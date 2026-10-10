import { isAuthorized } from "./auth/basic.js";
import { parseDavPath } from "./http/path.js";
import { LimitedR2 } from "./monitor/limited-r2.js";
import { QuotaExceededError } from "./monitor/quota.js";
import { DOUsageClient } from "./monitor/usage-client.js";
import { UsageStore } from "./monitor/usage-store.js";
import { handleWebDav } from "./webdav/handler.js";
import { apiFiles } from "./web/api.js";
import { webPage } from "./web/page.js";

export { UsageStore };

function unauthorized(): Response {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="CF Free WebDAV", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") {
      return Response.json({ status: "ok" });
    }
    if (url.pathname === "/" && request.method === "GET") {
      if (!env.WEBDAV_PASSWORD) {
        return new Response("Set the WEBDAV_PASSWORD secret before using WebDAV.", { status: 503 });
      }
      if (!(await isAuthorized(request, env.WEBDAV_USERNAME || "webdav", env.WEBDAV_PASSWORD))) {
        return unauthorized();
      }
      const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
      const nonce = btoa(String.fromCharCode(...nonceBytes));
      const headers = new Headers({
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
        "content-security-policy": "default-src 'none'; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      });
      return new Response(webPage(nonce), { headers });
    }
    if (url.pathname === "/api/files" && request.method === "GET") {
      if (!env.WEBDAV_PASSWORD) return new Response("Set the WEBDAV_PASSWORD secret before using WebDAV.", { status: 503 });
      if (!(await isAuthorized(request, env.WEBDAV_USERNAME || "webdav", env.WEBDAV_PASSWORD))) {
        return unauthorized();
      }
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
      return apiFiles(request, env, new DOUsageClient(env.USAGE_STORE));
    }
    if (url.pathname === "/usage" && request.method === "GET") {
      if (!env.WEBDAV_PASSWORD) return new Response("Set the WEBDAV_PASSWORD secret before using WebDAV.", { status: 503 });
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
      if (!(await isAuthorized(request, env.WEBDAV_USERNAME || "webdav", env.WEBDAV_PASSWORD))) {
        return unauthorized();
      }
      try {
        const usage = await new DOUsageClient(env.USAGE_STORE).summary();
        return Response.json(usage);
      } catch (error) {
        if (error instanceof QuotaExceededError) return Response.json({ error: error.message }, { status: 503 });
        throw error;
      }
    }
    if (url.pathname === "/usage/reconcile-official" && request.method === "POST") {
      if (!env.WEBDAV_PASSWORD) return new Response("Set the WEBDAV_PASSWORD secret before using WebDAV.", { status: 503 });
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
      if (!(await isAuthorized(request, env.WEBDAV_USERNAME || "webdav", env.WEBDAV_PASSWORD))) {
        return unauthorized();
      }
      try {
        const state = await new DOUsageClient(env.USAGE_STORE).reconcileOfficial();
        return Response.json({ ok: true, state });
      } catch (error) {
        if (error instanceof QuotaExceededError) return Response.json({ error: error.message }, { status: 503 });
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
      }
    }

    const path = parseDavPath(url.pathname);
    if (!path) return new Response("Not found.", { status: 404 });
    if (!env.WEBDAV_PASSWORD) {
      return new Response("Set the WEBDAV_PASSWORD secret before using WebDAV.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const username = env.WEBDAV_USERNAME || "webdav";
    if (!(await isAuthorized(request, username, env.WEBDAV_PASSWORD))) return unauthorized();
    if (!env.FILES || !env.USAGE_STORE) {
      return new Response("R2 bucket or Durable Object binding is not configured.", { status: 503 });
    }
    const guardedEnv = { ...env, FILES: new LimitedR2(env.FILES, new DOUsageClient(env.USAGE_STORE)) };
    return handleWebDav(request, guardedEnv, path, new DOUsageClient(env.USAGE_STORE));
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const usageStore = env.USAGE_STORE;
    if (!usageStore) throw new Error("Durable Object binding is not configured.");
    const client = new DOUsageClient(usageStore);
    await client.reconcileOfficial();
  },
} satisfies ExportedHandler<Env>;
