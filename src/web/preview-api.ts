import { parseDavPath } from "../http/path.js";

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const SAFE_PREVIEW_TYPES = /^(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|text\/plain)(?:;|$)/i;

export async function apiPreview(request: Request, env: Env): Promise<Response> {
  if (!env.FILES) return new Response("R2 bucket is not configured.", { status: 503 });
  const rawKey = new URL(request.url).searchParams.get("path") || "";
  const encoded = rawKey.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const path = parseDavPath(`/dav/${encoded}`);
  if (!path?.key || path.collectionHint) return new Response("A file path is required.", { status: 400 });

  try {
    const metadata = await env.FILES.head(path.key);
    if (!metadata) return new Response("File not found.", { status: 404 });
    const contentType = metadata.httpMetadata?.contentType || "application/octet-stream";
    if (!SAFE_PREVIEW_TYPES.test(contentType)) return new Response("Preview is not supported for this file type.", { status: 415 });
    if (contentType.toLowerCase().startsWith("text/plain") && metadata.size > MAX_TEXT_PREVIEW_BYTES) {
      return new Response("Text preview is limited to 1 MiB.", { status: 413 });
    }

    const object = await env.FILES.get(path.key, {
      onlyIf: request.headers,
      ...(request.headers.has("range") ? { range: request.headers } : {}),
    });
    if (!object) return new Response("File not found.", { status: 404 });
    if (!("body" in object)) {
      const notModified = request.headers.has("if-none-match") || request.headers.has("if-modified-since");
      return new Response(null, { status: notModified ? 304 : 412, headers: { etag: object.httpEtag } });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", contentType);
    headers.set("content-disposition", "inline");
    headers.set("etag", object.httpEtag);
    headers.set("last-modified", object.uploaded.toUTCString());
    headers.set("cache-control", "private, no-store");
    headers.set("x-content-type-options", "nosniff");
    headers.set("content-security-policy", "default-src 'none'; sandbox");
    headers.set("accept-ranges", "bytes");

    let status = 200;
    if (object.range) {
      const range = object.range;
      const suffixLength = "suffix" in range ? Math.min(range.suffix, object.size) : 0;
      const start = "offset" in range && range.offset !== undefined
        ? range.offset
        : suffixLength ? object.size - suffixLength : 0;
      const length = "length" in range && range.length !== undefined ? range.length : suffixLength || object.size - start;
      status = 206;
      headers.set("content-range", `bytes ${start}-${start + length - 1}/${object.size}`);
      headers.set("content-length", String(length));
    } else {
      headers.set("content-length", String(object.size));
    }
    return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
  } catch {
    return new Response("Unable to preview file.", { status: 500 });
  }
}
