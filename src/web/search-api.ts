import { backendById, configuredBackends, usesLegacyR2Mount } from "../storage/backend.js";

export async function apiSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (!query || query.length > 200) return Response.json({ error: "Search text must contain 1 to 200 characters." }, { status: 400 });
  const rawPath = (url.searchParams.get("path") || "").replace(/^\/+|\/+$/g, "");
  const segments = rawPath.split("/").filter(Boolean);
  const legacy = usesLegacyR2Mount(env);
  const targets = segments.length && !legacy ? [backendById(env, segments[0])].filter(Boolean) : configuredBackends(env);
  const inner = legacy ? segments.join("/") : segments.slice(1).join("/");
  const entries = [];
  for (const backend of targets) {
    if (!backend) continue;
    const results = await backend.search(segments.length ? inner : "", query);
    entries.push(...results.map((item) => {
      const key = usesLegacyR2Mount(env) ? item.path : `${item.backend}/${item.path}`;
      const encoded = key.split("/").map(encodeURIComponent).join("/");
      return { key, name: item.name, backend: item.backend, backendLabel: item.backend === "onedrive" ? "Microsoft OneDrive" : "Cloudflare R2", collection: item.collection, size: item.size, uploaded: item.uploaded.toISOString(), createdAt: item.createdAt?.toISOString() || null, contentType: item.contentType, href: `/dav/${encoded}${item.collection ? "/" : ""}` };
    }));
  }
  const sorted = entries.sort((a, b) => a.key.localeCompare(b.key));
  const offset = Math.max(0, Number(url.searchParams.get("cursor") || 0) || 0);
  const page = sorted.slice(offset, offset + 1000);
  return Response.json({ entries: page, cursor: offset + page.length < sorted.length ? String(offset + page.length) : null }, { headers: { "cache-control": "private, no-store" } });
}
