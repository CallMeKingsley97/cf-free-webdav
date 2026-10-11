import { parseDavPath } from "../http/path.js";
import { signSharePath } from "../share/link.js";

interface ShareRequest {
  path: string;
  ttlHours: number;
}

const TTL_OPTIONS = [1, 24, 168, 720];

export async function apiShare(request: Request, env: Env): Promise<Response> {
  const secret = env.SHARE_SECRET || env.WEBDAV_PASSWORD;
  if (!secret) {
    return Response.json({ error: "Set the WEBDAV_PASSWORD secret before using WebDAV." }, { status: 503 });
  }

  let body: ShareRequest;
  try {
    body = (await request.json()) as ShareRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.path !== "string" || !body.path) {
    return Response.json({ error: "A file path is required." }, { status: 400 });
  }
  if (!TTL_OPTIONS.includes(body.ttlHours)) {
    return Response.json({ error: "Unsupported validity period." }, { status: 400 });
  }

  const target = parseDavPath(`/dav/${body.path.replace(/^\/+/, "")}`);
  if (!target || !target.key || target.collectionHint) {
    return Response.json({ error: "Only files can be shared." }, { status: 400 });
  }

  const expires = Math.floor(Date.now() / 1000) + body.ttlHours * 3600;
  const signature = await signSharePath(target.key, expires, secret);
  const encodedPath = target.segments.map((segment) => encodeURIComponent(segment)).join("/");
  return Response.json(
    {
      url: `${new URL(request.url).origin}/share/${expires}/${signature}?path=${encodeURIComponent(encodedPath)}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
