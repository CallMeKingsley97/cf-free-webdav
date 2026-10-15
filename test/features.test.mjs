import assert from "node:assert/strict";
import test from "node:test";
import { authHeaders, loadBuildModule, makeRuntime, MemoryR2 } from "./helpers.mjs";

test("quota reservations are serialized, committed, cancelled, and expire from the pending total", async () => {
  const { store, state } = await makeRuntime({ QUOTA_STORAGE_MAX_BYTES: "100", QUOTA_THRESHOLD_PERCENT: "0.8" });
  const reserve = () => store.fetch(new Request("https://usage/reserve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storageBytes: 20, classAOperations: 1, classBOperations: 0 }),
  }));
  const results = await Promise.all([reserve(), reserve(), reserve(), reserve()]);
  const bodies = await Promise.all(results.map((response) => response.json()));
  assert.equal(bodies.filter((body) => body.ok).length, 3);
  assert.equal(bodies.filter((body) => !body.ok).length, 1);
  const reservations = bodies.filter((body) => body.ok).map((body) => body.reservationId);

  const commit = await store.fetch(new Request("https://usage/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storageBytes: 20, classAOperations: 1, classBOperations: 0, reservationId: reservations[0] }),
  }));
  assert.equal(commit.status, 200);
  await store.fetch(new Request("https://usage/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storageBytes: 20, classAOperations: 1, classBOperations: 0, reservationId: reservations[0] }),
  }));
  for (const reservationId of reservations.slice(1)) {
    await store.fetch(new Request("https://usage/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reservationId }),
    }));
  }
  const committedSummary = await store.fetch(new Request("https://usage/summary"));
  const committedState = (await committedSummary.json()).state;
  assert.equal(committedState.storageBytes, 20);
  assert.equal(committedState.classAOperations, 1);
  const allowed = await reserve();
  const expiring = await allowed.json();
  assert.equal(expiring.ok, true);
  const reservationStateKey = [...state.values.keys()].find((key) => key.includes("reservations"));
  const pending = state.values.get(reservationStateKey);
  pending[expiring.reservationId].expiresAt = Date.now() - 1;
  state.values.set(reservationStateKey, pending);
  assert.equal((await (await reserve()).json()).ok, true);
});

test("trash preserves deleted files and overwritten versions, restores them, and hides internal keys", async () => {
  const [{ handleWebDav }, { parseDavPath }, { apiTrash }, { apiFiles }, { LimitedR2 }] = await Promise.all([
    loadBuildModule("src/webdav/handler.js"),
    loadBuildModule("src/http/path.js"),
    loadBuildModule("src/web/trash-api.js"),
    loadBuildModule("src/web/api.js"),
    loadBuildModule("src/monitor/limited-r2.js"),
  ]);
  const { env: config, usage } = await makeRuntime();
  const rawBucket = new MemoryR2();
  const env = { ...config, FILES: new LimitedR2(rawBucket, usage) };
  const path = parseDavPath("/dav/notes.txt");
  const put = (body) => handleWebDav(new Request("https://example.test/dav/notes.txt", {
    method: "PUT",
    headers: { "content-type": "text/plain", "content-length": String(body.length) },
    body,
  }), env, path, usage);

  assert.equal((await put("v1")).status, 201);
  assert.equal((await put("v2")).status, 204);
  assert.equal(new TextDecoder().decode(rawBucket.objects.get("notes.txt").data), "v2");
  const fullDownload = await handleWebDav(new Request("https://example.test/dav/notes.txt"), env, path, usage);
  assert.equal(fullDownload.status, 200);
  assert.equal(fullDownload.headers.has("content-range"), false);

  let trashResponse = await apiTrash(new Request("https://example.test/api/trash"), env, usage);
  let trash = (await trashResponse.json()).items;
  assert.equal(trash.length, 1);
  assert.equal(trash[0].kind, "version");
  assert.equal(trash[0].size, 2);

  const restoreVersion = await apiTrash(new Request(`https://example.test/api/trash/${trash[0].id}/restore`, { method: "POST" }), env, usage);
  assert.equal(restoreVersion.status, 200);
  assert.equal(new TextDecoder().decode(rawBucket.objects.get("notes.txt").data), "v1");

  assert.equal((await handleWebDav(new Request("https://example.test/dav/notes.txt", { method: "DELETE" }), env, path, usage)).status, 204);
  assert.equal(rawBucket.objects.has("notes.txt"), false);
  trashResponse = await apiTrash(new Request("https://example.test/api/trash"), env, usage);
  trash = (await trashResponse.json()).items;
  const deleted = trash.find((item) => item.kind === "deleted");
  assert.ok(deleted);
  assert.equal((await apiTrash(new Request(`https://example.test/api/trash/${deleted.id}/restore`, { method: "POST" }), env, usage)).status, 200);
  assert.equal(new TextDecoder().decode(rawBucket.objects.get("notes.txt").data), "v1");

  const root = await apiFiles(new Request("https://example.test/api/files?path="), env, usage);
  const entries = (await root.json()).entries;
  assert.deepEqual(entries.map((entry) => entry.key), ["notes.txt"]);
  assert.equal((await parseDavPath("/dav/.__cf_free_webdav__/trash")), null);
});

