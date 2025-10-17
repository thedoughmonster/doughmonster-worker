import type { AppEnv } from "../config/env.js";
import { resolveOrderOpenedAt } from "../lib/order-utils.js";

const ORDER_BY_ID_PREFIX = "orders:byId:";
const ORDER_INDEX_PREFIX = "orders:index:";
const RECENT_INDEX_KEY = "orders:recentIndex";
const CURSOR_KEY = "orders:lastFulfilledCursor";
const RECENT_INDEX_LIMIT = 300;

export interface OrderCursor {
  ts: string | null;
  orderGuid: string | null;
  businessDate: number | null;
}

export interface CachedOrderRecord {
  guid: string;
  openedAtMs: number | null;
  order?: any;
}

export interface UpsertOptions {
  knownOrders?: Map<string, CachedOrderRecord>;
  limit?: number;
}

export async function getOrder(env: AppEnv, guid: string): Promise<any | null> {
  const key = `${ORDER_BY_ID_PREFIX}${guid}`;
  const raw = await env.CACHE_KV.get(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putOrder(env: AppEnv, order: any): Promise<void> {
  if (!order || typeof order.guid !== "string") {
    throw new Error("putOrder requires order with guid");
  }
  const key = `${ORDER_BY_ID_PREFIX}${order.guid}`;
  await env.CACHE_KV.put(key, JSON.stringify(order));
}

export async function getIndexForDate(env: AppEnv, businessDate: string): Promise<string[]> {
  const key = `${ORDER_INDEX_PREFIX}${businessDate}`;
  const raw = await env.CACHE_KV.get(key);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export async function upsertIntoDateIndex(
  env: AppEnv,
  businessDate: string,
  entries: CachedOrderRecord[],
  options: UpsertOptions = {}
): Promise<string[]> {
  if (!entries.length) {
    return getIndexForDate(env, businessDate);
  }

  const key = `${ORDER_INDEX_PREFIX}${businessDate}`;
  const existing = await getIndexForDate(env, businessDate);
  const known = mergeKnownOrders(entries, options.knownOrders);
  const combinedGuids = uniqueGuids([...entries.map((entry) => entry.guid), ...existing]);
  const resolved = await resolveRecords(env, combinedGuids, known);
  const sorted = sortRecords(resolved);
  const serialized = JSON.stringify(sorted.map((record) => record.guid));
  await env.CACHE_KV.put(key, serialized);
  return sorted.map((record) => record.guid);
}

export async function getRecentIndex(env: AppEnv): Promise<string[]> {
  const raw = await env.CACHE_KV.get(RECENT_INDEX_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export async function upsertRecentIndex(
  env: AppEnv,
  entries: CachedOrderRecord[],
  options: UpsertOptions = {}
): Promise<string[]> {
  const existing = await getRecentIndex(env);
  const known = mergeKnownOrders(entries, options.knownOrders);
  const combinedGuids = uniqueGuids([...entries.map((entry) => entry.guid), ...existing]);
  const resolved = await resolveRecords(env, combinedGuids, known);
  const sorted = sortRecords(resolved);
  const limit = options.limit ?? RECENT_INDEX_LIMIT;
  const trimmed = sorted.slice(0, limit);
  await env.CACHE_KV.put(RECENT_INDEX_KEY, JSON.stringify(trimmed.map((record) => record.guid)));
  return trimmed.map((record) => record.guid);
}

export async function getCursor(env: AppEnv): Promise<OrderCursor | null> {
  const raw = await env.CACHE_KV.get(CURSOR_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      ts: typeof parsed.ts === "string" ? parsed.ts : null,
      orderGuid: typeof parsed.orderGuid === "string" ? parsed.orderGuid : null,
      businessDate:
        typeof parsed.businessDate === "number"
          ? parsed.businessDate
          : typeof parsed.businessDate === "string" && /^\d{8}$/.test(parsed.businessDate)
          ? Number(parsed.businessDate)
          : null,
    };
  } catch {
    return null;
  }
}

export async function setCursor(env: AppEnv, cursor: OrderCursor): Promise<void> {
  await env.CACHE_KV.put(CURSOR_KEY, JSON.stringify(cursor));
}

function mergeKnownOrders(
  entries: CachedOrderRecord[],
  additional?: Map<string, CachedOrderRecord>
): Map<string, CachedOrderRecord> {
  const known = new Map<string, CachedOrderRecord>();
  for (const entry of entries) {
    if (!entry || typeof entry.guid !== "string") {
      continue;
    }
    known.set(entry.guid, { guid: entry.guid, openedAtMs: entry.openedAtMs, order: entry.order });
  }

  if (additional) {
    for (const [guid, record] of additional.entries()) {
      if (!guid || typeof guid !== "string" || !record) {
        continue;
      }
      const current = known.get(guid);
      if (!current) {
        known.set(guid, { guid, openedAtMs: record.openedAtMs, order: record.order });
        continue;
      }
      if (current.openedAtMs === null && record.openedAtMs !== null) {
        known.set(guid, { guid, openedAtMs: record.openedAtMs, order: record.order ?? current.order });
      } else if (record.order && !current.order) {
        current.order = record.order;
      }
    }
  }

  return known;
}

async function resolveRecords(
  env: AppEnv,
  guids: string[],
  known: Map<string, CachedOrderRecord>
): Promise<CachedOrderRecord[]> {
  const resolved: CachedOrderRecord[] = [];
  for (const guid of guids) {
    const record = await resolveRecord(env, guid, known);
    if (!record) {
      continue;
    }
    resolved.push(record);
  }
  return resolved;
}

async function resolveRecord(
  env: AppEnv,
  guid: string,
  known: Map<string, CachedOrderRecord>
): Promise<CachedOrderRecord | null> {
  if (!guid) {
    return null;
  }
  const cached = known.get(guid);
  if (cached && cached.openedAtMs !== undefined) {
    return cached;
  }

  const order = cached?.order ?? (await getOrder(env, guid));
  if (!order) {
    return null;
  }

  const opened = resolveOrderOpenedAt(order);
  const record: CachedOrderRecord = {
    guid,
    openedAtMs: opened.ms,
    order,
  };
  known.set(guid, record);
  return record;
}

function sortRecords(records: CachedOrderRecord[]): CachedOrderRecord[] {
  return records
    .filter((record) => typeof record.guid === "string" && record.guid)
    .sort((a, b) => {
      const aTime = a.openedAtMs;
      const bTime = b.openedAtMs;
      if (aTime !== null && bTime !== null && aTime !== bTime) {
        return bTime - aTime;
      }
      if (aTime === null && bTime !== null) {
        return 1;
      }
      if (bTime === null && aTime !== null) {
        return -1;
      }
      return a.guid.localeCompare(b.guid);
    });
}

function uniqueGuids(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}
