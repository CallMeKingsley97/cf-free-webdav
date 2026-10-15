const encoder = new TextEncoder();

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function redirectUri(request: Request, env: Env): string {
  return env.ONEDRIVE_REDIRECT_URI || `${new URL(request.url).origin}/auth/onedrive/callback`;
}

export async function startOneDriveAuth(request: Request, env: Env): Promise<Response> {
  if (!env.ONEDRIVE_CLIENT_ID) return new Response("ONEDRIVE_CLIENT_ID is not configured.", { status: 503 });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const state = `${timestamp}.${await sign(timestamp, env.WEBDAV_PASSWORD || "")}`;
  const url = new URL(`https://login.microsoftonline.com/${env.ONEDRIVE_TENANT || "consumers"}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: env.ONEDRIVE_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(request, env),
    response_mode: "query",
    scope: "offline_access Files.ReadWrite User.Read",
    state,
  }).toString();
  return Response.redirect(url.toString(), 302);
}

export async function finishOneDriveAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  const [timestamp, signature] = state.split(".");
  if (!code || !timestamp || !signature || Date.now() - Number(timestamp) * 1000 > 10 * 60 * 1000 || signature !== await sign(timestamp, env.WEBDAV_PASSWORD || "")) {
    return new Response("Invalid or expired authorization response.", { status: 400 });
  }
  if (!env.ONEDRIVE_CLIENT_ID) return new Response("ONEDRIVE_CLIENT_ID is not configured.", { status: 503 });
  const form = new URLSearchParams({
    client_id: env.ONEDRIVE_CLIENT_ID,
    code,
    redirect_uri: redirectUri(request, env),
    grant_type: "authorization_code",
    scope: "offline_access Files.ReadWrite User.Read",
  });
  if (env.ONEDRIVE_CLIENT_SECRET) form.set("client_secret", env.ONEDRIVE_CLIENT_SECRET);
  const tokenResponse = await fetch(`https://login.microsoftonline.com/${env.ONEDRIVE_TENANT || "consumers"}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  const body = await tokenResponse.json().catch(() => ({})) as { refresh_token?: string; error_description?: string };
  if (!tokenResponse.ok || !body.refresh_token) return new Response(`OneDrive authorization failed: ${body.error_description || tokenResponse.statusText}`, { status: 502 });
  return new Response(`<!doctype html><meta charset="utf-8"><title>OneDrive 授权完成</title><style>body{font:16px system-ui;max-width:760px;margin:48px auto;padding:0 20px}code,textarea{width:100%;box-sizing:border-box;font:13px ui-monospace}textarea{height:100px;padding:10px}</style><h1>OneDrive 授权完成</h1><p>将下面的 refresh token 设置为 Worker Secret：</p><textarea readonly>${body.refresh_token}</textarea><p><code>npx wrangler secret put ONEDRIVE_REFRESH_TOKEN</code></p><p>设置完成后刷新管理页面。</p>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}
