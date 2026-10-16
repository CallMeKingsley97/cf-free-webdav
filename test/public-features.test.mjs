import assert from "node:assert/strict";
import test from "node:test";
import { authHeaders, loadBuildModule, makeRuntime, MemoryR2 } from "./helpers.mjs";

test("upload-only inbox stages files privately and requires owner approval", async () => {
  const [{ default: worker }, { apiFiles }] = await Promise.all([
    loadBuildModule("src/index.js"),
    loadBuildModule("src/web/api.js"),
  ]);
  const { env: config, namespace, usage } = await makeRuntime();
  const bucket = new MemoryR2();
  await bucket.put("drop/", "", { httpMetadata: { contentType: "httpd/unix-directory" } });
  const env = { ...config, FILES: bucket, USAGE_STORE: namespace };

  const createdResponse = await worker.fetch(new Request("https://example.test/api/inboxes", {
    method: "POST", headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ folder: "drop", ttlHours: 24 }),
  }), env);
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json();
  const token = new URL(created.url).pathname.split("/")[2];

  const uploadPage = await worker.fetch(new Request(created.url), env);
  assert.equal(uploadPage.status, 200);
  assert.match(uploadPage.headers.get("content-security-policy"), /script-src 'nonce-/);
  assert.match(await uploadPage.text(), /不能查看或下载/);
  assert.equal((await worker.fetch(new Request(`https://example.test/inbox/${token}/portrait.jpg`), env)).status, 404);

  const upload = await worker.fetch(new Request(`https://example.test/inbox/${token}/portrait.jpg`, {
    method: "PUT", headers: { "content-length": "5" }, body: "image",
  }), env);
  assert.equal(upload.status, 200);
  const stageKey = [...bucket.objects.keys()].find((key) => key.startsWith(".__cf_free_webdav__/inbox/"));
  assert.ok(stageKey);
  assert.equal(bucket.objects.has("drop/portrait.jpg"), false);

  const fileList = await apiFiles(new Request("https://example.test/api/files?path=drop"), env, usage);
  assert.deepEqual((await fileList.json()).entries, []);
  const inboxResponse = await worker.fetch(new Request("https://example.test/api/inboxes", { headers: authHeaders() }), env);
  const inboxData = await inboxResponse.json();
  assert.equal(inboxData.items.length, 1);
  assert.equal(inboxData.items[0].name, "portrait.jpg");
  assert.equal("tokenHash" in inboxData.inboxes[0], false);
  assert.equal(inboxData.inboxes[0].url, created.url);
  const forged = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
  assert.equal((await worker.fetch(new Request(`https://example.test/inbox/${forged}`), env)).status, 404);

  const item = inboxData.items[0];
  const keep = await worker.fetch(new Request(`https://example.test/api/inboxes/${created.id}/items/${item.id}/keep`, {
    method: "POST", headers: authHeaders(),
  }), env);
  assert.equal(keep.status, 200);
  assert.equal((await keep.json()).name, "portrait.jpg");
  assert.equal(bucket.objects.has(stageKey), false);
  assert.equal(new TextDecoder().decode(bucket.objects.get("drop/portrait.jpg").data), "image");
  assert.equal((await usage.summary()).state.storageBytes, 5);

  const secondUpload = await worker.fetch(new Request(`https://example.test/inbox/${token}/remove.txt`, {
    method: "PUT", headers: { "content-length": "4" }, body: "gone",
  }), env);
  assert.equal(secondUpload.status, 200);
  const pending = await (await worker.fetch(new Request("https://example.test/api/inboxes", { headers: authHeaders() }), env)).json();
  const removeItem = pending.items.find((entry) => entry.name === "remove.txt");
  assert.ok(removeItem);
  const remove = await worker.fetch(new Request(`https://example.test/api/inboxes/${created.id}/items/${removeItem.id}/delete`, {
    method: "DELETE", headers: authHeaders(),
  }), env);
  assert.equal(remove.status, 200);
  assert.equal(bucket.objects.has(removeItem.objectKey), false);
  assert.equal((await usage.summary()).state.storageBytes, 5);

  const revoke = await worker.fetch(new Request(`https://example.test/api/inboxes/${created.id}`, {
    method: "DELETE", headers: authHeaders(),
  }), env);
  assert.equal(revoke.status, 200);
  assert.equal((await worker.fetch(new Request(created.url), env)).status, 404);
});

