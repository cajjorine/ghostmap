/**
 * Le globe 3D (three.js + globe.gl) : terres, pays allumés, halos, anneaux, Lune, satellite, étoiles filantes,
 * bloom et résolution adaptative. Ne connaît rien des règles du jeu : game.ts lui donne les pays à découvrir
 * et reçoit un rappel à chaque pays allumé.
 */
import Globe, { type GlobeInstance } from 'globe.gl';
import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface Feature {
  /** Nom Natural Earth (clé). */
  n: string;
  fr: string;
  /** Noms normalisés reconnus. */
  k: string[];
  /** Superficie (unités relatives). */
  a: number;
  /** Centroïde [lng, lat]. */
  c: [number, number];
  /** Point lumineux (ville, sommet…) : pas de pays dessous, une colonne de lumière à la place. */
  pt?: boolean;
}

export interface LandMeta {
  n: string;
  p: { rings: number[]; np: number; ni: number }[];
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface WorldHooks {
  /** Panneau de jeu : le globe se centre dans l'espace qu'il laisse libre. */
  panel: HTMLElement;
  dragHint: HTMLElement;
  fps: HTMLElement;
  onIgnite(name: string, silent: boolean, combo: number): void;
}

export interface TourOptions {
  won: boolean;
  /** Nom affiché d'un pays (clé Natural Earth), dans la langue du joueur. */
  name(n: string): string;
  /** Appelé à chaque arrêt de la tournée. */
  onStop?(i: number): void;
}

export interface World {
  /** `levels` (0 à 4) : carte en dégradé, chaque pays monte à la hauteur de son niveau. */
  setTargets(targets: Feature[], companions: Map<string, string>, levels?: Map<string, number>): void;
  ignite(name: string, opts?: { silent?: boolean }): void;
  /** Fin de carte sans spectacle (partie déjà terminée) : tout s'allume. */
  reveal(animated: boolean, won: boolean): void;
  /** Fin de carte en spectacle : onde, tournée de la caméra avec les noms, pulsation. `skip` y met fin. */
  tour(opts: TourOptions): { done: Promise<void>; skip(): void };
  intro(start: LatLng, ms?: number): void;
  lookAt(start: LatLng, ms: number): void;
  litCount(): number;
  /** Allumage automatique des cibles quand elles entrent dans le champ (coupé en mode Retrouve-les). */
  setScan(on: boolean): void;
  /** Rotation lente (menu). */
  setIdle(on: boolean): void;
  /** Pays sous un point de l'écran (null : océan) et position touchée. null si le toucher rate la Terre. */
  pick(x: number, y: number): { name: string | null; lat: number; lng: number } | null;
  /** Mauvais pays touché : il clignote en bleu pâle. */
  flashMiss(name: string): void;
  /** Pays manquants : ils s'allument en bleu pâle, les autres gardent leur couleur. */
  markMissing(names: string[]): void;
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COL = {
  ocean: '#0c2c4c',
  land: '#5d7a99',
  landSide: '#2a4058',
  stroke: 'rgba(196,214,234,0.38)',
  lit: '#ff6236',
  win: '#ff7448',
  litSide: '#b8381a',
  litStroke: 'rgba(255,214,196,0.95)',
  miss: '#8fb4d9',
  missSide: '#3f5f80',
  missStroke: 'rgba(225,238,252,0.85)',
  /** Niveaux des cartes en dégradé, du plus faible au plus fort. */
  levels: ['#9c3f27', '#cf4e2c', '#ff6236', '#ff8f62', '#ffc6a8'],
};
const LEVEL_ALT = [0.02, 0.045, 0.07, 0.095, 0.12];
const R = 100;
const TRANS = reduced ? 0 : 900;

const radial = (stops: [number, string][], size = 128) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const lineMat = (s: string) => {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(s)!;
  return new THREE.LineBasicMaterial({
    color: new THREE.Color(`rgb(${m[1]},${m[2]},${m[3]})`),
    transparent: +m[4] < 1,
    opacity: +m[4],
  });
};

// lissage indépendant de la fréquence d'affichage : même vitesse à 60, 120 ou 144 Hz
const ease = (rate: number, dt: number) => 1 - (1 - rate) ** (dt / 16.667);

export const angDist = (a: LatLng, b: LatLng) => {
  const r = Math.PI / 180;
  const la1 = a.lat * r;
  const la2 = b.lat * r;
  const dl = (b.lng - a.lng) * r;
  return Math.acos(Math.min(1, Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dl))) / r;
};

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// ---------- géométrie des terres ----------
// Tous les pays « éteints » sont fusionnés en 3 maillages (capots, flancs, contours), soit une poignée d'appels
// de dessin au lieu de ~1800 avec la couche polygones de globe.gl. Seuls les pays allumés reçoivent leur propre
// maillage, qui monte en altitude par simple mise à l'échelle.
interface Part {
  pos: Float32Array;
  idx: Uint32Array;
  nrm: Float32Array | null;
}

const geom = (pos: Float32Array, idx: Uint32Array, nrm?: Float32Array | null) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
};

const concatF = (arrs: Float32Array[], n: number) => {
  const out = new Float32Array(n);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};

// assemble plusieurs morceaux { pos, idx, nrm? } en un seul (indices décalés)
function joinParts(parts: Part[]): Part {
  let nv = 0;
  let ni = 0;
  for (const p of parts) {
    nv += p.pos.length;
    ni += p.idx.length;
  }
  const pos = concatF(parts.map((p) => p.pos), nv);
  const nrm = parts[0].nrm ? concatF(parts.map((p) => p.nrm!), nv) : null;
  const idx = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo;
    io += p.idx.length;
    vo += p.pos.length / 3;
  }
  return { pos, idx, nrm };
}

