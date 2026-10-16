import {
  emptyUsageState,
  monthKey,
  operationBlockReason,
  readQuotaConfig,
  storageBlockReason,
  usageSummary,
  writeBlockReason,
  type UsageState,
  type UsageSummary,
} from "./quota.js";
import { fetchOfficialUsage, startOfMonthISO } from "./analytics.js";
import { notifyThreshold } from "../notify/threshold.js";
import type { ShareCreateInput } from "../share/record.js";
import type { GalleryRecord, InboxItemRecord, InboxRecord } from "../features/records.js";
import { RESERVED_ROOT } from "../http/path.js";

const STATE_KEY = "r2-usage-state";
const RESERVATIONS_KEY = "r2-usage-reservations";
const COMMITTED_RESERVATIONS_KEY = "r2-usage-committed-reservations";
const SNAPSHOT_RETENTION_DAYS = 60;
const RESERVATION_TTL_MS = 60 * 60 * 1000;
const INBOX_INDEX_KEY = "feature-inbox-index";
const INBOX_ITEMS_PREFIX = "feature-inbox-items:";
const INBOX_RECORD_PREFIX = "feature-inbox:";
const GALLERY_INDEX_KEY = "feature-gallery-index";
const GALLERY_RECORD_PREFIX = "feature-gallery:";
const MAX_INBOX_LINKS = 500;
const MAX_INBOX_UPLOADS = 100;
const MAX_GALLERIES = 500;

interface QuotaReservation extends ReservationRequest {
  expiresAt: number;
}