test("failed restores roll back partial output and retain the recoverable archive", async () => {
  const [{ handleWebDav }, { parseDavPath }, { apiTrash }, { LimitedR2 }] = await Promise.all([
    loadBuildModule("src/webdav/handler.js"),
    loadBuildModule("src/http/path.js"),
    loadBuildModule("src/web/trash-api.js"),
    loadBuildModule("src/monitor/limited-r2.js"),
  ]);
  const { env: config, usage } = await makeRuntime();
  const bucket = new MemoryR2();
  await bucket.put("recover/", "", { httpMetadata: { contentType: "httpd/unix-directory" } });
  await bucket.put("recover/a.txt", "a");
  await bucket.put("recover/b.txt", "b");
  const env = { ...config, FILES: new LimitedR2(bucket, usage) };
  const deleted = await handleWebDav(new Request("https://example.test/dav/recover/", { method: "DELETE" }), env, parseDavPath("/dav/recover/"), usage);
  assert.equal(deleted.status, 204);
  const items = (await (await apiTrash(new Request("https://example.test/api/trash"), env, usage)).json()).items;
  const folder = items.find((item) => item.key === "recover" && item.kind === "deleted");
  assert.ok(folder);

  bucket.failPut = (key) => key === "recover/b.txt";
  const failed = await apiTrash(new Request(`https://example.test/api/trash/${folder.id}/restore`, { method: "POST" }), env, usage);
  assert.equal(failed.status, 500);
  assert.equal(bucket.objects.has("recover/a.txt"), false);
  assert.equal(bucket.objects.has("recover/b.txt"), false);
  assert.ok(await bucket.head(`.__cf_free_webdav__/trash/${folder.id}/manifest.json`));

  bucket.failPut = null;
  const restored = await apiTrash(new Request(`https://example.test/api/trash/${folder.id}/restore`, { method: "POST" }), env, usage);
  assert.equal(restored.status, 200);
  assert.equal(new TextDecoder().decode(bucket.objects.get("recover/a.txt").data), "a");
  assert.equal(new TextDecoder().decode(bucket.objects.get("recover/b.txt").data), "b");

  const filePath = parseDavPath("/dav/rollback.txt");
  await bucket.put("rollback.txt", "old");
  const overwrite = await handleWebDav(new Request("https://example.test/dav/rollback.txt", {
    method: "PUT", headers: { "content-length": "3" }, body: "new",
  }), env, filePath, usage);
  assert.equal(overwrite.status, 204);
  await handleWebDav(new Request("https://example.test/dav/rollback.txt", { method: "DELETE" }), env, filePath, usage);
  const versions = (await (await apiTrash(new Request("https://example.test/api/trash"), env, usage)).json()).items;
  const oldVersion = versions.find((item) => item.key === "rollback.txt" && item.kind === "version");
  assert.ok(oldVersion);
  const failingUsage = {
    reserve: async () => "failing-reservation",
    commit: async () => { throw new Error("Injected Durable Object commit failure."); },
    cancel: async () => undefined,
    release: async () => undefined,
    summary: async () => { throw new Error("unused"); },
  };
  const commitFailure = await apiTrash(
    new Request(`https://example.test/api/trash/${oldVersion.id}/restore`, { method: "POST" }),
    env,
    failingUsage,
  );
  assert.equal(commitFailure.status, 500);
  assert.equal(bucket.objects.has("rollback.txt"), false);
  assert.ok(await bucket.head(`.__cf_free_webdav__/trash/${oldVersion.id}/manifest.json`));
  const recovered = await apiTrash(new Request(`https://example.test/api/trash/${oldVersion.id}/restore`, { method: "POST" }), env, usage);
  assert.equal(recovered.status, 200);
  assert.equal(new TextDecoder().decode(bucket.objects.get("rollback.txt").data), "old");
});

