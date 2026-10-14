const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSharePath(key: string, expires: number, secret: string): Promise<string> {
  const cryptoKey = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(`${expires}:${key}`));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function signManagedSharePath(id: string, key: string, expires: number, secret: string): Promise<string> {
  const cryptoKey = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(`${id}:${expires}:${key}`));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function verifySharePath(
  key: string,
  expires: number,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    const cryptoKey = await hmacKey(secret);
    return await crypto.subtle.verify("HMAC", cryptoKey, base64UrlDecode(signature), encoder.encode(`${expires}:${key}`));
  } catch {
    return false;
  }
}

export async function verifyManagedSharePath(
  id: string,
  key: string,
  expires: number,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    const cryptoKey = await hmacKey(secret);
    return await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      base64UrlDecode(signature),
      encoder.encode(`${id}:${expires}:${key}`),
    );
  } catch {
    return false;
  }
}
