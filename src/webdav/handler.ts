import { parentPath, parseDestination, type DavPath } from "../http/path.js";
import {
  proppatchPropertyNames,
  proppatchRejectedDocument,
  propfindDocument,
  requestedProperties,
} from "../http/xml.js";
import {
  deleteKeys,
  listChildren,
  listTree,
  MAX_TREE_OBJECTS,
  metadataForPut,
  statResource,
  StorageLimitError,
  type DavResource,
} from "../storage/r2.js";
import { estimatePrefixSize } from "../storage/size.js";
import type { UsageClient } from "../monitor/limited-r2.js";
import { QuotaExceededError } from "../monitor/quota.js";

const ALLOW = "OPTIONS, PROPFIND, PROPPATCH, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE";
const XML_HEADERS = {
  "content-type": "application/xml; charset=utf-8",
  "cache-control": "private, no-store",
  dav: "1",
};

class DavError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DavError";
  }
}

function response(status: number, body = "", headers?: HeadersInit): Response {
  return new Response(body || null, { status, headers });
}

function failure(status: number, message: string): Response {
  return response(status, message, { "content-type": "text/plain; charset=utf-8" });
}

function resourcePath(key: string, collection: boolean): DavPath {
  const segments = key ? key.split("/") : [];
  return { key, segments, collectionHint: collection };
}

function etagHeaders(etag: string, uploaded?: Date): Headers {
  const headers = new Headers({ etag, "cache-control": "private, no-store" });
  if (uploaded) headers.set("last-modified", uploaded.toUTCString());
  return headers;
}

function readMetadata(request: Request): R2HTTPMetadata {
  const metadata: R2HTTPMetadata = {
    contentType: request.headers.get("content-type") || "application/octet-stream",
  };
  const fields: Array<[Exclude<keyof R2HTTPMetadata, "cacheExpiry">, string]> = [
    ["contentLanguage", "content-language"],
    ["contentDisposition", "content-disposition"],
    ["contentEncoding", "content-encoding"],
    ["cacheControl", "cache-control"],
  ];
  for (const [field, header] of fields) {
    const value = request.headers.get(header);
    if (value) metadata[field] = value;
  }
  return metadata;
}

