/**
 * Statistiques de tous les joueurs (mode Classique), servies par worker/index.ts.
 * Chaque carte terminée est envoyée une seule fois par navigateur, sans identifiant joueur.
 * Rien n'est envoyé hors du site publié (pas de pollution depuis `npm run dev`).
 * Si l'API ne répond pas, tout échoue en silence : le bloc ne s'affiche pas.
 */
import { CONFIG } from '../config';
import { load, save } from '../engine/storage';
import { t } from './i18n';

export interface CardStats {
  n: number;
  today: number;
  wins?: number;
  avg?: number | null;
  /** Trouvé en 1 à 5 essais, puis raté. */
  dist?: number[];
  /** Nombre de parties gagnées par score (0 à 100). */
  scores?: number[];
  wrong?: string | null;
}

export interface CardReport {
  won: boolean;
  tries: number;
  score: number;
  ms: number;
  wrongs: string[];
}

const live = (() => {
  try {
    return location.origin === new URL(CONFIG.url).origin;
  } catch {
    return false;
  }
})();

/** Identifiant d'une carte : numéro du jour et place dans la journée (les énigmes ne bougent jamais). */
export const cardId = (day: number, slot: number) => `c${day}.${slot}`;

/** Envois en cours : le panneau de fin peut se redessiner (changement de langue) avant la réponse. */
const pending = new Set<string>();

export function sendResult(day: number, slot: number, r: CardReport): void {
  if (!live) return;
  const id = cardId(day, slot);
  const sent = load<{ day: number; ids: string[] }>('sent', { day, ids: [] });
  if ((sent.day === day && sent.ids.includes(id)) || pending.has(id)) return;
  pending.add(id);
  fetch('/api/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ card: id, ...r }),
    keepalive: true,
  })
    .then((res) => {
      if (!res.ok) return;
      const cur = load<{ day: number; ids: string[] }>('sent', { day, ids: [] });
      save('sent', { day, ids: [...(cur.day === day ? cur.ids : []), id] });
    })
    .catch(() => {})
    .finally(() => pending.delete(id));
}

const memo = new Map<string, Promise<CardStats | null>>();

export function fetchStats(day: number, slot: number): Promise<CardStats | null> {
  if (!live) return Promise.resolve(null);
  const id = cardId(day, slot);
  let p = memo.get(id);
  if (!p) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    p = fetch(`/api/stats?card=${encodeURIComponent(id)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<CardStats>) : null))
      .catch(() => null)
      .finally(() => clearTimeout(timer));
    memo.set(id, p);
    // nouvelle tentative possible plus tard si l'appel a échoué
    p.then((s) => { if (!s) memo.delete(id); });
  }
  return p;
}

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Bloc de fin de carte. Vide tant que la carte compte moins de 30 joueurs. */
export function statsHtml(s: CardStats, mine: { won: boolean; tries: number; score: number | null }, fmt: (v: number) => string): string {
  if (!s.dist || !s.scores || !s.n) return '';
  const pct = (v: number) => Math.round((100 * v) / s.n);
  const lines: string[] = [];
  lines.push(
    t('psWon', { p: pct(s.wins ?? 0) }) +
      (s.avg ? ' · ' + t('psAvg', { a: s.avg.toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 1 }) }) : ''),
  );
  if (mine.won && mine.score !== null) {
    // part des joueurs (gagnants et perdants) dont le score est strictement inférieur
    const below = s.dist[5] + s.scores.slice(0, mine.score).reduce((a, b) => a + b, 0);
    lines.push(t('psBetter', { p: pct(below) }));
  }
  const max = Math.max(...s.dist, 1);
  const bars = s.dist
    .map((v, i) => {
      const me = mine.won ? i === mine.tries - 1 : i === 5;
      return `<li class="${me ? 'me' : ''}"><span>${i < 5 ? i + 1 : 'X'}</span><i style="--w:${((v / max) * 100).toFixed(1)}%"></i><b>${pct(v)} %</b></li>`;
    })
    .join('');
  return `<div class="pstats">
    <p class="ps-head">${t('psHead', { n: fmt(s.n) })}</p>
    ${lines.map((l) => `<p>${l}</p>`).join('')}
    <ol class="ps-dist">${bars}</ol>
    ${s.wrong ? `<p class="ps-wrong">${t('psWrong', { w: esc(s.wrong) })}</p>` : ''}
  </div>`;
}
