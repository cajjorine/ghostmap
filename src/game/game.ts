/**
 * Carte Fantôme : un globe 3D sans aucun nom, des pays qui s'allument quand on les découvre.
 * Le joueur devine ce qu'ils ont en commun en 5 essais. CARDS_PER_DAY cartes par jour, jouées à la suite :
 * le résultat de la journée n'est envoyé au moteur qu'après la dernière.
 * Chaque carte gagnée vaut un score sur 100 (essais, exploration, rapidité).
 * Contrat : GameModule (src/engine/types.ts) et skill daily-game-conventions.
 */
import { CONFIG } from '../config';
import { loadPuzzles } from '../engine/puzzle';
import { load, save } from '../engine/storage';
import type { GameContext, GameModule, GameResult } from '../engine/types';
import countriesUrl from '../data/geo/countries.json?url';
import landBinUrl from '../data/geo/land.bin?url';
import landMetaUrl from '../data/geo/land.json?url';
import { createWorld, webglAvailable, type Feature, type LandMeta, type LatLng, type World } from './globe';
import { getLang, setLang, t, wrongMsg, type Lang } from './i18n';
import { makeJudge, norm, type Judge, type NearRule } from './judge';
import { buzz, chime, isMuted, ping, sadTone, thud, toggleMute, tone } from './sound';

/** Nombre de cartes par jour (mettre 1 pour revenir à une carte par jour). */
const CARDS_PER_DAY = 3;

export interface PuzzleText {
  /** La réponse, affichée en fin de carte. */
  title: string;
  /** 4 indices au plus, débloqués un par un après chaque erreur. */
  hints: string[];
  /** Anecdote affichée en fin de carte. */
  fact: string;
  /** Façons de trouver : `+` = et, `/` = ou, `sauf` = mots interdits. */
  answers: string[];
  /** Réponses proches, dans l'ordre (la première qui correspond gagne). `hot` : essai non décompté. */
  near: NearRule[];
  /** Carte en dégradé : unité des valeurs (obligatoire). */
  unit?: string;
  /** Carte en dégradé : source des chiffres (obligatoire). */
  source?: string;
}

export interface Puzzle extends PuzzleText {
  /** `gradient` : chaque pays a une valeur, il brille et monte d'autant plus qu'elle est grande. */
  type?: 'gradient';
  /** Noms français des pays allumés (variantes reconnues : voir src/data/geo/countries.json). */
  countries?: string[];
  /** Carte en dégradé : nom français du pays → valeur. */
  values?: Record<string, number>;
  /** Carte en dégradé : `log` pour des valeurs très écartées. */
  scale?: 'log';
  /** Où le globe se tourne au début : « lat, lng » ou un nom de pays. */
  start?: string;
  /** Version anglaise. Ses réponses sont acceptées dans les deux langues. */
  en?: PuzzleText;
}

export type GuessKind = 'wrong' | 'near' | 'right';
export type CardStatus = 'playing' | 'won' | 'lost';

export interface Score {
  total: number;
  tries: number;
  explore: number;
  /** null : partie commencée avant le chronomètre (score ramené à 100 sans la rapidité). */
  speed: number | null;
}

export interface CardState {
  guesses: { t: string; k: GuessKind }[];
  /** Pays déjà découverts (noms Natural Earth). */
  found: string[];
  allSeen: boolean;
  status: CardStatus;
  /** Temps de jeu actif (page visible, règles fermées). Absent sur les parties d'avant le chronomètre. */
  ms?: number;
  /** Score de la carte gagnée. */
  score?: Score;
}

export interface State {
  /** Carte affichée (0-based). */
  cur: number;
  cards: CardState[];
}

export { norm as normalize };

