import type { UsageClient } from "../monitor/limited-r2.js";
import { listBackendFiles } from "../webdav/multi-handler.js";
import { usesLegacyR2Mount } from "../storage/backend.js";

function fileHref(path: string, collection: boolean): string {
  const encoded = path.split("/").filter(Boolean).map((segment) => encodeURIComponent(segment)).join("/");
  return `/dav/${encoded}${collection && encoded ? "/" : ""}`;
}

export async function apiFiles(request: Request, env: Env, usage: UsageClient): Promise<Response> {
  const requested = new URL(request.url).searchParams.get("path") || "";
  try {
    const result = await listBackendFiles(env, requested.replace(/^\/+/, ""));
    const entries = result.entries.map((item) => {
      const key = usesLegacyR2Mount(env) ? item.path : item.path ? `${item.backend}/${item.path}` : item.backend;
      return {
        key,
        name: item.name || item.backend,
        backend: item.backend,
        backendLabel: item.backend === "onedrive" ? "Microsoft OneDrive" : "Cloudflare R2",
        collection: item.collection,
        size: item.size,
        uploaded: item.uploaded.toISOString(),
        createdAt: item.createdAt?.toISOString() || null,
        contentType: item.contentType,
        href: fileHref(key, item.collection),
      };
    });
    return Response.json(
      {
        path: result.path,
        entries: entries.sort((left, right) =>
          left.collection !== right.collection ? Number(right.collection) - Number(left.collection) : left.name.localeCompare(right.name),
        ),
        usage: await usage.summary(),
        backends: result.path.length ? undefined : entries.map((entry) => ({ id: entry.backend, label: entry.backendLabel })),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "web_files_failed" }));
    return Response.json({ error: error instanceof Error ? error.message : "Unable to list files." }, { status: 502 });
  }
}
