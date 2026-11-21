/**
 * Mode « Retrouve-les » : le jeu à l'envers. La réponse est donnée, le globe est éteint, et le joueur touche
 * les pays concernés. 5 erreurs permises ; au-delà de 12 pays, l'objectif est d'en retrouver 12.
 * Il reprend les cartes Classique du jour, une fois celles-ci terminées (rien n'est dévoilé).
 * Sauvegarde propre au mode (clé `find`), hors des statistiques du moteur.
 */
import { CONFIG } from '../config';
import { shareResult } from '../engine/share';
import { load, save } from '../engine/storage';
import { angDist, type Feature, type LatLng, type World } from './globe';
import { t } from './i18n';
import { buzz, chime, ping, sadTone, thud } from './sound';

const MAX_ERR = 5;
const GOAL_CAP = 12;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

export type FindStatus = 'playing' | 'won' | 'lost' | 'gave';

export interface FindCard {
  found: string[];
  wrong: string[];
  status: FindStatus;
}

export interface FindState {
  cur: number;
  cards: FindCard[];
}

export interface Resolved {
  targets: Feature[];
  companions: Map<string, string>;
  start: LatLng;
}

export interface FindDeps {
  /** Conteneur du mode, dans le panneau. */
  el: HTMLElement;
  dateKey: string;
  dayNumber: number;
  count: number;
  world(): World | null;
  resolve(i: number): Resolved;
  title(i: number): string;
  fact(i: number): string;
  name(n: string): string;
  chip(n: number, total: number, bump: boolean): void;
  toast(msg: string): void;
  menu(): void;
  setTouring(on: boolean): void;
  flash(): void;
  confetti(): void;
}

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const newCard = (): FindCard => ({ found: [], wrong: [], status: 'playing' });

