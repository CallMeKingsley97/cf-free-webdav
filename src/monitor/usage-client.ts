import type { UsageClient } from "./limited-r2.js";
import { QuotaExceededError, type UsageState, type UsageSummary } from "./quota.js";
import type { ManagedShareRecord, ShareCreateInput, ShareStoreClient } from "../share/record.js";

export interface UsageTrendDay {
  day: string;
  classAOperations: number;
  classBOperations: number;
  storageBytes: number;
  blocked: boolean;
}

export class DOUsageClient implements UsageClient, ShareStoreClient {
  constructor(private readonly namespace: DurableObjectNamespace) {}

  private get stub(): DurableObjectStub {
    return this.namespace.get(this.namespace.idFromName("usage"));
  }

  async reserve(storageBytes: number, classAOperations: number, classBOperations: number): Promise<string> {
    const result = await this.post("/reserve", storageBytes, classAOperations, classBOperations);
    if (!result.reservationId) throw new QuotaExceededError("Usage reservation response is invalid.");
    return result.reservationId;
  }

  async commit(storageBytes: number, classAOperations: number, classBOperations: number, reservationId?: string): Promise<void> {
    try {
      await this.post("/commit", storageBytes, classAOperations, classBOperations, reservationId);
    } catch {
      await this.post("/commit", storageBytes, classAOperations, classBOperations, reservationId);
    }
  }

  async cancel(reservationId: string): Promise<void> {
    const response = await this.stub.fetch("https://usage/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reservationId }),
    });
    if (!response.ok) throw new QuotaExceededError("Usage reservation cancellation failed.");
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

  async trend(): Promise<UsageTrendDay[]> {
    const response = await this.stub.fetch("https://usage/trend", { method: "GET" });
    if (!response.ok) throw new QuotaExceededError("Usage trend request failed.");
    const result = (await response.json()) as { days: UsageTrendDay[] };
    return result.days;
  }

  async createShare(input: ShareCreateInput): Promise<void> {
    await this.fetchJson("/shares/create", "POST", input);
  }

  async listShares(): Promise<ManagedShareRecord[]> {
    const result = await this.fetchJson("/shares/list", "GET");
    return result.shares as ManagedShareRecord[];
  }

  async getShare(id: string): Promise<ManagedShareRecord | null> {
    const result = await this.fetchJson("/shares/get?id=" + encodeURIComponent(id), "GET");
    return (result.share as ManagedShareRecord | null) || null;
  }

  async revokeShare(id: string): Promise<boolean> {
    const result = await this.fetchJson("/shares/revoke?id=" + encodeURIComponent(id), "POST");
    return Boolean(result.revoked);
  }

  async consumeShare(id: string, now = Date.now()): Promise<{ ok: boolean; reason?: "missing" | "revoked" | "expired" | "limit" }> {
    const response = await this.stub.fetch("https://usage/shares/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, now }),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; reason?: string };
    if (!response.ok) throw new QuotaExceededError(result.reason || "Usage store request failed.");
    return { ok: Boolean(result.ok), reason: result.reason as "missing" | "revoked" | "expired" | "limit" | undefined };
  }

  private async post(
    path: string,
    storageBytes: number,
    classAOperations: number,
    classBOperations: number,
    reservationId?: string,
  ): Promise<{ ok: boolean; reason?: string; reservationId?: string }> {
    const response = await this.stub.fetch("https://usage" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storageBytes, classAOperations, classBOperations, reservationId }),
    });
    if (!response.ok) throw new QuotaExceededError("Usage store request failed.");
    const result = (await response.json()) as { ok: boolean; reason?: string; reservationId?: string };
    if (!result.ok) throw new QuotaExceededError(result.reason || "R2 usage threshold reached.");
    return result;
  }

  private async fetchJson(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await this.stub.fetch("https://usage" + path, {
      method,
      ...(body === undefined ? {} : {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || result.ok === false) {
      throw new QuotaExceededError(typeof result.reason === "string" ? result.reason : "Usage store request failed.");
    }
    return result;
  }
}
