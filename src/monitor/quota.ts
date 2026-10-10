export interface R2FreeLimits {
  classAOperations: number;
  classBOperations: number;
  storageBytes: number;
}

export interface QuotaConfig {
  limits: R2FreeLimits;
  thresholdRatio: number;
}

export interface UsageState {
  month: string;
  classAOperations: number;
  classBOperations: number;
  storageBytes: number;
  localClassAOperations: number;
  localClassBOperations: number;
  localStorageBytes: number;
  reconciledAt: string | null;
  reconciledClassAOperations: number;
  reconciledClassBOperations: number;
  reconciledStorageBytes: number;
}

export interface UsageSummary {
  state: UsageState;
  limits: R2FreeLimits;
  thresholdRatio: number;
  blocked: boolean;
  reason: string | null;
}

export const R2_FREE_LIMITS: R2FreeLimits = {
  classAOperations: 1_000_000,
  classBOperations: 10_000_000,
  storageBytes: 10 * 1024 ** 3,
};

export const DEFAULT_THRESHOLD_RATIO = 0.8;

export class QuotaExceededError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "QuotaExceededError";
  }
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function emptyUsageState(date: Date): UsageState {
  return {
    month: monthKey(date),
    classAOperations: 0,
    classBOperations: 0,
    storageBytes: 0,
    localClassAOperations: 0,
    localClassBOperations: 0,
    localStorageBytes: 0,
    reconciledAt: null,
    reconciledClassAOperations: 0,
    reconciledClassBOperations: 0,
    reconciledStorageBytes: 0,
  };
}

export function readQuotaConfig(env: Env): QuotaConfig {
  return {
    limits: {
      classAOperations: readPositive(env.QUOTA_CLASS_A_MAX, R2_FREE_LIMITS.classAOperations),
      classBOperations: readPositive(env.QUOTA_CLASS_B_MAX, R2_FREE_LIMITS.classBOperations),
      storageBytes: readPositive(env.QUOTA_STORAGE_MAX_BYTES, R2_FREE_LIMITS.storageBytes),
    },
    thresholdRatio: readRatio(env.QUOTA_THRESHOLD_PERCENT, DEFAULT_THRESHOLD_RATIO),
  };
}

function readPositive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readRatio(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return fallback;
  return parsed;
}

export function storageBlockReason(state: UsageState, config: QuotaConfig): string | null {
  const limit = config.limits.storageBytes * config.thresholdRatio;
  if (state.storageBytes < limit) return null;
  return `Storage estimate ${state.storageBytes} bytes reached ${Math.floor(limit)} bytes. Delete files to resume uploads.`;
}

export function operationBlockReason(state: UsageState, config: QuotaConfig): string | null {
  const { limits, thresholdRatio } = config;
  if (state.classAOperations >= limits.classAOperations * thresholdRatio) {
    return `Class A operations ${state.classAOperations} reached the configured threshold.`;
  }
  if (state.classBOperations >= limits.classBOperations * thresholdRatio) {
    return `Class B operations ${state.classBOperations} reached the configured threshold.`;
  }
  return null;
}

export function writeBlockReason(state: UsageState, config: QuotaConfig): string | null {
  return storageBlockReason(state, config) ?? operationBlockReason(state, config);
}

export function usageSummary(state: UsageState, config: QuotaConfig): UsageSummary {
  const reason = writeBlockReason(state, config);
  return {
    state,
    limits: config.limits,
    thresholdRatio: config.thresholdRatio,
    blocked: Boolean(reason),
    reason,
  };
}
