import { parseDavPath } from "../http/path.js";
import { DOUsageClient } from "../monitor/usage-client.js";
import type { UsageClient } from "../monitor/limited-r2.js";
import { statResource } from "../storage/r2.js";
import type { InboxRecord } from "../features/records.js";
import { createInboxToken, verifyInboxToken } from "../features/inbox-token.js";

const INBOX_TTLS = [24, 168, 720];
const MAX_UPLOAD_BYTES = 100_000_000;

export async function apiInboxes(request: Request, env: Env, store: DOUsageClient): Promise<Response> {
  if (request.method === "GET") {
    const [inboxes, items] = await Promise.all([store.listInboxes(), store.listInboxItems()]);
    const folderById = new Map(inboxes.map((inbox) => [inbox.id, inbox.folder]));
    const secret = env.SHARE_SECRET || env.WEBDAV_PASSWORD || "";
    const origin = new URL(request.url).origin;
    const urls = await Promise.all(inboxes.map(async (inbox) => [inbox.id, `${origin}/inbox/${await createInboxToken(inbox.id, secret)}`] as const));
    const urlById = new Map(urls);
    const pendingCounts = new Map<string, number>();
    for (const item of items) pendingCounts.set(item.linkId, (pendingCounts.get(item.linkId) || 0) + 1);
    return Response.json({
      inboxes: inboxes.map((inbox) => ({
        ...inbox,
        url: urlById.get(inbox.id),
        pendingCount: pendingCounts.get(inbox.id) || 0,
      })),
      items: items.map((item) => ({ ...item, folder: folderById.get(item.linkId) || "" })),
    }, { headers: { "cache-control": "private, no-store" } });
  }
  if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
  if (!env.FILES) return Response.json({ error: "R2 bucket is not configured." }, { status: 503 });

  let body: { folder?: unknown; ttlHours?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (typeof body.folder !== "string" || !INBOX_TTLS.includes(Number(body.ttlHours))) {
    return Response.json({ error: "A folder and supported validity period are required." }, { status: 400 });
  }
  const encodedFolder = body.folder.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const folder = parseDavPath(`/dav/${encodedFolder}${encodedFolder ? "/" : ""}`);
  if (!folder) return Response.json({ error: "Invalid folder path." }, { status: 400 });
  const resource = await statResource(env.FILES, folder);
  if (!resource?.collection) return Response.json({ error: "Folder not found." }, { status: 404 });

  const secret = env.SHARE_SECRET || env.WEBDAV_PASSWORD || "";
  if (!secret) return Response.json({ error: "Share signing secret is not configured." }, { status: 503 });
  const id = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + Number(body.ttlHours) * 3600;
  const record: InboxRecord = {
    id, folder: folder.key, createdAt: new Date().toISOString(),
    expiresAt, revoked: false, uploadCount: 0,
  };
  try {
    await store.createInbox(record);
    const token = await createInboxToken(record.id, secret);
    return Response.json({ id: record.id, url: `${new URL(request.url).origin}/inbox/${token}`, expiresAt: new Date(expiresAt * 1000).toISOString() }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create inbox link." }, { status: 503 });
  }
}

export async function apiRevokeInbox(id: string, store: DOUsageClient): Promise<Response> {
  if (!isId(id)) return Response.json({ error: "Inbox link not found." }, { status: 404 });
  return Response.json({ ok: await store.revokeInbox(id) }, { headers: { "cache-control": "private, no-store" } });
}

export async function apiInboxItem(
  request: Request,
  inboxId: string,
  itemId: string,
  action: "keep" | "delete",
  env: Env,
  usage: UsageClient,
  store: DOUsageClient,
): Promise<Response> {
  if (request.method !== "POST" && action === "keep") return new Response("Method not allowed.", { status: 405 });
  if (request.method !== "DELETE" && action === "delete") return new Response("Method not allowed.", { status: 405 });
  if (!env.FILES) return Response.json({ error: "R2 bucket is not configured." }, { status: 503 });
  const [inbox, item] = await Promise.all([store.getInbox(inboxId), store.getInboxItem(itemId)]);
  if (!inbox || !item || item.linkId !== inboxId) return Response.json({ error: "Pending file not found." }, { status: 404 });

  if (action === "delete") {
    const resolved = await store.resolveInboxItem(itemId);
    if (!resolved) return Response.json({ error: "Pending file not found." }, { status: 404 });
    try {
      await env.FILES.delete(item.objectKey);
    } catch {
      await store.finishInboxUpload(resolved).catch(() => undefined);
      return Response.json({ error: "Unable to delete pending file." }, { status: 500 });
    }
    await usage.release(item.size, 0, 0);
    return Response.json({ ok: true });
  }

  const source = await env.FILES.get(item.objectKey);
  if (!source || !("body" in source)) return Response.json({ error: "Pending file data is missing." }, { status: 404 });
  const parent = inbox.folder;
  const encodedParent = parent.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const parentPath = parseDavPath(`/dav/${encodedParent}${encodedParent ? "/" : ""}`);
  if (!parentPath || !(await statResource(env.FILES, parentPath))?.collection) {
    return Response.json({ error: "Destination folder no longer exists." }, { status: 409 });
  }
  const destination = await availableName(env, parent, item.name);
  if (!destination) return Response.json({ error: "Unable to choose a destination name." }, { status: 409 });

  let copied = false;
  try {
    await env.FILES.put(destination, source.body, {
      httpMetadata: {
        contentType: safeContentType(item.name),
        ...(safeContentType(item.name) === "application/octet-stream" ? { contentDisposition: "attachment" } : {}),
      },
      customMetadata: { createdAt: new Date().toISOString() },
    });
    copied = true;
    const resolved = await store.resolveInboxItem(itemId);
    if (!resolved) throw new Error("Pending file was already handled.");
    try {
      await env.FILES.delete(item.objectKey);
    } catch (error) {
      await store.finishInboxUpload(resolved).catch(() => undefined);
      throw error;
    }
    return Response.json({ ok: true, name: destination.slice(destination.lastIndexOf("/") + 1) });
  } catch {
    if (copied) await env.FILES.delete(destination).catch(() => undefined);
    return Response.json({ error: "Unable to keep pending file." }, { status: 500 });
  }
}

export async function handleInboxPublic(
  request: Request,
  env: Env,
  usage: UsageClient,
  store: DOUsageClient,
): Promise<Response> {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const token = parts[1] || "";
  const inboxId = await verifyInboxToken(token, env.SHARE_SECRET || env.WEBDAV_PASSWORD || "");
  if (!inboxId) return new Response("Not found.", { status: 404 });
  const inbox = await store.lookupInbox(inboxId);
  if (!inbox || inbox.revoked) return new Response("This upload link is unavailable.", { status: 404 });
  if (Math.floor(Date.now() / 1000) > inbox.expiresAt) return new Response("This upload link has expired.", { status: 410 });

  if (parts.length === 2 && request.method === "GET") return uploadPage();
  if (parts.length !== 3 || request.method !== "PUT") return new Response("Not found.", { status: 404 });
  if (!env.FILES) return new Response("R2 bucket is not configured.", { status: 503 });
  let name: string;
  try { name = decodeURIComponent(parts[2]); }
  catch { return new Response("Invalid filename.", { status: 400 }); }
  if (!validFilename(name)) return new Response("Invalid filename.", { status: 400 });
  const rawLength = request.headers.get("content-length");
  if (!rawLength || !/^\d+$/.test(rawLength)) return new Response("Content-Length is required.", { status: 411 });
  const expectedSize = Number(rawLength);
  if (!Number.isSafeInteger(expectedSize) || expectedSize > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Each file must be 100 MB or smaller." }, { status: 413 });
  }

  const reservation = await store.reserveInboxUpload(inbox.id);
  if (!reservation.ok) {
    const status = reservation.reason === "expired" ? 410 : reservation.reason === "limit" ? 429 : 404;
    return Response.json({ error: reservation.reason || "Upload link unavailable." }, { status });
  }
  const objectKey = `.__cf_free_webdav__/inbox/${inbox.id}/${crypto.randomUUID()}`;
  let reservationId: string | undefined;
  let written = false;
  let recorded = false;
  let committed = false;
  let received = 0;
  try {
    reservationId = await usage.reserve(expectedSize, 1, 0);
    const limitedBody = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_UPLOAD_BYTES || received > expectedSize) throw new Error("Upload exceeds its declared size.");
        controller.enqueue(chunk);
      },
    }));
    const object = await env.FILES.put(objectKey, limitedBody || new Uint8Array(), {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    written = true;
    if (received !== expectedSize || object.size !== expectedSize) throw new Error("Upload size did not match Content-Length.");
    const item = {
      id: objectKey.slice(objectKey.lastIndexOf("/") + 1), linkId: inbox.id, objectKey,
      name, size: object.size, uploadedAt: new Date().toISOString(),
    };
    await usage.commit(object.size, 1, 0, reservationId);
    committed = true;
    await store.finishInboxUpload(item);
    recorded = true;
    return Response.json({ ok: true, name, size: object.size }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (recorded) await store.resolveInboxItem(objectKey.slice(objectKey.lastIndexOf("/") + 1)).catch(() => undefined);
    if (written) await env.FILES.delete(objectKey).catch(() => undefined);
    if (committed) await usage.release(expectedSize, 0, 0).catch(() => undefined);
    else if (reservationId) await usage.cancel(reservationId).catch(() => undefined);
    await store.cancelInboxUpload(inbox.id).catch(() => undefined);
    return Response.json({ error: error instanceof Error ? error.message : "Upload failed." }, { status: 500 });
  }
}

function uploadPage(): Response {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  const style = `*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#17243a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}.wrap{width:min(620px,calc(100% - 32px));margin:9vh auto;padding:28px;border:1px solid #e1e7f0;border-radius:12px;background:#fff}.eyebrow{margin:0 0 8px;color:#60718b;font-size:11px;font-weight:700;letter-spacing:.08em}h1{margin:0;font-size:24px}.sub{margin:8px 0 24px;color:#66768d;font-size:14px;line-height:1.6}.drop{display:grid;place-items:center;min-height:180px;padding:20px;border:1px dashed #9db3d6;border-radius:8px;background:#f8faff;text-align:center}.drop input{max-width:100%;margin:14px auto}.drop button{min-height:44px;padding:0 18px;border:0;border-radius:7px;background:#2563eb;color:#fff;font-weight:650}.list{padding:0;list-style:none}.list li{padding:10px 0;border-bottom:1px solid #edf0f5;color:#52647d;font-size:13px;overflow-wrap:anywhere}.error{color:#b9363e}.progress{height:6px;margin-top:12px;border-radius:4px;background:#edf1f6;overflow:hidden}.progress i{display:block;height:100%;width:0;background:#16865b}small{display:block;margin-top:18px;color:#7b8aa0;line-height:1.5}`;
  const script = `const input=document.querySelector('#files'),list=document.querySelector('#list'),button=document.querySelector('#upload');function send(file){return new Promise((resolve,reject)=>{const row=document.createElement('li');row.textContent=file.name+' · 上传中';list.prepend(row);const xhr=new XMLHttpRequest();xhr.open('PUT',location.pathname+'/'+encodeURIComponent(file.name));xhr.upload.onprogress=e=>{if(e.lengthComputable)row.textContent=file.name+' · '+Math.round(e.loaded/e.total*100)+'%'};xhr.onload=()=>{if(xhr.status<400){row.textContent=file.name+' · 已送达，等待确认';resolve()}else{let message='上传失败';try{message=JSON.parse(xhr.responseText||'{}').error||message}catch{}row.textContent=file.name+' · '+message;row.className='error';reject(new Error('部分文件上传失败'))}};xhr.onerror=()=>{row.textContent=file.name+' · 网络错误';row.className='error';reject(new Error('网络错误'))};xhr.send(file)})}button.addEventListener('click',async()=>{button.disabled=true;try{for(const file of input.files){if(file.size>100000000){const row=document.createElement('li');row.textContent=file.name+' · 超过 100 MB 限制';row.className='error';list.prepend(row);continue}await send(file)}}catch{}finally{button.disabled=false}});`;
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>安全收件箱</title><style nonce="${nonce}">${style}</style></head><body><main class="wrap"><p class="eyebrow">CF FREE WEBDAV</p><h1>安全收件箱</h1><p class="sub">选择需要提交的文件。上传内容仅进入待确认区，链接创建者确认前不会进入云盘目录。</p><div class="drop"><label for="files">选择一个或多个文件</label><input id="files" type="file" multiple><button id="upload" type="button">开始上传</button></div><ul id="list" class="list" aria-live="polite"></ul><small>单个文件最大 100 MB；此链接不能查看或下载已上传文件。</small></main><script nonce="${nonce}">${script}</script></body></html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}

async function availableName(env: Env, folder: string, name: string): Promise<string | null> {
  const slash = folder ? `${folder}/` : "";
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 0; index < 1000; index += 1) {
    const candidate = `${slash}${index ? `${base} (${index})${extension}` : name}`;
    const path = parseDavPath(`/dav/${candidate.split("/").map(encodeURIComponent).join("/")}`);
    if (path && !(await statResource(env.FILES!, path))) return candidate;
  }
  return null;
}

function safeContentType(name: string): string {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ({
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm",
    txt: "text/plain; charset=utf-8", pdf: "application/pdf",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

function validFilename(name: string): boolean {
  return Boolean(name) && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(name) && new TextEncoder().encode(name).byteLength <= 255;
}

function isId(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}