// La triangulation est précalculée (land.json + land.bin) : ici on ne fait que projeter les points sur la sphère.
function landParts(meta: LandMeta[], bin: ArrayBuffer) {
  const out = new Map<string, { cap: Part; side: Part; line: Part }>();
  const d2r = Math.PI / 180;
  let off = 0;
  for (const c of meta) {
    const caps: Part[] = [];
    const sides: Part[] = [];
    const lines: Part[] = [];
    for (const p of c.p) {
      const pts = new Float32Array(bin, off, p.np * 2);
      off += p.np * 8;
      const tri = new Uint32Array(bin, off, p.ni);
      off += p.ni * 4;
      // capot : points sur la sphère, normales = direction radiale (exactes pour une sphère)
      const nrm = new Float32Array(p.np * 3);
      for (let i = 0; i < p.np; i++) {
        const phi = (90 - pts[i * 2 + 1]) * d2r;
        const th = (90 - pts[i * 2]) * d2r;
        const s = Math.sin(phi);
        nrm[i * 3] = s * Math.cos(th);
        nrm[i * 3 + 1] = Math.cos(phi);
        nrm[i * 3 + 2] = s * Math.sin(th);
      }
      const pos = nrm.map((v) => v * R);
      caps.push({ pos, idx: tri, nrm });
      // flancs (de 0,85 R à R, pour rester ancrés dans le globe même quand le pays monte haut) et contours
      const nc = p.rings.reduce((a, b) => a + b, 0);
      const sp = new Float32Array(nc * 6);
      const si = new Uint32Array(nc * 6);
      const li = new Uint32Array(nc * 2);
      sp.set(pos.subarray(0, nc * 3));
      for (let i = 0; i < nc * 3; i++) sp[nc * 3 + i] = pos[i] * 0.85;
      let k = 0;
      let start = 0;
      for (const len of p.rings) {
        for (let j = 0; j < len; j++) {
          const v0 = start + j;
          const v1 = start + ((j + 1) % len);
          si.set([v0, v0 + nc, v1 + nc, v1 + nc, v1, v0], k * 6);
          li[k * 2] = v0;
          li[k * 2 + 1] = v1;
          k++;
        }
        start += len;
      }
      sides.push({ pos: sp, idx: si, nrm: null });
      lines.push({ pos: pos.slice(0, nc * 3), idx: li, nrm: null });
    }
    out.set(c.n, { cap: joinParts(caps), side: joinParts(sides), line: joinParts(lines) });
  }
  return out;
}

