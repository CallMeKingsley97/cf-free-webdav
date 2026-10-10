import { parseDavPath } from "../http/path.js";
import { listChildren, StorageLimitError, statResource } from "../storage/r2.js";
import type { UsageClient } from "../monitor/limited-r2.js";
import { QuotaExceededError } from "../monitor/quota.js";

interface ApiEntry {
  key: string;
  name: string;
  collection: boolean;
  size: number;
  uploaded: string;
  contentType: string;
  href: string;
}

function fileHref(segments: string[], collection: boolean): string {
  const encoded = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return `/dav/${encoded}${collection && encoded ? "/" : ""}`;
}

export async function apiFiles(request: Request, env: Env, usage: UsageClient): Promise<Response> {
  if (!env.FILES) {
    return Response.json({ error: "R2 bucket is not configured." }, { status: 503 });
  }

  const requested = new URL(request.url).searchParams.get("path") || "";
  const path = parseDavPath(`/dav/${requested.replace(/^\/+/, "")}${requested ? "/" : ""}`);
  if (!path) return Response.json({ error: "Invalid path." }, { status: 400 });

  try {
    const resource = await statResource(env.FILES, path);
    if (!resource || !resource.collection) {
      return Response.json({ error: "Directory not found." }, { status: 404 });
    }
    const children = await listChildren(env.FILES, path.key);
    const entries: ApiEntry[] = children.map((item) => ({
      key: item.key,
      name: item.key.slice(item.key.lastIndexOf("/") + 1),
      collection: item.collection,
      size: item.size,
      uploaded: item.uploaded.toISOString(),
      contentType: item.contentType,
      href: fileHref(item.key.split("/"), item.collection),
    }));
    return Response.json(
      {
        path: path.segments,
        entries: entries.sort((left, right) =>
          left.collection !== right.collection ? Number(right.collection) - Number(left.collection) : left.name.localeCompare(right.name),
        ),
        usage: await usage.summary(),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof StorageLimitError) return Response.json({ error: error.message }, { status: 507 });
    if (error instanceof QuotaExceededError) return Response.json({ error: error.message }, { status: 503 });
    console.error(JSON.stringify({ level: "error", event: "web_files_failed" }));
    return Response.json({ error: "Unable to list files." }, { status: 500 });
  }
}
