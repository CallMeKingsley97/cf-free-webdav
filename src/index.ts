import { isAuthorized } from "./auth/basic.js";
import { parseDavPath } from "./http/path.js";
import { handleWebDav } from "./webdav/handler.js";

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
    return handleWebDav(request, env, path);
  },
} satisfies ExportedHandler<Env>;