/** Zones disputées qui s'allument avec leur pays, sans compter dans le total. */
const COMPANIONS: Record<string, string> = {
  'Siachen Glacier': 'India',
  'N. Cyprus': 'Cyprus',
  Somaliland: 'Somalia',
};
const SQ: Record<GuessKind, string> = { wrong: '🟥', near: '🟧', right: '🟩' };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SHELL = `
<div class="gm-globe" data-globe></div>
<canvas class="gm-fx" data-fx></canvas>
<div class="gm-flash" data-flash aria-hidden="true"></div>
<button class="ib gm-sound" data-sound type="button"><svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path class="w" d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/><path class="x" d="M16 9.5l5 5M21 9.5l-5 5"/></svg></button>
<div class="lang" data-lang-tab role="group"><button type="button" data-set-lang="fr">FR</button><button type="button" data-set-lang="en">EN</button></div>
<div class="chip" data-chip aria-live="polite"><b data-found>0</b><span>/ <span data-total>0</span></span><span class="lbl" data-chip-lbl></span><i></i></div>
<div class="legend" data-legend hidden aria-hidden="true"><span data-less></span><i></i><span data-more></span></div>
<div class="drag" data-drag aria-hidden="true">
  <svg viewBox="0 0 120 44"><path d="M14 30c28-16 64-16 92 0" opacity=".45"/><path d="M98 22l8 8-10 4" opacity=".45"/><g class="hand"><circle cx="60" cy="20" r="9" fill="rgba(255,255,255,.18)"/><circle cx="60" cy="20" r="4" fill="#fff" stroke="none"/></g></svg>
  <span data-drag-lbl></span>
</div>
<section class="panel" data-panel>
  <div data-play>
    <div class="prow"><div class="pips" data-pips aria-hidden="true"></div><span class="tries" data-tries></span></div>
    <ol class="hints" data-hints></ol>
    <p class="fb" data-fb role="status" aria-live="polite"></p>
    <form class="gform" data-form autocomplete="off">
      <input data-input maxlength="80" enterkeyhint="send" autocapitalize="off" spellcheck="false">
      <button class="gbtn primary" type="submit" data-submit></button>
    </form>
    <ul class="tried" data-tried></ul>
  </div>
  <div class="done" data-done hidden></div>
</section>
<div class="fps" data-fps aria-hidden="true"><b>--</b> i/s</div>
<div class="loader" data-loader><div></div></div>`;

async function loadGeo(): Promise<[Feature[], LandMeta[], ArrayBuffer]> {
  const ok = (r: Response) => {
    if (!r.ok) throw new Error(r.url + ' : ' + r.status);
    return r;
  };
  return Promise.all([
    fetch(countriesUrl).then((r) => ok(r).json() as Promise<Feature[]>),
    fetch(landMetaUrl).then((r) => ok(r).json() as Promise<LandMeta[]>),
    fetch(landBinUrl).then((r) => ok(r).arrayBuffer()),
  ]);
}

const newCard = (): CardState => ({ guesses: [], found: [], allSeen: false, status: 'playing', ms: 0 });

/** Cartes du jour : bloc de CARDS_PER_DAY entrées consécutives, sans chevauchement d'un jour à l'autre. */
function dayCards(dayNumber: number): Puzzle[] {
  const all = loadPuzzles<Puzzle>();
  const base = CARDS_PER_DAY * Math.max(0, dayNumber - 1);
  return Array.from({ length: CARDS_PER_DAY }, (_, i) => all[(base + i) % all.length]);
}

/**
 * Sauvegarde du jour, y compris l'ancien format à une carte (migré en carte 1).
 * Une carte gagnée avant l'arrivée du score reçoit le sien (exploration estimée, sans rapidité).
 */
function restore(saved: unknown, ctx: GameContext<Puzzle, State>, puzzles: Puzzle[]): State {
  const s = saved as Partial<State> & Partial<CardState>;
  let st: State;
  if (s && Array.isArray(s.cards) && s.cards.length === CARDS_PER_DAY)
    st = { cur: Math.min(CARDS_PER_DAY - 1, Math.max(0, s.cur ?? 0)), cards: s.cards };
  else {
    const cards = Array.from({ length: CARDS_PER_DAY }, newCard);
    if (s && Array.isArray(s.guesses))
      cards[0] = { guesses: s.guesses, found: s.found ?? [], allSeen: !!s.allSeen, status: ctx.status };
    st = { cur: 0, cards };
  }
  st.cards = st.cards.map((c, i) => {
    if (c.status !== 'won' || c.score) return c;
    const n = countriesOf(puzzles[i]).length;
    return { ...c, score: computeScore(c, n ? c.found.length / n : 0) };
  });
  return st;
}

