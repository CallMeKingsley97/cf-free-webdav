import type { QuotaConfig, UsageState } from "../monitor/quota.js";
import { sendFeishuNotification } from "./feishu.js";

const encoder = new TextEncoder();

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let size = bytes / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size < 10 ? 2 : 1)} ${units[index]}`;
}

function ratioPercent(used: number, limit: number): number {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
}

export async function notifyThreshold(env: Env, state: UsageState, config: QuotaConfig): Promise<void> {
  const webhookUrl = env.FEISHU_WEBHOOK_URL;
  if (!webhookUrl) return;

  const alertPercent = env.FEISHU_ALERT_PERCENT ? Number(env.FEISHU_ALERT_PERCENT) : 70;
  if (!Number.isFinite(alertPercent) || alertPercent <= 0 || alertPercent > 100) return;

  const checks = [
    { name: "存储空间", used: state.storageBytes, limit: config.limits.storageBytes, byte: true },
    { name: "A 类操作", used: state.classAOperations, limit: config.limits.classAOperations, byte: false },
    { name: "B 类操作", used: state.classBOperations, limit: config.limits.classBOperations, byte: false },
  ];

  const exceeded = checks.filter((check) => ratioPercent(check.used, check.limit) >= alertPercent);
  if (!exceeded.length) return;

  const lines = exceeded.map((check) => {
    const percent = ratioPercent(check.used, check.limit);
    const used = check.byte ? formatBytes(check.used) : check.used.toLocaleString("en-US");
    const limit = check.byte ? formatBytes(check.limit) : check.limit.toLocaleString("en-US");
    return `**${check.name}**：${percent}%（${used} / ${limit}）`;
  });
  lines.push(`\n已达 ${alertPercent}% 预警线，${config.thresholdRatio * 100}% 触发熔断（写入停止）。请及时清理或调整配额。`);

  await sendFeishuNotification(webhookUrl, env.FEISHU_WEBHOOK_SECRET, {
    title: "R2 免费额度预警",
    lines,
  });
}
