export type BackendId = "r2" | "onedrive";

export interface BackendResource {
  backend: BackendId;
  path: string;
  name: string;
  collection: boolean;
  size: number;
  etag: string;
  uploaded: Date;
  createdAt: Date | null;
  contentType: string;
}

export interface StorageBackend {
  readonly id: BackendId;
  readonly label: string;
  available(): boolean;
  stat(path: string): Promise<BackendResource | null>;
  list(path: string): Promise<BackendResource[]>;
  read(path: string, request: Request): Promise<Response | null>;
  put(path: string, request: Request): Promise<BackendResource>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  search(path: string, query: string): Promise<BackendResource[]>;
}

const MAX_LIST = 1000;

function nameOf(path: string): string {
  return path.split("/").filter(Boolean).at(-1) || "";
}

function collectionResource(backend: BackendId, path: string, uploaded = new Date(0)): BackendResource {
  return {
    backend,
    path,
    name: nameOf(path),
    collection: true,
    size: 0,
    etag: `"${backend}-dir-${encodeURIComponent(path || "root")}"`,
    uploaded,
    createdAt: null,
    contentType: "httpd/unix-directory",
  };
}

function parseHttpDate(value: string | null | undefined): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export class R2Backend implements StorageBackend {
  readonly id = "r2" as const;
  readonly label = "Cloudflare R2";
  constructor(private readonly bucket?: R2Bucket) {}
  available(): boolean { return Boolean(this.bucket); }

  async stat(path: string): Promise<BackendResource | null> {
    if (!this.bucket) return null;
    if (!path) return collectionResource(this.id, "");
    const object = await this.bucket.head(path);
    if (object) return this.fromObject(path, object, false);
    const marker = await this.bucket.head(`${path}/`);
    if (marker) return this.fromObject(path, marker, true);
    const page = await this.bucket.list({ prefix: `${path}/`, delimiter: "/", limit: 1 });
    return page.objects.length || page.delimitedPrefixes.length ? collectionResource(this.id, path) : null;
  }

  async list(path: string): Promise<BackendResource[]> {
    if (!this.bucket) return [];
    const prefix = path ? `${path}/` : "";
    const result = new Map<string, BackendResource>();
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, delimiter: "/", limit: MAX_LIST, cursor, include: ["httpMetadata", "customMetadata"] });
      for (const object of page.objects) {
        if (object.key === prefix || object.key.startsWith(".__cf_free_webdav__")) continue;
        const key = object.key.endsWith("/") ? object.key.slice(0, -1) : object.key;
        if (!key.slice(prefix.length).includes("/")) result.set(key, this.fromObject(key, object, object.key.endsWith("/")));
      }
      for (const child of page.delimitedPrefixes) {
        const key = child.replace(/\/$/, "");
        if (key.startsWith(".__cf_free_webdav__")) continue;
        result.set(key, collectionResource(this.id, key));
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return [...result.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(path: string, request: Request): Promise<Response | null> {
    if (!this.bucket) return null;
    const object = await this.bucket.get(path, {
      ...(request.headers.has("range") ? { range: request.headers } : {}),
      ...(request.headers.has("if-none-match") ? { onlyIf: request.headers } : {}),
    });
    if (!object || !("body" in object)) return null;
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("last-modified", object.uploaded.toUTCString());
    headers.set("accept-ranges", "bytes");
    headers.set("content-length", String(object.size));
    let status = 200;
    if (object.range) {
      const range = object.range;
      const suffix = "suffix" in range ? Math.min(range.suffix, object.size) : 0;
      const start = "offset" in range && range.offset !== undefined ? range.offset : Math.max(0, object.size - suffix);
      const length = "length" in range && range.length !== undefined ? range.length : (suffix || object.size - start);
      headers.set("content-length", String(length));
      headers.set("content-range", `bytes ${start}-${start + length - 1}/${object.size}`);
      status = 206;
    }
    return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
  }

  async put(path: string, request: Request): Promise<BackendResource> {
    if (!this.bucket) throw new Error("R2 is not configured.");
    const result = await this.bucket.put(path, request.body || new Uint8Array(), {
      httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" },
    });
    return this.fromObject(path, result, false);
  }

  async mkdir(path: string): Promise<void> {
    if (!this.bucket) throw new Error("R2 is not configured.");
    await this.bucket.put(`${path}/`, "", { httpMetadata: { contentType: "httpd/unix-directory" } });
  }

  async remove(path: string): Promise<void> {
    if (!this.bucket) throw new Error("R2 is not configured.");
    const resource = await this.stat(path);
    if (!resource) return;
    if (!resource.collection) return this.bucket.delete(path);
    const page = await this.bucket.list({ prefix: `${path}/`, limit: MAX_LIST });
    await this.bucket.delete([...page.objects.map((object) => object.key), `${path}/`]);
  }

  async copy(from: string, to: string): Promise<void> {
    if (!this.bucket) throw new Error("R2 is not configured.");
    const resource = await this.stat(from);
    if (!resource) throw new Error("Source resource not found.");
    if (!resource.collection) {
      const object = await this.bucket.get(from);
      if (!object || !("body" in object)) throw new Error("Source resource disappeared.");
      await this.bucket.put(to, object.body, { httpMetadata: object.httpMetadata });
      return;
    }
    for (const child of await this.listTree(from)) {
      const relative = child.path.slice(from.length).replace(/^\//, "");
      if (child.collection) await this.mkdir(`${to}/${relative}`);
      else await this.copy(child.path, `${to}/${relative}`);
    }
  }

  async move(from: string, to: string): Promise<void> { await this.copy(from, to); await this.remove(from); }

  async search(path: string, query: string): Promise<BackendResource[]> {
    const all = await this.listTree(path);
    const lower = query.toLocaleLowerCase("zh-CN");
    return all.filter((item) => item.name.toLocaleLowerCase("zh-CN").includes(lower));
  }

  private async listTree(path: string): Promise<BackendResource[]> {
    const result: BackendResource[] = [];
    for (const item of await this.list(path)) {
      result.push(item);
      if (item.collection) result.push(...await this.listTree(item.path));
    }
    return result;
  }

  private fromObject(path: string, object: R2Object, collection: boolean): BackendResource {
    return {
      backend: this.id,
      path,
      name: nameOf(path),
      collection,
      size: collection ? 0 : object.size,
      etag: object.httpEtag,
      uploaded: object.uploaded,
      createdAt: object.customMetadata?.createdAt ? parseHttpDate(object.customMetadata.createdAt) : null,
      contentType: collection ? "httpd/unix-directory" : object.httpMetadata?.contentType || "application/octet-stream",
    };
  }
}

interface GraphItem {
  id: string;
  name: string;
  size?: number;
  eTag?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { path?: string };
  "@microsoft.graph.downloadUrl"?: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export class OneDriveBackend implements StorageBackend {
  readonly id = "onedrive" as const;
  readonly label = "Microsoft OneDrive";
  private readonly baseFolder = "CF Free WebDAV";

  constructor(private readonly env: Env) {}
  available(): boolean { return Boolean(this.env.ONEDRIVE_REFRESH_TOKEN && this.env.ONEDRIVE_CLIENT_ID); }

  async stat(path: string): Promise<BackendResource | null> {
    const item = await this.item(path);
    return item ? this.resource(path, item) : null;
  }

  async list(path: string): Promise<BackendResource[]> {
    await this.ensureBase();
    const item = await this.item(path);
    if (!item || !item.folder) return [];
    let url = `${this.graphPath(path)}/children?$select=id,name,size,eTag,file,folder,createdDateTime,lastModifiedDateTime`;
    const result: BackendResource[] = [];
    while (url) {
      const response = await this.fetchGraph(url);
      if (!response.ok) throw new Error(`OneDrive list failed: ${response.status}`);
      const body = await response.json() as { value: GraphItem[]; "@odata.nextLink"?: string };
      result.push(...body.value.map((child) => this.resource(path ? `${path}/${child.name}` : child.name, child)));
      url = body["@odata.nextLink"] || "";
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(path: string, request: Request): Promise<Response | null> {
    const item = await this.item(path, true);
    const downloadUrl = item?.["@microsoft.graph.downloadUrl"];
    if (!item || !downloadUrl) return null;
    const headers = new Headers();
    if (request.headers.has("range")) headers.set("range", request.headers.get("range")!);
    const response = await fetch(downloadUrl, { headers });
    if (!response.ok) return null;
    const out = new Headers(response.headers);
    out.set("etag", item.eTag || `"${item.id}"`);
    out.set("last-modified", item.lastModifiedDateTime || new Date().toISOString());
    out.set("accept-ranges", "bytes");
    return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers: out });
  }

  async put(path: string, request: Request): Promise<BackendResource> {
    await this.ensureParent(path);
    const response = await this.fetchGraph(`${this.graphPath(path)}/content`, {
      method: "PUT",
      headers: { "content-type": request.headers.get("content-type") || "application/octet-stream" },
      body: request.body,
    });
    if (!response.ok) throw new Error(`OneDrive upload failed: ${response.status}`);
    return this.resource(path, await response.json() as GraphItem);
  }

  async mkdir(path: string): Promise<void> {
    await this.ensureParent(path);
    const parent = this.parentPath(path);
    const response = await this.fetchGraph(`${this.graphPath(parent)}/children`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameOf(path), folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
    if (!response.ok) throw new Error(`OneDrive mkdir failed: ${response.status}`);
  }

  async remove(path: string): Promise<void> {
    const item = await this.item(path);
    if (!item) return;
    const response = await this.fetchGraph(`/me/drive/items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error(`OneDrive delete failed: ${response.status}`);
  }

  async copy(from: string, to: string): Promise<void> {
    const item = await this.item(from);
    if (!item) throw new Error("Source resource not found.");
    const parent = await this.item(this.parentPath(to));
    if (!parent) throw new Error("Destination parent not found.");
    const response = await this.fetchGraph(`/me/drive/items/${encodeURIComponent(item.id)}/copy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentReference: { id: parent.id }, name: nameOf(to) }),
    });
    if (!response.ok && response.status !== 202) throw new Error(`OneDrive copy failed: ${response.status}`);
  }

  async move(from: string, to: string): Promise<void> {
    const item = await this.item(from);
    const parent = await this.item(this.parentPath(to));
    if (!item || !parent) throw new Error("Source or destination not found.");
    const response = await this.fetchGraph(`/me/drive/items/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameOf(to), parentReference: { id: parent.id } }),
    });
    if (!response.ok) throw new Error(`OneDrive move failed: ${response.status}`);
  }

  async search(path: string, query: string): Promise<BackendResource[]> {
    const all: BackendResource[] = [];
    for (const child of await this.list(path)) {
      if (child.name.toLocaleLowerCase("zh-CN").includes(query.toLocaleLowerCase("zh-CN"))) all.push(child);
      if (child.collection) all.push(...await this.search(child.path, query));
    }
    return all;
  }

  private async ensureBase(): Promise<void> {
    if (await this.itemDirect("")) return;
    const response = await this.fetchGraph("/me/drive/root/children", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: this.baseFolder, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
    if (!response.ok && response.status !== 409) throw new Error(`OneDrive base folder failed: ${response.status}`);
  }

  private async ensureParent(path: string): Promise<void> {
    await this.ensureBase();
    const parent = this.parentPath(path);
    if (!parent || await this.item(parent)) return;
    const segments = parent.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      const next = current ? `${current}/${segment}` : segment;
      if (!(await this.item(next))) await this.mkdir(next);
      current = next;
    }
  }

  private async item(path: string, withDownload = false): Promise<GraphItem | null> {
    await this.ensureToken();
    return this.itemDirect(path, withDownload);
  }

  private async itemDirect(path: string, withDownload = false): Promise<GraphItem | null> {
    const select = withDownload ? "id,name,size,eTag,file,folder,createdDateTime,lastModifiedDateTime,@microsoft.graph.downloadUrl" : "id,name,size,eTag,file,folder,createdDateTime,lastModifiedDateTime";
    const response = await this.fetchGraph(`${this.graphPath(path)}?$select=${select}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`OneDrive metadata failed: ${response.status}`);
    return await response.json() as GraphItem;
  }

  private graphPath(path: string): string {
    const suffix = [this.baseFolder, ...path.split("/").filter(Boolean)].map(encodeURIComponent).join("/");
    return `/me/drive/root:/${suffix}:`;
  }

  private parentPath(path: string): string { return path.split("/").filter(Boolean).slice(0, -1).join("/"); }

  private resource(path: string, item: GraphItem): BackendResource {
    const collection = Boolean(item.folder);
    return {
      backend: this.id,
      path,
      name: item.name,
      collection,
      size: collection ? 0 : item.size || 0,
      etag: item.eTag || `"${item.id}"`,
      uploaded: parseHttpDate(item.lastModifiedDateTime),
      createdAt: item.createdDateTime ? parseHttpDate(item.createdDateTime) : null,
      contentType: collection ? "httpd/unix-directory" : item.file?.mimeType || "application/octet-stream",
    };
  }

  private async fetchGraph(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.ensureToken();
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`, { ...init, headers });
  }

  private async ensureToken(): Promise<string> {
    if (this.env.ONEDRIVE_ACCESS_TOKEN) return this.env.ONEDRIVE_ACCESS_TOKEN;
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
    if (!this.env.ONEDRIVE_REFRESH_TOKEN || !this.env.ONEDRIVE_CLIENT_ID) throw new Error("OneDrive is not configured.");
    const form = new URLSearchParams({
      client_id: this.env.ONEDRIVE_CLIENT_ID,
      refresh_token: this.env.ONEDRIVE_REFRESH_TOKEN,
      grant_type: "refresh_token",
      scope: "offline_access Files.ReadWrite User.Read",
    });
    if (this.env.ONEDRIVE_CLIENT_SECRET) form.set("client_secret", this.env.ONEDRIVE_CLIENT_SECRET);
    const response = await fetch(`https://login.microsoftonline.com/${this.env.ONEDRIVE_TENANT || "consumers"}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
    if (!response.ok) throw new Error("Unable to refresh the OneDrive token.");
    const body = await response.json() as { access_token: string; expires_in?: number };
    cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 };
    return body.access_token;
  }
}

export function configuredBackends(env: Env): StorageBackend[] {
  const backends: StorageBackend[] = [];
  const r2 = new R2Backend(env.FILES);
  if (r2.available()) backends.push(r2);
  const onedrive = new OneDriveBackend(env);
  if (onedrive.available()) backends.push(onedrive);
  return backends;
}

export function usesLegacyR2Mount(env: Env): boolean {
  const backends = configuredBackends(env);
  return backends.length === 1 && backends[0].id === "r2";
}

export function backendById(env: Env, id: string): StorageBackend | null {
  return configuredBackends(env).find((backend) => backend.id === id) || null;
}