export class UsageStore {
  private tableReady = false;
  private stateLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  private ensureTable(): void {
    if (this.tableReady) return;
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS daily_snapshots (
        day TEXT PRIMARY KEY,
        month TEXT NOT NULL,
        class_a_operations INTEGER NOT NULL,
        class_b_operations INTEGER NOT NULL,
        storage_bytes INTEGER NOT NULL,
        blocked INTEGER NOT NULL
      )
    `);
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS managed_shares (
        id TEXT PRIMARY KEY,
        file_key TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        max_downloads INTEGER,
        downloads INTEGER NOT NULL DEFAULT 0,
        revoked INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.state.storage.sql.exec(`CREATE INDEX IF NOT EXISTS managed_shares_expiry ON managed_shares (expires_at)`);
    this.tableReady = true;
  }

  private dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private async recordSnapshot(state: UsageState): Promise<void> {
    this.ensureTable();
    const config = readQuotaConfig(this.env);
    const blocked = writeBlockReason(state, config) ? 1 : 0;
    const day = this.dayKey(new Date());
    this.state.storage.sql.exec(
      `INSERT INTO daily_snapshots (day, month, class_a_operations, class_b_operations, storage_bytes, blocked)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (day) DO UPDATE SET
         month = excluded.month,
         class_a_operations = excluded.class_a_operations,
         class_b_operations = excluded.class_b_operations,
         storage_bytes = excluded.storage_bytes,
         blocked = excluded.blocked`,
      day,
      state.month,
      Math.trunc(state.classAOperations),
      Math.trunc(state.classBOperations),
      Math.trunc(state.storageBytes),
      blocked,
    );
    // 清理超出保留期的旧快照
    const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
    this.state.storage.sql.exec(`DELETE FROM daily_snapshots WHERE day < ?`, cutoff);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/reserve":
        return this.reserve(await readJson(request));
      case "/commit":
        return this.commit(await readJson(request));
      case "/cancel":
        return this.cancel(await readReservationId(request));
      case "/release":
        return this.release(await readJson(request));
      case "/reconcile":
        return this.reconcile(await readJson(request));
      case "/reconcile-official":
        return this.reconcileOfficial();
      case "/summary":
        return this.summary();
      case "/trend":
        return this.trend();
      case "/shares/create":
        return this.createShare(await readShareInput(request));
      case "/shares/list":
        return this.listShares();
      case "/shares/get":
        return this.getShare(url.searchParams.get("id") || "");
      case "/shares/revoke":
        return this.revokeShare(url.searchParams.get("id") || "");
      case "/shares/consume":
        return this.consumeShare(await readShareConsumeInput(request));
      case "/inboxes/create":
        return this.createInbox(await readFeatureBody<InboxRecord>(request, "record"));
      case "/inboxes/list":
        return this.listInboxes();
      case "/inboxes/get":
        return this.getInbox(url.searchParams.get("id") || "");
      case "/inboxes/lookup":
        return this.lookupInbox(url.searchParams.get("id") || "");
      case "/inboxes/reserve":
        return this.reserveInboxUpload(await readFeatureBody<{ id: string; now: number }>(request));
      case "/inboxes/cancel-upload":
        return this.cancelInboxUpload(await readFeatureBody<{ id: string }>(request));
      case "/inboxes/finish-upload":
        return this.finishInboxUpload(await readFeatureBody<InboxItemRecord>(request, "item"));
      case "/inboxes/items":
        return this.listInboxItems(url.searchParams.get("linkId") || "");
      case "/inboxes/item":
        return this.getInboxItem(url.searchParams.get("id") || "");
      case "/inboxes/resolve":
        return this.resolveInboxItem(await readFeatureBody<{ id: string }>(request));
      case "/inboxes/revoke":
        return this.revokeInbox(url.searchParams.get("id") || "");
      case "/galleries/create":
        return this.createGallery(await readFeatureBody<GalleryRecord>(request, "record"));
      case "/galleries/list":
        return this.listGalleries();
      case "/galleries/get":
        return this.getGallery(url.searchParams.get("id") || "");
      case "/galleries/revoke":
        return this.revokeGallery(url.searchParams.get("id") || "");
      case "/reset":
        return this.reset();
      default:
        return new Response("Not found.", { status: 404 });
    }
  }

  async alarm(): Promise<void> {
    await this.withStateLock(async () => {
      const now = new Date();
      await this.save(emptyUsageState(now));
      await this.state.storage.put(RESERVATIONS_KEY, {});
      await this.state.storage.put(COMMITTED_RESERVATIONS_KEY, {});
      await this.scheduleMonthReset(now);
    });
  }


  private async ensureCurrentMonth(): Promise<UsageState> {
    const now = new Date();
    const month = monthKey(now);
    const stored = await this.state.storage.get<UsageState>(STATE_KEY);
    if (stored && stored.month === month) return stored;

    const fresh = emptyUsageState(now);
    await this.state.storage.put(STATE_KEY, fresh);
    await this.state.storage.put(RESERVATIONS_KEY, {});
    await this.scheduleMonthReset(now);
    return fresh;
  }

  private async scheduleMonthReset(now: Date): Promise<void> {
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const currentAlarm = await this.state.storage.getAlarm();
    if (!currentAlarm || currentAlarm < next) {
      await this.state.storage.setAlarm(next);
    }
  }

  private async save(next: UsageState): Promise<void> {
    await this.state.storage.put(STATE_KEY, next);
  }

  private async reserve(input: ReservationRequest): Promise<Response> {
    if (input.storageBytes < 0 || input.classAOperations < 0 || input.classBOperations < 0) {
      return Response.json({ ok: false, reason: "Reservations cannot be negative." }, { status: 400 });
    }
    return this.withStateLock(async () => {
      const state = await this.ensureCurrentMonth();
      const reservations = await this.currentReservations();
      const pending = sumReservations(reservations);
      const projected: UsageState = {
        ...state,
        storageBytes: state.storageBytes + pending.storageBytes + input.storageBytes,
        classAOperations: state.classAOperations + pending.classAOperations + input.classAOperations,
        classBOperations: state.classBOperations + pending.classBOperations + input.classBOperations,
      };
      const config = readQuotaConfig(this.env);
      const reason = input.storageBytes > 0 || input.classAOperations > 0
        ? storageBlockReason(projected, config) ?? operationBlockReason(projected, config)
        : null;
      if (reason) return Response.json({ ok: false, reason });

      const reservationId = crypto.randomUUID();
      reservations[reservationId] = { ...input, expiresAt: Date.now() + RESERVATION_TTL_MS };
      await this.state.storage.put(RESERVATIONS_KEY, reservations);
      return Response.json({ ok: true, reservationId });
    });
  }

  private async commit(input: ReservationRequest): Promise<Response> {
    return this.withStateLock(async () => {
      await this.ensureCurrentMonth();
      const reservationId = input.reservationId;
      const now = Date.now();
      const state = await this.state.storage.transaction(async (transaction) => {
        const values = await transaction.get([STATE_KEY, RESERVATIONS_KEY, COMMITTED_RESERVATIONS_KEY]);
        const current = values.get(STATE_KEY) as UsageState | undefined;
        const reservations = values.get(RESERVATIONS_KEY) as Record<string, QuotaReservation> | undefined || {};
        const committed = values.get(COMMITTED_RESERVATIONS_KEY) as Record<string, number> | undefined || {};
        const state = current?.month === monthKey(new Date()) ? current : emptyUsageState(new Date());

        for (const [id, expiresAt] of Object.entries(committed)) {
          if (expiresAt <= now) delete committed[id];
        }
        if (reservationId && committed[reservationId]) return { ...state };

        if (reservationId) {
          delete reservations[reservationId];
          committed[reservationId] = now + RESERVATION_TTL_MS;
        }
        state.storageBytes = Math.max(0, state.storageBytes + input.storageBytes);
        state.classAOperations = Math.max(0, state.classAOperations + input.classAOperations);
        state.classBOperations = Math.max(0, state.classBOperations + input.classBOperations);
        await transaction.put({
          [STATE_KEY]: state,
          [RESERVATIONS_KEY]: reservations,
          [COMMITTED_RESERVATIONS_KEY]: committed,
        });
        return state;
      });
      try {
        this.recordSnapshot(state);
      } catch {
        console.error(JSON.stringify({ level: "error", event: "snapshot_record_failed" }));
      }
      return Response.json({ ok: true, state });
    });
  }

  private async cancel(input: { reservationId: string }): Promise<Response> {
    return this.withStateLock(async () => {
      const reservations = await this.currentReservations();
      await this.state.storage.transaction(async (transaction) => {
        const committed = await transaction.get<Record<string, number>>(COMMITTED_RESERVATIONS_KEY) || {};
        if (!committed[input.reservationId]) {
          delete reservations[input.reservationId];
          await transaction.put(RESERVATIONS_KEY, reservations);
        }
      });
      return Response.json({ ok: true });
    });
  }

  private async release(input: ReservationRequest): Promise<Response> {
    return this.withStateLock(async () => {
      const state = await this.ensureCurrentMonth();
      state.storageBytes = Math.max(0, state.storageBytes - input.storageBytes);
      state.classAOperations = Math.max(0, state.classAOperations - input.classAOperations);
      state.classBOperations = Math.max(0, state.classBOperations - input.classBOperations);
      await this.save(state);
      return Response.json({ ok: true, state });
    });
  }

  private async reconcile(input: { storageBytes: number }): Promise<Response> {
    return this.withStateLock(async () => {
      const state = await this.ensureCurrentMonth();
      state.storageBytes = Math.max(0, Math.floor(input.storageBytes));
      state.reconciledAt = new Date().toISOString();
      await this.save(state);
      return Response.json({ ok: true, state });
    });
  }

  async reconcileOfficial(): Promise<Response> {
    const accountId = this.env.CF_ACCOUNT_ID;
    const apiToken = this.env.CF_API_TOKEN;
    const bucketName = this.env.R2_BUCKET_NAME || "cf-free-webdav-files";
    if (!accountId || !apiToken) {
      return Response.json({ ok: false, reason: "CF_ACCOUNT_ID and CF_API_TOKEN are required." }, { status: 503 });
    }

    const startOfMonth = startOfMonthISO(new Date());
    const official = await fetchOfficialUsage(accountId, apiToken, bucketName, startOfMonth);
    return this.withStateLock(async () => {
      const state = await this.ensureCurrentMonth();
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

      this.ctxSafeSideEffects(state);
      return Response.json({ ok: true, state });
    });
  }

  private ctxSafeSideEffects(state: UsageState): void {
    try {
      this.recordSnapshot(state);
    } catch {
      console.error(JSON.stringify({ level: "error", event: "snapshot_record_failed" }));
    }
    this.state.waitUntil(
      notifyThreshold(this.env, state, readQuotaConfig(this.env)).catch((error: unknown) => {
        console.error(JSON.stringify({
          level: "error",
          event: "threshold_notify_failed",
          error: error instanceof Error ? error.message : "unknown",
        }));
      }),
    );
  }

  private async summary(): Promise<Response> {
    return this.withStateLock(async () => {
      const state = await this.ensureCurrentMonth();
      const pending = sumReservations(await this.currentReservations());
      const projected: UsageState = {
        ...state,
        storageBytes: state.storageBytes + pending.storageBytes,
        classAOperations: state.classAOperations + pending.classAOperations,
        classBOperations: state.classBOperations + pending.classBOperations,
      };
      return Response.json(usageSummary(projected, readQuotaConfig(this.env)));
    });
  }

  private trend(): Response {
    this.ensureTable();
    const rows = this.state.storage.sql
      .exec<{ day: string; class_a_operations: number; class_b_operations: number; storage_bytes: number; blocked: number }>(
        `SELECT day, class_a_operations, class_b_operations, storage_bytes, blocked
         FROM daily_snapshots ORDER BY day ASC LIMIT 90`,
      )
      .toArray();
    return Response.json({
      days: rows.map((row) => ({
        day: row.day,
        classAOperations: row.class_a_operations,
        classBOperations: row.class_b_operations,
        storageBytes: row.storage_bytes,
        blocked: row.blocked !== 0,
      })),
    });
  }

  private async reset(): Promise<Response> {
    return this.withStateLock(async () => {
      const fresh = emptyUsageState(new Date());
      await this.save(fresh);
      await this.state.storage.put(RESERVATIONS_KEY, {});
      await this.state.storage.put(COMMITTED_RESERVATIONS_KEY, {});
      return Response.json({ ok: true, state: fresh });
    });
  }

  private async currentReservations(): Promise<Record<string, QuotaReservation>> {
    const stored = await this.state.storage.get<Record<string, QuotaReservation>>(RESERVATIONS_KEY) || {};
    const now = Date.now();
    let changed = false;
    for (const [id, reservation] of Object.entries(stored)) {
      if (!reservation || reservation.expiresAt <= now) {
        delete stored[id];
        changed = true;
      }
    }
    if (changed) await this.state.storage.put(RESERVATIONS_KEY, stored);
    return stored;
  }

  private createShare(input: ShareCreateInput): Response {
    this.ensureTable();
    if (
      !isShareId(input.id) ||
      !input.fileKey ||
      !Number.isSafeInteger(input.expiresAt) ||
      (input.maxDownloads !== null && (!Number.isSafeInteger(input.maxDownloads) || input.maxDownloads < 1 || input.maxDownloads > 10_000))
    ) {
      return Response.json({ ok: false, reason: "Invalid share record." }, { status: 400 });
    }
    this.pruneShares();
    this.state.storage.sql.exec(
      `INSERT INTO managed_shares (id, file_key, expires_at, created_at, max_downloads, downloads, revoked)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      input.id,
      input.fileKey,
      input.expiresAt,
      input.createdAt,
      input.maxDownloads,
    );
    return Response.json({ ok: true });
  }

  private listShares(): Response {
    this.ensureTable();
    this.pruneShares();
    const rows = this.state.storage.sql.exec<ShareSqlRow>(
      `SELECT id, file_key, expires_at, created_at, max_downloads, downloads, revoked
       FROM managed_shares ORDER BY created_at DESC LIMIT 500`,
    ).toArray();
    return Response.json({ ok: true, shares: rows.map(mapShareRow) });
  }

  private getShare(id: string): Response {
    this.ensureTable();
    if (!isShareId(id)) return Response.json({ ok: true, share: null });
    const row = this.state.storage.sql.exec<ShareSqlRow>(
      `SELECT id, file_key, expires_at, created_at, max_downloads, downloads, revoked
       FROM managed_shares WHERE id = ?`,
      id,
    ).toArray()[0];
    return Response.json({ ok: true, share: row ? mapShareRow(row) : null });
  }

  private revokeShare(id: string): Response {
    this.ensureTable();
    if (!isShareId(id)) return Response.json({ ok: true, revoked: false });
    const row = this.state.storage.sql.exec<{ id: string }>(
      `SELECT id FROM managed_shares WHERE id = ?`,
      id,
    ).toArray()[0];
    if (!row) return Response.json({ ok: true, revoked: false });
    this.state.storage.sql.exec(`UPDATE managed_shares SET revoked = 1 WHERE id = ?`, id);
    return Response.json({ ok: true, revoked: true });
  }

  private async consumeShare(input: { id: string; now: number }): Promise<Response> {
    return this.withStateLock(async () => {
      this.ensureTable();
      if (!isShareId(input.id)) return Response.json({ ok: false, reason: "missing" });
      const row = this.state.storage.sql.exec<ShareSqlRow>(
        `SELECT id, file_key, expires_at, created_at, max_downloads, downloads, revoked
         FROM managed_shares WHERE id = ?`,
        input.id,
      ).toArray()[0];
      if (!row) return Response.json({ ok: false, reason: "missing" });
      if (row.revoked !== 0) return Response.json({ ok: false, reason: "revoked" });
      if (Math.floor(input.now / 1000) > row.expires_at) return Response.json({ ok: false, reason: "expired" });
      if (row.max_downloads !== null && row.downloads >= row.max_downloads) {
        return Response.json({ ok: false, reason: "limit" });
      }
      this.state.storage.sql.exec(`UPDATE managed_shares SET downloads = downloads + 1 WHERE id = ?`, input.id);
      return Response.json({ ok: true });
    });
  }

  private async createInbox(record: InboxRecord): Promise<Response> {
    if (!isFeatureId(record?.id) || typeof record.folder !== "string" || !Number.isSafeInteger(record.expiresAt)) {
      return Response.json({ ok: false, reason: "Invalid inbox record." }, { status: 400 });
    }
    return this.withStateLock(async () => {
      const ids = await this.state.storage.get<string[]>(INBOX_INDEX_KEY) || [];
      if (ids.length >= MAX_INBOX_LINKS) return Response.json({ ok: false, reason: "Inbox link limit reached." }, { status: 429 });
      if (await this.state.storage.get<InboxRecord>(INBOX_RECORD_PREFIX + record.id)) {
        return Response.json({ ok: false, reason: "Inbox link already exists." }, { status: 409 });
      }
      const saved: InboxRecord = { ...record, revoked: false, uploadCount: 0 };
      ids.push(saved.id);
      await this.state.storage.put({
        [INBOX_INDEX_KEY]: ids,
        [INBOX_RECORD_PREFIX + saved.id]: saved,
        [INBOX_ITEMS_PREFIX + saved.id]: [],
      });
      return Response.json({ ok: true, inbox: saved });
    });
  }

  private async listInboxes(): Promise<Response> {
    const ids = await this.state.storage.get<string[]>(INBOX_INDEX_KEY) || [];
    const inboxes = await Promise.all(ids.map((id) => this.state.storage.get<InboxRecord>(INBOX_RECORD_PREFIX + id)));
    return Response.json({ ok: true, inboxes: inboxes.filter((item): item is InboxRecord => Boolean(item)) });
  }

  private async getInbox(id: string): Promise<Response> {
    const inbox = isFeatureId(id) ? await this.state.storage.get<InboxRecord>(INBOX_RECORD_PREFIX + id) : undefined;
    return Response.json({ ok: true, inbox: inbox || null });
  }

  private async lookupInbox(id: string): Promise<Response> {
    const inbox = isFeatureId(id) ? await this.state.storage.get<InboxRecord>(INBOX_RECORD_PREFIX + id) : undefined;
    return Response.json({ ok: true, inbox: inbox || null });
  }

  private async reserveInboxUpload(input: { id: string; now: number }): Promise<Response> {
    return this.withStateLock(async () => {
      if (!isFeatureId(input.id)) return Response.json({ ok: false, reason: "missing" });
      const key = INBOX_RECORD_PREFIX + input.id;
      const inbox = await this.state.storage.get<InboxRecord>(key);
      if (!inbox) return Response.json({ ok: false, reason: "missing" });
      if (inbox.revoked) return Response.json({ ok: false, reason: "revoked" });
      if (Math.floor(input.now / 1000) > inbox.expiresAt) return Response.json({ ok: false, reason: "expired" });
      if (inbox.uploadCount >= MAX_INBOX_UPLOADS) return Response.json({ ok: false, reason: "limit" });
      inbox.uploadCount += 1;
      await this.state.storage.put(key, inbox);
      return Response.json({ ok: true, inbox });
    });
  }

  private async cancelInboxUpload(input: { id: string }): Promise<Response> {
    return this.withStateLock(async () => {
      if (!isFeatureId(input.id)) return Response.json({ ok: true });
      const key = INBOX_RECORD_PREFIX + input.id;
      const inbox = await this.state.storage.get<InboxRecord>(key);
      if (inbox) {
        inbox.uploadCount = Math.max(0, inbox.uploadCount - 1);
        await this.state.storage.put(key, inbox);
      }
      return Response.json({ ok: true });
    });
  }

  private async finishInboxUpload(item: InboxItemRecord): Promise<Response> {
    if (!isFeatureId(item?.id) || !isFeatureId(item.linkId) ||
      item.objectKey !== `${RESERVED_ROOT}/inbox/${item.linkId}/${item.id}` ||
      typeof item.name !== "string" || !item.name || !Number.isSafeInteger(item.size) || item.size < 0) {
      return Response.json({ ok: false, reason: "Invalid inbox item." }, { status: 400 });
    }
    return this.withStateLock(async () => {
      const linkKey = INBOX_RECORD_PREFIX + item.linkId;
      const inbox = await this.state.storage.get<InboxRecord>(linkKey);
      if (!inbox) return Response.json({ ok: false, reason: "Inbox link not found." }, { status: 404 });
      const itemsKey = INBOX_ITEMS_PREFIX + item.linkId;
      const ids = await this.state.storage.get<string[]>(itemsKey) || [];
      if (ids.length >= MAX_INBOX_UPLOADS) return Response.json({ ok: false, reason: "Inbox is full." }, { status: 429 });
      if (ids.includes(item.id)) return Response.json({ ok: false, reason: "Inbox item already exists." }, { status: 409 });
      ids.push(item.id);
      await this.state.storage.put({ [itemsKey]: ids, [INBOX_RECORD_PREFIX + "item:" + item.id]: item });
      return Response.json({ ok: true, item });
    });
  }

  private async listInboxItems(linkId: string): Promise<Response> {
    const inboxes = linkId
      ? [linkId]
      : await this.state.storage.get<string[]>(INBOX_INDEX_KEY) || [];
    const items = (await Promise.all(inboxes.map(async (id) => {
      const ids = await this.state.storage.get<string[]>(INBOX_ITEMS_PREFIX + id) || [];
      return Promise.all(ids.map((itemId) => this.state.storage.get<InboxItemRecord>(INBOX_RECORD_PREFIX + "item:" + itemId)));
    }))).flat().filter((item): item is InboxItemRecord => Boolean(item));
    return Response.json({ ok: true, items });
  }

  private async getInboxItem(id: string): Promise<Response> {
    const item = isFeatureId(id) ? await this.state.storage.get<InboxItemRecord>(INBOX_RECORD_PREFIX + "item:" + id) : undefined;
    return Response.json({ ok: true, item: item || null });
  }

  private async resolveInboxItem(input: { id: string }): Promise<Response> {
    return this.withStateLock(async () => {
      if (!isFeatureId(input.id)) return Response.json({ ok: true, item: null });
      const itemKey = INBOX_RECORD_PREFIX + "item:" + input.id;
      const item = await this.state.storage.get<InboxItemRecord>(itemKey);
      if (!item) return Response.json({ ok: true, item: null });
      const itemsKey = INBOX_ITEMS_PREFIX + item.linkId;
      const ids = await this.state.storage.get<string[]>(itemsKey) || [];
      await this.state.storage.put(itemsKey, ids.filter((id) => id !== item.id));
      await this.state.storage.delete(itemKey);
      return Response.json({ ok: true, item });
    });
  }

  private async revokeInbox(id: string): Promise<Response> {
    return this.withStateLock(async () => {
      if (!isFeatureId(id)) return Response.json({ ok: true, revoked: false });
      const key = INBOX_RECORD_PREFIX + id;
      const inbox = await this.state.storage.get<InboxRecord>(key);
      if (!inbox) return Response.json({ ok: true, revoked: false });
      inbox.revoked = true;
      await this.state.storage.put(key, inbox);
      return Response.json({ ok: true, revoked: true });
    });
  }

  private async createGallery(record: GalleryRecord): Promise<Response> {
    if (!isFeatureId(record?.id) || typeof record.folder !== "string" ||
      (record.mode !== "photos" && record.mode !== "files") || typeof record.title !== "string" ||
      record.title.length > 120 || !Array.isArray(record.files) || record.files.length > 300) {
      return Response.json({ ok: false, reason: "Invalid gallery record." }, { status: 400 });
    }
    return this.withStateLock(async () => {
      const ids = await this.state.storage.get<string[]>(GALLERY_INDEX_KEY) || [];
      if (ids.length >= MAX_GALLERIES) return Response.json({ ok: false, reason: "Public page limit reached." }, { status: 429 });
      const key = GALLERY_RECORD_PREFIX + record.id;
      if (await this.state.storage.get<GalleryRecord>(key)) return Response.json({ ok: false, reason: "Public page already exists." }, { status: 409 });
      const saved: GalleryRecord = { ...record, revoked: false };
      ids.push(saved.id);
      await this.state.storage.put({ [GALLERY_INDEX_KEY]: ids, [key]: saved });
      return Response.json({ ok: true, gallery: saved });
    });
  }

  private async listGalleries(): Promise<Response> {
    const ids = await this.state.storage.get<string[]>(GALLERY_INDEX_KEY) || [];
    const records = await Promise.all(ids.map((id) => this.state.storage.get<GalleryRecord>(GALLERY_RECORD_PREFIX + id)));
    const galleries = records.filter((item): item is GalleryRecord => Boolean(item)).map(({ files, ...item }) => ({ ...item, fileCount: files.length }));
    return Response.json({ ok: true, galleries });
  }

  private async getGallery(id: string): Promise<Response> {
    const gallery = isFeatureId(id) ? await this.state.storage.get<GalleryRecord>(GALLERY_RECORD_PREFIX + id) : undefined;
    return Response.json({ ok: true, gallery: gallery || null });
  }

  private async revokeGallery(id: string): Promise<Response> {
    return this.withStateLock(async () => {
      if (!isFeatureId(id)) return Response.json({ ok: true, revoked: false });
      const key = GALLERY_RECORD_PREFIX + id;
      const gallery = await this.state.storage.get<GalleryRecord>(key);
      if (!gallery) return Response.json({ ok: true, revoked: false });
      gallery.revoked = true;
      await this.state.storage.put(key, gallery);
      return Response.json({ ok: true, revoked: true });
    });
  }

  private pruneShares(): void {
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 86_400;
    this.state.storage.sql.exec(`DELETE FROM managed_shares WHERE expires_at < ?`, cutoff);
  }

  private async withStateLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.stateLock;
    let unlock!: () => void;
    this.stateLock = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      unlock();
    }
  }
}

