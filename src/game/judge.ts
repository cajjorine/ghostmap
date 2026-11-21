/**
 * Arbitrage des réponses par mots-clés (sans IA).
 * Règle : `+` = « et », `/` = « ou », `sauf` = mots interdits.
 * Un mot de 3 lettres ou moins doit apparaître tel quel ; au-delà, il suffit qu'un mot commence pareil.
 */

/** Minuscules, sans accents, ponctuation remplacée par des espaces (les mots restent séparés). */
export const norm = (s: string): string =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

type Test = (normalized: string) => boolean;

const termRe = (t: string) =>
  new RegExp('(^| )' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (t.length <= 3 ? '($| )' : ''));

export function compileRule(src: string): Test | null {
  const [pos, neg = ''] = String(src).split(/\bsauf\b/i);
  const groups = pos
    .split('+')
    .map((g) => g.split('/').map(norm).filter(Boolean).map(termRe))
    .filter((g) => g.length);
  const nots = neg.split(/[/+,]/).map(norm).filter(Boolean).map(termRe);
  if (!groups.length) return null;
  return (n) => groups.every((g) => g.some((r) => r.test(n))) && !nots.some((r) => r.test(n));
}

export interface NearRule {
  rule: string;
  msg: string;
  /** Brûlant : l'essai n'est pas décompté. */
  hot?: boolean;
}

/** Messages vides : game.ts met un message par défaut dans la langue choisie. */
export type Verdict =
  | { k: 'empty' }
  | { k: 'right' }
  | { k: 'hot'; msg: string }
  | { k: 'near'; msg: string }
  | { k: 'wrong' };

export type Judge = (guess: string) => Verdict;

export function makeJudge(answers: string[], near: NearRule[]): Judge {
  const right = answers.map(compileRule).filter((t): t is Test => t !== null);
  const close = near
    .map((x) => ({ ...x, test: compileRule(x.rule) }))
    .filter((x): x is NearRule & { test: Test } => x.test !== null);
  return (guess) => {
    const n = norm(guess);
    if (n.length < 2) return { k: 'empty' };
    if (right.some((t) => t(n))) return { k: 'right' };
    const hit = close.find((x) => x.test(n));
    if (hit) return { k: hit.hot ? 'hot' : 'near', msg: hit.msg };
    return { k: 'wrong' };
  };
}
