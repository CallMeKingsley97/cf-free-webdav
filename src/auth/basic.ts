async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

export async function isAuthorized(
  request: Request,
  expectedUsername: string,
  expectedPassword: string,
): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > 8192 || !/^Basic\s/i.test(authorization)) return false;

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(authorization.replace(/^Basic\s/i, "").trim()), (char) =>
        char.charCodeAt(0),
      ),
    );
    return await constantTimeEqual(
      decoded,
      `${expectedUsername}:${expectedPassword}`,
    );
  } catch {
    return false;
  }
}