export interface ReservationRequest {
  storageBytes: number;
  classAOperations: number;
  classBOperations: number;
  reservationId?: string;
}

async function readJson(request: Request): Promise<ReservationRequest> {
  try {
    const body = (await request.json()) as Partial<ReservationRequest>;
    return {
      storageBytes: safeCount(body.storageBytes),
      classAOperations: safeCount(body.classAOperations),
      classBOperations: safeCount(body.classBOperations),
      reservationId: typeof body.reservationId === "string" ? body.reservationId : undefined,
    };
  } catch {
    return { storageBytes: 0, classAOperations: 0, classBOperations: 0 };
  }
}

function safeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

async function readReservationId(request: Request): Promise<{ reservationId: string }> {
  try {
    const body = (await request.json()) as { reservationId?: unknown };
    return { reservationId: typeof body.reservationId === "string" ? body.reservationId : "" };
  } catch {
    return { reservationId: "" };
  }
}

function sumReservations(reservations: Record<string, QuotaReservation>): ReservationRequest {
  return Object.values(reservations).reduce(
    (sum, item) => ({
      storageBytes: sum.storageBytes + item.storageBytes,
      classAOperations: sum.classAOperations + item.classAOperations,
      classBOperations: sum.classBOperations + item.classBOperations,
    }),
    { storageBytes: 0, classAOperations: 0, classBOperations: 0 },
  );
}

