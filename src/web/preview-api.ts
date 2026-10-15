import { backendById, usesLegacyR2Mount } from "../storage/backend.js";

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const SAFE_PREVIEW_TYPES = /^(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|text\/plain)(?:;|$)/i;

export async function apiPreview(request: Request, env: Env): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("path") || "";
  const segments = raw.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const backend = (segments.length ? backendById(env, segments[0]) : null) || (usesLegacyR2Mount(env) ? backendById(env, "r2") : null);
  if (!backend || (!segments.length && !usesLegacyR2Mount(env))) return new Response("A file path is required.", { status: 400 });
  const path = usesLegacyR2Mount(env) ? segments.join("/") : segments.slice(1).join("/");
  const metadata = await backend.stat(path);
  if (!metadata || metadata.collection) return new Response("File not found.", { status: 404 });
  if (!SAFE_PREVIEW_TYPES.test(metadata.contentType)) return new Response("Preview is not supported for this file type.", { status: 415 });
  if (metadata.contentType.toLowerCase().startsWith("text/plain") && metadata.size > MAX_TEXT_PREVIEW_BYTES) return new Response("Text preview is limited to 1 MiB.", { status: 413 });
  const result = await backend.read(path, request);
  if (!result) return new Response("File not found.", { status: 404 });
  const headers = new Headers(result.headers);
  headers.set("content-type", metadata.contentType);
  headers.set("content-disposition", "inline");
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  headers.set("x-content-type-options", "nosniff");
  return new Response(result.body, { status: result.status, headers });
}