function requestSize(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

async function requireParentCollection(env: Env, path: DavPath): Promise<void> {
  if (!path.segments.length) throw new DavError(409, "A parent collection is required.");
  const parent = await statResource(env.FILES, parentPath(path));
  if (!parent || !parent.collection) throw new DavError(409, "The parent collection does not exist.");
}

async function readSmallBody(request: Request, limit: number): Promise<string> {
  const size = requestSize(request);
  if (size !== null && size > limit) throw new DavError(413, "XML request body is too large.");
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new DavError(413, "XML request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new DavError(400, "XML request body must use UTF-8.");
  }
}

async function handlePropfind(request: Request, env: Env, path: DavPath): Promise<Response> {
  const body = await readSmallBody(request, 16_384);

  const resource = await statResource(env.FILES, path);
  if (!resource) throw new DavError(404, "Resource not found.");

  const depth = (request.headers.get("depth") || "1").toLowerCase();
  if (depth === "infinity") throw new DavError(403, "Infinite-depth PROPFIND is disabled.");
  if (depth !== "0" && depth !== "1") throw new DavError(400, "Depth must be 0 or 1.");

  const entries = [{ path: resourcePath(resource.key, resource.collection), resource }];
  if (depth === "1" && resource.collection) {
    const children = await listChildren(env.FILES, resource.key);
    entries.push(
      ...children.map((child) => ({
        path: resourcePath(child.key, child.collection),
        resource: child,
      })),
    );
  }

  const properties = requestedProperties(body);
  return new Response(
    propfindDocument(new URL(request.url).origin, entries, properties.names, properties.namesOnly),
    { status: 207, headers: XML_HEADERS },
  );
}

async function handleProppatch(request: Request, env: Env, path: DavPath): Promise<Response> {
  const body = await readSmallBody(request, 16_384);

  const resource = await statResource(env.FILES, path);
  if (!resource) throw new DavError(404, "Resource not found.");
  const properties = proppatchPropertyNames(body);
  if (!properties.length) throw new DavError(400, "Invalid PROPPATCH request body.");

  const responsePath = resourcePath(resource.key, resource.collection);
  return new Response(
    proppatchRejectedDocument(new URL(request.url).origin, responsePath, properties),
    { status: 207, headers: { ...XML_HEADERS, "cache-control": "no-store" } },
  );
}

async function handleGet(request: Request, env: Env, path: DavPath): Promise<Response> {
  if (!path.key || path.collectionHint) throw new DavError(405, "Collections cannot be downloaded.");

  const object = await env.FILES.get(path.key, {
    onlyIf: request.headers,
    range: request.headers,
  });
  if (!object) throw new DavError(404, "Resource not found.");
  if (!("body" in object)) {
    const notModified =
      request.headers.has("if-none-match") || request.headers.has("if-modified-since");
    const failedMatch =
      request.headers.has("if-match") || request.headers.has("if-unmodified-since");
    const status = failedMatch ? 412 : notModified ? 304 : 412;
    return response(status, "", etagHeaders(object.httpEtag, object.uploaded));
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("last-modified", object.uploaded.toUTCString());
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, no-store");

  let status = 200;
  if (object.range) {
    const suffixLength = object.range.suffix
      ? Math.min(object.range.suffix, object.size)
      : 0;
    const start =
      object.range.offset ?? (suffixLength ? object.size - suffixLength : 0);
    const length =
      object.range.length ?? (suffixLength || object.size - start);
    const end = start + length - 1;
    status = 206;
    headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
    headers.set("content-length", String(length));
  } else {
    headers.set("content-length", String(object.size));
  }

  return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
}

async function handleHead(env: Env, path: DavPath): Promise<Response> {
  if (!path.key || path.collectionHint) throw new DavError(405, "Collections do not have a file body.");
  const object = await env.FILES.head(path.key);
  if (!object) throw new DavError(404, "Resource not found.");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("last-modified", object.uploaded.toUTCString());
  headers.set("content-length", String(object.size));
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, no-store");
  return response(200, "", headers);
}

async function handlePut(request: Request, env: Env, path: DavPath, usage: UsageClient): Promise<Response> {
  if (!path.key || path.collectionHint) throw new DavError(405, "PUT requires a file path.");
  await requireParentCollection(env, path);

  const current = await statResource(env.FILES, path);
  if (current?.collection) throw new DavError(409, "A collection already uses this path.");
  const previousSize = current ? current.size : 0;
  const contentLength = requestSize(request);
  const reservedSize = contentLength === null ? 0 : Math.max(contentLength - previousSize, 0);
  await usage.reserve(reservedSize, 0, 0);
  const object = await env.FILES.put(path.key, request.body || new Uint8Array(), {
    onlyIf: request.headers,
    httpMetadata: readMetadata(request),
  });
  if (!object) throw new DavError(412, "A request precondition failed.");
  await usage.commit(object.size - previousSize, 0, 0);

  const headers = etagHeaders(object.httpEtag);
  return response(current ? 204 : 201, "", headers);
}

async function handleMkcol(request: Request, env: Env, path: DavPath): Promise<Response> {
  if (!path.key) throw new DavError(405, "The root collection already exists.");
  const size = requestSize(request);
  if ((size !== null && size > 0) || (size === null && request.body)) {
    throw new DavError(415, "MKCOL request bodies are not supported.");
  }

  const existing = await statResource(env.FILES, path);
  if (existing || (await env.FILES.head(path.key))) {
    throw new DavError(405, "The collection or resource already exists.");
  }
  await requireParentCollection(env, path);

  await env.FILES.put(`${path.key}/`, "", {
    httpMetadata: { contentType: "httpd/unix-directory" },
  });
  return response(201);
}

async function handleDelete(env: Env, path: DavPath, usage: UsageClient): Promise<Response> {
  if (!path.key) throw new DavError(403, "The root collection cannot be deleted.");
  const resource = await statResource(env.FILES, path);
  if (!resource) throw new DavError(404, "Resource not found.");

  if (resource.collection) {
    const prefix = `${resource.key}/`;
    const objects = await listTree(env.FILES, prefix);
    const keys = [...new Set([`${prefix}`, ...objects.map((object) => object.key)])];
    if (keys.length > MAX_TREE_OBJECTS) throw new StorageLimitError();
    await deleteKeys(env.FILES, keys);
    const releasedSize = objects.reduce((sum, object) => sum + object.size, 0);
    await usage.release(releasedSize, 0, 0);
  } else {
    await env.FILES.delete(resource.key);
    await usage.release(resource.size, 0, 0);
  }
  return response(204);
}

interface CopyPlan {
  from?: string;
  to: string;
  directory: boolean;
  size: number;
  metadata?: R2Object;
}

async function destinationObjects(
  env: Env,
  resource: DavResource | null,
): Promise<string[]> {
  if (!resource) return [];
  if (resource.collection) {
    const prefix = `${resource.key}/`;
    const objects = await listTree(env.FILES, prefix);
    const keys = [...new Set([prefix, ...objects.map((object) => object.key)])];
    if (keys.length > MAX_TREE_OBJECTS) throw new StorageLimitError();
    return keys;
  }
  return [resource.key];
}

async function buildCopyPlan(
  env: Env,
  source: DavResource,
  destination: DavPath,
  depth: string,
): Promise<CopyPlan[]> {
  if (!source.collection) {
    return [{ from: source.key, to: destination.key, directory: false, size: source.size }];
  }
  if (new TextEncoder().encode(`${destination.key}/`).byteLength > 1024) {
    throw new DavError(414, "Destination collection path is too long.");
  }

  const sourcePrefix = `${source.key}/`;
  const destinationPrefix = `${destination.key}/`;
  const rootMarker = await env.FILES.head(sourcePrefix);
  const plan: CopyPlan[] = [
    {
      from: rootMarker ? sourcePrefix : undefined,
      to: destinationPrefix,
      directory: true,
      size: 0,
      metadata: rootMarker || undefined,
    },
  ];
  if (depth === "0") return plan;

  const objects = await listTree(env.FILES, sourcePrefix);
  for (const object of objects) {
    if (object.key === sourcePrefix) continue;
    const relative = object.key.slice(sourcePrefix.length);
    if (!relative) continue;
    plan.push({
      from: object.key,
      to: `${destinationPrefix}${relative}`,
      directory: object.key.endsWith("/"),
      size: object.size,
      metadata: object,
    });
  }
  if (plan.length > MAX_TREE_OBJECTS) throw new StorageLimitError();
  return plan;
}

async function applyCopyPlan(env: Env, plan: CopyPlan[]): Promise<void> {
  for (const item of plan) {
    if (item.directory) {
      await env.FILES.put(
        item.to,
        "",
        item.metadata
          ? metadataForPut(item.metadata, "httpd/unix-directory")
          : { httpMetadata: { contentType: "httpd/unix-directory" } },
      );
      continue;
    }

    if (!item.from) throw new DavError(500, "Copy source is missing.");
    const object = await env.FILES.get(item.from);
    if (!object || !("body" in object)) {
      throw new DavError(404, "A source object disappeared during the operation.");
    }
    await env.FILES.put(item.to, object.body, metadataForPut(object));
  }
}

async function handleCopyMove(
  request: Request,
  env: Env,
  sourcePath: DavPath,
  move: boolean,
  usage: UsageClient,
): Promise<Response> {
  if (!sourcePath.key) throw new DavError(403, "The root collection cannot be copied or moved.");
  const source = await statResource(env.FILES, sourcePath);
  if (!source) throw new DavError(404, "Source resource not found.");

  const destination = parseDestination(request);
  if (!destination || !destination.key) {
    throw new DavError(400, "Destination must be a path on this WebDAV server.");
  }
  if (source.key === destination.key) return response(204);
  if (source.collection && destination.key.startsWith(`${source.key}/`)) {
    throw new DavError(409, "A collection cannot be copied into itself.");
  }
  if (source.collection && source.key.startsWith(`${destination.key}/`)) {
    throw new DavError(409, "A collection cannot be copied over one of its parents.");
  }
  if (source.collection && !move) {
    const requestedDepth = (request.headers.get("depth") || "infinity").toLowerCase();
    if (requestedDepth !== "0" && requestedDepth !== "infinity") {
      throw new DavError(400, "COPY Depth must be 0 or infinity.");
    }
  }

  const overwriteHeader = (request.headers.get("overwrite") || "T").toUpperCase();
  if (overwriteHeader !== "T" && overwriteHeader !== "F") {
    throw new DavError(400, "Overwrite must be T or F.");
  }

  await requireParentCollection(env, destination);
  const destinationPath = { ...destination, collectionHint: false };
  const existing = await statResource(env.FILES, destinationPath);
  if (existing && existing.collection !== source.collection) {
    throw new DavError(409, "Source and destination resource types must match.");
  }
  if (existing && overwriteHeader === "F") throw new DavError(412, "Destination already exists.");

  const depth = move ? "infinity" : (request.headers.get("depth") || "infinity").toLowerCase();
  const plan = await buildCopyPlan(env, source, destination, depth);
  const copiedSize = plan.reduce((sum, item) => sum + item.size, 0);
  const oldDestinationKeys = await destinationObjects(env, existing);
  if (!existing?.collection) {
    const destinationFile = await env.FILES.head(destination.key);
    if (destinationFile) oldDestinationKeys.push(destination.key);
  }
  const replacedSize = existing?.collection
    ? await estimatePrefixSize(env.FILES, `${destination.key}/`)
    : existing ? existing.size : 0;

  await usage.reserve(copiedSize, 0, 0);

  await applyCopyPlan(env, plan);

  const desiredKeys = new Set(plan.map((item) => item.to));
  const staleKeys = oldDestinationKeys.filter((key) => !desiredKeys.has(key));
  if (staleKeys.length) await deleteKeys(env.FILES, staleKeys);

  await usage.commit(copiedSize - replacedSize, 0, 0);

  if (move) {
    if (source.collection) {
      const sourcePrefix = `${source.key}/`;
      await deleteKeys(
        env.FILES,
        [...new Set([sourcePrefix, ...plan.flatMap((item) => item.from ? [item.from] : [])])],
      );
    } else {
      await env.FILES.delete(source.key);
    }
    await usage.release(copiedSize, 0, 0);
  }

  return response(existing ? 204 : 201);
}

async function routeMethod(request: Request, env: Env, path: DavPath, usage: UsageClient): Promise<Response> {
  switch (request.method) {
    case "OPTIONS":
      return response(200, "", {
        allow: ALLOW,
        dav: "1",
        "ms-author-via": "DAV",
      });
    case "PROPFIND":
      return handlePropfind(request, env, path);
    case "PROPPATCH":
      return handleProppatch(request, env, path);
    case "GET":
      return handleGet(request, env, path);
    case "HEAD":
      return handleHead(env, path);
    case "PUT":
      return handlePut(request, env, path, usage);
    case "MKCOL":
      return handleMkcol(request, env, path);
    case "DELETE":
      return handleDelete(env, path, usage);
    case "COPY":
      return handleCopyMove(request, env, path, false, usage);
    case "MOVE":
      return handleCopyMove(request, env, path, true, usage);
    default:
      return response(405, "", { allow: ALLOW });
  }
}

export async function handleWebDav(
  request: Request,
  env: Env,
  path: DavPath,
  usage: UsageClient,
): Promise<Response> {
  try {
    return await routeMethod(request, env, path, usage);
  } catch (error) {
    if (error instanceof DavError) return failure(error.status, error.message);
    if (error instanceof StorageLimitError) return failure(507, error.message);
    if (error instanceof QuotaExceededError) return failure(507, error.message);
    console.error(
      JSON.stringify({
        level: "error",
        event: "webdav_operation_failed",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return failure(500, "The WebDAV operation could not be completed.");
  }
}