interface ShareSqlRow extends Record<string, SqlStorageValue> {
  id: string;
  file_key: string;
  expires_at: number;
  created_at: string;
  max_downloads: number | null;
  downloads: number;
  revoked: number;
}

function mapShareRow(row: ShareSqlRow): {
  id: string;
  fileKey: string;
  expiresAt: number;
  createdAt: string;
  maxDownloads: number | null;
  downloads: number;
  revoked: boolean;
} {
  return {
    id: row.id,
    fileKey: row.file_key,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    maxDownloads: row.max_downloads,
    downloads: row.downloads,
    revoked: row.revoked !== 0,
  };
}

function isShareId(id: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(id);
}

function isFeatureId(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);
}

async function readFeatureBody<T>(request: Request, property?: string): Promise<T> {
  try {
    const body = await request.json() as Record<string, unknown>;
    return (property ? body[property] : body) as T;
  } catch {
    return {} as T;
  }
}

async function readShareInput(request: Request): Promise<ShareCreateInput> {
  try {
    const body = await request.json() as Partial<ShareCreateInput>;
    return {
      id: typeof body.id === "string" ? body.id : "",
      fileKey: typeof body.fileKey === "string" ? body.fileKey : "",
      expiresAt: Number(body.expiresAt),
      createdAt: typeof body.createdAt === "string" ? body.createdAt : "",
      maxDownloads: body.maxDownloads === null || body.maxDownloads === undefined ? null : Number(body.maxDownloads),
    };
  } catch {
    return { id: "", fileKey: "", expiresAt: 0, createdAt: "", maxDownloads: null };
  }
}

async function readShareConsumeInput(request: Request): Promise<{ id: string; now: number }> {
  try {
    const body = await request.json() as { id?: unknown; now?: unknown };
    return {
      id: typeof body.id === "string" ? body.id : "",
      now: Number.isSafeInteger(body.now) ? Number(body.now) : Date.now(),
    };
  } catch {
    return { id: "", now: Date.now() };
  }
}