// ---------- décor : Lune, satellite, étoiles filantes ----------
function moonTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a9adb3';
  g.fillRect(0, 0, 512, 256);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9; i++) {
    g.fillStyle = `rgba(70,76,88,${0.25 + rnd() * 0.25})`;
    g.beginPath();
    g.ellipse(rnd() * 512, 50 + rnd() * 150, 30 + rnd() * 60, 18 + rnd() * 40, rnd() * 3, 0, 7);
    g.fill();
  }
  for (let i = 0; i < 160; i++) {
    const x = rnd() * 512;
    const y = rnd() * 256;
    const r = 1.5 + rnd() ** 3 * 16;
    g.fillStyle = 'rgba(60,64,72,.45)';
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
    g.strokeStyle = 'rgba(235,238,242,.35)';
    g.lineWidth = Math.max(1, r / 5);
    g.beginPath();
    g.arc(x - r * 0.15, y - r * 0.15, r, 3.4, 5.6);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ombre de la Lune vue de face : claire en haut à gauche (côté soleil), sombre vers le bas à droite
function moonShadeTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(S * 0.3, S * 0.3, 0, S * 0.3, S * 0.3, S * 0.95);
  gr.addColorStop(0, 'rgba(4,8,20,0)');
  gr.addColorStop(0.35, 'rgba(4,8,20,0.05)');
  gr.addColorStop(0.75, 'rgba(4,8,20,0.5)');
  gr.addColorStop(1, 'rgba(4,8,20,0.72)');
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
  g.fillStyle = gr;
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Shoot {
  line: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial[]>;
  head: THREE.Sprite;
  a: THREE.Vector3;
  b: THREE.Vector3;
  t0: number;
  dur: number;
}

interface Decor {
  moon: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  moonShade: THREE.Sprite;
  moonOrbit: THREE.Group;
  moonHalo: THREE.Sprite;
  moonT0: number;
  moonFade: number;
  moonFor?: string;
  blink: THREE.Sprite;
  sat: THREE.Group;
  satOrbit: THREE.Group;
  shoot: Shoot[];
  nextShoot: number;
  ready: boolean;
  warm?: THREE.Material[];
}

// traînée en segments d'opacité décroissante (plutôt qu'un dégradé par sommet, qui demanderait un shader de plus)
const TRAIL = [1, 0.55, 0.28, 0.1];

interface Glow extends LatLng {
  size: number;
  op: number;
  born: number;
  obj?: THREE.Sprite;
}

interface Raised {
  g: THREE.Group;
  cap: THREE.Mesh;
  side: THREE.Mesh;
  line: THREE.LineSegments;
  kind: Kind;
  alt: number;
  from: number;
  to: number;
  t0: number;
  /** Début de la pulsation de fin (0 : aucune). */
  bump0: number;
}

type Kind = 'base' | 'lit' | 'win' | 'miss' | 'g0' | 'g1' | 'g2' | 'g3' | 'g4';

export function createWorld(
  el: HTMLElement,
  features: Feature[],
  landMeta: LandMeta[],
  landBin: ArrayBuffer,
  start: LatLng,
  hooks: WorldHooks,
): World {
  const byName = new Map(features.map((f) => [f.n, f]));

  const landMat = new THREE.MeshLambertMaterial({ color: COL.land });
  const litMat = new THREE.MeshBasicMaterial({ color: COL.lit });
  const winMat = new THREE.MeshBasicMaterial({ color: COL.win });
  const sideMat = new THREE.MeshBasicMaterial({ color: COL.landSide, side: THREE.DoubleSide });
  const litSideMat = new THREE.MeshBasicMaterial({ color: COL.litSide, side: THREE.DoubleSide });
  const strokeMat = lineMat(COL.stroke);
  const litStrokeMat = lineMat(COL.litStroke);
  const missMat = new THREE.MeshBasicMaterial({ color: COL.miss });
  const missSideMat = new THREE.MeshBasicMaterial({ color: COL.missSide, side: THREE.DoubleSide });
  const missStrokeMat = lineMat(COL.missStroke);
  const lvl = (i: number) => ({ alt: LEVEL_ALT[i], cap: new THREE.MeshBasicMaterial({ color: COL.levels[i] }), side: litSideMat, line: litStrokeMat });
  const KIND: Record<Kind, { alt: number; cap: THREE.Material; side: THREE.Material; line: THREE.Material }> = {
    base: { alt: 0.005, cap: landMat, side: sideMat, line: strokeMat },
    lit: { alt: 0.022, cap: litMat, side: litSideMat, line: litStrokeMat },
    win: { alt: 0.04, cap: winMat, side: litSideMat, line: litStrokeMat },
    miss: { alt: 0.035, cap: missMat, side: missSideMat, line: missStrokeMat },
    g0: lvl(0), g1: lvl(1), g2: lvl(2), g3: lvl(3), g4: lvl(4),
  };
  const glowTex = radial([
    [0, 'rgba(255,255,255,1)'],
    [0.18, 'rgba(255,220,200,0.85)'],
    [0.45, 'rgba(255,120,70,0.28)'],
    [1, 'rgba(255,90,40,0)'],
  ]);

  let targets: Feature[] = [];
  let companions = new Map<string, string>();
  let levels = new Map<string, number>();
  const litSet = new Set<string>();
  const missSet = new Set<string>();
  let solved = false;
  let won = true;
  let scanOn = false;
  const glows: Glow[] = [];
  let rings: LatLng[] = [];
  const queue: Feature[] = [];
  let combo = 0;
  let lastIgniteAt = 0;
  const land = {
    root: null as THREE.Group | null,
    geo: new Map<string, { cap: THREE.BufferGeometry; side: THREE.BufferGeometry; line: THREE.BufferGeometry }>(),
    raised: new Map<string, Raised>(),
    /** Maillage de base des terres et fin (exclue) des triangles de chaque pays, pour savoir lequel est touché. */
    capMesh: null as THREE.Mesh | null,
    capEnds: [] as { end: number; n: string }[],
  };

  // ---------- pays ----------
  function buildLand(scene: THREE.Scene) {
    const parts = landParts(landMeta, landBin);
    const all = { cap: [] as Part[], side: [] as Part[], line: [] as Part[] };
    let tris = 0;
    for (const [n, p] of parts) {
      tris += p.cap.idx.length / 3;
      land.capEnds.push({ end: tris, n });
      land.geo.set(n, {
        cap: geom(p.cap.pos, p.cap.idx, p.cap.nrm),
        side: geom(p.side.pos, p.side.idx),
        line: geom(p.line.pos, p.line.idx),
      });
      all.cap.push(p.cap);
      all.side.push(p.side);
      all.line.push(p.line);
    }
    const cap = joinParts(all.cap);
    const side = joinParts(all.side);
    const line = joinParts(all.line);
    const root = new THREE.Group();
    const base = new THREE.Group();
    land.capMesh = new THREE.Mesh(geom(cap.pos, cap.idx, cap.nrm), landMat);
    base.add(land.capMesh, new THREE.Mesh(geom(side.pos, side.idx), sideMat));
    const bl = new THREE.LineSegments(geom(line.pos, line.idx), strokeMat);
    bl.scale.setScalar(1.0001);
    base.add(bl);
    base.scale.setScalar(1 + KIND.base.alt);
    root.add(base);
    scene.add(root);
    land.root = root;
  }

  function raise(n: string, kind: Kind) {
    const geo = land.geo.get(n);
    if (!geo || !land.root) return;
    let r = land.raised.get(n);
    if (!r) {
      if (kind === 'base') return;
      const g = new THREE.Group();
      const cap = new THREE.Mesh(geo.cap);
      const side = new THREE.Mesh(geo.side);
      const line = new THREE.LineSegments(geo.line);
      line.scale.setScalar(1.0001);
      [g, cap, side, line].forEach((o) => { o.renderOrder = 1; });
      g.add(cap, side, line);
      land.root.add(g);
      r = { g, cap, side, line, kind: 'base', alt: KIND.base.alt, from: 0, to: KIND.base.alt, t0: 0, bump0: 0 };
      g.scale.setScalar(1 + r.alt);
      land.raised.set(n, r);
    }
    if (r.kind === kind) return;
    const K = KIND[kind];
    r.kind = kind;
    r.cap.material = K.cap;
    r.side.material = K.side;
    r.line.material = K.line;
    r.from = r.alt;
    r.to = K.alt;
    r.t0 = performance.now();
  }

  function animateLand(now: number) {
    for (const [n, r] of land.raised) {
      let moved = false;
      if (r.alt !== r.to) {
        const k = TRANS ? Math.min(1, (now - r.t0) / TRANS) : 1;
        const e = k < 0.5 ? 2 * k * k : 1 - (2 - 2 * k) ** 2 / 2;
        r.alt = k >= 1 ? r.to : r.from + (r.to - r.from) * e;
        moved = true;
      }
      let extra = 0;
      if (r.bump0) {
        const k = (now - r.bump0) / 650;
        if (k >= 1) r.bump0 = 0;
        else if (k > 0) extra = 0.035 * Math.sin(Math.PI * k);
        moved = true;
      }
      if (moved) r.g.scale.setScalar(1 + r.alt + extra);
      if (r.alt === r.to && r.kind === 'base' && !r.bump0) {
        land.root?.remove(r.g);
        land.raised.delete(n);
      }
    }
  }

  function kindOf(n: string): Kind {
    if (missSet.has(n) || missSet.has(companions.get(n) ?? '')) return 'miss';
    const lv = levels.get(n) ?? levels.get(companions.get(n) ?? '');
    if (lv !== undefined) return `g${lv}` as Kind;
    return solved ? (won ? 'win' : 'miss') : 'lit';
  }

  function refreshPolys() {
    if (!land.root) return;
    const want = new Map<string, Kind>();
    litSet.forEach((n) => want.set(n, kindOf(n)));
    for (const n of land.raised.keys()) if (!want.has(n)) raise(n, 'base');
    for (const [n, k] of want) raise(n, k);
    if (targets.some((t) => t.pt)) world.pointsData(targets.filter((t) => t.pt && litSet.has(t.n)));
  }

  const glowOf = (f: Feature, born: number): Glow => ({
    lat: f.c[1],
    lng: f.c[0],
    size: Math.max(6, Math.min(18, 6 + Math.sqrt(f.a) * 0.8)),
    op: f.a < 1 ? 0.85 : f.a < 10 ? 0.35 : 0,
    born,
  });

  function addRing(f: Feature) {
    const r = { lat: f.c[1], lng: f.c[0] };
    rings.push(r);
    world.ringsData(rings.slice());
    setTimeout(() => {
      rings = rings.filter((x) => x !== r);
      world.ringsData(rings.slice());
    }, 1500);
  }

  function ignite(t: Feature, { silent = false, now = performance.now() } = {}) {
    if (litSet.has(t.n)) return;
    litSet.add(t.n);
    companions.forEach((owner, c) => { if (owner === t.n) litSet.add(c); });
    combo = now - lastIgniteAt < 900 ? combo + 1 : 0;
    lastIgniteAt = now;
    const gw = glowOf(t, now);
    if (gw.op > 0) {
      glows.push(gw);
      world.customLayerData(glows.slice());
    }
    addRing(t);
    refreshPolys();
    hooks.onIgnite(t.n, silent, combo);
  }

  // ---------- fin de carte : arrêts de la tournée et pulsation ----------
  /** Regroupe les pays par proximité, garde au plus 4 groupes importants et éloignés, dans l'ordre du trajet. */
  function tourStops(from: LatLng) {
    type Cluster = LatLng & { w: number; items: Feature[] };
    const weight = (f: Feature) => Math.sqrt(f.a) + 0.5;
    const clusters: Cluster[] = [];
    for (const f of targets.slice().sort((a, b) => weight(b) - weight(a))) {
      const p = { lat: f.c[1], lng: f.c[0] };
      const c = clusters.find((k) => angDist(k, p) < 28);
      if (c) {
        c.items.push(f);
        c.w += weight(f);
      } else clusters.push({ ...p, w: weight(f), items: [f] });
    }
    const pool = clusters.sort((a, b) => b.w - a.w);
    const chosen: Cluster[] = pool.length ? [pool.shift()!] : [];
    while (chosen.length < 4 && pool.length) {
      let best = -1;
      let bi = -1;
      pool.forEach((c, i) => {
        const d = Math.min(...chosen.map((k) => angDist(k, c)));
        const sc = c.w * Math.min(1, d / 60);
        if (sc > best) {
          best = sc;
          bi = i;
        }
      });
      if (bi < 0 || best < chosen[0].w * 0.08) break;
      chosen.push(pool.splice(bi, 1)[0]);
    }
    // trajet : toujours le groupe le plus proche de la position courante
    const path: Cluster[] = [];
    let cur: LatLng = from;
    while (chosen.length) {
      chosen.sort((a, b) => angDist(cur, a) - angDist(cur, b));
      cur = chosen.shift()!;
      path.push(cur as Cluster);
    }
    return path.map((c) => ({ lat: c.lat, lng: c.lng, names: c.items.slice(0, 5) }));
  }

  /** Une vague de soulèvement court de pays en pays, depuis l'endroit regardé. */
  function pulse() {
    const pov = world.pointOfView();
    const now = performance.now();
    [...litSet]
      .map((n) => byName.get(n))
      .filter((f): f is Feature => !!f)
      .sort((a, b) => angDist(pov, { lat: a.c[1], lng: a.c[0] }) - angDist(pov, { lat: b.c[1], lng: b.c[0] }))
      .forEach((f, i) => {
        const r = land.raised.get(f.n);
        if (r) r.bump0 = now + i * 35;
      });
  }

  // ---------- cadrage : le globe se centre dans l'espace laissé libre par le panneau ----------
  const view = { x: 0, y: 0, tx: 0, ty: 0, alt: 2.4 };
  function measure() {
    const W = innerWidth;
    const H = innerHeight;
    const r = hooks.panel.getBoundingClientRect();
    const top = 64;
    const side = r.left > W * 0.45 && r.height > 0;
    const freeW = side ? r.left - 16 : W;
    const freeH = side ? H - top : r.top - top;
    view.tx = side ? (W - freeW) / 2 : 0;
    view.ty = side ? -top / 2 : (H - freeH) / 2 - top;
    const rad = Math.max(120, Math.min(freeW * 0.46, freeH * 0.47));
    const k = (rad * Math.tan((50 * Math.PI) / 360)) / (H / 2);
    view.alt = Math.max(0.6, 1 / Math.sin(Math.atan(k)) - 1);
    hooks.dragHint.style.left = W / 2 - view.tx + 'px';
    hooks.dragHint.style.top = H / 2 - view.ty + 'px';
  }
  const applyOffset = () => world.globeOffset([-view.x, -view.y]);

  // ---------- décor ----------
  function buildDecor(scene: THREE.Scene): Decor {
    // Lune : matériau sans éclairage (un shader éclairé + texture coûte jusqu'à 2 s de compilation, d'où un gel à son
    // apparition). Le soleil suit la caméra, donc l'ombrage apparent de la Lune est fixe à l'écran : un disque dégradé
    // tourné vers la caméra (moonShade) l'imite.
    const moon = new THREE.Mesh(new THREE.SphereGeometry(24, 48, 32), new THREE.MeshBasicMaterial({ map: moonTexture() }));
    moon.material.transparent = true;
    moon.material.opacity = 0;
    const moonShade = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: moonShadeTexture(), transparent: true, depthWrite: false, opacity: 0 }),
    );
    moonShade.scale.setScalar(48.2);
    scene.add(moonShade);
    const moonOrbit = new THREE.Group();
    moonOrbit.add(moon);
    moonOrbit.visible = false;
    scene.add(moonOrbit);
    const moonHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radial([
          [0, 'rgba(200,220,255,.35)'],
          [0.4, 'rgba(160,190,255,.12)'],
          [1, 'rgba(120,160,255,0)'],
        ]),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    moonHalo.scale.setScalar(150);
    moon.add(moonHalo);
    // satellite ; panneaux en deux faces simples plutôt qu'en DoubleSide : réutilise le shader déjà compilé des pays
    const sat = new THREE.Group();
    const metal = new THREE.MeshLambertMaterial({ color: '#c9d2dc' });
    const panel = new THREE.MeshLambertMaterial({ color: '#2d5fa8' });
    sat.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 2.2), metal));
    const pg = new THREE.PlaneGeometry(4.2, 1.3);
    [-1, 1].forEach((s) =>
      [0, Math.PI].forEach((r) => {
        const p = new THREE.Mesh(pg, panel);
        p.position.x = s * 2.9;
        p.rotation.y = r;
        sat.add(p);
      }),
    );
    const blink = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, color: '#bfe3ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    blink.scale.setScalar(5);
    blink.position.z = 1.4;
    sat.add(blink);
    sat.position.set(0, 0, 122);
    sat.scale.setScalar(0.9);
    const satOrbit = new THREE.Group();
    satOrbit.rotation.set(0.95, 0, 0.4);
    satOrbit.add(sat);
    scene.add(satOrbit);
    return {
      moon, moonShade, moonOrbit, moonHalo, moonT0: 0, moonFade: 0,
      blink, sat, satOrbit, shoot: [], nextShoot: performance.now() + 3000, ready: false,
    };
  }

  function spawnShootingStar(scene: THREE.Scene, cam: THREE.Camera, d: Decor) {
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      TRAIL.map(
        () => new THREE.LineBasicMaterial({ color: '#ffffff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
      ),
    );
    line.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL.length * 6), 3));
    TRAIL.forEach((_, i) => line.geometry.addGroup(i * 2, 2, i));
    line.frustumCulled = false;
    const D = 2600;
    const half = Math.tan((25 * Math.PI) / 180) * D;
    const asp = innerWidth / innerHeight;
    const sx = (Math.random() * 1.6 - 0.8) * half * asp;
    const sy = (0.15 + Math.random() * 0.7) * half;
    const ang = -0.35 - Math.random() * 0.5;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const a = new THREE.Vector3(sx, sy, -D).applyMatrix4(cam.matrixWorld);
    const b = new THREE.Vector3(sx + dir * Math.cos(ang) * half * 0.7, sy + Math.sin(ang) * half * 0.7, -D).applyMatrix4(cam.matrixWorld);
    const head = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, color: '#ffffff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    head.scale.setScalar(34);
    scene.add(head);
    d.shoot.push({ line, head, a, b, t0: performance.now(), dur: 900 + Math.random() * 500 });
    scene.add(line);
  }

  const vHead = new THREE.Vector3();
  const vTail = new THREE.Vector3();
  function animateDecor(d: Decor, now: number, dt: number, scene: THREE.Scene, cam: THREE.Camera) {
    d.moonOrbit.rotation.y = ((now - d.moonT0) / 1000) * ((Math.PI * 2) / 3600);
    d.moon.rotation.y = (now / 1000) * 0.03;
    const mo = d.moon.material;
    mo.opacity += (d.moonFade - mo.opacity) * ease(0.04, dt);
    d.moonHalo.material.opacity = mo.opacity;
    // ombre : disque face caméra posé devant la Lune
    d.moonShade.visible = d.moonOrbit.visible;
    d.moonShade.material.opacity = mo.opacity;
    d.moon.getWorldPosition(vHead);
    vTail.copy(cam.position).sub(vHead).normalize().multiplyScalar(24.5);
    d.moonShade.position.copy(vHead).add(vTail);
    d.satOrbit.rotation.y = (now / 1000) * ((Math.PI * 2) / 55);
    d.sat.rotation.z = (now / 1000) * 0.4;
    d.blink.material.opacity = now % 1400 < 140 ? 1 : 0.18;
    if (!reduced && d.ready && now > d.nextShoot) {
      spawnShootingStar(scene, cam, d);
      d.nextShoot = now + 5000 + Math.random() * 8000;
    }
    d.shoot = d.shoot.filter((s) => {
      const k = (now - s.t0) / s.dur;
      if (k >= 1) {
        scene.remove(s.line, s.head);
        s.line.geometry.dispose();
        s.line.material.forEach((m) => m.dispose());
        s.head.material.dispose();
        return false;
      }
      const kh = Math.min(1, k * 1.15);
      const kt = Math.max(0, k * 1.15 - 0.35);
      const p = s.line.geometry.attributes.position as THREE.BufferAttribute;
      const fade = Math.sin(Math.PI * k);
      TRAIL.forEach((o, i) => {
        vHead.lerpVectors(s.a, s.b, kh + ((kt - kh) * i) / TRAIL.length);
        vTail.lerpVectors(s.a, s.b, kh + ((kt - kh) * (i + 1)) / TRAIL.length);
        p.setXYZ(i * 2, vHead.x, vHead.y, vHead.z);
        p.setXYZ(i * 2 + 1, vTail.x, vTail.y, vTail.z);
        s.line.material[i].opacity = o * fade;
      });
      p.needsUpdate = true;
      s.head.position.copy(vHead.lerpVectors(s.a, s.b, kh));
      s.head.material.opacity = fade * 0.9;
      return true;
    });
  }

  // la Lune se place en haut à gauche du globe (à moitié cachée derrière sur téléphone), vue depuis la position de départ
  function placeMoon(s: LatLng) {
    const d = decor;
    const sk = s.lat + ',' + s.lng;
    if (d.moonFor === sk) return;
    d.moonFor = sk;
    const c = world.getCoords(s.lat, s.lng, view.alt);
    const C0 = new THREE.Vector3(c.x, c.y, c.z);
    const dist = C0.length();
    const f = C0.clone().negate().normalize();
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const u = new THREE.Vector3().crossVectors(r, f);
    const half = Math.tan((25 * Math.PI) / 180);
    const H2 = innerHeight / 2;
    const Rpx = (H2 * Math.tan(Math.asin(100 / dist))) / half;
    const wide = innerWidth >= 980;
    const k = wide ? 1.12 : 0.97;
    const th = ((wide ? 138 : 118) * Math.PI) / 180;
    const a = Math.atan((half * k * Rpx) / H2);
    const D = dist + 620;
    const dir = f
      .clone()
      .multiplyScalar(Math.cos(a))
      .add(r.clone().multiplyScalar(Math.cos(th) * Math.sin(a)))
      .add(u.clone().multiplyScalar(Math.sin(th) * Math.sin(a)));
    const go = () => {
      d.moonOrbit.rotation.y = 0;
      d.moonT0 = performance.now();
      d.moon.position.copy(C0.clone().add(dir.multiplyScalar(D)));
      d.moonFade = 1;
    };
    if (d.moon.material.opacity < 0.05) go();
    else {
      d.moonFade = 0;
      setTimeout(go, 900);
    }
  }

  // ---------- initialisation ----------
  // antialias inutile : l'image passe par le compositeur (bloom), qui dessine hors de l'écran sans MSAA
  const world: GlobeInstance = new Globe(el, {
    animateIn: false,
    rendererConfig: { antialias: false, powerPreference: 'high-performance' },
  });
  world
    .width(innerWidth)
    .height(innerHeight)
    .backgroundColor('#03050b')
    .showAtmosphere(true)
    .atmosphereColor('#6fb2ff')
    .atmosphereAltitude(0.17)
    .ringColor(() => (t: number) => `rgba(255,140,100,${Math.max(0, 1 - t)})`)
    .ringMaxRadius(5)
    .ringPropagationSpeed(5)
    .ringRepeatPeriod(5000)
    .ringAltitude(0.035)
    .customThreeObject((d: object) => {
      const g = d as Glow;
      const m = new THREE.SpriteMaterial({
        map: glowTex, color: '#ff8a5c', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: g.op,
      });
      const s = new THREE.Sprite(m);
      s.scale.setScalar(0.01);
      g.obj = s;
      return s;
    })
    .customThreeObjectUpdate((obj, d) => {
      const g = d as Glow;
      Object.assign(obj.position, world.getCoords(g.lat, g.lng, 0.05));
    })
    .pointLat((d: object) => (d as Feature).c[1])
    .pointLng((d: object) => (d as Feature).c[0])
    .pointColor((d: object) => {
      const k = kindOf((d as Feature).n);
      return k === 'miss' ? COL.miss : k === 'win' ? '#ffb08f' : COL.lit;
    })
    .pointAltitude((d: object) => {
      const k = kindOf((d as Feature).n);
      return k === 'win' ? 0.11 : k === 'miss' ? 0.06 : 0.08;
    })
    .pointRadius(0.45)
    .pointResolution(8)
    .pointsMerge(false)
    .pointsTransitionDuration(TRANS)
    .htmlLat('lat')
    .htmlLng('lng')
    .htmlAltitude(0.07)
    .htmlElement((d: object) => {
      const el = document.createElement('div');
      el.className = 'gm-label';
      el.textContent = (d as { text: string }).text;
      return el;
    })
    .enablePointerInteraction(false);

  const gm = world.globeMaterial() as THREE.MeshPhongMaterial;
  gm.color = new THREE.Color(COL.ocean);
  gm.emissive = new THREE.Color('#05182b');
  gm.shininess = 22;
  gm.specular = new THREE.Color('#2f5f8a');
  const amb = new THREE.AmbientLight(0xbfd4ff, 0.95);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  world.lights([amb, sun]);

  const scene = world.scene();
  buildLand(scene);
  refreshPolys();
  const n = 2600;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const Rs = 3000 + Math.random() * 5000;
    const s = Math.sqrt(1 - u * u);
    pos.set([Rs * s * Math.cos(th), Rs * u, Rs * s * Math.sin(th)], i * 3);
    const w = 0.55 + Math.random() * 0.45;
    col.set([w, w * (0.9 + Math.random() * 0.1), w], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(
    sg,
    new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  scene.add(stars);
  const decor = buildDecor(scene);

  // Précompilation des shaders qui n'apparaissent qu'en cours de partie (pays allumés, halos, anneaux, étoiles
  // filantes) : sans ça, chacun gèle l'affichage de 0,3 à 2 s la première fois qu'il est dessiné.
  // On attend que globe.gl ait mis les lumières dans la scène : leur nombre fait partie de la clé de chaque shader.
  const warmUp = () => {
    if (!sun.parent) {
      requestAnimationFrame(warmUp);
      return;
    }
    const warm = new THREE.Group();
    const tri = new THREE.BufferGeometry();
    const seg = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    tri.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
    seg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const tmp: THREE.Material[] = [
      new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      new THREE.LineBasicMaterial({ transparent: true }),
    ];
    warm.add(
      new THREE.Mesh(tri, litMat),
      new THREE.Mesh(tri, winMat),
      new THREE.Mesh(tri, missMat),
      new THREE.Mesh(tri, litSideMat),
      new THREE.LineSegments(seg, litStrokeMat),
      new THREE.Sprite(tmp[0] as THREE.SpriteMaterial),
      new THREE.Line(seg, tmp[1]),
    );
    // Les matériaux temporaires restent en vie : les libérer libérerait aussi le programme compilé.
    // La variante d'un shader dépend de la cible de rendu : on compile pour celle du compositeur (bloom).
    const rr = world.renderer() as THREE.WebGLRenderer;
    const prevRT = rr.getRenderTarget();
    try {
      rr.setRenderTarget(world.postProcessingComposer().readBuffer);
      // la Lune et les étoiles filantes n'apparaissent qu'une fois leurs shaders prêts
      const show = () => {
        decor.warm = tmp;
        decor.ready = true;
        decor.moonOrbit.visible = true;
      };
      Promise.all([rr.compileAsync(warm, world.camera(), scene), rr.compileAsync(scene, world.camera())]).then(show, show);
    } finally {
      rr.setRenderTarget(prevRT);
    }
  };
  requestAnimationFrame(warmUp);

  const small = innerWidth < 700;
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), small ? 0.4 : 0.36, 0.3, 0.3);
  const setSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w: number, h: number) => setSize(w / 2, h / 2);
  const comp = world.postProcessingComposer();
  comp.addPass(bloom);
  comp.addPass(new OutputPass());

  // Résolution adaptative : si la cadence reste sous ~50 i/s pendant 1,5 s, on baisse la définition d'un cran
  // (jusqu'à 1×). Jamais à la hausse ; les fenêtres où l'onglet était caché ou en pause ne comptent pas.
  const rr = world.renderer() as THREE.WebGLRenderer;
  const adapt = { pr: rr.getPixelRatio(), n: 0, slow: 0, t0: 0, from: 0 };
  const adaptRes = (now: number, dt: number) => {
    if (adapt.pr <= 1) return;
    if (dt >= 250 || document.hidden || !decor.ready) {
      adapt.t0 = adapt.n = adapt.slow = 0;
      return;
    }
    if (!adapt.from) adapt.from = now + 2000;
    if (now < adapt.from) return;
    if (!adapt.t0) adapt.t0 = now;
    adapt.n++;
    if (dt > 20) adapt.slow++;
    if (now - adapt.t0 < 1500) return;
    const bad = adapt.slow / adapt.n > 0.5;
    adapt.n = adapt.slow = 0;
    adapt.t0 = now;
    if (!bad) return;
    adapt.pr = Math.max(1, adapt.pr - 0.25);
    rr.setPixelRatio(adapt.pr);
    rr.setSize(innerWidth, innerHeight);
    comp.setPixelRatio(adapt.pr);
  };

  const ctr = world.controls();
  ctr.minDistance = 100 * 1.3;
  ctr.maxDistance = 100 * 6;
  ctr.autoRotateSpeed = 0.9;
  ctr.addEventListener('start', () => {
    hooks.dragHint.classList.add('gone');
    ctr.autoRotate = false;
  });

  measure();
  view.x = view.tx;
  view.y = view.ty;
  applyOffset();
  world.pointOfView(
    reduced
      ? { lat: start.lat, lng: start.lng, altitude: view.alt }
      : { lat: start.lat - 10, lng: start.lng - 120, altitude: view.alt + 2.2 },
  );
  const cam = world.camera();
  placeMoon(start);

  let lastW = innerWidth;
  addEventListener('resize', () => {
    world.width(innerWidth).height(innerHeight);
    const wChanged = Math.abs(innerWidth - lastW) > 40;
    lastW = innerWidth;
    measure();
    if (wChanged) world.pointOfView({ altitude: view.alt }, 400);
  });
  new ResizeObserver(() => measure()).observe(hooks.panel);

  const pickRay = new THREE.Raycaster();
  let lastScan = 0;
  let prev = performance.now();
  const fps = { n: 0, t0: prev, pr0: adapt.pr };
  const cd = new THREE.Vector3();
  const loop = (now: number) => {
    const raw = now - prev;
    const dt = Math.min(100, Math.max(0, raw));
    prev = now;
    adaptRes(now, raw);
    // compteur d'images par seconde, rafraîchi deux fois par seconde
    fps.n++;
    if (now - fps.t0 >= 500) {
      const v = Math.round((fps.n * 1000) / (now - fps.t0));
      const pr = adapt.pr;
      hooks.fps.innerHTML = `<b>${v}</b> i/s${pr !== fps.pr0 ? ` · ${pr.toFixed(2).replace(/\.?0+$/, '')}×` : ''}`;
      hooks.fps.classList.toggle('low', v < 50);
      fps.n = 0;
      fps.t0 = now;
    }
    sun.position.set(-0.75, 0.55, 0.6).applyQuaternion(cam.quaternion).multiplyScalar(500);
    stars.rotation.y += (0.00004 * dt) / 16.667;
    animateDecor(decor, now, dt, scene, cam);
    animateLand(now);
    if (Math.abs(view.x - view.tx) + Math.abs(view.y - view.ty) > 0.05) {
      const k = ease(0.12, dt);
      view.x += (view.tx - view.x) * k;
      view.y += (view.ty - view.y) * k;
      applyOffset();
    }
    if (scanOn && now - lastScan > 120) {
      lastScan = now;
      const pov = world.pointOfView();
      const lim = ((Math.acos(1 / (1 + pov.altitude)) * 180) / Math.PI) * 0.72;
      for (const t of targets)
        if (!litSet.has(t.n) && !queue.includes(t) && angDist(pov, { lat: t.c[1], lng: t.c[0] }) < lim) queue.push(t);
    }
    if (queue.length && now - lastIgniteAt > (solved ? 45 : 140))
      ignite(queue.shift()!, { now, silent: solved && combo % 3 !== 0 });
    cd.copy(cam.position).normalize();
    for (const g of glows) {
      if (!g.obj) continue;
      const gp = g.obj.position;
      const f = gp.dot(cd) / (gp.length() || 1);
      g.obj.material.opacity = g.op * Math.min(1, Math.max(0, (f - 0.1) / 0.3));
      const k = Math.min(1, (now - g.born) / 700);
      const e = k < 1 ? 1 + 1.4 * Math.sin(k * Math.PI) * (1 - k) : 1;
      const pulse = 1 + 0.06 * Math.sin(now / 600 + g.lat);
      g.obj.scale.setScalar(g.size * (solved ? 1.1 : 1) * e * pulse * Math.min(1, k * 3 + 0.01));
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    // Nouvelle carte : tout s'éteint (pays, halos, file d'allumage) avant de poser les nouvelles cibles.
    setTargets(t, comps, lv) {
      targets = t;
      companions = comps;
      levels = lv ?? new Map();
      for (const f of t) if (f.pt) byName.set(f.n, f);
      missSet.clear();
      world.pointsData([]);
      won = true;
      world.htmlElementsData([]);
      litSet.clear();
      queue.length = 0;
      glows.length = 0;
      world.customLayerData([]);
      solved = false;
      combo = 0;
      ctr.autoRotate = false;
      refreshPolys();
    },
    ignite(name, { silent = false } = {}) {
      const f = byName.get(name);
      if (f) ignite(f, { silent });
    },
    reveal(animated, w) {
      solved = true;
      won = w;
      scanOn = true;
      refreshPolys();
      const pov = world.pointOfView();
      const rest = targets
        .filter((t) => !litSet.has(t.n))
        .sort((a, b) => angDist(pov, { lat: a.c[1], lng: a.c[0] }) - angDist(pov, { lat: b.c[1], lng: b.c[0] }));
      if (animated) {
        queue.push(...rest.filter((t) => !queue.includes(t)));
        if (!reduced) {
          ctr.autoRotate = true;
          setTimeout(() => { ctr.autoRotate = false; }, 9000);
        }
      } else rest.forEach((t) => ignite(t, { silent: true }));
    },
    intro(s, ms = 2800) {
      scanOn = true;
      placeMoon(s);
      world.pointOfView({ lat: s.lat, lng: s.lng, altitude: view.alt }, reduced ? 0 : ms);
    },
    lookAt(s, ms) {
      world.pointOfView({ lat: s.lat, lng: s.lng, altitude: view.alt }, reduced ? 0 : ms);
    },
    tour(opts) {
      solved = true;
      won = opts.won;
      refreshPolys();
      const pov0 = world.pointOfView();
      const rest = () =>
        targets
          .filter((t) => !litSet.has(t.n))
          .sort((a, b) => angDist(pov0, { lat: a.c[1], lng: a.c[0] }) - angDist(pov0, { lat: b.c[1], lng: b.c[0] }));
      if (reduced) {
        rest().forEach((t) => ignite(t, { silent: true }));
        return { done: Promise.resolve(), skip() {} };
      }
      // onde : les lumières restantes s'allument depuis l'endroit regardé
      queue.push(...rest().filter((t) => !queue.includes(t)));

      const stops = tourStops(pov0);
      const timers: number[] = [];
      let over = false;
      let resolve!: () => void;
      const done = new Promise<void>((r) => (resolve = r));
      const end = () => {
        if (over) return;
        over = true;
        timers.forEach((id) => clearTimeout(id));
        world.htmlElementsData([]);
        queue.length = 0;
        rest().forEach((t) => ignite(t, { silent: true }));
        const p = world.pointOfView();
        world.pointOfView({ lat: p.lat, lng: p.lng, altitude: view.alt }, 900);
        setTimeout(pulse, 500);
        ctr.autoRotate = true;
        setTimeout(() => { ctr.autoRotate = false; }, 7000);
        resolve();
      };
      let at = 450;
      stops.forEach((s, i) => {
        timers.push(window.setTimeout(() => {
          world.htmlElementsData([]);
          world.pointOfView({ lat: s.lat, lng: s.lng, altitude: Math.max(0.45, view.alt * 0.72) }, 900);
        }, at));
        timers.push(window.setTimeout(() => {
          world.htmlElementsData(s.names.map((f) => ({ lat: f.c[1], lng: f.c[0], text: opts.name(f.n) })));
          opts.onStop?.(i);
        }, at + 900));
        at += 1400;
      });
      timers.push(window.setTimeout(end, at + 200));
      return { done, skip: end };
    },
    litCount: () => targets.filter((t) => litSet.has(t.n)).length,
    setScan(on) {
      scanOn = on;
      if (!on) queue.length = 0;
    },
    setIdle(on) {
      ctr.autoRotate = on && !reduced;
    },
    pick(x, y) {
      const r = rr.domElement.getBoundingClientRect();
      pickRay.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), cam);
      const sp = pickRay.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), R), new THREE.Vector3());
      if (!sp) return null;
      const dSea = sp.distanceTo(pickRay.ray.origin);
      let name: string | null = null;
      const hit = land.capMesh ? pickRay.intersectObject(land.capMesh, false)[0] : undefined;
      // un pays de la face cachée est plus loin que la mer : ignoré
      if (hit && hit.faceIndex != null && hit.distance < dSea + 2) {
        const e = land.capEnds;
        let lo = 0;
        let hi = e.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (e[mid].end > hit.faceIndex) hi = mid;
          else lo = mid + 1;
        }
        name = e[lo]?.n ?? null;
      }
      const g = world.toGeoCoords({ x: sp.x, y: sp.y, z: sp.z });
      return { name, lat: g.lat, lng: g.lng };
    },
    flashMiss(name) {
      if (litSet.has(name)) return;
      raise(name, 'miss');
      const r = land.raised.get(name);
      if (r) r.bump0 = performance.now();
      setTimeout(() => {
        if (!litSet.has(name)) raise(name, 'base');
      }, 700);
    },
    markMissing(names) {
      names.forEach((n) => missSet.add(n));
      for (const n of names) {
        const f = byName.get(n);
        if (f) ignite(f, { silent: true });
      }
      refreshPolys();
    },
  };
}
