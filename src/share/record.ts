export interface ManagedShareRecord {
  id: string;
  fileKey: string;
  expiresAt: number;
  createdAt: string;
  maxDownloads: number | null;
  downloads: number;
  revoked: boolean;
}

export interface ShareCreateInput {
  id: string;
  fileKey: string;
  expiresAt: number;
  createdAt: string;
  maxDownloads: number | null;
}

export interface ShareStoreClient {
  createShare(input: ShareCreateInput): Promise<void>;
  listShares(): Promise<ManagedShareRecord[]>;
  getShare(id: string): Promise<ManagedShareRecord | null>;
  revokeShare(id: string): Promise<boolean>;
  consumeShare(id: string, now?: number): Promise<{ ok: boolean; reason?: "missing" | "revoked" | "expired" | "limit" }>;
}
