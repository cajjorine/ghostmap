import { addDays } from './date';
import { load, save } from './storage';
import type { GameResult } from './types';

export interface Stats {
  played: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  lastPlayedKey: string | null;
  lastWonKey: string | null;
  /** Wins by attempt count ("1", "2", …). */
  distribution: Record<string, number>;
}

const KEY = 'stats';
const empty = (): Stats => ({
  played: 0,
  wins: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastPlayedKey: null,
  lastWonKey: null,
  distribution: {},
});

/** Stats for display: a streak whose last win is older than yesterday is shown as broken. */
export function getStats(todayKey: string): Stats {
  const s = { ...empty(), ...load<Partial<Stats>>(KEY, {}) };
  const alive = s.lastWonKey === todayKey || s.lastWonKey === addDays(todayKey, -1);
  return alive ? s : { ...s, currentStreak: 0 };
}

/** Records the day's result. Idempotent: a second call for the same day does nothing. */
export function recordResult(dayKey: string, result: GameResult): Stats {
  const s = { ...empty(), ...load<Partial<Stats>>(KEY, {}) };
  if (s.lastPlayedKey === dayKey) return getStats(dayKey);

  s.played += 1;
  s.lastPlayedKey = dayKey;
  if (result.won) {
    s.wins += 1;
    s.currentStreak = s.lastWonKey === addDays(dayKey, -1) ? s.currentStreak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.currentStreak);
    s.lastWonKey = dayKey;
    const k = String(result.attempts);
    s.distribution[k] = (s.distribution[k] ?? 0) + 1;
  } else {
    s.currentStreak = 0;
  }
  save(KEY, s);
  return s;
}
