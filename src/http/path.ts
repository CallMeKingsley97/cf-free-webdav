export const DAV_MOUNT_PATH = "/dav";

export interface DavPath {
  segments: string[];
  key: string;
  collectionHint: boolean;
}

export function parseDavPath(pathname: string): DavPath | null {
  if (pathname !== DAV_MOUNT_PATH && !pathname.startsWith(`${DAV_MOUNT_PATH}/`)) {
    return null;
  }

  const suffix = pathname.slice(DAV_MOUNT_PATH.length);
  if (suffix.startsWith("//")) return null;
  const rawPath = suffix.replace(/^\//, "");
  if (rawPath.includes("//")) return null;
  const collectionHint = rawPath === "" || rawPath.endsWith("/");
  const segments: string[] = [];

  try {
    for (const rawSegment of rawPath.split("/")) {
      if (!rawSegment) continue;
      const segment = decodeURIComponent(rawSegment);
      if (
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(segment)
      ) {
        return null;
      }
      segments.push(segment);
    }
  } catch {
    return null;
  }

  const key = segments.join("/");
  if (new TextEncoder().encode(key).byteLength > 1023) return null;

  return {
    segments,
    key,
    collectionHint: collectionHint || segments.length === 0,
  };
}

export function parentPath(path: DavPath): DavPath {
  const segments = path.segments.slice(0, -1);
  return { segments, key: segments.join("/"), collectionHint: true };
}

export function hrefForPath(origin: string, path: DavPath, collection: boolean): string {
  const encoded = path.segments.map((segment) => encodeURIComponent(segment)).join("/");
  const base = encoded ? `${DAV_MOUNT_PATH}/${encoded}` : `${DAV_MOUNT_PATH}/`;
  return `${origin}${base}${collection && encoded ? "/" : ""}`;
}

export function parseDestination(request: Request): DavPath | null {
  const value = request.headers.get("destination");
  if (!value) return null;

  try {
    const destination = new URL(value, request.url);
    if (
      destination.origin !== new URL(request.url).origin ||
      destination.search ||
      destination.hash
    ) {
      return null;
    }
    return parseDavPath(destination.pathname);
  } catch {
    return null;
  }
}
