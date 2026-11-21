/**
 * Carte Fantôme : un globe 3D sans aucun nom, des pays qui s'allument quand on les découvre.
 * Le joueur devine ce qu'ils ont en commun en 5 essais.
 * Contrat : GameModule (src/engine/types.ts) et skill daily-game-conventions.
 */
import { CONFIG } from '../config';
import type { GameContext, GameModule, GameResult } from '../engine/types';
import countriesUrl from '../data/geo/countries.json?url';
import landBinUrl from '../data/geo/land.bin?url';
import landMetaUrl from '../data/geo/land.json?url';
import { createWorld, webglAvailable, type Feature, type LandMeta, type LatLng, type World } from './globe';
import { makeJudge, norm, type NearRule } from './judge';
import { buzz, chime, isMuted, ping, sadTone, thud, toggleMute, tone } from './sound';

export interface Puzzle {
  /** La réponse, affichée en fin de partie. */
  title: string;
  /** Noms français des pays allumés (variantes reconnues : voir src/data/geo/countries.json). */
  countries: string[];
  /** 4 indices au plus, débloqués un par un après chaque erreur. */
  hints: string[];
  /** Anecdote affichée en fin de partie. */
  fact: string;
  /** Où le globe se tourne au début : « lat, lng » ou un nom de pays. */
  start?: string;
  /** Façons de trouver : `+` = et, `/` = ou, `sauf` = mots interdits. */
  answers: string[];
  /** Réponses proches, dans l'ordre (la première qui correspond gagne). `hot` : essai non décompté. */
  near: NearRule[];
}

export type GuessKind = 'wrong' | 'near' | 'right';

export interface State {
  guesses: { t: string; k: GuessKind }[];
  /** Pays déjà découverts (noms Natural Earth). */
  found: string[];
  allSeen: boolean;
}

export { norm as normalize };

