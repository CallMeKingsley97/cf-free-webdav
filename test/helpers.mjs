import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadBuildModule(relativePath) {
  const outputPath = relativePath.startsWith("src/") ? relativePath.slice(4) : relativePath;
  return import(pathToFileURL(path.join(process.env.CF_TEST_BUILD_DIR, outputPath)).href);
}

function bytesOf(value) {
  if (value == null) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ReadableStream) return new Uint8Array();
  return new Uint8Array();
}

function streamOf(bytes) {
  return new ReadableStream({
    start(controller) {
      if (bytes.byteLength) controller.enqueue(bytes.slice());
      controller.close();
    },
  });
}

function metadataHeaders(record, headers) {
  const metadata = record.httpMetadata || {};
  if (metadata.contentType) headers.set("content-type", metadata.contentType);
  if (metadata.contentLanguage) headers.set("content-language", metadata.contentLanguage);
  if (metadata.contentDisposition) headers.set("content-disposition", metadata.contentDisposition);
  if (metadata.contentEncoding) headers.set("content-encoding", metadata.contentEncoding);
  if (metadata.cacheControl) headers.set("cache-control", metadata.cacheControl);
}

function objectFor(record) {
  return {
    key: record.key,
    size: record.data.byteLength,
    etag: record.etag,
    httpEtag: record.httpEtag,
    uploaded: new Date(record.uploaded),
    httpMetadata: { ...record.httpMetadata },
    customMetadata: { ...record.customMetadata },
    writeHttpMetadata(headers) { metadataHeaders(record, headers); },
  };
}

function parseRange(options, size) {
  const range = options?.range;
  if (range instanceof Headers) {
    const value = range.get("range");
    const match = value?.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) return undefined;
    if (!match[1]) {
      const suffix = Number(match[2]);
      return { offset: Math.max(0, size - suffix), length: Math.min(size, suffix) };
    }
    const offset = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;
    return { offset, length: Math.max(0, Math.min(size - offset, end - offset + 1)) };
  }
  if (range && typeof range === "object") {
    if ("suffix" in range) return { offset: Math.max(0, size - range.suffix), length: Math.min(size, range.suffix) };
    if ("offset" in range) return { offset: range.offset, length: range.length ?? size - range.offset };
  }
  return undefined;
}

export class MemoryR2 {
  objects = new Map();
  sequence = 0;
  failPut = null;
  failDelete = null;

  async put(key, value, options = {}) {
    if (this.failPut?.(key)) throw new Error("Injected R2 put failure.");
    let bytes = bytesOf(value);
    if (value instanceof ReadableStream) bytes = new Uint8Array(await new Response(value).arrayBuffer());
    const etag = String(++this.sequence).padStart(8, "0");
    const record = {
      key,
      data: bytes.slice(),
      etag,
      httpEtag: `"${etag}"`,
      uploaded: new Date(),
      httpMetadata: { ...(options.httpMetadata || {}) },
      customMetadata: { ...(options.customMetadata || {}) },
    };
    this.objects.set(key, record);
    return objectFor(record);
  }

  async head(key) {
    const record = this.objects.get(key);
    return record ? objectFor(record) : null;
  }

  async get(key, options = {}) {
    const record = this.objects.get(key);
    if (!record) return null;
    const range = parseRange(options, record.data.byteLength);
    const start = range?.offset || 0;
    const end = range ? start + range.length : record.data.byteLength;
    const bytes = record.data.slice(start, end);
    return {
      ...objectFor(record),
      body: streamOf(bytes),
      range,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }

  async list(options = {}) {
    const prefix = options.prefix || "";
    const delimiter = options.delimiter;
    const all = [...this.objects.values()].filter((record) => record.key.startsWith(prefix)).sort((a, b) => a.key.localeCompare(b.key));
    const items = [];
    const prefixes = new Set();
    for (const record of all) {
      const relative = record.key.slice(prefix.length);
      if (delimiter) {
        const delimiterIndex = relative.indexOf(delimiter);
        if (delimiterIndex >= 0) {
          prefixes.add(prefix + relative.slice(0, delimiterIndex + 1));
          continue;
        }
      }
      items.push({ type: "object", record });
    }
    for (const value of prefixes) items.push({ type: "prefix", value });
    items.sort((a, b) => (a.type === "object" ? a.record.key : a.value).localeCompare(b.type === "object" ? b.record.key : b.value));
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit || 1000;
    const page = items.slice(start, start + limit);
    const truncated = start + limit < items.length;
    return {
      objects: page.filter((item) => item.type === "object").map((item) => objectFor(item.record)),
      delimitedPrefixes: page.filter((item) => item.type === "prefix").map((item) => item.value),
      truncated,
      cursor: truncated ? String(start + limit) : undefined,
    };
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (this.failDelete?.(key)) throw new Error("Injected R2 delete failure.");
      this.objects.delete(key);
    }
  }

