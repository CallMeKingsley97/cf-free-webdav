const encoder = new TextEncoder();

export interface FeishuNotification {
  title: string;
  lines: string[];
}

export async function sendFeishuNotification(
  webhookUrl: string,
  secret: string | undefined,
  notification: FeishuNotification,
): Promise<void> {
  const payload: Record<string, unknown> = {
    timestamp: Math.floor(Date.now() / 1000).toString(),
    msg_type: "interactive",
    card: {
      schema: "2.0",
      header: {
        title: { tag: "plain_text", content: notification.title },
        template: "orange",
      },
      elements: [
        {
          tag: "div",
          text: { tag: "lark_md", content: notification.lines.join("\n") },
        },
      ],
    },
  };

  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = await feishuSign(timestamp, secret);
    payload.timestamp = timestamp.toString();
    payload.sign = sign;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Feishu webhook returned ${response.status}: ${body}`);
  }
}

async function feishuSign(timestamp: number, secret: string): Promise<string> {
  const key = encoder.encode(`${timestamp}\n${secret}`);
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(""));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
