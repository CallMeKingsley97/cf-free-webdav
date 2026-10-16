import { parseDavPath } from "../http/path.js";
import { DOUsageClient } from "../monitor/usage-client.js";
import { isInternalKey, statResource } from "../storage/r2.js";
import type { GalleryFileRecord, GalleryRecord } from "../features/records.js";

const MAX_GALLERY_FILES = 300;
const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", avif: "image/avif",
};
const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
};

export async function apiGalleries(request: Request, env: Env, store: DOUsageClient): Promise<Response> {
  if (request.method === "GET") {
    return Response.json({ galleries: await store.listGalleries() }, { headers: { "cache-control": "private, no-store" } });
  }
  if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
  if (!env.FILES) return Response.json({ error: "R2 bucket is not configured." }, { status: 503 });

  let body: { folder?: unknown; mode?: unknown; title?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (typeof body.folder !== "string" || (body.mode !== "photos" && body.mode !== "files")) {
    return Response.json({ error: "A folder and display mode are required." }, { status: 400 });
  }
  const encodedFolder = body.folder.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const path = parseDavPath(`/dav/${encodedFolder}${encodedFolder ? "/" : ""}`);
  if (!path) return Response.json({ error: "Invalid folder path." }, { status: 400 });
  const directory = await statResource(env.FILES, path);
  if (!directory?.collection) return Response.json({ error: "Folder not found." }, { status: 404 });

  const prefix = path.key ? `${path.key}/` : "";
  const files: GalleryFileRecord[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await env.FILES.list({ prefix, cursor, limit: 1000, include: ["httpMetadata"] });
    scanned += page.objects.length;
    if (scanned > 10_000) return Response.json({ error: "Folder scan is limited to 10,000 stored objects." }, { status: 413 });
    for (const object of page.objects) {
      if (isInternalKey(object.key) || object.key.endsWith("/")) continue;
      const type = galleryContentType(object.key, body.mode);
      if (!type) continue;
      const relative = object.key.slice(prefix.length);
      if (!relative) continue;
      files.push({ key: object.key, name: relative, size: object.size, contentType: type });
      if (files.length > MAX_GALLERY_FILES) {
        return Response.json({ error: `A public page can include up to ${MAX_GALLERY_FILES} safe files.` }, { status: 413 });
      }
    }
    if (page.truncated && !page.cursor) return Response.json({ error: "Unable to finish listing this folder." }, { status: 503 });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (!files.length) return Response.json({ error: "This folder has no files supported by the selected page type." }, { status: 400 });

  const defaultTitle = path.segments.at(-1) || (body.mode === "photos" ? "照片集" : "文件展示");
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : defaultTitle;
  const gallery: GalleryRecord = {
    id: crypto.randomUUID(), folder: path.key, mode: body.mode, title, createdAt: new Date().toISOString(), revoked: false, files,
  };
  try {
    await store.createGallery(gallery);
    return Response.json({ id: gallery.id, url: `${new URL(request.url).origin}/gallery/${gallery.id}`, fileCount: files.length }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to publish this folder." }, { status: 503 });
  }
}

export async function apiRevokeGallery(id: string, store: DOUsageClient): Promise<Response> {
  if (!isId(id)) return Response.json({ error: "Public page not found." }, { status: 404 });
  return Response.json({ ok: await store.revokeGallery(id) }, { headers: { "cache-control": "private, no-store" } });
}

export async function handleGalleryPublic(request: Request, env: Env, store: DOUsageClient): Promise<Response> {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const id = parts[1] || "";
  if (!isId(id)) return new Response("Not found.", { status: 404 });
  const gallery = await store.getGallery(id);
  if (!gallery || gallery.revoked) return new Response("This public page is unavailable.", { status: 404 });
  if (parts.length === 2 && request.method === "GET") return galleryPage(gallery, new URL(request.url).origin);
  if (parts.length !== 4 || parts[2] !== "file" || !/^\d+$/.test(parts[3]) || !["GET", "HEAD"].includes(request.method)) {
    return new Response("Not found.", { status: 404 });
  }
  if (!env.FILES) return new Response("R2 bucket is not configured.", { status: 503 });
  const file = gallery.files[Number(parts[3])];
  if (!file) return new Response("Not found.", { status: 404 });
  const contentType = galleryContentType(file.name, gallery.mode);
  if (!contentType || contentType !== file.contentType) return new Response("Not found.", { status: 404 });
  const object = await env.FILES.get(file.key);
  if (!object || !("body" in object)) return new Response("File not found.", { status: 404 });
  const image = contentType.startsWith("image/");
  const filename = encodeURIComponent(file.name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const headers = new Headers({
    "content-type": contentType,
    "content-disposition": `${image ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "referrer-policy": "no-referrer",
    "content-length": String(object.size),
  });
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

function galleryPage(gallery: GalleryRecord, origin: string): Response {
  const cards = gallery.files.map((file, index) => {
    const href = `${origin}/gallery/${gallery.id}/file/${index}`;
    const image = file.contentType.startsWith("image/");
    if (gallery.mode === "photos") {
      return `<a class="photo" href="${attr(href)}"><img loading="lazy" src="${attr(href)}" alt="${attr(file.name)}"><span>${escapeHtml(file.name)}</span></a>`;
    }
    return `<article class="file"><div class="file-type">${image ? "IMG" : file.contentType === "application/pdf" ? "PDF" : "TXT"}</div><div class="file-info"><strong>${escapeHtml(file.name)}</strong><small>${formatSize(file.size)}</small></div><a href="${attr(href)}" aria-label="下载 ${attr(file.name)}">${image ? "查看" : "下载"}</a></article>`;
  }).join("");
  const title = escapeHtml(gallery.title);
  const heading = gallery.mode === "photos" ? "照片集" : "文件展示";
  const bodyClass = gallery.mode === "photos" ? "photos" : "files";
  const style = `*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#17243a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}.page{width:min(1120px,calc(100% - 36px));margin:36px auto 64px}.top{display:flex;align-items:end;justify-content:space-between;gap:20px;padding-bottom:18px;border-bottom:1px solid #dfe5ed}.kicker{margin:0 0 8px;color:#587080;font-size:11px;font-weight:700;letter-spacing:.08em}h1{margin:0;font-size:28px;overflow-wrap:anywhere}.count{color:#718198;font-size:13px;white-space:nowrap}.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-top:18px}.photo{overflow:hidden;border:1px solid #e2e7ee;border-radius:7px;background:#fff;color:inherit;text-decoration:none}.photo img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#e9edf2}.photo span{display:block;padding:10px 11px;font-size:12px;overflow-wrap:anywhere}.files{margin-top:18px;border-top:1px solid #e2e7ee}.file{display:flex;align-items:center;gap:12px;min-height:68px;padding:11px 12px;border-bottom:1px solid #e2e7ee;background:#fff}.file-type{display:grid;place-items:center;width:40px;height:40px;flex:0 0 auto;border-radius:6px;background:#e6f3ef;color:#16865b;font-size:10px;font-weight:750}.file-info{min-width:0;flex:1}.file strong{display:block;overflow-wrap:anywhere;font-size:13px}.file small{display:block;margin-top:4px;color:#78879b;font-size:11px}.file a{display:grid;place-items:center;min-width:60px;min-height:40px;border:1px solid #dbe3ee;border-radius:6px;color:#245ac0;text-decoration:none;font-size:12px;font-weight:650}.foot{margin-top:16px;color:#8794a6;font-size:11px}@media(max-width:600px){.page{margin-top:24px}.top{align-items:start;flex-direction:column;gap:7px}.photos{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}h1{font-size:23px}}`;
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="referrer" content="no-referrer"><style>${style}</style></head><body><main class="page"><header class="top"><div><p class="kicker">CF FREE WEBDAV · ${heading}</p><h1>${title}</h1></div><span class="count">${gallery.files.length} 个项目</span></header><section class="${bodyClass}">${cards}</section><footer class="foot">由 CF Free WebDAV 发布</footer></main></body></html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

function galleryContentType(key: string, mode: "photos" | "files"): string | null {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  const image = IMAGE_TYPES[extension];
  if (image) return image;
  if (mode === "files") return DOCUMENT_TYPES[extension] || null;
  return null;
}

function formatSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function isId(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

function attr(value: string): string {
  return escapeHtml(value);
}
