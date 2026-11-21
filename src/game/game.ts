/**
 * Carte Fantôme : un globe 3D sans aucun nom, des pays qui s'allument quand on les découvre.
 * Trois modes, choisis dans un menu :
 * - Classique : deviner ce que les pays allumés ont en commun, en 5 essais. CARDS_PER_DAY cartes par jour ;
 *   seul ce mode alimente le moteur (statistiques, modal de fin), une fois la dernière carte jouée.
 * - Points : même mécanique avec des lieux (villes, sommets…) en colonnes de lumière. Sauvegarde propre.
 * - Retrouve-les (find.ts) : la réponse est donnée, on touche les pays. Débloqué après le Classique.
 * Chaque carte vaut un score sur 100.
 * Contrat : GameModule (src/engine/types.ts) et skill daily-game-conventions.
 */
import { CONFIG } from '../config';
import { loadPuzzles } from '../engine/puzzle';
import { shareResult } from '../engine/share';
import { load, save } from '../engine/storage';
import type { GameContext, GameModule, GameResult } from '../engine/types';
import countriesUrl from '../data/geo/countries.json?url';
import landBinUrl from '../data/geo/land.bin?url';
import landMetaUrl from '../data/geo/land.json?url';
import { createFind } from './find';
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

/** Lieu d'une carte de points : nom français (et anglais), position. */
export interface PointDef {
  n: string;
  en?: string;
  lat: number;
  lng: number;
}

export interface Puzzle extends PuzzleText {
  /**
   * `gradient` : chaque pays a une valeur, il brille et monte d'autant plus qu'elle est grande.
   * `points` : des lieux à la place des pays (mode Points, hors rotation du Classique).
   */
  type?: 'gradient' | 'points';
  /** Carte de points : les lieux. */
  points?: PointDef[];
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

type Mode = 'classic' | 'points' | 'find';
type GuessKind2 = 'classic' | 'points';

/** Cartes à deviner du jour (Classique ou Points), avec leur état. */
interface Deck {
  kind: GuessKind2;
  puzzles: Puzzle[];
  st: State;
  finished: boolean;
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
<button class="ib gm-home" data-home type="button"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
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
  <div data-find hidden></div>
</section>
<div class="menu" data-menu hidden><div class="menu-in">
  <p class="menu-sub" data-menu-sub></p>
  <div class="modes" data-modes></div>
</div></div>
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

/**
 * Cartes du jour : bloc de CARDS_PER_DAY entrées consécutives, sans chevauchement d'un jour à l'autre.
 * Les cartes de points forment une file à part : le Classique les ignore, son ordre ne bouge donc pas.
 */
function dayCards(dayNumber: number, kind: GuessKind2): Puzzle[] {
  const all = loadPuzzles<Puzzle>().filter((p) => (p.type === 'points') === (kind === 'points'));
  if (!all.length) return [];
  const base = CARDS_PER_DAY * Math.max(0, dayNumber - 1);
  return Array.from({ length: CARDS_PER_DAY }, (_, i) => all[(base + i) % all.length]);
}

/**
 * Sauvegarde du jour, y compris l'ancien format à une carte (migré en carte 1).
 * Une carte gagnée avant l'arrivée du score reçoit le sien (exploration estimée, sans rapidité).
 */
function restore(saved: unknown, status: CardStatus, puzzles: Puzzle[]): State {
  const s = saved as Partial<State> & Partial<CardState>;
  let st: State;
  if (s && Array.isArray(s.cards) && s.cards.length === CARDS_PER_DAY)
    st = { cur: Math.min(CARDS_PER_DAY - 1, Math.max(0, s.cur ?? 0)), cards: s.cards };
  else {
    const cards = Array.from({ length: CARDS_PER_DAY }, newCard);
    if (s && Array.isArray(s.guesses))
      cards[0] = { guesses: s.guesses, found: s.found ?? [], allSeen: !!s.allSeen, status };
    st = { cur: 0, cards };
  }
  st.cards = st.cards.map((c, i) => {
    if (c.status !== 'won' || c.score) return c;
    const n = countriesOf(puzzles[i]).length;
    return { ...c, score: computeScore(c, n ? c.found.length / n : 0) };
  });
  return st;
}

/** Pays d'une carte, en noms français tels qu'écrits dans puzzles.json (identifiants `pt:i` pour les points). */
const countriesOf = (p: Puzzle) =>
  p.type === 'points'
    ? (p.points ?? []).map((_, i) => `pt:${i}`)
    : p.type === 'gradient'
      ? Object.keys(p.values ?? {})
      : (p.countries ?? []);

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