/** Pays d'une carte, en noms français tels qu'écrits dans puzzles.json. */
const countriesOf = (p: Puzzle) => (p.type === 'gradient' ? Object.keys(p.values ?? {}) : (p.countries ?? []));

/** 5 niveaux (0 à 4) : rang direct s'il y a 5 valeurs distinctes ou moins, sinon échelle linéaire ou log. */
function levelsOf(vals: number[], log: boolean): number[] {
  const tr = vals.map((v) => (log ? Math.log10(Math.max(v, 1e-9)) : v));
  const distinct = [...new Set(tr)].sort((a, b) => a - b);
  if (distinct.length <= 5)
    return tr.map((v) => (distinct.length === 1 ? 4 : Math.round((distinct.indexOf(v) * 4) / (distinct.length - 1))));
  const lo = distinct[0];
  const hi = distinct[distinct.length - 1];
  return tr.map((v) => Math.min(4, Math.floor(((v - lo) / (hi - lo)) * 5)));
}

/** Barème : essais 60 → 12, exploration 20 × part repérée, rapidité 20 sous 1 min puis 0 à 5 min. */
function computeScore(c: CardState, seenRatio: number): Score {
  const tries = Math.max(12, 60 - 12 * (c.guesses.length - 1));
  const explore = Math.round(20 * Math.min(1, Math.max(0, seenRatio)));
  if (c.ms === undefined) return { total: Math.round(((tries + explore) * 100) / 80), tries, explore, speed: null };
  const s = c.ms / 1000;
  const speed = s <= 60 ? 20 : s >= 300 ? 0 : Math.round((20 * (300 - s)) / 240);
  return { total: tries + explore + speed, tries, explore, speed };
}

