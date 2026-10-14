import { isAuthorized } from "./auth/basic.js";
import { parseDavPath } from "./http/path.js";
import { LimitedR2 } from "./monitor/limited-r2.js";
import { QuotaExceededError } from "./monitor/quota.js";
import { DOUsageClient, type UsageTrendDay } from "./monitor/usage-client.js";
import { UsageStore } from "./monitor/usage-store.js";
import { verifyManagedSharePath, verifySharePath } from "./share/link.js";
import { handleWebDav } from "./webdav/handler.js";
import { apiFiles } from "./web/api.js";
import { webPage } from "./web/page.js";
import { apiRevokeShare, apiShare, apiShares } from "./web/share-api.js";
import { apiTrash } from "./web/trash-api.js";
import { purgeExpiredTrash } from "./storage/trash.js";
import { apiSearch } from "./web/search-api.js";
import { apiPreview } from "./web/preview-api.js";

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

function credentialError(message: string): Response {
  return new Response(message, {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function hasCredentials(env: Env): boolean {
  return Boolean(env.WEBDAV_PASSWORD);
}

function shareSecret(env: Env): string {
  return env.SHARE_SECRET || env.WEBDAV_PASSWORD || "";
}

async function requireAuthorization(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (!hasCredentials(env)) return credentialError("Set the WEBDAV_PASSWORD secret before using WebDAV.");
  if (!(await isAuthorized(request, env.WEBDAV_USERNAME || "webdav", env.WEBDAV_PASSWORD || ""))) {
    return unauthorized();
  }
  return null;
}

function trackedEnv(env: Env, usage: DOUsageClient): Env {
  if (!env.FILES) return env;
  return { ...env, FILES: new LimitedR2(env.FILES, usage) };
}

async function handleShareDownload(request: Request, env: Env, usage: DOUsageClient): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) {
    return new Response("Invalid share link.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const managedId = parts.length === 4 ? parts[1] : null;
  const rawExpires = parts.length === 4 ? parts[2] : parts[1];
  const rawSignature = parts.length === 4 ? parts[3] : parts[2];
  const expires = Number(rawExpires);
  if (!Number.isSafeInteger(expires) || expires < 0 || rawExpires.length > 15) {
    return new Response("Invalid share link.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (Date.now() > expires * 1000) {
    return new Response("This share link has expired.", { status: 410, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const davUrl = new URL(request.url);
  davUrl.pathname = `/dav/${url.searchParams.get("path") || ""}`;
  const target = parseDavPath(davUrl.pathname);
  const rawPath = url.searchParams.get("path") || "";
  if (!target || !target.key || target.collectionHint || rawPath.includes("//")) {
    return new Response("Invalid share link.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (managedId) {
    const record = await usage.getShare(managedId);
    if (!record || record.fileKey !== target.key || record.expiresAt !== expires) {
      return new Response("Invalid share link.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (!(await verifyManagedSharePath(managedId, target.key, expires, rawSignature, shareSecret(env)))) {
      return new Response("Invalid share link.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const access = await usage.consumeShare(managedId);
    if (!access.ok) {
      const status = access.reason === "expired" || access.reason === "limit" ? 410 : 404;
      return new Response(access.reason === "limit" ? "This share link reached its access limit." : "Invalid share link.", {
        status,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
  } else if (!(await verifySharePath(target.key, expires, rawSignature, shareSecret(env)))) {
    return new Response("Invalid share link.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  return handleWebDav(request, trackedEnv(env, usage), target, usage);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") {
      return Response.json({ status: "ok" });
    }
    if (url.pathname === "/" && request.method === "GET") {
      if (!hasCredentials(env)) {
        return credentialError("Set the WEBDAV_PASSWORD secret before using WebDAV.");
      }
      if (!(await isAuthorized(request, env.WEBDAV_USERNAME || "webdav", env.WEBDAV_PASSWORD || ""))) {
        return unauthorized();
      }
      const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
      const nonce = btoa(String.fromCharCode(...nonceBytes));
      const headers = new Headers({
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
        "content-security-policy": "default-src 'none'; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'; connect-src 'self'; img-src 'self' data:; media-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      });
      return new Response(webPage(nonce), { headers });
    }
    if (url.pathname === "/api/files" && request.method === "GET") {
      const denied = await requireAuthorization(request, env);
      if (denied) return denied;
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
      const usage = new DOUsageClient(env.USAGE_STORE);
      return apiFiles(request, trackedEnv(env, usage), usage);
    }
    if (url.pathname === "/api/search" && request.method === "GET") {
      const denied = await requireAuthorization(request, env);
      if (denied) return denied;
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
      const usage = new DOUsageClient(env.USAGE_STORE);
      return apiSearch(request, trackedEnv(env, usage));
    }
    if (url.pathname === "/api/preview" && request.method === "GET") {
      const denied = await requireAuthorization(request, env);
      if (denied) return denied;
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
      const usage = new DOUsageClient(env.USAGE_STORE);
      return apiPreview(request, trackedEnv(env, usage));
    }
    if (url.pathname === "/api/share" && request.method === "POST") {
      const denied = await requireAuthorization(request, env);
      if (denied) return denied;
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
      const usage = new DOUsageClient(env.USAGE_STORE);
      return apiShare(request, trackedEnv(env, usage), usage);
    }
    if (url.pathname === "/api/shares" && request.method === "GET") {
      const denied = await requireAuthorization(request, env);
      if (denied) return denied;
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
      return apiShares(request, env, new DOUsageClient(env.USAGE_STORE));
    }
    if (url.pathname.startsWith("/api/shares/") && request.method === "DELETE") {
      const denied = await requireAuthorization(request, env);
      if (denied) return denied;
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
      const id = url.pathname.slice("/api/shares/".length);
      return apiRevokeShare(id, new DOUsageClient(env.USAGE_STORE));
    }
    if (url.pathname === "/api/trash" || url.pathname.startsWith("/api/trash/")) {
      const denied = await requireAuthorization(request, env);
      if (denied) return denied;
      if (!env.FILES || !env.USAGE_STORE) return new Response("R2 bucket or Durable Object binding is not configured.", { status: 503 });
      const usage = new DOUsageClient(env.USAGE_STORE);
      return apiTrash(request, trackedEnv(env, usage), usage);
    }
    if (url.pathname.startsWith("/share/") && request.method === "GET") {
      if (!hasCredentials(env)) return credentialError("Set the WEBDAV_PASSWORD secret before using WebDAV.");
      if (!env.FILES) return credentialError("R2 bucket is not configured.");
      if (!env.USAGE_STORE) return credentialError("Durable Object binding is not configured.");
      return handleShareDownload(request, env, new DOUsageClient(env.USAGE_STORE));
    }
    if (url.pathname === "/api/trend" && request.method === "GET") {
      const denied = await requireAuthorization(request, env);
      if (denied) return denied;
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
      try {
        const days: UsageTrendDay[] = await new DOUsageClient(env.USAGE_STORE).trend();
        return Response.json({ days }, { headers: { "cache-control": "private, no-store" } });
      } catch (error) {
        if (error instanceof QuotaExceededError) return Response.json({ error: error.message }, { status: 503 });
        throw error;
      }
    }
    if (url.pathname === "/usage" && request.method === "GET") {
      const denied = await requireAuthorization(request, env);
      if (denied) return denied;
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
      try {
        const usage = await new DOUsageClient(env.USAGE_STORE).summary();
        return Response.json(usage);
      } catch (error) {
        if (error instanceof QuotaExceededError) return Response.json({ error: error.message }, { status: 503 });
        throw error;
      }
    }
    if (url.pathname === "/usage/reconcile-official" && request.method === "POST") {
      const denied = await requireAuthorization(request, env);
      if (denied) return denied;
      if (!env.USAGE_STORE) return new Response("Durable Object binding is not configured.", { status: 503 });
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
    if (!hasCredentials(env)) {
      return credentialError("Set the WEBDAV_PASSWORD secret before using WebDAV.");
    }

    const username = env.WEBDAV_USERNAME || "webdav";
    if (!(await isAuthorized(request, username, env.WEBDAV_PASSWORD || ""))) return unauthorized();
    if (!env.FILES || !env.USAGE_STORE) {
      return new Response("R2 bucket or Durable Object binding is not configured.", { status: 503 });
    }
    const usage = new DOUsageClient(env.USAGE_STORE);
    return handleWebDav(request, trackedEnv(env, usage), path, usage);
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const usageStore = env.USAGE_STORE;
    if (!usageStore) throw new Error("Durable Object binding is not configured.");
    const client = new DOUsageClient(usageStore);
    if (env.FILES) {
      const tracked = trackedEnv(env, client).FILES;
      if (tracked) {
        const releasedBytes = await purgeExpiredTrash(tracked);
        if (releasedBytes) await client.release(releasedBytes, 0, 0);
      }
    }
    await client.reconcileOfficial();
  },
} satisfies ExportedHandler<Env>;
