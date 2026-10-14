import { parseDavPath } from "../http/path.js";
import { signManagedSharePath } from "../share/link.js";
import type { ShareStoreClient } from "../share/record.js";
import { statResource } from "../storage/r2.js";

interface ShareRequest {
  path: string;
  ttlHours: number;
  maxDownloads?: number | null;
}

const TTL_OPTIONS = [1, 24, 168, 720];
const MAX_DOWNLOADS = 10_000;

export async function apiShare(request: Request, env: Env, shares: ShareStoreClient): Promise<Response> {
  const secret = env.SHARE_SECRET || env.WEBDAV_PASSWORD;
  if (!secret) {
    return Response.json({ error: "Set the WEBDAV_PASSWORD secret before using WebDAV." }, { status: 503 });
  }
  if (!env.FILES) return Response.json({ error: "R2 bucket is not configured." }, { status: 503 });

  let body: ShareRequest;
  try {
    body = (await request.json()) as ShareRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.path !== "string" || !body.path) {
    return Response.json({ error: "A file path is required." }, { status: 400 });
  }
  if (!TTL_OPTIONS.includes(body.ttlHours)) {
    return Response.json({ error: "Unsupported validity period." }, { status: 400 });
  }
  const maxDownloads = body.maxDownloads == null
    ? null
    : typeof body.maxDownloads === "number" ? body.maxDownloads : Number.NaN;
  if (maxDownloads !== null && (!Number.isSafeInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > MAX_DOWNLOADS)) {
    return Response.json({ error: `Access limit must be from 1 to ${MAX_DOWNLOADS}.` }, { status: 400 });
  }

  const encodedPath = body.path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  const target = parseDavPath(`/dav/${encodedPath}`);
  if (!target || !target.key || target.collectionHint) {
    return Response.json({ error: "Only files can be shared." }, { status: 400 });
  }

  const resource = await statResource(env.FILES, target);
  if (!resource || resource.collection) {
    return Response.json({ error: "File not found." }, { status: 404 });
  }

  const id = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + body.ttlHours * 3600;
  const createdAt = new Date().toISOString();
  await shares.createShare({ id, fileKey: target.key, expiresAt, createdAt, maxDownloads });
  const signature = await signManagedSharePath(id, target.key, expiresAt, secret);
  const sharePath = target.segments.map((segment) => encodeURIComponent(segment)).join("/");
  return Response.json(
    {
      id,
      url: `${new URL(request.url).origin}/share/${id}/${expiresAt}/${signature}?path=${encodeURIComponent(sharePath)}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      maxDownloads,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function apiShares(request: Request, env: Env, shares: ShareStoreClient): Promise<Response> {
  const secret = env.SHARE_SECRET || env.WEBDAV_PASSWORD;
  if (!secret) return Response.json({ error: "Share signing secret is not configured." }, { status: 503 });

  const records = await shares.listShares();
  const origin = new URL(request.url).origin;
  const items = await Promise.all(records.map(async (share) => {
    const signature = await signManagedSharePath(share.id, share.fileKey, share.expiresAt, secret);
    const path = share.fileKey.split("/").map(encodeURIComponent).join("/");
    return {
      ...share,
      expiresAt: new Date(share.expiresAt * 1000).toISOString(),
      name: share.fileKey.split("/").at(-1) || share.fileKey,
      url: `${origin}/share/${share.id}/${share.expiresAt}/${signature}?path=${encodeURIComponent(path)}`,
    };
  }));
  return Response.json({ shares: items }, { headers: { "cache-control": "private, no-store" } });
}

export async function apiRevokeShare(id: string, shares: ShareStoreClient): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Share not found." }, { status: 404 });
  const existing = await shares.getShare(id);
  if (!existing) return Response.json({ error: "Share not found." }, { status: 404 });
  const revoked = await shares.revokeShare(id);
  return Response.json({ ok: true, revoked }, { headers: { "cache-control": "private, no-store" } });
}
