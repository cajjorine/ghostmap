import { CONFIG } from '../config';

/** Bump this to invalidate every save after an incompatible format change. */
const SCHEMA_VERSION = 1;
const prefix = `${CONFIG.gameId}:v${SCHEMA_VERSION}:`;

// In-memory fallback: Safari private mode, storage disabled, quota exceeded.
const memory = new Map<string, string>();
let backend: Storage | null = null;
try {
  const probe = '__probe__';
  localStorage.setItem(probe, probe);
  localStorage.removeItem(probe);
  backend = localStorage;
} catch {
  backend = null;
}

export const storageAvailable = backend !== null;

export function load<T>(key: string, fallback: T): T {
  const raw = backend ? safeGet(prefix + key) : (memory.get(prefix + key) ?? null);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  const raw = JSON.stringify(value);
  memory.set(prefix + key, raw);
  if (!backend) return;
  try {
    backend.setItem(prefix + key, raw);
  } catch {
    /* quota: memory copy kept for this session */
  }
}

export function remove(key: string): void {
  memory.delete(prefix + key);
  try {
    backend?.removeItem(prefix + key);
  } catch {
    /* ignore */
  }
}

function safeGet(k: string): string | null {
  try {
    return backend!.getItem(k);
  } catch {
    return memory.get(k) ?? null;
  }
}