test("public folder pages freeze a safe file whitelist and force non-image downloads", async () => {
  const [{ default: worker }, { apiGalleries }] = await Promise.all([
    loadBuildModule("src/index.js"),
    loadBuildModule("src/web/gallery-api.js"),
  ]);
  const { env: config, namespace, usage } = await makeRuntime();
  const bucket = new MemoryR2();
  await bucket.put("portfolio/photo.jpg", "jpeg", { httpMetadata: { contentType: "text/html" } });
  await bucket.put("portfolio/notes.txt", "notes");
  await bucket.put("portfolio/brief.pdf", "%PDF", { httpMetadata: { contentType: "text/html" } });
  await bucket.put("portfolio/page.html", "<script>owned()</script>", { httpMetadata: { contentType: "text/html" } });
  await bucket.put("portfolio/icon.svg", "<svg onload=owned()></svg>", { httpMetadata: { contentType: "image/svg+xml" } });
  const env = { ...config, FILES: bucket, USAGE_STORE: namespace };

  const createdResponse = await worker.fetch(new Request("https://example.test/api/galleries", {
    method: "POST", headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ folder: "portfolio", mode: "photos", title: "旅程 <script>" }),
  }), env);
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json();
  const gallery = await usage.getGallery(created.id);
  assert.deepEqual(gallery.files.map((file) => file.name), ["photo.jpg"]);
  assert.equal(gallery.files[0].contentType, "image/jpeg");

  const page = await worker.fetch(new Request(created.url), env);
  const html = await page.text();
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(page.headers.get("content-security-policy").includes("script-src"), false);
  assert.match(html, /旅程 &lt;script&gt;/);
  assert.doesNotMatch(html, /page\.html|icon\.svg/);
  const image = await worker.fetch(new Request(`https://example.test/gallery/${created.id}/file/0`), env);
  assert.equal(image.headers.get("content-type"), "image/jpeg");
  assert.equal(image.headers.get("content-disposition").split(";")[0], "inline");
  assert.equal(await image.text(), "jpeg");
  assert.equal((await worker.fetch(new Request(`https://example.test/gallery/${created.id}/file/1`), env)).status, 404);

  const filesResponse = await worker.fetch(new Request("https://example.test/api/galleries", {
    method: "POST", headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ folder: "portfolio", mode: "files" }),
  }), env);
  assert.equal(filesResponse.status, 200);
  const filesPage = await filesResponse.json();
  const filesGallery = await usage.getGallery(filesPage.id);
  assert.deepEqual(filesGallery.files.map((file) => file.name), ["brief.pdf", "notes.txt", "photo.jpg"]);
  const pdfIndex = filesGallery.files.findIndex((file) => file.name === "brief.pdf");
  const pdf = await worker.fetch(new Request(`https://example.test/gallery/${filesPage.id}/file/${pdfIndex}`), env);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition"), /^attachment;/);
  assert.equal(await pdf.text(), "%PDF");
});

test("file map is recursive, paged, and excludes internal R2 objects", async () => {
  const [{ default: worker }, { webPage }] = await Promise.all([
    loadBuildModule("src/index.js"),
    loadBuildModule("src/web/page.js"),
  ]);
  const { env: config, namespace } = await makeRuntime();
  const bucket = new MemoryR2();
  await bucket.put("space/a.txt", "a", { httpMetadata: { contentType: "text/plain" } });
  await bucket.put("space/nested/b.jpg", "bb", { httpMetadata: { contentType: "image/jpeg" } });
  await bucket.put(".__cf_free_webdav__/inbox/secret", "hidden");
  const env = { ...config, FILES: bucket, USAGE_STORE: namespace };
  const response = await worker.fetch(new Request("https://example.test/api/map?path=space", { headers: authHeaders() }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.entries.map((entry) => entry.name), ["a.txt", "nested/b.jpg"]);
  assert.equal(data.entries.reduce((sum, entry) => sum + entry.size, 0), 3);
  for (let index = 0; index < 1001; index += 1) {
    await bucket.put(`space/paged/item-${String(index).padStart(4, "0")}.txt`, "x");
  }
  const firstPage = await worker.fetch(new Request("https://example.test/api/map?path=space/paged", { headers: authHeaders() }), env);
  const firstData = await firstPage.json();
  assert.equal(firstData.entries.length, 1000);
  assert.ok(firstData.cursor);
  const nextPage = await worker.fetch(new Request(`https://example.test/api/map?path=space/paged&cursor=${encodeURIComponent(firstData.cursor)}`, { headers: authHeaders() }), env);
  assert.equal((await nextPage.json()).entries.length, 1);

  const html = webPage("feature-test");
  const inlineScript = html.match(/<script nonce="feature-test">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inlineScript);
  assert.doesNotThrow(() => new Function(inlineScript));
  assert.match(html, /data-view="inbox"/);
  assert.match(html, /data-view="galleries"/);
  assert.match(html, /data-map-mode="updated"/);
  assert.match(html, /id="inbox-links"/);
  assert.match(html, /占用明细/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Squarified treemap/);
  assert.match(html, /data-map-more/);
});
