const encoder = new TextEncoder();

export async function createInboxToken(id: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(id));
  return `${id}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyInboxToken(token: string, secret: string): Promise<string | null> {
  const separator = token.indexOf(".");
  if (separator < 1) return null;
  const id = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!isId(id) || !/^[A-Za-z0-9_-]{40,50}$/.test(signature)) return null;
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, base64UrlDecode(signature), encoder.encode(id));
    return valid ? id : null;
  } catch {
    return null;
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const decoded = atob(padded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function isId(id: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(id);
}
