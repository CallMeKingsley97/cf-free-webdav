import {
  emptyUsageState,
  monthKey,
  operationBlockReason,
  readQuotaConfig,
  storageBlockReason,
  usageSummary,
  type UsageState,
  type UsageSummary,
} from "./quota.js";
import { fetchOfficialUsage, startOfMonthISO } from "./analytics.js";

const STATE_KEY = "r2-usage-state";

export class UsageStore {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/reserve":
        return this.reserve(await readJson(request));
      case "/commit":
        return this.commit(await readJson(request));
      case "/release":
        return this.release(await readJson(request));
      case "/reconcile":
        return this.reconcile(await readJson(request));
      case "/reconcile-official":
        return this.reconcileOfficial();
      case "/summary":
        return this.summary();
      case "/reset":
        return this.reset();
      default:
        return new Response("Not found.", { status: 404 });
    }
  }

  async alarm(): Promise<void> {
    await this.ensureCurrentMonth();
    await this.state.storage.delete(STATE_KEY);
    await this.scheduleMonthReset(new Date());
  }


  private async ensureCurrentMonth(): Promise<UsageState> {
    const now = new Date();
    const month = monthKey(now);
    const stored = this.state.storage.get<UsageState>(STATE_KEY);
    if (stored && stored.month === month) return stored;

    const fresh = emptyUsageState(now);
    this.state.storage.put(STATE_KEY, fresh);
    await this.scheduleMonthReset(now);
    return fresh;
  }

  private async scheduleMonthReset(now: Date): Promise<void> {
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const currentAlarm = await this.state.storage.getAlarm();
    if (!currentAlarm || currentAlarm < next) {
      this.state.storage.setAlarm(next);
    }
  }

  private async save(next: UsageState): Promise<void> {
    await this.state.storage.put(STATE_KEY, next);
  }

  private async reserve(input: ReservationRequest): Promise<Response> {
    const state = await this.ensureCurrentMonth();
    const config = readQuotaConfig(this.env);

    if (input.storageBytes > 0) {
      const reason = storageBlockReason(state, config);
      if (reason) return Response.json({ ok: false, reason });
    }
    if (input.classAOperations > 0) {
      const reason = operationBlockReason(state, config);
      if (reason) return Response.json({ ok: false, reason });
    }
    return Response.json({ ok: true });
  }

  private async commit(input: ReservationRequest): Promise<Response> {
    const state = await this.ensureCurrentMonth();
    if (state.storageBytes + input.storageBytes < 0) state.storageBytes = 0;
    else state.storageBytes += input.storageBytes;
    state.classAOperations += input.classAOperations;
    state.classBOperations += input.classBOperations;
    await this.save(state);
    return Response.json({ ok: true, state });
  }

  private async release(input: ReservationRequest): Promise<Response> {
    const state = await this.ensureCurrentMonth();
    state.storageBytes = Math.max(0, state.storageBytes - input.storageBytes);
    state.classAOperations = Math.max(0, state.classAOperations - input.classAOperations);
    state.classBOperations = Math.max(0, state.classBOperations - input.classBOperations);
    await this.save(state);
    return Response.json({ ok: true, state });
  }

  private async reconcile(input: { storageBytes: number }): Promise<Response> {
    const state = await this.ensureCurrentMonth();
    state.storageBytes = Math.max(0, Math.floor(input.storageBytes));
    state.reconciledAt = new Date().toISOString();
    await this.save(state);
    return Response.json({ ok: true, state });
  }

  async reconcileOfficial(): Promise<Response> {
    const accountId = this.env.CF_ACCOUNT_ID;
    const apiToken = this.env.CF_API_TOKEN;
    const bucketName = this.env.R2_BUCKET_NAME || "cf-free-webdav-files";
    if (!accountId || !apiToken) {
      return Response.json({ ok: false, reason: "CF_ACCOUNT_ID and CF_API_TOKEN are required." }, { status: 503 });
    }

    const state = await this.ensureCurrentMonth();
    const startOfMonth = startOfMonthISO(new Date());
    const official = await fetchOfficialUsage(accountId, apiToken, bucketName, startOfMonth);

    state.localClassAOperations = state.classAOperations;
    state.localClassBOperations = state.classBOperations;
    state.localStorageBytes = state.storageBytes;
    state.reconciledClassAOperations = official.classAOperations;
    state.reconciledClassBOperations = official.classBOperations;
    state.reconciledStorageBytes = official.storageBytes;

    state.classAOperations = Math.max(official.classAOperations, state.localClassAOperations);
    state.classBOperations = Math.max(official.classBOperations, state.localClassBOperations);
    state.storageBytes = Math.max(official.storageBytes, state.localStorageBytes);
    state.reconciledAt = new Date().toISOString();
    await this.save(state);

    return Response.json({ ok: true, state });
  }

  private async summary(): Promise<Response> {
    const state = await this.ensureCurrentMonth();
    return Response.json(usageSummary(state, readQuotaConfig(this.env)));
  }

  private async reset(): Promise<Response> {
    const fresh = emptyUsageState(new Date());
    await this.save(fresh);
    return Response.json({ ok: true, state: fresh });
  }
}

export interface ReservationRequest {
  storageBytes: number;
  classAOperations: number;
  classBOperations: number;
}

async function readJson(request: Request): Promise<ReservationRequest> {
  try {
    const body = (await request.json()) as Partial<ReservationRequest>;
    return {
      storageBytes: safeCount(body.storageBytes),
      classAOperations: safeCount(body.classAOperations),
      classBOperations: safeCount(body.classBOperations),
    };
  } catch {
    return { storageBytes: 0, classAOperations: 0, classBOperations: 0 };
  }
}

function safeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}