export const game: GameModule<Puzzle, State> = {
  mount(root, ctx: GameContext<Puzzle, State>, api) {
    const MAX = CONFIG.maxAttempts;
    const N = CARDS_PER_DAY;
    const puzzles = dayCards(ctx.dayNumber);
    let st: State = restore(ctx.saved, ctx, puzzles);
    let dayFinished = ctx.status !== 'playing';
    /** Pendant le spectacle de fin : pas de nouvel affichage du panneau. */
    let touring = false;

    const card = () => st.cards[st.cur];
    const puzzle = () => puzzles[st.cur];
    const text = (): PuzzleText => {
      const p = puzzle();
      return getLang() === 'en' && p.en ? p.en : p;
    };
    const setCard = (patch: Partial<CardState>) => {
      st = { ...st, cards: st.cards.map((c, i) => (i === st.cur ? { ...c, ...patch } : c)) };
    };

    /** Réponses justes des deux langues ; réponses proches et messages dans la langue choisie. */
    let judge: Judge;
    const buildJudge = () => {
      const p = puzzle();
      judge = makeJudge([...p.answers, ...(p.en?.answers ?? [])], text().near);
    };
    buildJudge();

    root.classList.add('gm');
    root.innerHTML = SHELL;
    const $ = <T extends HTMLElement = HTMLElement>(k: string) => root.querySelector<T>(`[data-${k}]`)!;
    const ui = {
      globe: $('globe'), fx: $<HTMLCanvasElement>('fx'), flash: $('flash'), sound: $('sound'), langTab: $('lang-tab'),
      chip: $('chip'), chipLbl: $('chip-lbl'), found: $('found'), total: $('total'), drag: $('drag'),
      legend: $('legend'), less: $('less'), more: $('more'),
      dragLbl: $('drag-lbl'), panel: $('panel'), play: $('play'), done: $('done'), pips: $('pips'),
      tries: $('tries'), hints: $('hints'), fb: $('fb'), form: $<HTMLFormElement>('form'),
      input: $<HTMLInputElement>('input'), submit: $('submit'), tried: $('tried'), fps: $('fps'), loader: $('loader'),
    };
    const chipBar = ui.chip.querySelector('i')!;

    let world: World | null = null;
    let features: Feature[] = [];
    let featByName = new Map<string, Feature>();
    let targets: Feature[] = [];
    let start: LatLng = { lat: 20, lng: 10 };
    let find: (raw: string) => Feature | null = () => null;

    /** Nom affiché d'un pays (clé Natural Earth) dans la langue choisie. */
    const displayName = (n: string) => (getLang() === 'fr' ? (featByName.get(n)?.fr ?? n) : n);
    /** Nom affiché d'un pays écrit en français dans puzzles.json. */
    const displayRaw = (raw: string) => {
      const f = find(raw);
      return f ? displayName(f.n) : raw;
    };
    const fmt = (v: number) => v.toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-GB');

    // ---------- sauvegarde ----------
    let saveTimer: number | undefined;
    const saveNow = () => {
      window.clearTimeout(saveTimer);
      saveTimer = undefined;
      api.save(st);
    };
    // les pays découverts arrivent en rafale quand on tourne le globe : une sauvegarde groupée suffit
    const saveSoon = () => {
      if (saveTimer === undefined) saveTimer = window.setTimeout(saveNow, 400);
    };
    addEventListener('pagehide', () => { if (saveTimer !== undefined) saveNow(); });

    const wrongCount = () => card().guesses.filter((g) => g.k !== 'right').length;

    // ---------- chronomètre : ne compte que le temps de jeu réel ----------
    const rulesOpen = () => (document.getElementById('rules-modal') as HTMLDialogElement | null)?.open ?? false;
    let lastTick = performance.now();
    let ticks = 0;
    setInterval(() => {
      const now = performance.now();
      const dt = Math.min(2000, now - lastTick);
      lastTick = now;
      const c = card();
      if (!world || touring || document.hidden || rulesOpen() || c.status !== 'playing' || c.ms === undefined) return;
      setCard({ ms: c.ms + dt });
      if (++ticks % 5 === 0) saveSoon();
    }, 1000);

    // ---------- textes fixes et langue ----------
    function applyStatic() {
      ui.globe.setAttribute('aria-label', t('globe'));
      ui.sound.setAttribute('aria-label', isMuted() ? t('soundOn') : t('soundOff'));
      ui.chipLbl.textContent = t('chip');
      ui.dragLbl.textContent = t('drag');
      ui.less.textContent = t('less');
      ui.more.textContent = t('more');
      ui.panel.setAttribute('aria-label', t('panel'));
      ui.input.placeholder = t('placeholder');
      ui.input.setAttribute('aria-label', t('input'));
      ui.submit.textContent = t('submit');
      ui.tried.setAttribute('aria-label', t('tried'));
      ui.langTab.setAttribute('aria-label', t('langGroup'));
      ui.langTab.querySelectorAll<HTMLButtonElement>('[data-set-lang]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.setLang === getLang()));
      });
    }
    ui.langTab.addEventListener('click', (e) => {
      const l = (e.target as HTMLElement).closest<HTMLElement>('[data-set-lang]')?.dataset.setLang as Lang | undefined;
      if (!l || l === getLang()) return;
      setLang(l);
      buildJudge();
      applyStatic();
      ui.fb.textContent = '';
      if (!touring) render();
    });

    // ---------- son ----------
    ui.sound.addEventListener('click', () => {
      toggleMute();
      ui.sound.classList.toggle('off', isMuted());
      applyStatic();
    });
    ui.sound.classList.toggle('off', isMuted());

    // ---------- panneau ----------
    function feedback(msg: string, kind: string) {
      ui.fb.textContent = msg;
      ui.fb.className = 'fb ' + kind;
      ui.fb.style.animation = 'none';
      void ui.fb.offsetWidth;
      ui.fb.style.animation = '';
    }

    const pipsHtml = (c: CardState, cur: boolean) =>
      Array.from({ length: MAX }, (_, i) => {
        const g = c.guesses[i];
        return `<span class="pip ${g ? g.k : cur && i === c.guesses.length ? 'cur' : ''}"></span>`;
      }).join('');

    const cardLabel = () => (N > 1 ? `<span class="cardno">${t('card', { n: st.cur + 1, total: N })}</span> · ` : '');

    function renderPlay() {
      const c = card();
      const tx = text();
      const w = wrongCount();
      ui.play.hidden = false;
      ui.done.hidden = true;
      ui.pips.innerHTML = pipsHtml(c, c.status === 'playing');
      ui.tries.innerHTML = c.status === 'playing' ? cardLabel() + t('tries', { n: c.guesses.length + 1, max: MAX }) : '';
      const shown = Math.min(w, tx.hints.length);
      ui.hints.innerHTML =
        shown === 0
          ? `<li class="h0">${t('first')}</li>`
          : tx.hints
              .slice(0, shown)
              .map((h, i) => `<li class="${i === shown - 1 ? 'new' : ''}"><span>${t('hint', { n: i + 1 })}</span>${esc(h)}</li>`)
              .reverse()
              .join('');
      ui.tried.innerHTML = c.guesses
        .filter((g) => g.k !== 'right')
        .map((g) => `<li class="${g.k}">${esc(g.t)}</li>`)
        .join('');
    }

    const dayTotal = () => st.cards.reduce((a, c) => a + (c.score?.total ?? 0), 0);

    function scoreHtml(c: CardState) {
      if (c.status !== 'won' || !c.score) return `<div class="score lost"><b>X</b><span>/100</span></div>`;
      const s = c.score;
      const row = (label: string, v: number, max: number) => `<li><span>${label}</span><b>${v}</b>/${max}</li>`;
      return `<div class="score"><b data-score>${s.total}</b><span>/100</span></div>
        <ul class="breakdown">${row(t('scTries'), s.tries, 60)}${row(t('scExplore'), s.explore, 20)}${
          s.speed === null ? '' : row(t('scSpeed'), s.speed, 20)
        }</ul>`;
    }

    function rankingHtml() {
      const p = puzzle();
      if (p.type !== 'gradient' || !p.values) return '';
      const tx = text();
      const unit = tx.unit ?? p.unit ?? '';
      const rows = Object.entries(p.values)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([raw, v]) => `<li><span>${esc(displayRaw(raw))}</span><b>${fmt(v)}</b></li>`)
        .join('');
      const src = tx.source ?? p.source;
      return `<div class="ranking"><p class="rk-head">${t('ranking')}${unit ? ` · ${esc(unit)}` : ''}</p><ol>${rows}</ol>${
        src ? `<p class="rk-src">${esc(t('source', { s: src }))}</p>` : ''
      }</div>`;
    }

    /** `fresh` : la carte vient de se terminer, le score défile de 0 à sa valeur. */
    function renderDone(fresh = false) {
      const c = card();
      const tx = text();
      const won = c.status === 'won';
      const k = c.guesses.length;
      const head = won ? (k === 1 ? t('headFirst') : t('headWon', { n: k })) : t('headLost');
      const last = st.cur === N - 1;
      const wins = st.cards.filter((x) => x.status === 'won').length;
      const best = load<number>('bestDay', 0);
      ui.play.hidden = true;
      ui.done.hidden = false;
      ui.done.innerHTML = `
        <p class="kicker ${won ? 'ok' : 'ko'}">${N > 1 ? cardLabel() : ''}${head}</p>
        <h2>${esc(tx.title)}</h2>
        ${scoreHtml(c)}
        ${tx.fact ? `<p class="fact">${esc(tx.fact)}</p>` : ''}
        ${rankingHtml()}
        <div class="sumrow"><div class="pips">${pipsHtml(c, false)}</div></div>
        ${
          last
            ? `<p class="daydone">${N > 1 ? t('dayDone', { w: wins, total: N }) + '<br>' : ''}${t('dayTotal', { n: dayTotal(), max: N * 100 })}${
                best ? ` · ${t('best', { n: best, max: N * 100 })}` : ''
              }</p>`
            : ''
        }
        <div class="acts">${
          last
            ? `<button class="gbtn primary" data-stats type="button">${t('stats')}</button>`
            : `<button class="gbtn primary" data-next type="button">${t('next', { n: st.cur + 2, total: N })}</button>`
        }</div>`;
      ui.done
        .querySelector('[data-stats]')
        ?.addEventListener('click', () => document.querySelector<HTMLElement>('[data-open="stats"]')?.click());
      ui.done.querySelector('[data-next]')?.addEventListener('click', nextCard);
      const sc = ui.done.querySelector<HTMLElement>('[data-score]');
      if (fresh && sc && c.score && !reduced) countUp(sc, c.score.total);
    }

    /** Le score compte de 0 à sa valeur, avec un petit tic. */
    function countUp(el: HTMLElement, target: number) {
      const t0 = performance.now();
      const dur = 900 + target * 6;
      let shown = -1;
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const v = Math.round(target * (1 - (1 - k) ** 3));
        if (v !== shown) {
          if (Math.floor(v / 4) !== Math.floor(shown / 4)) tone(700 + v * 6, 0.03, 'square', 0.012);
          shown = v;
          el.textContent = String(v);
        }
        if (k < 1) requestAnimationFrame(step);
      };
      el.textContent = '0';
      requestAnimationFrame(step);
    }

    const render = () => {
      ui.legend.hidden = puzzle().type !== 'gradient';
      if (card().status === 'playing') renderPlay();
      else renderDone();
    };

    // ---------- compteur de pays ----------
    function updateChip(bump: boolean) {
      const n = world ? world.litCount() : 0;
      ui.found.textContent = String(n);
      ui.total.textContent = String(targets.length);
      chipBar.style.setProperty('--p', (targets.length ? (n / targets.length) * 100 : 0).toFixed(1) + '%');
      ui.chip.classList.toggle('full', n === targets.length && n > 0);
      if (bump) {
        ui.chip.classList.remove('bump');
        void ui.chip.offsetWidth;
        ui.chip.classList.add('bump');
      }
      if (bump && n === targets.length && card().status === 'playing' && !card().allSeen) {
        setCard({ allSeen: true });
        saveNow();
        setTimeout(() => api.toast(t('allSeen', { n: targets.length })), 500);
      }
    }

    // ---------- fin de carte, fin de journée ----------
    function dayResult(): GameResult {
      const wins = st.cards.filter((c) => c.status === 'won').length;
      const used = st.cards.map((c) => (c.status === 'won' ? c.guesses.length : MAX));
      const titles = puzzles.map((p) => (getLang() === 'en' && p.en ? p.en.title : p.title));
      const lines = st.cards.map(
        (c) =>
          Array.from({ length: MAX }, (_, i) => (c.guesses[i] ? SQ[c.guesses[i].k] : '⬛')).join('') +
          ' ' +
          (c.score ? c.score.total : 'X'),
      );
      return {
        won: wins >= Math.ceil((2 * N) / 3),
        attempts: Math.max(1, Math.min(MAX, Math.round(used.reduce((a, b) => a + b, 0) / N))),
        maxAttempts: MAX,
        grid: [...lines, t('scTotal', { n: dayTotal(), max: N * 100 })].join('\n'),
        summary: t('summary', { list: titles.join(' · ') }),
      };
    }

    /** Toutes les cartes terminées : record du jour, puis résultat envoyé au moteur (une seule fois). */
    function finalizeDay() {
      if (dayFinished || st.cards.some((c) => c.status === 'playing')) return;
      dayFinished = true;
      const total = dayTotal();
      if (total > load<number>('bestDay', 0)) save('bestDay', total);
      api.finish(dayResult());
      if (card().status !== 'playing' && !touring) renderDone();
    }

    function flash() {
      ui.flash.classList.remove('on');
      void ui.flash.offsetWidth;
      ui.flash.classList.add('on');
    }

    function finishCard(won: boolean) {
      const seen = targets.length ? card().found.filter((n) => targets.some((f) => f.n === n)).length / targets.length : 0;
      setCard({ status: won ? 'won' : 'lost', score: won ? computeScore(card(), seen) : undefined });
      saveNow();
      renderPlay();
      ui.input.blur();
      ui.drag.classList.add('gone');
      if (won) feedback(t('bravo'), 'ok');
      const after = () => {
        touring = false;
        ui.panel.classList.remove('touring');
        if (won) {
          chime();
          confetti();
        }
        renderDone(true);
        finalizeDay();
      };
      if (!world || reduced) {
        world?.reveal(false, won);
        if (!won) sadTone();
        setTimeout(after, 500);
        return;
      }
      touring = true;
      flash();
      if (!won) sadTone();
      setTimeout(() => ui.panel.classList.add('touring'), 350);
      const tour = world.tour({
        won,
        name: displayName,
        onStop: (i) => (won ? ping(i + 3) : tone(330 - i * 30, 0.5, 'sine', 0.045)),
      });
      const skip = () => tour.skip();
      root.addEventListener('pointerdown', skip);
      tour.done.then(() => {
        root.removeEventListener('pointerdown', skip);
        setTimeout(after, 250);
      });
    }

    function nextCard() {
      if (st.cur >= N - 1) return;
      st = { ...st, cur: st.cur + 1 };
      saveNow();
      buildJudge();
      ui.fb.textContent = '';
      ui.input.value = '';
      render();
      showCard(true);
    }

    // ---------- saisie ----------
    ui.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (card().status !== 'playing') return;
      const guess = ui.input.value.trim();
      if (norm(guess).length < 2) {
        ui.input.focus();
        return;
      }
      if (card().guesses.some((g) => norm(g.t) === norm(guess))) {
        feedback(t('already'), 'info');
        return;
      }
      const r = judge(guess);
      if (r.k === 'empty') return;
      if (r.k === 'right') {
        setCard({ guesses: [...card().guesses, { t: guess, k: 'right' }] });
        ui.input.value = '';
        finishCard(true);
        return;
      }
      if (r.k === 'hot') {
        feedback(`${r.msg || t('hot')} ${t('notCounted')}`, 'hot');
        tone(660, 0.18, 'triangle', 0.04);
        ui.form.classList.remove('warm');
        void ui.form.offsetWidth;
        ui.form.classList.add('warm');
        return;
      }
      const nth = wrongCount();
      setCard({ guesses: [...card().guesses, { t: guess, k: r.k }] });
      ui.input.value = '';
      ui.form.classList.remove('shake');
      void ui.form.offsetWidth;
      ui.form.classList.add('shake');
      thud();
      buzz();
      if (card().guesses.length >= MAX) {
        finishCard(false);
        return;
      }
      saveNow();
      renderPlay();
      const msg = r.k === 'near' ? r.msg || t('near') : wrongMsg(nth);
      feedback(`${msg} ${text().hints.length >= wrongCount() ? t('newHint') : ''}`.trim(), r.k === 'near' ? 'warm' : 'cold');
    });

    // ---------- confettis ----------
    function confetti() {
      if (reduced) return;
      const fx = ui.fx;
      const g = fx.getContext('2d');
      if (!g) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      fx.width = innerWidth * dpr;
      fx.height = innerHeight * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = ui.panel.getBoundingClientRect();
      const ox = r.left + r.width / 2;
      const oy = r.top + 30;
      const CC = ['#ff6a3d', '#ffd2c2', '#ffffff', '#6fb2ff', '#ff9b73'];
      const ps = Array.from({ length: 160 }, () => {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        const v = 6 + Math.random() * 9;
        return {
          x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: 4 + Math.random() * 5,
          r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: CC[(Math.random() * CC.length) | 0],
        };
      });
      const t0 = performance.now();
      const step = (now: number) => {
        g.clearRect(0, 0, innerWidth, innerHeight);
        const age = now - t0;
        for (const p of ps) {
          p.vy += 0.28;
          p.vx *= 0.985;
          p.x += p.vx;
          p.y += p.vy;
          p.r += p.vr;
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.r);
          g.globalAlpha = Math.max(0, 1 - age / 2600);
          g.fillStyle = p.c;
          g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
          g.restore();
        }
        if (age < 2700) requestAnimationFrame(step);
        else g.clearRect(0, 0, innerWidth, innerHeight);
      };
      requestAnimationFrame(step);
    }

    // ---------- carte sur le globe ----------
    /** Pose les pays de la carte courante sur le globe et cadre la vue. */
    function showCard(animated: boolean) {
      const p = puzzle();
      const unknown: string[] = [];
      const names: string[] = [];
      const levels = new Map<string, number>();
      const raws = countriesOf(p);
      const lv = p.type === 'gradient' ? levelsOf(raws.map((r) => p.values![r]), p.scale === 'log') : [];
      raws.forEach((raw, i) => {
        const f = find(raw);
        if (!f) unknown.push(raw);
        else if (!names.includes(f.n)) {
          names.push(f.n);
          if (p.type === 'gradient') levels.set(f.n, lv[i]);
        }
      });
      if (unknown.length) console.warn(`[ghostmap] pays inconnus dans « ${p.title} » :`, unknown.join(', '));
      targets = names.map((n) => featByName.get(n)!);
      const companions = new Map(Object.entries(COMPANIONS).filter(([, owner]) => names.includes(owner)));

      start = (() => {
        if (p.start) {
          const nums = p.start.split(',').map(Number);
          if (nums.length === 2 && nums.every(Number.isFinite)) return { lat: nums[0], lng: nums[1] };
          const f = find(p.start);
          if (f) return { lat: f.c[1], lng: f.c[0] };
        }
        const big = targets.slice().sort((a, b) => b.a - a.a)[0];
        return big ? { lat: Math.max(-45, Math.min(55, big.c[1])), lng: big.c[0] } : { lat: 20, lng: 10 };
      })();

      if (!world) return;
      world.setTargets(targets, companions, p.type === 'gradient' ? levels : undefined);
      updateChip(false);
      if (card().status === 'playing') {
        card().found.forEach((n) => world!.ignite(n, { silent: true }));
        updateChip(false);
        if (animated) world.intro(start);
        else {
          // à la première visite, la Terre arrive en tournant une fois les règles fermées
          if (rulesOpen())
            document.getElementById('rules-modal')!.addEventListener('close', () => world!.intro(start), { once: true });
          else world.intro(start);
        }
      } else {
        world.lookAt(start, 2000);
        const won = card().status === 'won';
        setTimeout(() => world!.reveal(true, won), reduced ? 0 : 500);
      }
    }

    // ---------- démarrage ----------
    const noGL = (msg: string) => {
      ui.globe.innerHTML = `<div class="nogl"><b>${t('noGlTitle')}</b><span>${esc(msg)}</span></div>`;
      ui.loader.classList.add('gone');
      ui.drag.classList.add('gone');
    };

    applyStatic();
    render();
    if (card().status !== 'playing' || st.cur > 0) ui.drag.classList.add('gone');
    // journée terminée mais résultat pas encore envoyé (page fermée pendant le spectacle de fin)
    finalizeDay();

    loadGeo()
      .then(([feats, landMeta, landBin]) => {
        features = feats;
        featByName = new Map(features.map((f) => [f.n, f]));
        const idx = new Map<string, Feature>();
        for (const f of features) for (const k of f.k) if (!idx.has(k)) idx.set(k, f);
        find = (raw) => {
          const k = norm(raw);
          return idx.get(k) ?? idx.get(k.replace(/^(le|la|les|l)\s+/, '')) ?? null;
        };
        showCard(false);
        if (card().status !== 'playing') render();

        if (!webglAvailable()) {
          noGL(t('noGlBrowser'));
          return;
        }
        try {
          world = createWorld(ui.globe, features, landMeta, landBin, start, {
            panel: ui.panel,
            dragHint: ui.drag,
            fps: ui.fps,
            onIgnite(name, silent, combo) {
              const c = card();
              if (!c.found.includes(name)) {
                setCard({ found: [...c.found, name] });
                if (c.status === 'playing') saveSoon();
              }
              if (!silent) ping(combo);
              updateChip(true);
            },
          });
        } catch (err) {
          console.error(err);
          noGL(t('noGlError'));
          return;
        }
        ui.loader.classList.add('gone');
        showCard(false);
      })
      .catch((err) => {
        console.error(err);
        noGL(t('noGlLoad'));
      });
  },
};
