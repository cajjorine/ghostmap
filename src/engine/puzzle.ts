import encoded from 'virtual:puzzles';
import { CONFIG } from '../config';
import { dateKey, daysBetween } from './date';
import { createRng, hashString, type Rng } from './rng';

function decode<T>(b64: string, key: string): T[] {
  const bin = atob(b64);
  const k = new TextEncoder().encode(key);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ k[i % k.length];
  return JSON.parse(new TextDecoder().decode(bytes)) as T[];
}

let cache: unknown[] | null = null;
export function loadPuzzles<P>(): P[] {
  cache ??= decode<unknown>(encoded, __PUZZLE_KEY__);
  return cache as P[];
}

export interface Daily<P> {
  puzzle: P;
  dateKey: string;
  /** Index in puzzles.json. */
  index: number;
  /** 1-based game number since launchDate. */
  dayNumber: number;
}

export function getDaily<P>(now: Date = new Date()): Daily<P> {
  const puzzles = loadPuzzles<P>();
  if (puzzles.length === 0) throw new Error('src/data/puzzles.json is empty');
  const key = dateKey(now);
  // Clamped to 0: a device whose clock is before launch gets puzzle #1.
  const elapsed = Math.max(0, daysBetween(CONFIG.launchDate, key));
  if (elapsed >= puzzles.length) {
    console.warn(`[daily] puzzles exhausted (${puzzles.length}), looping. Add entries to puzzles.json.`);
  }
  const index = elapsed % puzzles.length;
  return { puzzle: puzzles[index], dateKey: key, index, dayNumber: elapsed + 1 };
}

/** Deterministic PRNG for the day: for procedural games or a stable daily shuffle. */
export function dailyRng(key: string = dateKey(), salt = ''): Rng {
  return createRng(hashString(`${CONFIG.gameId}:${key}:${salt}`));
}
