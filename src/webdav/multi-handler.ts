import { hrefForPath, parseDestination, parentPath, type DavPath } from "../http/path.js";
import { backendById, configuredBackends, usesLegacyR2Mount, type BackendResource, type StorageBackend } from "../storage/backend.js";
import type { UsageClient } from "../monitor/limited-r2.js";

const ALLOW = "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE";

class DavError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function response(status: number, body = "", headers?: HeadersInit): Response {
  return new Response(body || null, { status, headers });
}

function failure(status: number, message: string): Response {
  return response(status, message, { "content-type": "text/plain; charset=utf-8" });
}

function rootResource(): BackendResource {
  return { backend: "r2", path: "", name: "", collection: true, size: 0, etag: '"root"', uploaded: new Date(0), createdAt: null, contentType: "httpd/unix-directory" };
}

function mountResource(backend: StorageBackend): BackendResource {
  return { backend: backend.id, path: "", name: backend.id, collection: true, size: 0, etag: `"mount-${backend.id}"`, uploaded: new Date(0), createdAt: null, contentType: "httpd/unix-directory" };
}

function globalDavPath(backendId: string, inner: string): DavPath {
  const segments = [backendId, ...inner.split("/").filter(Boolean)];
  return { segments, key: segments.join("/"), collectionHint: true };
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function propfindXml(origin: string, entries: Array<{ path: DavPath; resource: BackendResource }>): string {
  const rows = entries.map(({ path, resource }) => {
    const href = hrefForPath(origin, path, resource.collection);
    const type = resource.collection ? "<d:resourcetype><d:collection/></d:resourcetype>" : "<d:resourcetype/>";
    return `<d:response><d:href>${xmlEscape(href)}</d:href><d:propstat><d:prop><d:displayname>${xmlEscape(resource.name || path.segments.at(-1) || "")}</d:displayname>${type}<d:getcontentlength>${resource.size}</d:getcontentlength><d:getlastmodified>${xmlEscape(resource.uploaded.toUTCString())}</d:getlastmodified><d:getetag>${xmlEscape(resource.etag)}</d:getetag><d:getcontenttype>${xmlEscape(resource.contentType)}</d:getcontenttype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  }).join("");
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${rows}</d:multistatus>`;
}

function backendForPath(env: Env, path: DavPath): { backend: StorageBackend; inner: string } | null {
  if (!path.segments.length) return null;
  const backend = backendById(env, path.segments[0]);
  if (!backend && usesLegacyR2Mount(env)) {
    const legacy = backendById(env, "r2");
    return legacy ? { backend: legacy, inner: path.segments.join("/") } : null;
  }
  return backend ? { backend, inner: path.segments.slice(1).join("/") } : null;
}

async function handlePropfind(request: Request, env: Env, path: DavPath): Promise<Response> {
  const depth = (request.headers.get("depth") || "1").toLowerCase();
  if (depth !== "0" && depth !== "1") throw new DavError(400, "Depth must be 0 or 1.");
  const origin = new URL(request.url).origin;
  const entries: Array<{ path: DavPath; resource: BackendResource }> = [];
  if (!path.segments.length) {
    entries.push({ path, resource: rootResource() });
    if (depth === "1") {
      if (usesLegacyR2Mount(env)) {
        const backend = backendById(env, "r2");
        if (backend) {
          const children = await backend.list("");
          entries.push(...children.map((child) => ({ path: { segments: child.path.split("/").filter(Boolean), key: child.path, collectionHint: child.collection }, resource: child })));
        }
      } else {
        for (const backend of configuredBackends(env)) entries.push({ path: { segments: [backend.id], key: backend.id, collectionHint: true }, resource: mountResource(backend) });
      }
    }
  } else {
    const selected = backendForPath(env, path);
    if (!selected) throw new DavError(404, "Storage backend not found.");
    const resource = (path.segments.length === 1 ? mountResource(selected.backend) : await selected.backend.stat(selected.inner));
    if (!resource) throw new DavError(404, "Resource not found.");
    entries.push({ path, resource: { ...resource, path: selected.inner, name: resource.name || selected.backend.id } });
    if (depth === "1" && resource.collection) {
      const children = await selected.backend.list(selected.inner);
      entries.push(...children.map((child) => ({ path: { segments: [selected.backend.id, ...child.path.split("/").filter(Boolean)], key: `${selected.backend.id}/${child.path}`, collectionHint: child.collection }, resource: child })));
    }
  }
  return new Response(propfindXml(origin, entries), { status: 207, headers: { "content-type": "application/xml; charset=utf-8", dav: "1", "cache-control": "private, no-store" } });
}

async function handleGet(request: Request, env: Env, path: DavPath, usage: UsageClient): Promise<Response> {
  const selected = backendForPath(env, path);
  if (!selected || !selected.inner || path.collectionHint) throw new DavError(405, "A file path is required.");
  const result = await selected.backend.read(selected.inner, request);
  if (!result) throw new DavError(404, "Resource not found.");
  await usage.commit(0, 0, 1);
  return result;
}

async function handlePut(request: Request, env: Env, path: DavPath, usage: UsageClient): Promise<Response> {
  const selected = backendForPath(env, path);
  if (!selected || !selected.inner || path.collectionHint) throw new DavError(405, "PUT requires a file path.");
  const parent = parentPath({ ...path, segments: path.segments.slice(1), key: selected.inner, collectionHint: true });
  if (parent.key && !(await selected.backend.stat(parent.key))?.collection) throw new DavError(409, "The parent collection does not exist.");
  const current = await selected.backend.stat(selected.inner);
  if (current?.collection) throw new DavError(409, "A collection already uses this path.");
  const resource = await selected.backend.put(selected.inner, request);
  await usage.commit(0, 1, 0);
  return response(current ? 204 : 201, "", { etag: resource.etag, "last-modified": resource.uploaded.toUTCString() });
}

async function handleMkcol(request: Request, env: Env, path: DavPath): Promise<Response> {
  const selected = backendForPath(env, path);
  if (!selected || !selected.inner) throw new DavError(405, "MKCOL requires a collection path.");
  if (await selected.backend.stat(selected.inner)) throw new DavError(405, "The collection already exists.");
  const parent = selected.inner.split("/").slice(0, -1).join("/");
  if (parent && !(await selected.backend.stat(parent))?.collection) throw new DavError(409, "The parent collection does not exist.");
  await selected.backend.mkdir(selected.inner);
  return response(201);
}

async function handleDelete(env: Env, path: DavPath): Promise<Response> {
  const selected = backendForPath(env, path);
  if (!selected || !selected.inner) throw new DavError(403, "The backend root cannot be deleted.");
  if (!(await selected.backend.stat(selected.inner))) throw new DavError(404, "Resource not found.");
  await selected.backend.remove(selected.inner);
  return response(204);
}

async function handleCopyMove(request: Request, env: Env, path: DavPath, move: boolean): Promise<Response> {
  const source = backendForPath(env, path);
  const destination = parseDestination(request);
  const target = destination ? backendForPath(env, destination) : null;
  if (!source || !source.inner || !target || !target.inner) throw new DavError(400, "Source and destination must identify backend paths.");
  if (source.backend.id !== target.backend.id) throw new DavError(409, "Cross-backend COPY and MOVE are not supported; upload the file to the target backend instead.");
  if (!(await source.backend.stat(source.inner))) throw new DavError(404, "Source resource not found.");
  const existing = await target.backend.stat(target.inner);
  if (existing && (request.headers.get("overwrite") || "T").toUpperCase() === "F") throw new DavError(412, "Destination already exists.");
  if (move) await source.backend.move(source.inner, target.inner);
  else await source.backend.copy(source.inner, target.inner);
  return response(existing ? 204 : 201);
}

export async function handleMultiWebDav(request: Request, env: Env, path: DavPath, usage: UsageClient): Promise<Response> {
  try {
    switch (request.method) {
      case "OPTIONS": return response(200, "", { allow: ALLOW, dav: "1", "ms-author-via": "DAV" });
      case "PROPFIND": return handlePropfind(request, env, path);
      case "GET":
      case "HEAD": return handleGet(request, env, path, usage);
      case "PUT": return handlePut(request, env, path, usage);
      case "MKCOL": return handleMkcol(request, env, path);
      case "DELETE": return handleDelete(env, path);
      case "COPY": return handleCopyMove(request, env, path, false);
      case "MOVE": return handleCopyMove(request, env, path, true);
      case "PROPPATCH": return response(207, "", { dav: "1" });
      default: return response(405, "", { allow: ALLOW });
    }
  } catch (error) {
    if (error instanceof DavError) return failure(error.status, error.message);
    console.error(JSON.stringify({ level: "error", event: "webdav_backend_failed", error: error instanceof Error ? error.message : String(error) }));
    return failure(502, error instanceof Error ? error.message : "Storage backend request failed.");
  }
}

export async function listBackendFiles(env: Env, path: string): Promise<{ path: string[]; entries: BackendResource[] }> {
  const segments = path.split("/").filter(Boolean);
  if (!segments.length) {
    if (usesLegacyR2Mount(env)) {
      const backend = backendById(env, "r2");
      return { path: [], entries: backend ? await backend.list("") : [] };
    }
    return { path: [], entries: configuredBackends(env).map(mountResource) };
  }
  const backend = backendById(env, segments[0]);
  if (!backend && usesLegacyR2Mount(env)) {
    const legacy = backendById(env, "r2");
    return { path: segments, entries: legacy ? await legacy.list(segments.join("/")) : [] };
  }
  if (!backend) throw new DavError(404, "Storage backend not found.");
  const inner = segments.slice(1).join("/");
  return { path: segments, entries: await backend.list(inner) };
}

