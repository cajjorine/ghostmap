/**
 * Textes du jeu en français et en anglais. Le choix est mémorisé ; par défaut, la langue du navigateur.
 * Le modal de fin et la barre du haut appartiennent au socle commun et restent en français.
 */
import { load, save } from '../engine/storage';

export type Lang = 'fr' | 'en';

const fr = {
  globe: 'Globe terrestre : glisse pour le faire tourner, pince ou molette pour zoomer',
  soundOff: 'Couper le son',
  soundOn: 'Activer le son',
  chip: 'pays allumés repérés',
  drag: 'Fais tourner la Terre',
  panel: 'Partie du jour',
  placeholder: 'Ces pays ont en commun…',
  input: 'Ta réponse',
  submit: 'Deviner',
  tried: 'Réponses déjà proposées',
  langGroup: 'Langue',
  card: 'Carte {n}/{total}',
  tries: 'Essai {n} sur {max}',
  first: '<b>Essai 1 : la carte seule.</b> Qu’ont en commun tous les pays allumés ?',
  hint: 'Indice {n}',
  headFirst: 'Du premier coup !',
  headWon: 'Trouvé en {n} essais',
  headLost: 'Raté pour cette carte',
  next: 'Carte suivante ({n}/{total})',
  dayDone: 'Journée terminée : {w}/{total} cartes trouvées',
  stats: 'Statistiques et partage',
  allSeen: 'Les {n} lumières sont repérées. À toi de deviner !',
  already: 'Déjà proposé.',
  notCounted: '(essai non décompté)',
  newHint: 'Nouvel indice débloqué.',
  bravo: 'Bravo !',
  hot: 'Brûlant ! Précise un peu.',
  near: 'Tu chauffes…',
  wrong: 'Raté.|Non, pas ça.|Froid.|Ce n’est pas ça.|Toujours pas.',
  summary: 'Réponses : {list}',
  scTries: 'Essais',
  scExplore: 'Exploration',
  scSpeed: 'Rapidité',
  scTotal: 'Total : {n}/{max}',
  dayTotal: 'Journée : {n}/{max}',
  best: 'Record : {n}/{max}',
  less: 'moins',
  more: 'plus',
  ranking: 'Classement',
  source: 'Source : {s}',
  noGlTitle: 'Le globe 3D ne peut pas s’afficher.',
  noGlBrowser: 'Ton navigateur ne gère pas WebGL. Essaie avec Chrome, Safari ou Firefox à jour.',
  noGlError: 'Une erreur est survenue en préparant la 3D.',
  noGlLoad: 'Impossible de charger la carte. Recharge la page.',
};

type Key = keyof typeof fr;

const en: Record<Key, string> = {
  globe: 'Globe: drag to spin it, pinch or scroll to zoom',
  soundOff: 'Mute',
  soundOn: 'Unmute',
  chip: 'lit countries spotted',
  drag: 'Spin the Earth',
  panel: 'Today’s game',
  placeholder: 'These countries all…',
  input: 'Your answer',
  submit: 'Guess',
  tried: 'Answers already tried',
  langGroup: 'Language',
  card: 'Map {n}/{total}',
  tries: 'Guess {n} of {max}',
  first: '<b>Guess 1: just the map.</b> What do all the lit countries have in common?',
  hint: 'Hint {n}',
  headFirst: 'First try!',
  headWon: 'Solved in {n} guesses',
  headLost: 'Missed this one',
  next: 'Next map ({n}/{total})',
  dayDone: 'Day complete: {w}/{total} maps solved',
  stats: 'Stats and sharing',
  allSeen: 'All {n} lights spotted. Your turn to guess!',
  already: 'Already tried.',
  notCounted: '(this guess doesn’t count)',
  newHint: 'New hint unlocked.',
  bravo: 'Well done!',
  hot: 'Red hot! Be a bit more specific.',
  near: 'Getting warmer…',
  wrong: 'Nope.|Not that.|Cold.|That’s not it.|Still no.',
  summary: 'Answers: {list}',
  scTries: 'Guesses',
  scExplore: 'Exploration',
  scSpeed: 'Speed',
  scTotal: 'Total: {n}/{max}',
  dayTotal: 'Today: {n}/{max}',
  best: 'Best: {n}/{max}',
  less: 'less',
  more: 'more',
  ranking: 'Ranking',
  source: 'Source: {s}',
  noGlTitle: 'The 3D globe can’t be displayed.',
  noGlBrowser: 'Your browser doesn’t support WebGL. Try an up-to-date Chrome, Safari or Firefox.',
  noGlError: 'Something went wrong while setting up 3D.',
  noGlLoad: 'Couldn’t load the map. Please reload the page.',
};

const DICT: Record<Lang, Record<Key, string>> = { fr, en };

let lang: Lang = load<Lang | null>('lang', null) ?? (navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en');
if (lang !== 'fr' && lang !== 'en') lang = 'fr';

export const getLang = (): Lang => lang;

export function setLang(l: Lang): void {
  lang = l;
  save('lang', l);
  document.documentElement.lang = l;
}
document.documentElement.lang = lang;

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  return DICT[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Messages d'erreur, à faire tourner. */
export const wrongMsg = (nth: number): string => {
  const list = t('wrong').split('|');
  return list[nth % list.length];
};
