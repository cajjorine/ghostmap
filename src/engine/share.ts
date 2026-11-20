import { CONFIG } from '../config';
import type { GameResult } from './types';

export function buildShareText(dayNumber: number, result: GameResult): string {
  const score = result.won ? `${result.attempts}/${result.maxAttempts}` : `X/${result.maxAttempts}`;
  return [`${CONFIG.title} #${dayNumber} ${score}`, result.grid, CONFIG.url].filter(Boolean).join('\n');
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Touch mobile: native share sheet (WhatsApp, SMS…). Elsewhere: clipboard.
 * Must be called from a user gesture (click), otherwise browsers refuse.
 */
export async function shareResult(text: string): Promise<ShareOutcome> {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // otherwise fall back to the clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return legacyCopy(text) ? 'copied' : 'failed';
  }
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}
