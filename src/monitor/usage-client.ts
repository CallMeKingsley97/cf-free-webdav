import type { UsageClient } from "./limited-r2.js";
import { QuotaExceededError, type UsageState, type UsageSummary } from "./quota.js";

export class DOUsageClient implements UsageClient {
  constructor(private readonly stub: DurableObjectStub) {}

  async reserve(storageBytes: number, classAOperations: number, classBOperations: number): Promise<void> {
    await this.post("/reserve", storageBytes, classAOperations, classBOperations);
  }

  async commit(storageBytes: number, classAOperations: number, classBOperations: number): Promise<void> {
    await this.post("/commit", storageBytes, classAOperations, classBOperations);
  }

  async release(storageBytes: number, classAOperations: number, classBOperations: number): Promise<void> {
    await this.post("/release", storageBytes, classAOperations, classBOperations);
  }

  async summary(): Promise<UsageSummary> {
    const response = await this.stub.fetch("https://usage/summary", { method: "GET" });
    if (!response.ok) throw new QuotaExceededError("Usage summary request failed.");
    return (await response.json()) as UsageSummary;
  }

  async reconcileOfficial(): Promise<UsageState> {
    const response = await this.stub.fetch("https://usage/reconcile-official", { method: "POST" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { reason?: string } | null;
      throw new QuotaExceededError(body?.reason || "Official reconcile failed.");
    }
    const result = (await response.json()) as { ok: boolean; state: UsageState };
    return result.state;
  }

  private async post(path: string, storageBytes: number, classAOperations: number, classBOperations: number): Promise<void> {
    const response = await this.stub.fetch("https://usage" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storageBytes, classAOperations, classBOperations }),
    });
    if (!response.ok) throw new QuotaExceededError("Usage store request failed.");
    const result = (await response.json()) as { ok: boolean; reason?: string };
    if (!result.ok) throw new QuotaExceededError(result.reason || "R2 usage threshold reached.");
  }
}
