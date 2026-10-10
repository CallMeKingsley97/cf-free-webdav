async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
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