test("failed permanent cleanup leaves the manifest available for retry", async () => {
  const [{ planTrashEntry, writeTrashPlan, listTrash, removeTrashItem }, { statResource }] = await Promise.all([
    loadBuildModule("src/storage/trash.js"),
    loadBuildModule("src/storage/r2.js"),
  ]);
  const bucket = new MemoryR2();
  await bucket.put("keep.txt", "payload");
  const resource = await statResource(bucket, { key: "keep.txt", segments: ["keep.txt"], collectionHint: false });
  const plan = await planTrashEntry(bucket, resource, "deleted", 30);
  await writeTrashPlan(bucket, plan);
  const item = (await listTrash(bucket))[0];
  const manifest = `.__cf_free_webdav__/trash/${item.id}/manifest.json`;
  bucket.failDelete = (key) => key === item.entries[0].payloadKey;
  await assert.rejects(removeTrashItem(bucket, item));
  assert.ok(await bucket.head(manifest));
  bucket.failDelete = null;
  assert.equal(await removeTrashItem(bucket, item), item.byteSize + item.manifestBytes);
  assert.equal(await bucket.head(manifest), null);
});

test("WebDAV Range, HEAD, PROPFIND, COPY, MOVE, folder restore, and deletion at quota remain functional", async () => {
  const [{ handleWebDav }, { parseDavPath }, { apiTrash }, { LimitedR2 }] = await Promise.all([
    loadBuildModule("src/webdav/handler.js"),
    loadBuildModule("src/http/path.js"),
    loadBuildModule("src/web/trash-api.js"),
    loadBuildModule("src/monitor/limited-r2.js"),
  ]);
  const { env: config, usage } = await makeRuntime({ QUOTA_CLASS_A_MAX: "1000", QUOTA_THRESHOLD_PERCENT: "0.8" });
  const rawBucket = new MemoryR2();
  const env = { ...config, FILES: new LimitedR2(rawBucket, usage) };
  const call = (key, method, headers = {}, body) => handleWebDav(new Request(`https://example.test/dav/${key}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  }), env, parseDavPath(`/dav/${key}`), usage);

  assert.equal((await call("project/", "MKCOL")).status, 201);
  assert.equal((await call("project/source.txt", "PUT", { "content-type": "text/plain", "content-length": "5" }, "alpha")).status, 201);
  assert.equal((await call("project/copied.txt", "PUT", { "content-type": "text/plain", "content-length": "3" }, "old")).status, 201);
  const range = await call("project/source.txt", "GET", { range: "bytes=1-3" });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "lph");
  assert.equal(range.headers.get("content-range"), "bytes 1-3/5");
  const head = await call("project/source.txt", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "5");
  const propfind = await handleWebDav(new Request("https://example.test/dav/", { method: "PROPFIND", headers: { depth: "1" } }), env, parseDavPath("/dav/"), usage);
  assert.equal(propfind.status, 207);
  assert.match(await propfind.text(), /project/);

  const usageBeforeCopy = (await usage.summary()).state.storageBytes;
  const copied = await call("project/source.txt", "COPY", {
    destination: "https://example.test/dav/project/copied.txt",
  });
  assert.equal(copied.status, 204);
  const usageAfterCopy = (await usage.summary()).state.storageBytes;
  const versionResponse = await apiTrash(new Request("https://example.test/api/trash"), env, usage);
  const copyVersion = (await versionResponse.json()).items.find((item) => item.kind === "version" && item.key === "project/copied.txt");
  assert.ok(copyVersion);
  assert.equal(usageAfterCopy - usageBeforeCopy, 5 + (await rawBucket.head(`.__cf_free_webdav__/trash/${copyVersion.id}/manifest.json`)).size);
  const moved = await call("project/copied.txt", "MOVE", {
    destination: "https://example.test/dav/project/moved.txt",
    overwrite: "F",
  });
  assert.equal(moved.status, 201);
  assert.equal(rawBucket.objects.has("project/copied.txt"), false);
  assert.equal(new TextDecoder().decode(rawBucket.objects.get("project/moved.txt").data), "alpha");

  await usage.commit(0, 1000, 0);
  const deleted = await call("project/", "DELETE");
  assert.equal(deleted.status, 204);
  assert.equal(rawBucket.objects.has("project/source.txt"), false);
  const trashResponse = await apiTrash(new Request("https://example.test/api/trash"), env, usage);
  const trash = (await trashResponse.json()).items;
  const folder = trash.find((item) => item.kind === "deleted" && item.key === "project");
  assert.ok(folder);
  await usage.release(0, 1000, 0);
  assert.equal((await apiTrash(new Request(`https://example.test/api/trash/${folder.id}/restore`, { method: "POST" }), env, usage)).status, 200);
  assert.equal(new TextDecoder().decode(rawBucket.objects.get("project/moved.txt").data), "alpha");
});

test("managed and legacy share links work, track public reads, enforce limits, and revoke", async () => {
  const [{ default: worker }, { signSharePath }] = await Promise.all([
    loadBuildModule("src/index.js"),
    loadBuildModule("src/share/link.js"),
  ]);
  const { env: config, namespace, usage } = await makeRuntime();
  const bucket = new MemoryR2();
  await bucket.put("public.txt", "hello", { httpMetadata: { contentType: "text/plain" } });
  const env = { ...config, FILES: bucket, USAGE_STORE: namespace };
  const shareResponse = await worker.fetch(new Request("https://example.test/api/share", {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ path: "public.txt", ttlHours: 1, maxDownloads: 1 }),
  }), env);
  assert.equal(shareResponse.status, 200);
  const created = await shareResponse.json();
  const concurrent = await Promise.all([
    worker.fetch(new Request(created.url), env),
    worker.fetch(new Request(created.url), env),
  ]);
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 410]);
  const first = concurrent.find((response) => response.status === 200);
  assert.equal(await first.text(), "hello");
  assert.ok((await usage.summary()).state.classBOperations >= 2);

  const records = await worker.fetch(new Request("https://example.test/api/shares", { headers: authHeaders() }), env);
  assert.equal((await records.json()).shares[0].downloads, 1);
  const revoke = await worker.fetch(new Request(`https://example.test/api/shares/${created.id}`, { method: "DELETE", headers: authHeaders() }), env);
  assert.equal(revoke.status, 200);
  assert.equal((await worker.fetch(new Request(created.url), env)).status, 404);

  const expires = Math.floor(Date.now() / 1000) + 3600;
  const signature = await signSharePath("public.txt", expires, "test-password");
  const legacy = await worker.fetch(new Request(`https://example.test/share/${expires}/${signature}?path=public.txt`), env);
  assert.equal(legacy.status, 200);
  assert.equal(await legacy.text(), "hello");

  const malformed = await worker.fetch(new Request("https://example.test/share/9999999999/%not-base64?path=public.txt"), env);
  assert.equal(malformed.status, 404);
});

