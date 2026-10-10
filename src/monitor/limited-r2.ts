import type { UsageSummary } from "./quota.js";

export interface UsageClient {
  summary(): Promise<UsageSummary>;
  reserve(storageBytes: number, classAOperations: number, classBOperations: number): Promise<void>;
  commit(storageBytes: number, classAOperations: number, classBOperations: number): Promise<void>;
  release(storageBytes: number, classAOperations: number, classBOperations: number): Promise<void>;
}

export class LimitedR2 implements R2Bucket {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly usage: UsageClient,
  ) {}

  get(key: string, options?: R2GetOptions): Promise<R2Object | R2ObjectBody | null>;
  get(key: string, options: R2GetOptions & { onlyIf: R2Conditional }): Promise<R2Object | R2ObjectBody | null>;
  get(key: string, options: R2GetOptions & { range: R2Range }): Promise<R2ObjectBody | null>;
  get(
    key: string,
    options: R2GetOptions & {
      onlyIf: R2Conditional;
      range: R2Range;
    },
  ): Promise<R2Object | R2ObjectBody | null>;
  async get(key: string, options?: R2GetOptions): Promise<R2Object | R2ObjectBody | null> {
    await this.usage.commit(0, 0, 1);
    const result = await this.bucket.get(key, options);
    return result;
  }

  async head(key: string): Promise<R2Object | null> {
    await this.usage.commit(0, 0, 1);
    return this.bucket.head(key);
  }

  async put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream | string | null, options?: R2PutOptions): Promise<R2Object> {
    const size = estimateValueSize(value);
    await this.usage.reserve(size, 1, 0);
    const result = await this.bucket.put(key, value, options);
    await this.usage.commit(size, 1, 0);
    return result;
  }

  async delete(keys: string | string[]): Promise<void> {
    return this.bucket.delete(keys);
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const result = await this.bucket.list(options);
    await this.usage.commit(0, 1, 0);
    return result;
  }

  async createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload> {
    await this.usage.reserve(0, 1, 0);
    const upload = await this.bucket.createMultipartUpload(key, options);
    await this.usage.commit(0, 1, 0);
    return upload;
  }

  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload {
    return this.bucket.resumeMultipartUpload(key, uploadId);
  }
}

export function estimateValueSize(value: ArrayBuffer | ArrayBufferView | ReadableStream | string | null): number {
  if (value === null) return 0;
  if (typeof value === "string") return new TextEncoder().encode(value).byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (value instanceof ReadableStream) return 0;
  return value.byteLength;
}

