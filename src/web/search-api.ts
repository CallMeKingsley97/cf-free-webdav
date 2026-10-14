import { parseDavPath } from "../http/path.js";
import { isInternalKey } from "../storage/r2.js";

interface SearchEntry {
  key: string;
  name: string;
  collection: boolean;
  size: number;
  uploaded: string;
  createdAt: string | null;
  contentType: string;
  href: string;
}

function hrefForKey(key: string, collection: boolean): string {
  const encoded = key.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `/dav/${encoded}${collection && encoded ? "/" : ""}`;
}

function matches(name: string, query: string): boolean {
  return name.toLocaleLowerCase("zh-CN").includes(query.toLocaleLowerCase("zh-CN"));
}

export async function apiSearch(request: Request, env: Env): Promise<Response> {
  if (!env.FILES) return Response.json({ error: "R2 bucket is not configured." }, { status: 503 });
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (!query || query.length > 200) return Response.json({ error: "Search text must contain 1 to 200 characters." }, { status: 400 });

  const rawPath = url.searchParams.get("path") || "";
  const encodedPath = rawPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const root = parseDavPath(`/dav/${encodedPath}${encodedPath ? "/" : ""}`);
  if (!root) return Response.json({ error: "Invalid search path." }, { status: 400 });

  const rawCursor = url.searchParams.get("cursor") || undefined;
  if (rawCursor && rawCursor.length > 4096) return Response.json({ error: "Invalid search cursor." }, { status: 400 });
  const prefix = root.key ? `${root.key}/` : "";

  try {
    const page = await env.FILES.list({
      prefix,
      cursor: rawCursor,
      limit: 1000,
      include: ["httpMetadata", "customMetadata"],
    });
    const results = new Map<string, SearchEntry>();
    for (const object of page.objects) {
      if (isInternalKey(object.key) || object.key === prefix) continue;
      const isMarker = object.key.endsWith("/");
      const relative = object.key.slice(prefix.length).replace(/\/$/, "");
      if (!relative) continue;
      const segments = relative.split("/");

      for (let index = 0; index < segments.length; index += 1) {
        const name = segments[index];
        if (!name || !matches(name, query)) continue;
        const key = [root.key, ...segments.slice(0, index + 1)].filter(Boolean).join("/");
        const collection = isMarker || index < segments.length - 1;
        const entry: SearchEntry = {
          key,
          name,
          collection,
          size: collection ? 0 : object.size,
          uploaded: object.uploaded.toISOString(),
          createdAt: object.customMetadata?.createdAt || null,
          contentType: collection ? "httpd/unix-directory" : object.httpMetadata?.contentType || "application/octet-stream",
          href: hrefForKey(key, collection),
        };
        const previous = results.get(key);
        if (!previous || (!collection && object.uploaded.toISOString() > previous.uploaded)) results.set(key, entry);
      }
    }

    return Response.json(
      { entries: [...results.values()].sort((a, b) => a.key.localeCompare(b.key)), cursor: page.truncated ? page.cursor : null },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return Response.json({ error: "Unable to search files." }, { status: 500 });
  }
}