  resumeMultipartUpload() { throw new Error("Multipart upload mock is not used by these tests."); }
  async createMultipartUpload() { throw new Error("Multipart upload mock is not used by these tests."); }
}

class MemorySql {
  shares = new Map();

  exec(query, ...values) {
    const normalized = query.replace(/\s+/g, " ").trim().toLowerCase();
    let rows = [];
    if (normalized.startsWith("insert into managed_shares")) {
      const [id, file_key, expires_at, created_at, max_downloads] = values;
      this.shares.set(id, { id, file_key, expires_at, created_at, max_downloads, downloads: 0, revoked: 0 });
    } else if (normalized.startsWith("select") && normalized.includes("from managed_shares")) {
      rows = [...this.shares.values()];
      if (normalized.includes("where id = ?")) rows = rows.filter((row) => row.id === values[0]);
      rows = rows.map((row) => ({ ...row }));
    } else if (normalized.startsWith("update managed_shares set revoked")) {
      const row = this.shares.get(values[0]);
      if (row) row.revoked = 1;
    } else if (normalized.startsWith("update managed_shares set downloads")) {
      const row = this.shares.get(values[0]);
      if (row) row.downloads += 1;
    }
    return { toArray: () => rows };
  }
}

export class MemoryDOState {
  values = new Map();
  alarm = null;
  storage = {
    get: async (key) => this.values.get(key),
    put: async (key, value) => {
      if (typeof key === "string") this.values.set(key, structuredClone(value));
      else for (const [entryKey, entryValue] of Object.entries(key)) this.values.set(entryKey, structuredClone(entryValue));
    },
    delete: async (key) => this.values.delete(key),
    getAlarm: async () => this.alarm,
    setAlarm: async (time) => { this.alarm = time; },
    transaction: async (callback) => {
      const pending = new Map([...this.values].map(([key, value]) => [key, structuredClone(value)]));
      const transaction = {
        get: async (keyOrKeys) => {
          if (Array.isArray(keyOrKeys)) return new Map(keyOrKeys.filter((key) => pending.has(key)).map((key) => [key, pending.get(key)]));
          return pending.get(keyOrKeys);
        },
        put: async (keyOrValues, value) => {
          if (typeof keyOrValues === "string") pending.set(keyOrValues, structuredClone(value));
          else for (const [key, item] of Object.entries(keyOrValues)) pending.set(key, structuredClone(item));
        },
        delete: async (key) => pending.delete(key),
      };
      const result = await callback(transaction);
      this.values = pending;
      return result;
    },
    sql: new MemorySql(),
  };
  waitUntil(promise) { promise.catch(() => undefined); }
}

export async function makeRuntime(envOverrides = {}) {
  const [{ UsageStore }, { DOUsageClient }] = await Promise.all([
    loadBuildModule("src/monitor/usage-store.js"),
    loadBuildModule("src/monitor/usage-client.js"),
  ]);
  const env = {
    QUOTA_CLASS_A_MAX: "1000000",
    QUOTA_CLASS_B_MAX: "10000000",
    QUOTA_STORAGE_MAX_BYTES: "1000000000",
    QUOTA_THRESHOLD_PERCENT: "0.8",
    WEBDAV_USERNAME: "webdav",
    WEBDAV_PASSWORD: "test-password",
    ...envOverrides,
  };
  const state = new MemoryDOState();
  const store = new UsageStore(state, env);
  const namespace = {
    idFromName: (name) => name,
    get: () => ({ fetch: (input, init) => store.fetch(input instanceof Request ? input : new Request(input, init)) }),
  };
  const usage = new DOUsageClient(namespace);
  return { env, state, store, namespace, usage };
}

export function authHeaders(username = "webdav", password = "test-password") {
  return { authorization: `Basic ${btoa(`${username}:${password}`)}` };
}
