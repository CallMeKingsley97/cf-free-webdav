import { parseDavPath } from "../http/path.js";
import { isInternalKey, statResource } from "../storage/r2.js";

const PAGE_SIZE = 1000;

export async function apiMap(request: Request, env: Env): Promise<Response> {
  if (!env.FILES) return Response.json({ error: "R2 bucket is not configured." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const rawPath = params.get("path") || "";
  const encodedPath = rawPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const path = parseDavPath(`/dav/${encodedPath}${encodedPath ? "/" : ""}`);
  if (!path) return Response.json({ error: "Invalid folder path." }, { status: 400 });
  const directory = await statResource(env.FILES, path);
  if (!directory?.collection) return Response.json({ error: "Folder not found." }, { status: 404 });
  const cursor = params.get("cursor") || undefined;
  if (cursor && cursor.length > 4096) return Response.json({ error: "Invalid page cursor." }, { status: 400 });
  const prefix = path.key ? `${path.key}/` : "";
  const page = await env.FILES.list({
    prefix,
    cursor,
    limit: PAGE_SIZE,
    include: ["httpMetadata", "customMetadata"],
  });
  const entries = page.objects
    .filter((object) => !isInternalKey(object.key) && !object.key.endsWith("/"))
    .map((object) => ({
      key: object.key,
      name: object.key.slice(prefix.length),
      size: object.size,
      uploaded: object.uploaded.toISOString(),
      contentType: object.httpMetadata?.contentType || "application/octet-stream",
    }));
  return Response.json({
    path: path.segments,
    entries,
    cursor: page.truncated ? page.cursor || null : null,
  }, { headers: { "cache-control": "private, no-store" } });
}
