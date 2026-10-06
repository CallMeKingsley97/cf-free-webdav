import type { DavPath } from "../http/path.js";

export const MAX_TREE_OBJECTS = 1000;

export class StorageLimitError extends Error {
  constructor() {
    super("The operation exceeds the configured object limit.");
    this.name = "StorageLimitError";
  }
}

export interface DavResource {
  key: string;
  collection: boolean;
  size: number;
  etag: string;
  uploaded: Date;
  contentType: string;
}

function fromObject(object: R2Object, key: string, collection = false): DavResource {
  return {
    key,
    collection,
    size: collection ? 0 : object.size,
    etag: object.httpEtag || `"${object.etag}"`,
    uploaded: object.uploaded,
    contentType: collection
      ? "httpd/unix-directory"
      : object.httpMetadata?.contentType || "application/octet-stream",
  };
}

function impliedCollection(key: string, marker?: R2Object): DavResource {
  return {
    key,
    collection: true,
    size: 0,
    etag: marker?.httpEtag || `"dir-${encodeURIComponent(key || "root")}"`,
    uploaded: marker?.uploaded || new Date(0),
    contentType: "httpd/unix-directory",
  };
}

export async function statResource(
  bucket: R2Bucket,
  path: DavPath,
): Promise<DavResource | null> {
  if (!path.key) return impliedCollection("");

  const file = path.collectionHint ? null : await bucket.head(path.key);
  if (file) return fromObject(file, path.key);

  const markerKey = `${path.key}/`;
  const marker = await bucket.head(markerKey);
  if (marker) return fromObject(marker, path.key, true);

  const contents = await bucket.list({
    prefix: markerKey,
    delimiter: "/",
    limit: 1,
  });
  if (contents.objects.some((object) => object.key !== markerKey) || contents.delimitedPrefixes.length) {
    return impliedCollection(path.key);
  }
  return null;
}

export async function listChildren(
  bucket: R2Bucket,
  collectionKey: string,
): Promise<DavResource[]> {
  const prefix = collectionKey ? `${collectionKey}/` : "";
  const resources = new Map<string, DavResource>();
  let cursor: string | undefined;

  do {
    const page = await bucket.list({
      prefix,
      delimiter: "/",
      limit: MAX_TREE_OBJECTS,
      cursor,
      include: ["httpMetadata"],
    });
    for (const object of page.objects) {
      if (object.key === prefix) continue;
      const relative = object.key.slice(prefix.length);
      if (!relative) continue;

      if (relative.endsWith("/")) {
        const childName = relative.slice(0, -1);
        if (childName.includes("/")) continue;
        const childKey = `${collectionKey ? `${collectionKey}/` : ""}${childName}`;
        resources.set(childKey, fromObject(object, childKey, true));
      } else if (!relative.includes("/")) {
        resources.set(object.key, fromObject(object, object.key));
      }
    }

    for (const directoryPrefix of page.delimitedPrefixes) {
      const childKey = directoryPrefix.slice(prefix.length).replace(/\/$/, "");
      if (!childKey || childKey.includes("/")) continue;
      const key = `${collectionKey ? `${collectionKey}/` : ""}${childKey}`;
      if (!resources.has(key)) resources.set(key, impliedCollection(key));
    }

    if (resources.size > MAX_TREE_OBJECTS) throw new StorageLimitError();
    if (page.truncated && !page.cursor) throw new StorageLimitError();
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return [...resources.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export async function listTree(
  bucket: R2Bucket,
  prefix: string,
): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await bucket.list({
      prefix,
      cursor,
      limit: MAX_TREE_OBJECTS,
      include: ["httpMetadata", "customMetadata"],
    });
    objects.push(...page.objects);
    if (objects.length > MAX_TREE_OBJECTS) throw new StorageLimitError();
    if (!page.truncated) break;
    if (!page.cursor || objects.length >= MAX_TREE_OBJECTS) throw new StorageLimitError();
    cursor = page.cursor;
  }

  return objects;
}

export async function deleteKeys(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let offset = 0; offset < keys.length; offset += 1000) {
    await bucket.delete(keys.slice(offset, offset + 1000));
  }
}

export function metadataForPut(
  object?: R2Object | null,
  contentType?: string,
): { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> } {
  const httpMetadata = object?.httpMetadata
    ? { ...object.httpMetadata }
    : contentType
      ? { contentType }
      : undefined;
  return {
    ...(httpMetadata ? { httpMetadata } : {}),
    ...(object?.customMetadata ? { customMetadata: { ...object.customMetadata } } : {}),
  };
}