test("recursive search, safe preview, and management UI features are exposed", async () => {
  const [{ default: worker }, { webPage }] = await Promise.all([
    loadBuildModule("src/index.js"),
    loadBuildModule("src/web/page.js"),
  ]);
  const { env: config, namespace } = await makeRuntime();
  const bucket = new MemoryR2();
  await bucket.put("folder/meeting-notes.txt", "secret <tag>", { httpMetadata: { contentType: "text/plain" } });
  const env = { ...config, FILES: bucket, USAGE_STORE: namespace };
  const search = await worker.fetch(new Request("https://example.test/api/search?q=meeting&path=", { headers: authHeaders() }), env);
  assert.equal(search.status, 200);
  assert.equal((await search.json()).entries[0].key, "folder/meeting-notes.txt");
  const preview = await worker.fetch(new Request("https://example.test/api/preview?path=folder%2Fmeeting-notes.txt", { headers: authHeaders() }), env);
  assert.equal(preview.status, 200);
  assert.equal(await preview.text(), "secret <tag>");
  assert.equal(preview.headers.get("content-disposition"), "inline");
  const unsafe = await bucket.put("unsafe.html", "<script>alert(1)</script>", { httpMetadata: { contentType: "text/html" } });
  void unsafe;
  const rejected = await worker.fetch(new Request("https://example.test/api/preview?path=unsafe.html", { headers: authHeaders() }), env);
  assert.equal(rejected.status, 415);

  for (let index = 0; index < 1001; index += 1) {
    await bucket.put(`pagination/item-${String(index).padStart(4, "0")}-needle.txt`, "x", { httpMetadata: { contentType: "text/plain" } });
  }
  const firstPage = await worker.fetch(new Request("https://example.test/api/search?q=needle&path=pagination", { headers: authHeaders() }), env);
  const firstData = await firstPage.json();
  assert.equal(firstData.entries.length, 1000);
  assert.ok(firstData.cursor);
  const secondPage = await worker.fetch(new Request(`https://example.test/api/search?q=needle&path=pagination&cursor=${encodeURIComponent(firstData.cursor)}`, { headers: authHeaders() }), env);
  assert.equal((await secondPage.json()).entries.length, 1);

  const html = webPage("test-nonce");
  assert.match(html, /data-view="trash"/);
  assert.match(html, /data-view="shares"/);
  assert.match(html, /递归搜索当前目录/);
  assert.match(html, /data-preview=/);
  assert.match(html, /el\('table'\)\.addEventListener\('change'/);
  const inlineScript = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inlineScript);
  assert.doesNotThrow(() => new Function(inlineScript));
});

test("management view requests are serialized by generation", async () => {
  const { webPage } = await loadBuildModule("src/web/page.js");
  const inlineScript = webPage("test-nonce").match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inlineScript);
  assert.match(inlineScript, /let viewRequest = 0;/);
  assert.match(inlineScript, /const requestView = \+\+viewRequest;/);
  assert.match(inlineScript, /if \(requestView !== viewRequest\) return;/);
  const loadTrashBlock = inlineScript.match(/async function loadTrash\(\) \{[\s\S]*?\n  \}/)?.[0];
  const loadSharesBlock = inlineScript.match(/async function loadShares\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(loadTrashBlock && loadTrashBlock.includes('const requestView = ++viewRequest;'));
  assert.ok(loadSharesBlock && loadSharesBlock.includes('const requestView = ++viewRequest;'));
});