export function createFind(d: FindDeps) {
  const N = d.count;
  const saved = load<{ day: string; st: FindState } | null>('find', null);
  let st: FindState =
    saved && saved.day === d.dateKey && saved.st.cards?.length === N
      ? saved.st
      : { cur: 0, cards: Array.from({ length: N }, newCard) };
  let res: Resolved = { targets: [], companions: new Map(), start: { lat: 20, lng: 10 } };
  let touring = false;
  let last: { msg: string; kind: string } | null = null;

  const card = () => st.cards[st.cur];
  const persist = () => save('find', { day: d.dateKey, st });
  const setCard = (patch: Partial<FindCard>) => {
    st = { ...st, cards: st.cards.map((c, i) => (i === st.cur ? { ...c, ...patch } : c)) };
    persist();
  };
  const goal = () => Math.min(GOAL_CAP, res.targets.length);
  const goalOf = (i: number) => Math.min(GOAL_CAP, d.resolve(i).targets.length);
  const scoreOf = (c: FindCard, g: number) =>
    g ? Math.max(0, Math.round((100 * Math.min(c.found.length, g)) / g) - 5 * c.wrong.length) : 0;
  const total = () => st.cards.reduce((a, c, i) => a + (c.status === 'playing' ? 0 : scoreOf(c, goalOf(i))), 0);

  function progress() {
    const done = st.cards.filter((c) => c.status !== 'playing').length;
    return { done, total: N, finished: done === N, score: total() };
  }

  function feedback(msg: string, kind: string) {
    last = { msg, kind };
    const fb = d.el.querySelector<HTMLElement>('[data-ffb]');
    if (!fb) return;
    fb.textContent = msg;
    fb.className = 'fb ' + kind;
    fb.style.animation = 'none';
    void fb.offsetWidth;
    fb.style.animation = '';
  }

  const label = () => (N > 1 ? `<span class="cardno">${t('card', { n: st.cur + 1, total: N })}</span> · ` : '');
  const errPips = (c: FindCard) =>
    Array.from({ length: MAX_ERR }, (_, i) => `<span class="pip ${i < c.wrong.length ? 'wrong' : ''}"></span>`).join('');

  function render(fresh = false) {
    const c = card();
    const g = goal();
    d.chip(c.found.length, g, false);
    if (c.status === 'playing') {
      const taps = c.wrong.map((n) => `<li class="wrong">${esc(d.name(n))}</li>`).join('');
      d.el.innerHTML = `
        <p class="kicker ok">${label()}${t('findTag')}</p>
        <h2 class="ftitle">${esc(d.title(st.cur))}</h2>
        <div class="prow"><div class="pips">${errPips(c)}</div><span class="tries">${t('findErrors', { n: c.wrong.length, max: MAX_ERR })}</span></div>
        <p class="fgoal">${
          res.targets.length > GOAL_CAP
            ? t('findGoalOf', { n: c.found.length, goal: g, total: res.targets.length })
            : t('findGoal', { n: c.found.length, goal: g })
        }</p>
        <p class="fhow">${t('findHow')}</p>
        <p class="fb" data-ffb role="status" aria-live="polite"></p>
        <ul class="tried">${taps}</ul>
        <div class="acts"><button class="gbtn ghost" type="button" data-giveup>${t('giveUp')}</button></div>`;
      d.el.querySelector('[data-giveup]')!.addEventListener('click', () => finish('gave'));
      if (last) {
        const fb = d.el.querySelector<HTMLElement>('[data-ffb]')!;
        fb.textContent = last.msg;
        fb.className = 'fb ' + last.kind;
      }
      return;
    }
    const lastCard = st.cur === N - 1;
    const missing = res.targets.filter((f) => !c.found.includes(f.n)).map((f) => d.name(f.n));
    const shown = missing.slice(0, 20);
    const more = missing.length - shown.length;
    const head = c.status === 'won' ? t('findWon') : c.status === 'lost' ? t('findLost') : t('findGave');
    const sc = scoreOf(c, g);
    const best = load<number>('bestFind', 0);
    d.el.innerHTML = `
      <div class="done">
        <p class="kicker ${c.status === 'won' ? 'ok' : 'ko'}">${label()}${head}</p>
        <h2>${esc(d.title(st.cur))}</h2>
        <div class="score"><b data-fscore>${sc}</b><span>/100</span></div>
        <p class="fstat">${t('findStat', { n: Math.min(c.found.length, g), goal: g, e: c.wrong.length })}</p>
        ${
          missing.length
            ? `<p class="missing">${esc(t('findMissing', { list: shown.join(', ') }))}${more > 0 ? ' ' + esc(t('findMore', { n: more })) : ''}</p>`
            : ''
        }
        ${d.fact(st.cur) ? `<p class="fact">${esc(d.fact(st.cur))}</p>` : ''}
        ${
          lastCard
            ? `<p class="daydone">${t('dayTotal', { n: total(), max: N * 100 })}${best ? ` · ${t('best', { n: best, max: N * 100 })}` : ''}</p>`
            : ''
        }
        <div class="acts">${
          lastCard
            ? `<button class="gbtn primary" data-fshare type="button">${t('share')}</button>
               <button class="gbtn ghost" data-fmenu type="button">${t('otherModes')}</button>`
            : `<button class="gbtn primary" data-fnext type="button">${t('next', { n: st.cur + 2, total: N })}</button>`
        }</div>
      </div>`;
    d.el.querySelector('[data-fnext]')?.addEventListener('click', next);
    d.el.querySelector('[data-fmenu]')?.addEventListener('click', d.menu);
    d.el.querySelector('[data-fshare]')?.addEventListener('click', share);
    const el = d.el.querySelector<HTMLElement>('[data-fscore]');
    if (fresh && el && !reduced) countUp(el, sc);
  }

  function countUp(el: HTMLElement, target: number) {
    const t0 = performance.now();
    const dur = 900 + target * 6;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = String(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  }

  async function share() {
    const lines = st.cards.map((c, i) => {
      const g = goalOf(i);
      const icon = c.status === 'won' ? '🟩' : '🟥';
      return `${icon} ${Math.min(c.found.length, g)}/${g} · ${c.wrong.length} ✗ · ${scoreOf(c, g)}`;
    });
    const text = [`${CONFIG.title} · ${t('findTag')} #${d.dayNumber}`, ...lines, t('scTotal', { n: total(), max: N * 100 }), CONFIG.url].join('\n');
    const r = await shareResult(text);
    if (r === 'copied') d.toast(t('copied'));
    else if (r === 'failed') d.toast(t('shareFail'));
  }

  /** Pose la carte courante sur le globe. */
  function show() {
    res = d.resolve(st.cur);
    last = null;
    const w = d.world();
    const c = card();
    if (w) {
      w.setTargets(res.targets, res.companions);
      c.found.forEach((n) => w.ignite(n, { silent: true }));
      if (c.status === 'playing') {
        w.intro(res.start);
        w.setScan(false);
      } else {
        w.setScan(false);
        w.markMissing(res.targets.filter((f) => !c.found.includes(f.n)).map((f) => f.n));
        w.lookAt(res.start, 1500);
      }
    }
    render();
  }

  function next() {
    if (st.cur >= N - 1) return;
    st = { ...st, cur: st.cur + 1 };
    persist();
    show();
  }

  function finish(status: FindStatus) {
    const c = card();
    if (c.status !== 'playing') return;
    setCard({ status });
    if (st.cards.every((x) => x.status !== 'playing') && total() > load<number>('bestFind', 0)) save('bestFind', total());
    const w = d.world();
    const missing = res.targets.filter((f) => !card().found.includes(f.n)).map((f) => f.n);
    const won = status === 'won';
    const after = () => {
      touring = false;
      d.setTouring(false);
      if (won) {
        chime();
        d.confetti();
      }
      render(true);
    };
    if (!won) sadTone();
    if (!w || reduced) {
      w?.markMissing(missing);
      setTimeout(after, 400);
      return;
    }
    touring = true;
    d.setTouring(true);
    d.flash();
    w.markMissing(missing);
    const tour = w.tour({ won: true, name: d.name, onStop: (i) => ping(i + 3) });
    const skip = () => tour.skip();
    const root = d.el.closest('.gm') ?? document.body;
    root.addEventListener('pointerdown', skip);
    tour.done.then(() => {
      root.removeEventListener('pointerdown', skip);
      setTimeout(after, 250);
    });
  }

  /** Toucher sur le globe (déjà filtré : bref et sans glisser). */
  function tap(x: number, y: number) {
    const c = card();
    const w = d.world();
    if (!w || touring || c.status !== 'playing') return;
    const hit = w.pick(x, y);
    if (!hit) return;
    let n = hit.name;
    if (n && res.companions.has(n)) n = res.companions.get(n)!;
    // dans l'eau : compte s'il tombe près d'une petite île à trouver (environ 300 km)
    if (!n) {
      const near = res.targets
        .filter((f) => !c.found.includes(f.n) && f.a < 10)
        .map((f) => ({ f, dd: angDist(hit, { lat: f.c[1], lng: f.c[0] }) }))
        .filter((x) => x.dd < 3)
        .sort((a, b) => a.dd - b.dd)[0];
      if (!near) {
        feedback(t('findSea'), 'info');
        return;
      }
      n = near.f.n;
    }
    const nm = d.name(n);
    if (c.found.includes(n)) {
      feedback(t('findAgain', { name: nm }), 'info');
      return;
    }
    if (res.targets.some((f) => f.n === n)) {
      const found = [...c.found, n];
      setCard({ found });
      w.ignite(n);
      ping(found.length % 8);
      d.chip(found.length, goal(), true);
      feedback(t('findRight', { name: nm }), 'ok');
      if (found.length >= goal()) finish('won');
      else render();
      return;
    }
    if (c.wrong.includes(n)) {
      feedback(t('findAgainWrong', { name: nm }), 'info');
      return;
    }
    const wrong = [...c.wrong, n];
    setCard({ wrong });
    w.flashMiss(n);
    thud();
    buzz();
    feedback(t('findWrong', { name: nm }), 'cold');
    if (wrong.length >= MAX_ERR) finish('lost');
    else render();
  }

  return { show, render, tap, progress, busy: () => touring };
}
