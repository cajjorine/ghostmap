import { CONFIG } from '../config';
import { buildShareText, shareResult } from '../engine/share';
import type { Stats } from '../engine/stats';
import type { GameResult } from '../engine/types';
import { startCountdown } from './countdown';
import { toast } from './toast';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderEndView(
  body: HTMLElement,
  opts: { stats: Stats; result: GameResult | null; dayNumber: number; dateKey: string },
): void {
  const { stats, result, dayNumber } = opts;
  const winPct = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  const max = Math.max(1, ...Object.values(stats.distribution));

  const bars = Array.from({ length: CONFIG.maxAttempts }, (_, i) => {
    const n = stats.distribution[String(i + 1)] ?? 0;
    const current = result?.won && result.attempts === i + 1 ? ' current' : '';
    return `<div class="bar-row"><span>${i + 1}</span>
      <div class="bar${current}" style="width:${Math.max(8, (n / max) * 100)}%">${n}</div></div>`;
  }).join('');

  const heading = !result ? 'Statistiques' : result.won ? 'Bravo !' : 'Perdu…';

  body.innerHTML = `
    <h2>${heading}</h2>
    ${result?.summary ? `<p class="summary">${esc(result.summary)}</p>` : ''}
    <div class="stats">
      <div><strong>${stats.played}</strong><span>Parties</span></div>
      <div><strong>${winPct}</strong><span>% victoires</span></div>
      <div><strong>${stats.currentStreak}</strong><span>Série</span></div>
      <div><strong>${stats.maxStreak}</strong><span>Record</span></div>
    </div>
    <h3>Répartition</h3>
    <div class="distribution">${bars}</div>
    ${
      result
        ? `<div class="end-footer">
            <div class="next"><span>Prochain défi</span><strong data-countdown>--:--:--</strong></div>
            <button class="btn primary" data-share type="button">Partager</button>
          </div>`
        : ''
    }`;

  const cd = body.querySelector<HTMLElement>('[data-countdown]');
  if (cd) startCountdown(cd, opts.dateKey);

  body.querySelector('[data-share]')?.addEventListener('click', async () => {
    if (!result) return;
    const outcome = await shareResult(buildShareText(dayNumber, result));
    if (outcome === 'copied') toast('Résultat copié !');
    else if (outcome === 'failed') toast('Copie impossible sur ce navigateur');
  });
}
