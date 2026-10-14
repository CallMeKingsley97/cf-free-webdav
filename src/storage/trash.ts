import { RESERVED_ROOT } from "../http/path.js";
import { deleteKeys, listTree, MAX_TREE_OBJECTS, metadataForPut, StorageLimitError, type DavResource } from "./r2.js";

const TRASH_ROOT = `${RESERVED_ROOT}/trash/`;
const encoder = new TextEncoder();
const ID_PATTERN = /^[0-9a-f-]{36}$/i;

export type TrashKind = "deleted" | "version";

export interface TrashObjectEntry {
  originalKey: string;
  payloadKey: string;
  size: number;
  collection: boolean;
}

export interface TrashManifest {
  version: 1;
  id: string;
  kind: TrashKind;
  originalKey: string;
  collection: boolean;
  createdAt: string;
  expiresAt: string;
  byteSize: number;
  entries: TrashObjectEntry[];
}

export interface TrashPlan {
  manifest: TrashManifest;
  manifestKey: string;
  manifestBytes: number;
  sourceKeys: string[];
  sourceObjects: R2Object[];
}

export interface TrashItem extends TrashManifest {
  manifestBytes: number;
}

function entryPrefix(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error("Invalid trash entry ID.");
  return `${TRASH_ROOT}${id}/`;
}

function manifestKey(id: string): string {
  return `${entryPrefix(id)}manifest.json`;
}

function validRetentionDays(value: number): number {
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : 30;
}

function encodedSize(value: string): number {
  return encoder.encode(value).byteLength;
}

export async function planTrashEntry(
  bucket: R2Bucket,
  resource: DavResource,
  kind: TrashKind,
  retentionDays: number,
  now = new Date(),
): Promise<TrashPlan> {
  const prefix = resource.collection ? `${resource.key}/` : resource.key;
  let sourceObjects: R2Object[];
  if (resource.collection) {
    sourceObjects = await listTree(bucket, prefix);
  } else {
    const object = await bucket.head(resource.key);
    if (!object) throw new Error("The resource disappeared before it could be archived.");
    sourceObjects = [object];
  }

  const id = crypto.randomUUID();
  const targetPrefix = `${entryPrefix(id)}data/`;
  const entries = sourceObjects.map((object, index) => ({
    originalKey: object.key,
    payloadKey: `${targetPrefix}${String(index).padStart(4, "0")}${object.key.endsWith("/") ? "/" : ""}`,
    size: object.size,
    collection: object.key.endsWith("/"),
  }));
  const deletedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + validRetentionDays(retentionDays) * 86_400_000).toISOString();
  const manifest: TrashManifest = {
    version: 1,
    id,
    kind,
    originalKey: resource.key,
    collection: resource.collection,
    createdAt: deletedAt,
    expiresAt,
    byteSize: sourceObjects.reduce((sum, object) => sum + object.size, 0),
    entries,
  };
  const manifestJson = JSON.stringify(manifest);

  return {
    manifest,
    manifestKey: manifestKey(id),
    manifestBytes: encodedSize(manifestJson),
    sourceKeys: sourceObjects.map((object) => object.key),
    sourceObjects,
  };
}

export async function writeTrashPlan(bucket: R2Bucket, plan: TrashPlan): Promise<void> {
  const createdPayloads: string[] = [];
  try {
    for (let index = 0; index < plan.sourceObjects.length; index += 1) {
      const source = plan.sourceObjects[index];
      const entry = plan.manifest.entries[index];
      const body = await bucket.get(source.key);
      if (!body || !("body" in body)) throw new Error("The resource disappeared while it was being archived.");
      createdPayloads.push(entry.payloadKey);
      await bucket.put(entry.payloadKey, body.body, metadataForPut(body));
    }
    await bucket.put(plan.manifestKey, JSON.stringify(plan.manifest), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
  } catch (error) {
    await deleteKeys(bucket, [...createdPayloads, plan.manifestKey]).catch(() => undefined);
    throw error;
  }
}

export async function getTrashItem(bucket: R2Bucket, id: string): Promise<TrashItem | null> {
  const key = manifestKey(id);
  const object = await bucket.get(key);
  if (!object || !("body" in object)) return null;
  try {
    const manifest = JSON.parse(await object.text()) as TrashManifest;
    if (
      manifest.version !== 1 ||
      manifest.id !== id ||
      (manifest.kind !== "deleted" && manifest.kind !== "version") ||
      typeof manifest.originalKey !== "string" ||
      manifest.originalKey.startsWith(`${RESERVED_ROOT}/`) ||
      !Array.isArray(manifest.entries) ||
      manifest.entries.some((entry) =>
        !entry ||
        typeof entry.originalKey !== "string" ||
        entry.originalKey.startsWith(`${RESERVED_ROOT}/`) ||
        typeof entry.payloadKey !== "string" ||
        !entry.payloadKey.startsWith(`${entryPrefix(id)}data/`) ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0
      )
    ) return null;
    return { ...manifest, manifestBytes: object.size };
  } catch {
    return null;
  }
}

export async function listTrash(bucket: R2Bucket): Promise<TrashItem[]> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: TRASH_ROOT, delimiter: "/", limit: MAX_TREE_OBJECTS, cursor });
    for (const prefix of page.delimitedPrefixes) {
      const relative = prefix.slice(TRASH_ROOT.length).replace(/\/$/, "");
      if (ID_PATTERN.test(relative)) ids.add(relative);
    }
    if (page.truncated && !page.cursor) throw new StorageLimitError();
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const items = await Promise.all([...ids].map((id) => getTrashItem(bucket, id)));
  return items
    .filter((item): item is TrashItem => item !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function removeTrashItem(bucket: R2Bucket, item: TrashItem): Promise<number> {
  await deleteKeys(bucket, item.entries.map((entry) => entry.payloadKey));
  await bucket.delete(manifestKey(item.id));
  return item.byteSize + item.manifestBytes;
}

export async function measureTrashBytes(bucket: R2Bucket, item: TrashItem): Promise<number> {
  let bytes = 0;
  for (const entry of item.entries) {
    const object = await bucket.head(entry.payloadKey).catch(() => null);
    if (object) bytes += object.size;
  }
  const manifest = await bucket.head(manifestKey(item.id)).catch(() => null);
  return bytes + (manifest?.size || 0);
}

export async function restoreTrashItem(bucket: R2Bucket, item: TrashItem, replaceExisting = false): Promise<void> {
  const createdKeys: string[] = [];
  try {
    for (const entry of item.entries) {
      const source = await bucket.get(entry.payloadKey);
      if (!source || !("body" in source)) throw new Error("A retained file version is missing.");
      createdKeys.push(entry.originalKey);
      await bucket.put(entry.originalKey, source.body, metadataForPut(source));
    }
  } catch (error) {
    if (!replaceExisting) await deleteKeys(bucket, createdKeys).catch(() => undefined);
    throw error;
  }
}

export function trashManifestBytes(manifest: TrashManifest): number {
  return encodedSize(JSON.stringify(manifest));
}

export function isValidTrashId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export async function purgeExpiredTrash(bucket: R2Bucket, now = Date.now()): Promise<number> {
  const items = await listTrash(bucket);
  let releasedBytes = 0;
  for (const item of items) {
    if (Date.parse(item.expiresAt) > now) continue;
    releasedBytes += await removeTrashItem(bucket, item);
  }
  return releasedBytes;
}