    // ---------- les deux jeux de cartes à deviner ----------
    const classicPuzzles = dayCards(ctx.dayNumber, 'classic');
    const pointsPuzzles = dayCards(ctx.dayNumber, 'points');
    const pointsSaved = load<{ day: string; st: State } | null>('points', null);
    const pointsSt = restore(pointsSaved?.day === ctx.dateKey ? pointsSaved.st : null, 'playing', pointsPuzzles);
    const decks: Record<GuessKind2, Deck> = {
      classic: {
        kind: 'classic',
        puzzles: classicPuzzles,
        st: restore(ctx.saved, ctx.status, classicPuzzles),
        finished: ctx.status !== 'playing',
      },
      points: {
        kind: 'points',
        puzzles: pointsPuzzles,
        st: pointsSt,
        finished: pointsSt.cards.every((c) => c.status !== 'playing'),
      },
    };
    let D: Deck = decks.classic;
    let mode: Mode = 'classic';
    let menuOpen = false;
    /** Géographie chargée : les modes peuvent démarrer. */
    let ready = false;
    /** Pendant le spectacle de fin : pas de nouvel affichage du panneau. */
    let touring = false;

    const card = () => D.st.cards[D.st.cur];
    const puzzle = () => D.puzzles[D.st.cur];
    const textOf = (p: Puzzle): PuzzleText => (getLang() === 'en' && p.en ? p.en : p);
    const text = () => textOf(puzzle());
    const setCard = (patch: Partial<CardState>) => {
      D.st = { ...D.st, cards: D.st.cards.map((c, i) => (i === D.st.cur ? { ...c, ...patch } : c)) };
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
      home: $('home'), menu: $('menu'), menuSub: $('menu-sub'), modes: $('modes'), find: $('find'),
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

    /** Nom affiché d'un pays (clé Natural Earth) ou d'un lieu (`pt:i`, carte en cours) dans la langue choisie. */
    const displayName = (n: string) => {
      if (n.startsWith('pt:')) {
        const pt = puzzle().points?.[Number(n.slice(3))];
        return pt ? (getLang() === 'en' && pt.en ? pt.en : pt.n) : n;
      }
      return getLang() === 'fr' ? (featByName.get(n)?.fr ?? n) : n;
    };
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
      if (D.kind === 'classic') api.save(D.st);
      else save('points', { day: ctx.dateKey, st: D.st });
    };
    // les pays découverts arrivent en rafale quand on tourne le globe : une sauvegarde groupée suffit
    const saveSoon = () => {
      if (saveTimer === undefined) saveTimer = window.setTimeout(saveNow, 400);
    };
    addEventListener('pagehide', () => { if (saveTimer !== undefined) saveNow(); });

    const wrongCount = () => card().guesses.filter((g) => g.k !== 'right').length;
    const guessing = () => !menuOpen && mode !== 'find';

    // ---------- chronomètre : ne compte que le temps de jeu réel ----------
    const rulesOpen = () => (document.getElementById('rules-modal') as HTMLDialogElement | null)?.open ?? false;
    let lastTick = performance.now();
    let ticks = 0;
    setInterval(() => {
      const now = performance.now();
      const dt = Math.min(2000, now - lastTick);
      lastTick = now;
      if (!guessing() || !D.puzzles.length) return;
      const c = card();
      if (!world || touring || document.hidden || rulesOpen() || c.status !== 'playing' || c.ms === undefined) return;
      setCard({ ms: c.ms + dt });
      if (++ticks % 5 === 0) saveSoon();
    }, 1000);