/** Zones disputées qui s'allument avec leur pays, sans compter dans le total. */
const COMPANIONS: Record<string, string> = { 'Siachen Glacier': 'India', 'N. Cyprus': 'Cyprus' };
const SQ: Record<GuessKind, string> = { wrong: '🟥', near: '🟧', right: '🟩' };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SHELL = `
<div class="gm-globe" data-globe aria-label="Globe terrestre : glisse pour le faire tourner, pince ou molette pour zoomer"></div>
<canvas class="gm-fx" data-fx></canvas>
<button class="ib gm-sound" data-sound type="button" aria-label="Couper le son"><svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path class="w" d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/><path class="x" d="M16 9.5l5 5M21 9.5l-5 5"/></svg></button>
<div class="chip" data-chip aria-live="polite"><b data-found>0</b><span>/ <span data-total>0</span></span><span class="lbl">pays allumés repérés</span><i></i></div>
<div class="drag" data-drag aria-hidden="true">
  <svg viewBox="0 0 120 44"><path d="M14 30c28-16 64-16 92 0" opacity=".45"/><path d="M98 22l8 8-10 4" opacity=".45"/><g class="hand"><circle cx="60" cy="20" r="9" fill="rgba(255,255,255,.18)"/><circle cx="60" cy="20" r="4" fill="#fff" stroke="none"/></g></svg>
  <span>Fais tourner la Terre</span>
</div>
<section class="panel" data-panel aria-label="Partie du jour">
  <div data-play>
    <div class="prow"><div class="pips" data-pips aria-hidden="true"></div><span class="tries" data-tries></span></div>
    <ol class="hints" data-hints></ol>
    <p class="fb" data-fb role="status" aria-live="polite"></p>
    <form class="gform" data-form autocomplete="off">
      <input data-input maxlength="80" placeholder="Ces pays ont en commun…" aria-label="Ta réponse" enterkeyhint="send" autocapitalize="off" spellcheck="false">
      <button class="gbtn primary" type="submit">Deviner</button>
    </form>
    <ul class="tried" data-tried aria-label="Réponses déjà proposées"></ul>
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

export const game: GameModule<Puzzle, State> = {
  mount(root, ctx: GameContext<Puzzle, State>, api) {
    const { puzzle } = ctx;
    const MAX = CONFIG.maxAttempts;
    const judge = makeJudge(puzzle.answers, puzzle.near);
    let st: State = ctx.saved ?? { guesses: [], found: [], allSeen: false };
    let status = ctx.status;
    let result = ctx.result;

    root.classList.add('gm');
    root.innerHTML = SHELL;
    const $ = <T extends HTMLElement = HTMLElement>(k: string) => root.querySelector<T>(`[data-${k}]`)!;
    const ui = {
      globe: $('globe'), fx: $<HTMLCanvasElement>('fx'), sound: $('sound'),
      chip: $('chip'), found: $('found'), total: $('total'), drag: $('drag'),
      panel: $('panel'), play: $('play'), done: $('done'), pips: $('pips'), tries: $('tries'),
      hints: $('hints'), fb: $('fb'), form: $<HTMLFormElement>('form'), input: $<HTMLInputElement>('input'),
      tried: $('tried'), fps: $('fps'), loader: $('loader'),
    };
    const chipBar = ui.chip.querySelector('i')!;

    let world: World | null = null;
    let targets: Feature[] = [];
    let start: LatLng = { lat: 20, lng: 10 };

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

    const wrongCount = () => st.guesses.filter((g) => g.k !== 'right').length;

    // ---------- son ----------
    const setSound = () => {
      ui.sound.classList.toggle('off', isMuted());
      ui.sound.setAttribute('aria-label', isMuted() ? 'Activer le son' : 'Couper le son');
    };
    ui.sound.addEventListener('click', () => {
      toggleMute();
      setSound();
    });
    setSound();

    // ---------- panneau ----------
    function feedback(msg: string, kind: string) {
      ui.fb.textContent = msg;
      ui.fb.className = 'fb ' + kind;
      ui.fb.style.animation = 'none';
      void ui.fb.offsetWidth;
      ui.fb.style.animation = '';
    }

    const pipsHtml = (cur: boolean) =>
      Array.from({ length: MAX }, (_, i) => {
        const g = st.guesses[i];
        return `<span class="pip ${g ? g.k : cur && i === st.guesses.length ? 'cur' : ''}"></span>`;
      }).join('');

    function renderPlay() {
      const w = wrongCount();
      const used = st.guesses.length;
      ui.pips.innerHTML = pipsHtml(status === 'playing');
      ui.tries.textContent = status === 'playing' ? `Essai ${used + 1} sur ${MAX}` : '';
      const shown = Math.min(w, puzzle.hints.length);
      ui.hints.innerHTML =
        shown === 0
          ? `<li class="h0"><b>Essai 1 : la carte seule.</b> Qu’ont en commun tous les pays allumés ?</li>`
          : puzzle.hints
              .slice(0, shown)
              .map((h, i) => `<li class="${i === shown - 1 ? 'new' : ''}"><span>Indice ${i + 1}</span>${esc(h)}</li>`)
              .reverse()
              .join('');
      ui.tried.innerHTML = st.guesses
        .filter((g) => g.k !== 'right')
        .map((g) => `<li class="${g.k}">${esc(g.t)}</li>`)
        .join('');
    }

    // Panneau de fin : réponse et anecdote. Stats, série, partage et compte à rebours sont dans le modal du moteur.
    function renderDone() {
      const won = status === 'won';
      const k = st.guesses.length;
      const head = won ? (k === 1 ? 'Du premier coup !' : `Trouvé en ${k} essais`) : 'Raté pour cette carte';
      ui.play.hidden = true;
      ui.done.hidden = false;
      ui.done.innerHTML = `
        <p class="kicker ${won ? 'ok' : 'ko'}">${head}</p>
        <h2>${esc(puzzle.title)}</h2>
        ${puzzle.fact ? `<p class="fact">${esc(puzzle.fact)}</p>` : ''}
        <div class="sumrow"><div class="pips">${pipsHtml(false)}</div></div>
        <div class="acts"><button class="gbtn primary" data-stats type="button">Statistiques et partage</button></div>`;
      ui.done
        .querySelector('[data-stats]')!
        .addEventListener('click', () => document.querySelector<HTMLElement>('[data-open="stats"]')?.click());
    }

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
      if (bump && n === targets.length && status === 'playing' && !st.allSeen) {
        st = { ...st, allSeen: true };
        saveNow();
        setTimeout(() => api.toast(`Les ${targets.length} lumières sont repérées. À toi de deviner !`), 500);
      }
    }

    // ---------- fin de partie ----------
    const buildResult = (won: boolean): GameResult => ({
      won,
      attempts: st.guesses.length,
      maxAttempts: MAX,
      grid: Array.from({ length: MAX }, (_, i) => (st.guesses[i] ? SQ[st.guesses[i].k] : '⬛')).join(''),
      summary: `La réponse était : ${puzzle.title}`,
    });

    function finish(won: boolean) {
      status = won ? 'won' : 'lost';
      result = buildResult(won);
      saveNow();
      api.finish(result);
      renderPlay();
      ui.input.blur();
      ui.drag.classList.add('gone');
      world?.reveal(true);
      if (won) {
        chime();
        confetti();
        feedback('Bravo !', 'ok');
      } else sadTone();
      setTimeout(renderDone, won ? 1100 : 700);
    }

    // ---------- saisie ----------
    ui.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (status !== 'playing') return;
      const text = ui.input.value.trim();
      if (norm(text).length < 2) {
        ui.input.focus();
        return;
      }
      if (st.guesses.some((g) => norm(g.t) === norm(text))) {
        feedback('Déjà proposé.', 'info');
        return;
      }
      const r = judge(text, wrongCount());
      if (r.k === 'empty') return;
      if (r.k === 'right') {
        st = { ...st, guesses: [...st.guesses, { t: text, k: 'right' }] };
        ui.input.value = '';
        finish(true);
        return;
      }
      if (r.k === 'hot') {
        feedback(r.msg + ' (essai non décompté)', 'hot');
        tone(660, 0.18, 'triangle', 0.04);
        ui.form.classList.remove('warm');
        void ui.form.offsetWidth;
        ui.form.classList.add('warm');
        return;
      }
      st = { ...st, guesses: [...st.guesses, { t: text, k: r.k }] };
      ui.input.value = '';
      ui.form.classList.remove('shake');
      void ui.form.offsetWidth;
      ui.form.classList.add('shake');
      thud();
      buzz();
      if (st.guesses.length >= MAX) {
        finish(false);
        return;
      }
      saveNow();
      renderPlay();
      feedback(
        `${r.msg} ${puzzle.hints.length >= wrongCount() ? 'Nouvel indice débloqué.' : ''}`.trim(),
        r.k === 'near' ? 'warm' : 'cold',
      );
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

    // ---------- démarrage ----------
    const noGL = (msg: string) => {
      ui.globe.innerHTML = `<div class="nogl"><b>Le globe 3D ne peut pas s’afficher.</b><span>${esc(msg)}</span></div>`;
      ui.loader.classList.add('gone');
      ui.drag.classList.add('gone');
    };

    if (status === 'playing') renderPlay();
    else {
      ui.drag.classList.add('gone');
      renderDone();
    }

    loadGeo()
      .then(([features, landMeta, landBin]) => {
        const byName = new Map(features.map((f) => [f.n, f]));
        const idx = new Map<string, Feature>();
        for (const f of features) for (const k of f.k) if (!idx.has(k)) idx.set(k, f);
        const find = (raw: string) => {
          const k = norm(raw);
          return idx.get(k) ?? idx.get(k.replace(/^(le|la|les|l)\s+/, '')) ?? null;
        };

        const unknown: string[] = [];
        const names: string[] = [];
        for (const raw of puzzle.countries) {
          const f = find(raw);
          if (!f) unknown.push(raw);
          else if (!names.includes(f.n)) names.push(f.n);
        }
        if (unknown.length) console.warn(`[ghostmap] pays inconnus dans « ${puzzle.title} » :`, unknown.join(', '));
        targets = names.map((n) => byName.get(n)!);
        const companions = new Map(Object.entries(COMPANIONS).filter(([, owner]) => names.includes(owner)));

        start = (() => {
          if (puzzle.start) {
            const nums = puzzle.start.split(',').map(Number);
            if (nums.length === 2 && nums.every(Number.isFinite)) return { lat: nums[0], lng: nums[1] };
            const f = find(puzzle.start);
            if (f) return { lat: f.c[1], lng: f.c[0] };
          }
          const big = targets.slice().sort((a, b) => b.a - a.a)[0];
          return big ? { lat: Math.max(-45, Math.min(55, big.c[1])), lng: big.c[0] } : { lat: 20, lng: 10 };
        })();

        if (!webglAvailable()) {
          noGL('Ton navigateur ne gère pas WebGL. Essaie avec Chrome, Safari ou Firefox à jour.');
          return;
        }
        try {
          world = createWorld(ui.globe, features, landMeta, landBin, start, {
            panel: ui.panel,
            dragHint: ui.drag,
            fps: ui.fps,
            onIgnite(name, silent, combo) {
              if (!st.found.includes(name)) {
                st = { ...st, found: [...st.found, name] };
                if (status === 'playing') saveSoon();
              }
              if (!silent) ping(combo);
              updateChip(true);
            },
          });
        } catch (err) {
          console.error(err);
          noGL('Une erreur est survenue en préparant la 3D.');
          return;
        }
        world.setTargets(targets, companions);
        ui.loader.classList.add('gone');
        updateChip(false);

        if (status === 'playing') {
          st.found.forEach((n) => world!.ignite(n, { silent: true }));
          updateChip(false);
          // à la première visite, la Terre arrive en tournant une fois les règles fermées
          const rules = document.getElementById('rules-modal');
          if (rules instanceof HTMLDialogElement && rules.open)
            rules.addEventListener('close', () => world!.intro(start), { once: true });
          else world.intro(start);
        } else {
          world.lookAt(start, 2000);
          setTimeout(() => world!.reveal(true), reduced ? 0 : 500);
        }
      })
      .catch((err) => {
        console.error(err);
        noGL('Impossible de charger la carte. Recharge la page.');
      });
  },
};
