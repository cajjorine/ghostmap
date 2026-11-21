/**
 * Statistiques de tous les joueurs (mode Classique) : Worker Cloudflare + base D1.
 * Seules les adresses /api/* passent par ce code (`run_worker_first` dans wrangler.jsonc) ; tout le reste est servi
 * tel quel depuis dist/.
 *
 * POST /api/result      un résumé par carte jouée (envoyé une seule fois par navigateur)
 * GET  /api/stats?card= chiffres agrégés d'une carte, mis en cache une minute
 *
 * Vie privée : ni compte, ni identifiant joueur, ni adresse IP en base. La limite d'envois par minute est tenue
 * en mémoire (par instance du Worker), sur une empreinte de l'adresse jamais écrite.
 * Si la base n'est pas branchée (binding DB absent), l'API répond 503 et le jeu masque le bloc.
 */

// ---------- types minimaux (pas de dépendance @cloudflare/workers-types) ----------
interface D1Result<T> {
  results: T[];
}
interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
interface D1 {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown>;
}
interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  DB?: D1;
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}
declare const caches: { default: { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> } };

/** Seuils de TODO.md : pas de pourcentages sous 30 joueurs, une réponse fausse affichée à partir de 20. */
const MIN_PLAYERS = 30;
const MIN_WRONG = 20;
const RATE = { limit: 20, windowMs: 60_000 };
const CARD_RE = /^c\d{1,5}\.\d$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS results (card TEXT NOT NULL, won INTEGER NOT NULL, tries INTEGER NOT NULL, score INTEGER NOT NULL, ms INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS results_card ON results(card);
CREATE TABLE IF NOT EXISTS wrongs (card TEXT NOT NULL, guess TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (card, guess));
`;

/** Mots jamais affichés comme « réponse fausse la plus fréquente » (début de mot, sans accents). */
const BANNED = [
  'con', 'conne', 'connard', 'connasse', 'merde', 'putain', 'pute', 'salope', 'encul', 'nique', 'niqu', 'batard',
  'bite', 'couille', 'chatte', 'pd', 'pede', 'tapette', 'negre', 'bougnoul', 'youpin', 'nazi', 'hitler', 'fuck',
  'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'nigg', 'fag', 'retard', 'rape', 'viol', 'sex',
  'porn', 'cul',
];
const banned = (g: string) =>
  g.split(' ').some((w) => BANNED.some((b) => (b.length <= 3 ? w === b : w.startsWith(b))));

let schemaReady: Promise<unknown> | null = null;
const ensureSchema = (db: D1) =>
  (schemaReady ??= db
    .batch(SCHEMA.trim().split('\n').map((q) => db.prepare(q)))
    .catch((e) => {
      schemaReady = null;
      throw e;
    }));

const hits = new Map<string, { n: number; t0: number }>();
async function limited(req: Request): Promise<boolean> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'x';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const k = Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  const h = hits.get(k);
  if (!h || now - h.t0 > RATE.windowMs) {
    hits.set(k, { n: 1, t0: now });
    if (hits.size > 5000) for (const [kk, v] of hits) if (now - v.t0 > RATE.windowMs) hits.delete(kk);
    return false;
  }
  h.n++;
  return h.n > RATE.limit;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null;
const cleanGuess = (g: unknown) =>
  typeof g === 'string'
    ? g.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40)
    : '';

async function postResult(req: Request, db: D1): Promise<Response> {
  if (await limited(req)) return json({ error: 'rate' }, 429);
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'json' }, 400);
  }
  const card = typeof b.card === 'string' && CARD_RE.test(b.card) ? b.card : null;
  const won = typeof b.won === 'boolean' ? b.won : null;
  const tries = int(b.tries, 1, 5);
  const score = int(b.score, 0, 100);
  const ms = int(b.ms, 0, 3_600_000);
  if (!card || won === null || tries === null || score === null || ms === null) return json({ error: 'invalid' }, 400);
  const wrongs = [...new Set((Array.isArray(b.wrongs) ? b.wrongs.slice(0, 5) : []).map(cleanGuess).filter((g) => g.length >= 2))];
  await ensureSchema(db);
  await db.batch([
    db
      .prepare('INSERT INTO results (card, won, tries, score, ms, created) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(card, won ? 1 : 0, tries, won ? score : 0, ms, Date.now()),
    ...wrongs.map((g) =>
      db.prepare('INSERT INTO wrongs (card, guess, n) VALUES (?, ?, 1) ON CONFLICT (card, guess) DO UPDATE SET n = n + 1').bind(card, g),
    ),
  ]);
  return json({ ok: true });
}

async function getStats(url: URL, db: D1): Promise<Response> {
  const card = url.searchParams.get('card') ?? '';
  if (!CARD_RE.test(card)) return json({ error: 'invalid' }, 400);
  await ensureSchema(db);
  const day = card.slice(0, card.indexOf('.'));
  const [agg, dist, scores, wrong, today] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n, SUM(won) AS wins, AVG(CASE WHEN won = 1 THEN tries END) AS avg FROM results WHERE card = ?').bind(card).first<{ n: number; wins: number | null; avg: number | null }>(),
    db.prepare('SELECT tries, won, COUNT(*) AS c FROM results WHERE card = ? GROUP BY tries, won').bind(card).all<{ tries: number; won: number; c: number }>(),
    db.prepare('SELECT score, COUNT(*) AS c FROM results WHERE card = ? AND won = 1 GROUP BY score').bind(card).all<{ score: number; c: number }>(),
    db.prepare('SELECT guess, n FROM wrongs WHERE card = ? AND n >= ? ORDER BY n DESC LIMIT 10').bind(card, MIN_WRONG).all<{ guess: string; n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM results WHERE card = ?').bind(`${day}.0`).first<{ n: number }>(),
  ]);
  const n = agg?.n ?? 0;
  const base = { n, today: today?.n ?? 0 };
  if (n < MIN_PLAYERS) return json(base, 200, { 'cache-control': 'public, max-age=60' });
  // répartition : index 0 à 4 = trouvé en 1 à 5 essais, index 5 = raté
  const d = [0, 0, 0, 0, 0, 0];
  for (const r of dist.results) d[r.won ? Math.min(4, Math.max(0, r.tries - 1)) : 5] += r.c;
  // scores des parties gagnées, par valeur (0 à 100) : le joueur calcule sa place lui-même
  const s = new Array<number>(101).fill(0);
  for (const r of scores.results) s[Math.min(100, Math.max(0, r.score))] += r.c;
  const top = wrong.results.find((w) => !banned(w.guess));
  return json(
    { ...base, wins: agg?.wins ?? 0, avg: agg?.avg ?? null, dist: d, scores: s, wrong: top?.guess ?? null },
    200,
    { 'cache-control': 'public, max-age=60' },
  );
}

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (!env.DB) return json({ error: 'stats off' }, 503);
    try {
      if (url.pathname === '/api/result' && req.method === 'POST') return await postResult(req, env.DB);
      if (url.pathname === '/api/stats' && req.method === 'GET') {
        const cache = caches.default;
        const key = new Request(url.toString(), { method: 'GET' });
        const hit = await cache.match(key);
        if (hit) return hit;
        const res = await getStats(url, env.DB);
        if (res.ok) ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: 'server' }, 500);
    }
  },
};