    // ---------- textes fixes et langue ----------
    function applyStatic() {
      ui.globe.setAttribute('aria-label', t('globe'));
      ui.sound.setAttribute('aria-label', isMuted() ? t('soundOn') : t('soundOff'));
      ui.home.setAttribute('aria-label', t('home'));
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
      if (menuOpen) renderMenu();
      else if (!touring) render();
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

    const cardLabel = () =>
      (D.kind === 'points' ? `<span class="cardno">${t('pointsTag')}</span> · ` : '') +
      (N > 1 ? `<span class="cardno">${t('card', { n: D.st.cur + 1, total: N })}</span> · ` : '');

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
          ? `<li class="h0">${D.kind === 'points' ? t('firstPoints') : t('first')}</li>`
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

    const dayTotal = () => D.st.cards.reduce((a, c) => a + (c.score?.total ?? 0), 0);
    const bestKey = () => (D.kind === 'classic' ? 'bestDay' : 'bestPoints');

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

    const placesHtml = () => {
      const p = puzzle();
      if (p.type !== 'points' || !p.points) return '';
      return `<p class="places">${esc(t('places', { list: p.points.map((_, i) => displayName(`pt:${i}`)).join(' · ') }))}</p>`;
    };

    /** `fresh` : la carte vient de se terminer, le score défile de 0 à sa valeur. */
    function renderDone(fresh = false) {
      const c = card();
      const tx = text();
      const won = c.status === 'won';
      const k = c.guesses.length;
      const head = won ? (k === 1 ? t('headFirst') : t('headWon', { n: k })) : t('headLost');
      const last = D.st.cur === N - 1;
      const wins = D.st.cards.filter((x) => x.status === 'won').length;
      const best = load<number>(bestKey(), 0);
      const classic = D.kind === 'classic';
      ui.play.hidden = true;
      ui.done.hidden = false;
      ui.done.innerHTML = `
        <p class="kicker ${won ? 'ok' : 'ko'}">${cardLabel()}${head}</p>
        <h2>${esc(tx.title)}</h2>
        ${scoreHtml(c)}
        ${placesHtml()}
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
            ? `<button class="gbtn primary" data-stats type="button">${classic ? t('stats') : t('share')}</button>
               <button class="gbtn ghost" data-tomenu type="button">${t('otherModes')}</button>`
            : `<button class="gbtn primary" data-next type="button">${t('next', { n: D.st.cur + 2, total: N })}</button>`
        }</div>`;
      ui.done.querySelector('[data-stats]')?.addEventListener('click', () => {
        if (classic) document.querySelector<HTMLElement>('[data-open="stats"]')?.click();
        else sharePoints();
      });
      ui.done.querySelector('[data-tomenu]')?.addEventListener('click', openMenu);
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
      ui.legend.hidden = !guessing() || puzzle()?.type !== 'gradient';
      ui.chipLbl.textContent = mode === 'find' ? t('chipFind') : D.kind === 'points' ? t('chipPoints') : t('chip');
      if (mode === 'find') {
        findMode.render();
        return;
      }
      ui.find.hidden = true;
      if (card().status === 'playing') renderPlay();
      else renderDone();
    };

    // ---------- compteur ----------
    function drawChip(n: number, total: number, bump: boolean) {
      ui.found.textContent = String(n);
      ui.total.textContent = String(total);
      chipBar.style.setProperty('--p', (total ? (n / total) * 100 : 0).toFixed(1) + '%');
      ui.chip.classList.toggle('full', n === total && n > 0);
      if (bump) {
        ui.chip.classList.remove('bump');
        void ui.chip.offsetWidth;
        ui.chip.classList.add('bump');
      }
    }
    function updateChip(bump: boolean) {
      const n = world ? world.litCount() : 0;
      drawChip(n, targets.length, bump);
      if (bump && n === targets.length && card().status === 'playing' && !card().allSeen) {
        setCard({ allSeen: true });
        saveNow();
        setTimeout(() => api.toast(t('allSeen', { n: targets.length })), 500);
      }
    }

    // ---------- fin de carte, fin de journée ----------
    const gridLines = (d: Deck) =>
      d.st.cards.map(
        (c) =>
          Array.from({ length: MAX }, (_, i) => (c.guesses[i] ? SQ[c.guesses[i].k] : '⬛')).join('') +
          ' ' +
          (c.score ? c.score.total : 'X'),
      );
    const deckTotal = (d: Deck) => d.st.cards.reduce((a, c) => a + (c.score?.total ?? 0), 0);

    function dayResult(): GameResult {
      const d = decks.classic;
      const wins = d.st.cards.filter((c) => c.status === 'won').length;
      const used = d.st.cards.map((c) => (c.status === 'won' ? c.guesses.length : MAX));
      const titles = d.puzzles.map((p) => textOf(p).title);
      return {
        won: wins >= Math.ceil((2 * N) / 3),
        attempts: Math.max(1, Math.min(MAX, Math.round(used.reduce((a, b) => a + b, 0) / N))),
        maxAttempts: MAX,
        grid: [...gridLines(d), t('scTotal', { n: deckTotal(d), max: N * 100 })].join('\n'),
        summary: t('summary', { list: titles.join(' · ') }),
      };
    }

    async function sharePoints() {
      const d = decks.points;
      const text = [
        `${CONFIG.title} · ${t('pointsTag')} #${ctx.dayNumber}`,
        ...gridLines(d),
        t('scTotal', { n: deckTotal(d), max: N * 100 }),
        CONFIG.url,
      ].join('\n');
      const r = await shareResult(text);
      if (r === 'copied') api.toast(t('copied'));
      else if (r === 'failed') api.toast(t('shareFail'));
    }

    /** Toutes les cartes du jeu en cours terminées : record, puis (Classique) résultat envoyé au moteur, une seule fois. */
    function finalizeDay() {
      if (D.finished || !D.puzzles.length || D.st.cards.some((c) => c.status === 'playing')) return;
      D.finished = true;
      const total = dayTotal();
      if (total > load<number>(bestKey(), 0)) save(bestKey(), total);
      if (D.kind === 'classic') api.finish(dayResult());
      if (guessing() && card().status !== 'playing' && !touring) renderDone();
    }

    function flash() {
      ui.flash.classList.remove('on');
      void ui.flash.offsetWidth;
      ui.flash.classList.add('on');
    }

    function setTouring(on: boolean) {
      touring = on;
      if (on) setTimeout(() => touring && ui.panel.classList.add('touring'), 350);
      else ui.panel.classList.remove('touring');
      ui.home.toggleAttribute('disabled', on);
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
        setTouring(false);
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
      setTouring(true);
      flash();
      if (!won) sadTone();
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
      if (D.st.cur >= N - 1) return;
      D.st = { ...D.st, cur: D.st.cur + 1 };
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
      if (!guessing() || card().status !== 'playing') return;
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
    /** Cibles d'une carte : pays (ou lieux), zones rattachées, niveaux d'une carte en dégradé, point de départ. */
    function resolveCard(p: Puzzle) {
      const names: string[] = [];
      const levels = new Map<string, number>();
      let tg: Feature[];
      if (p.type === 'points') {
        tg = (p.points ?? []).map((pt, i) => ({ n: `pt:${i}`, fr: pt.n, k: [], a: 0.05, c: [pt.lng, pt.lat], pt: true }));
      } else {
        const unknown: string[] = [];
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
        if (unknown.length && ready) console.warn(`[ghostmap] pays inconnus dans « ${p.title} » :`, unknown.join(', '));
        tg = names.map((n) => featByName.get(n)!);
      }
      const companions = new Map(Object.entries(COMPANIONS).filter(([, owner]) => names.includes(owner)));
      const st: LatLng = (() => {
        if (p.start) {
          const nums = p.start.split(',').map(Number);
          if (nums.length === 2 && nums.every(Number.isFinite)) return { lat: nums[0], lng: nums[1] };
          const f = find(p.start);
          if (f) return { lat: f.c[1], lng: f.c[0] };
        }
        const big = p.type === 'points' ? tg[0] : tg.slice().sort((a, b) => b.a - a.a)[0];
        return big ? { lat: Math.max(-45, Math.min(55, big.c[1])), lng: big.c[0] } : { lat: 20, lng: 10 };
      })();
      return { targets: tg, companions, levels, start: st };
    }

    /** Pose les cibles de la carte courante sur le globe et cadre la vue. */
    function showCard(animated: boolean) {
      const p = puzzle();
      const r = resolveCard(p);
      targets = r.targets;
      start = r.start;
      if (!world) return;
      world.setIdle(false);
      world.setTargets(targets, r.companions, p.type === 'gradient' ? r.levels : undefined);
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

    // ---------- Retrouve-les ----------
    const findMode = createFind({
      el: ui.find,
      dateKey: ctx.dateKey,
      dayNumber: ctx.dayNumber,
      count: classicPuzzles.length ? N : 0,
      world: () => world,
      resolve: (i) => resolveCard(classicPuzzles[i]),
      title: (i) => textOf(classicPuzzles[i]).title,
      fact: (i) => textOf(classicPuzzles[i]).fact,
      name: (n) => (getLang() === 'fr' ? (featByName.get(n)?.fr ?? n) : n),
      chip: drawChip,
      toast: api.toast,
      menu: () => openMenu(),
      setTouring,
      flash,
      confetti,
    });

    // un toucher bref, sans glisser, sur le globe : en mode Retrouve-les, il désigne un pays
    let down: { x: number; y: number; t: number; id: number } | null = null;
    ui.globe.addEventListener('pointerdown', (e) => {
      down = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId } : null;
    });
    ui.globe.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || d.id !== e.pointerId || mode !== 'find' || menuOpen || touring) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 350) return;
      findMode.tap(e.clientX, e.clientY);
    });

    // ---------- menu ----------
    const ICONS: Record<Mode, string> = {
      classic: '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="15" fill="#0c2c4c" stroke="#3c5f86"/><path d="M12 18c5 2 8-3 12 0s2 6 7 7" stroke="#ff6a3d" stroke-width="3" fill="none" stroke-linecap="round"/><text x="22" y="27" text-anchor="middle" font-size="15" font-weight="800" fill="#eef3f9">?</text></svg>',
      find: '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="15" fill="#0c2c4c" stroke="#3c5f86"/><circle cx="20" cy="20" r="5" fill="#ff6a3d"/><path d="M24 24l8 9" stroke="#eef3f9" stroke-width="3" stroke-linecap="round"/></svg>',
      points: '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="15" fill="#0c2c4c" stroke="#3c5f86"/><g stroke="#ff8f62" stroke-width="3" stroke-linecap="round"><path d="M15 26v-8"/><path d="M23 30v-14"/><path d="M30 24v-6"/></g></svg>',
    };

    function modeStatus(m: Mode): { txt: string; locked: boolean; done: boolean } {
      if (m === 'find') {
        if (!decks.classic.finished) return { txt: t('stLocked'), locked: true, done: false };
        if (ready && !world) return { txt: t('stNo3d'), locked: true, done: false };
        const p = findMode.progress();
        if (p.finished) return { txt: t('stDone', { n: p.score, max: N * 100 }), locked: false, done: true };
        return { txt: p.done ? t('stProgress', { n: p.done, total: N }) : t('stNew', { n: N }), locked: false, done: false };
      }
      const d = decks[m];
      if (!d.puzzles.length) return { txt: '—', locked: true, done: false };
      if (d.finished) return { txt: t('stDone', { n: deckTotal(d), max: N * 100 }), locked: false, done: true };
      const n = d.st.cards.filter((c) => c.status !== 'playing').length;
      return { txt: n ? t('stProgress', { n, total: N }) : t('stNew', { n: N }), locked: false, done: false };
    }

    function renderMenu() {
      ui.menuSub.textContent = t('menuSub');
      const modes: Mode[] = ['classic', 'find', 'points'];
      const key = { classic: 'mClassic', find: 'mFind', points: 'mPoints' } as const;
      ui.modes.innerHTML = modes
        .map((m) => {
          const s = modeStatus(m);
          return `<button class="mode${s.done ? ' done' : ''}" type="button" data-mode="${m}" ${s.locked || !ready ? 'disabled' : ''}>
            <span class="mode-ic" aria-hidden="true">${ICONS[m]}</span>
            <span class="mode-txt"><b>${t(key[m])}</b><small>${t((key[m] + 'D') as 'mClassicD')}</small></span>
            <span class="mode-st">${s.locked ? '🔒 ' : ''}${esc(s.txt)}</span>
          </button>`;
        })
        .join('');
    }
    ui.modes.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
      if (b && !b.disabled) enter(b.dataset.mode as Mode);
    });
    ui.home.addEventListener('click', () => {
      if (!touring) openMenu();
    });

    function openMenu() {
      if (touring) return;
      if (saveTimer !== undefined) saveNow();
      menuOpen = true;
      root.classList.add('menu-open');
      ui.menu.hidden = false;
      ui.drag.classList.add('gone');
      ui.legend.hidden = true;
      ui.input.blur();
      renderMenu();
      if (world) {
        world.setTargets([], new Map());
        world.setScan(false);
        world.setIdle(true);
      }
    }

    function enter(m: Mode) {
      menuOpen = false;
      root.classList.remove('menu-open');
      ui.menu.hidden = true;
      mode = m;
      root.dataset.mode = m;
      ui.fb.textContent = '';
      ui.input.value = '';
      if (m === 'find') {
        ui.play.hidden = true;
        ui.done.hidden = true;
        ui.find.hidden = false;
        ui.chipLbl.textContent = t('chipFind');
        ui.legend.hidden = true;
        findMode.show();
        return;
      }
      ui.find.hidden = true;
      D = decks[m];
      buildJudge();
      render();
      showCard(false);
    }

    // ---------- démarrage ----------
    const noGL = (msg: string) => {
      ui.globe.innerHTML = `<div class="nogl"><b>${t('noGlTitle')}</b><span>${esc(msg)}</span></div>`;
      ui.loader.classList.add('gone');
      ui.drag.classList.add('gone');
    };

    /** On arrive sur le menu, sauf si une partie Classique est en cours (on la reprend directement). */
    const classicInProgress =
      !decks.classic.finished && decks.classic.st.cards.some((c) => c.guesses.length > 0 || c.status !== 'playing');

    applyStatic();
    root.dataset.mode = 'classic';
    render();
    if (card().status !== 'playing' || D.st.cur > 0) ui.drag.classList.add('gone');
    // journée terminée mais résultat pas encore envoyé (page fermée pendant le spectacle de fin)
    finalizeDay();
    if (!classicInProgress) openMenu();

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
        ready = true;
        if (!menuOpen) {
          showCard(false);
          if (card().status !== 'playing') render();
        }

        if (!webglAvailable()) {
          noGL(t('noGlBrowser'));
          if (menuOpen) renderMenu();
          return;
        }
        try {
          world = createWorld(ui.globe, features, landMeta, landBin, start, {
            panel: ui.panel,
            dragHint: ui.drag,
            fps: ui.fps,
            onIgnite(name, silent, combo) {
              if (!guessing()) return;
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
          if (menuOpen) renderMenu();
          return;
        }
        ui.loader.classList.add('gone');
        if (menuOpen) {
          world.setScan(false);
          world.lookAt(start, 2800);
          world.setIdle(true);
          renderMenu();
        } else showCard(false);
      })
      .catch((err) => {
        console.error(err);
        noGL(t('noGlLoad'));
      });
  },
};
