import { isAuthorized } from "./auth/basic.js";
import { parseDavPath } from "./http/path.js";
import { LimitedR2 } from "./monitor/limited-r2.js";
import { QuotaExceededError } from "./monitor/quota.js";
import { DOUsageClient } from "./monitor/usage-client.js";
import { UsageStore } from "./monitor/usage-store.js";
import { handleWebDav } from "./webdav/handler.js";

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
    if (url.pathname === "/usage" && request.method === "GET") {
      if (!(await isAuthorized(request, env.WEBDAV_USERNAME || "webdav", env.WEBDAV_PASSWORD || ""))) {
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
    const guardedEnv = { ...env, FILES: new LimitedR2(env.FILES, new DOUsageClient(env.USAGE_STORE)) };
    return handleWebDav(request, guardedEnv, path, new DOUsageClient(env.USAGE_STORE));
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const client = new DOUsageClient(env.USAGE_STORE);
    await client.reconcileOfficial();
  },
} satisfies ExportedHandler<Env>;
