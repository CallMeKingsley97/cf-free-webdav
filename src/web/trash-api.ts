import { parentPath, parseDavPath } from "../http/path.js";
import type { UsageClient } from "../monitor/limited-r2.js";
import { QuotaExceededError } from "../monitor/quota.js";
import {
  getTrashItem,
  isValidTrashId,
  listTrash,
  measureTrashBytes,
  planTrashEntry,
  removeTrashItem,
  restoreTrashItem,
  writeTrashPlan,
  type TrashItem,
} from "../storage/trash.js";
import { deleteKeys, statResource } from "../storage/r2.js";

class TrashApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function resourcePath(key: string, collection: boolean) {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return parseDavPath(`/dav/${encoded}${collection ? "/" : ""}`);
}

function itemResponse(item: TrashItem) {
  return {
    id: item.id,
    kind: item.kind,
    key: item.originalKey,
    name: item.originalKey.split("/").at(-1) || item.originalKey,
    collection: item.collection,
    size: item.byteSize,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
  };
}

export async function apiTrash(request: Request, env: Env, usage: UsageClient): Promise<Response> {
  if (!env.FILES) return Response.json({ error: "R2 bucket is not configured." }, { status: 503 });
  const bucket = env.FILES;
  const retentionDays = Number(env.TRASH_RETENTION_DAYS) || 30;
  const url = new URL(request.url);

  try {
    if (request.method === "GET" && url.pathname === "/api/trash") {
      const items = await listTrash(bucket);
      const now = Date.now();
      const activeItems = items.filter((item) => Date.parse(item.expiresAt) > now);
      return Response.json(
        { items: activeItems.map(itemResponse) },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    if (request.method === "DELETE" && url.pathname === "/api/trash") {
      const items = await listTrash(bucket);
      let releasedBytes = 0;
      for (const item of items) releasedBytes += await removeTrashItem(bucket, item);
      if (releasedBytes) await usage.release(releasedBytes, 0, 0);
      return Response.json({ ok: true, deleted: items.length }, { headers: { "cache-control": "private, no-store" } });
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 3 && parts[0] === "api" && parts[1] === "trash" && request.method === "DELETE") {
      if (!isValidTrashId(parts[2])) return Response.json({ error: "Trash entry not found." }, { status: 404 });
      const item = await getTrashItem(bucket, parts[2]);
      if (!item) return Response.json({ error: "Trash entry not found." }, { status: 404 });
      const releasedBytes = await removeTrashItem(bucket, item);
      await usage.release(releasedBytes, 0, 0);
      return Response.json({ ok: true }, { headers: { "cache-control": "private, no-store" } });
    }

    if (
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "trash" &&
      parts[3] === "restore" &&
      request.method === "POST"
    ) {
      if (!isValidTrashId(parts[2])) return Response.json({ error: "Trash entry not found." }, { status: 404 });
      const item = await getTrashItem(bucket, parts[2]);
      if (!item) return Response.json({ error: "Trash entry not found." }, { status: 404 });
      if (Date.parse(item.expiresAt) <= Date.now()) {
        const releasedBytes = await removeTrashItem(bucket, item);
        await usage.release(releasedBytes, 0, 0);
        return Response.json({ error: "This trash entry has expired." }, { status: 410 });
      }
      await restore(item, bucket, usage, retentionDays);
      return Response.json({ ok: true }, { headers: { "cache-control": "private, no-store" } });
    }

    return Response.json({ error: "Not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof TrashApiError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof QuotaExceededError) return Response.json({ error: error.reason }, { status: 507 });
    console.error(JSON.stringify({ level: "error", event: "trash_api_failed", error: error instanceof Error ? error.name : "unknown" }));
    return Response.json({ error: "The trash operation could not be completed." }, { status: 500 });
  }
}

async function restore(item: TrashItem, bucket: R2Bucket, usage: UsageClient, retentionDays: number): Promise<void> {
  const target = resourcePath(item.originalKey, item.collection);
  if (!target || !target.key) throw new TrashApiError(400, "The stored path is invalid.");
  const parent = parentPath(target);
  if (parent.key) {
    const parentResource = await statResource(bucket, parent);
    if (!parentResource?.collection) throw new TrashApiError(409, "The original parent directory no longer exists.");
  }

  const current = await statResource(bucket, target);
  if (item.kind === "deleted" && current) {
    throw new TrashApiError(409, "A resource already exists at the original path.");
  }
  if (item.kind === "version" && current && current.collection !== item.collection) {
    throw new TrashApiError(409, "The current resource has a different type from this version.");
  }

  let backupPlan = null;
  if (item.kind === "version" && current) {
    backupPlan = await planTrashEntry(bucket, current, "version", retentionDays);
  }
  const netStorageDelta = (backupPlan?.manifestBytes || 0) - item.manifestBytes;
  const reservationId = await usage.reserve(Math.max(0, netStorageDelta), 0, 0);
  let backupItem: TrashItem | null = null;
  let destinationCleared = false;
  let destinationModified = false;
  let usageCommitted = false;

  try {
    if (backupPlan) {
      await writeTrashPlan(bucket, backupPlan);
      backupItem = { ...backupPlan.manifest, manifestBytes: backupPlan.manifestBytes };
      if (current?.collection) {
        await deleteKeys(bucket, backupPlan.sourceKeys);
        destinationCleared = true;
      }
    }
    await restoreTrashItem(bucket, item, Boolean(current && !current.collection));
    destinationModified = true;
    await usage.commit(netStorageDelta, 0, 0, reservationId);
    usageCommitted = true;
    await removeTrashItem(bucket, item);
  } catch (error) {
    if (usageCommitted) {
      // Restoration has already been accounted for as if the old archive was
      // removed. If cleanup only deleted some R2 objects, add back exactly the
      // bytes that are still present rather than charging the whole archive.
      const remainingArchiveBytes = await measureTrashBytes(bucket, item);
      if (remainingArchiveBytes) {
        await usage.commit(remainingArchiveBytes, 0, 0).catch(() => undefined);
      }
      console.error(JSON.stringify({ level: "error", event: "trash_restore_cleanup_failed", id: item.id }));
      throw new TrashApiError(500, "The file was restored, but its recovery copy could not be removed. Retry from the trash list.");
    }
    let rolledBack = true;
    if (backupItem && destinationCleared) {
      try {
        await deleteKeys(bucket, item.entries.map((entry) => entry.originalKey));
        await restoreTrashItem(bucket, backupItem);
      } catch {
        rolledBack = false;
      }
    } else if (backupItem && destinationModified) {
      try {
        await restoreTrashItem(bucket, backupItem, true);
      } catch {
        rolledBack = false;
      }
    } else if (!backupItem && destinationModified) {
      try {
        await deleteKeys(bucket, item.entries.map((entry) => entry.originalKey));
      } catch {
        rolledBack = false;
      }
    }
    if (backupItem && rolledBack) await removeTrashItem(bucket, backupItem).catch(() => undefined);
    if (!rolledBack) {
      await usage.cancel(reservationId);
      const duplicatedBytes = (backupItem?.byteSize || 0) + (backupItem?.manifestBytes || 0) + item.byteSize;
      await usage.commit(duplicatedBytes, 0, 0).catch(() => undefined);
    } else {
      await usage.cancel(reservationId);
    }
    throw error;
  }
}

