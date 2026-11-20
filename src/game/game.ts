/**
 * EXAMPLE GAME: « 5 indices » (guess the country from progressive clues).
 * This is the only business-logic file to rewrite for each new game.
 * Contract: GameModule in src/engine/types.ts and the daily-game-conventions skill.
 */
import { CONFIG } from '../config';
import type { GameContext, GameModule, GameResult } from '../engine/types';

export interface Puzzle {
  answer: string;
  aliases?: string[];
  clues: string[];
}

export interface State {
  /** Guesses in order; '' = clue skipped. */
  guesses: string[];
}

/** Lowercase, no accents, no punctuation, no spaces. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const game: GameModule<Puzzle, State> = {
  mount(root, ctx: GameContext<Puzzle, State>, api) {
    const { puzzle } = ctx;
    const max = Math.min(CONFIG.maxAttempts, puzzle.clues.length);
    const accepted = new Set([puzzle.answer, ...(puzzle.aliases ?? [])].map(normalize));
    let state: State = ctx.saved ?? { guesses: [] };
    let status = ctx.status;

    const isCorrect = (g: string) => g !== '' && accepted.has(normalize(g));

    const buildResult = (won: boolean): GameResult => {
      const used = state.guesses.length;
      const cells = Array.from({ length: max }, (_, i) =>
        i < used ? (won && i === used - 1 ? '🟩' : '🟥') : '⬜',
      );
      return {
        won,
        attempts: used,
        maxAttempts: max,
        grid: cells.join(''),
        summary: `La réponse était : ${puzzle.answer}`,
      };
    };

    const submit = (raw: string) => {
      if (status !== 'playing') return;
      const guess = raw.trim();
      if (guess && state.guesses.some((g) => g && normalize(g) === normalize(guess))) {
        api.toast('Déjà proposé');
        return;
      }
      state = { guesses: [...state.guesses, guess] };
      api.save(state);
      if (isCorrect(guess)) {
        status = 'won';
        api.finish(buildResult(true));
      } else if (state.guesses.length >= max) {
        status = 'lost';
        api.finish(buildResult(false));
      } else if (guess) {
        api.toast('Raté, nouvel indice !');
      }
      render();
    };

    const render = () => {
      const finished = status !== 'playing';
      const visible = finished ? max : Math.min(max, state.guesses.length + 1);

      const clues = puzzle.clues
        .slice(0, visible)
        .map((c, i) => `<li class="clue"><span class="clue-n">${i + 1}</span><span>${esc(c)}</span></li>`)
        .join('');

      const guesses = state.guesses
        .map((g) => {
          const ok = isCorrect(g);
          return `<li class="guess ${ok ? 'ok' : 'ko'}">${ok ? '✅' : '❌'} ${g ? esc(g) : '<em>passé</em>'}</li>`;
        })
        .join('');

      root.innerHTML = `
        <p class="lead">Quel pays se cache derrière ces indices ?</p>
        <ol class="clues">${clues}</ol>
        ${guesses ? `<ul class="guesses">${guesses}</ul>` : ''}
        ${
          finished
            ? `<p class="answer ${status}">${status === 'won' ? 'Trouvé' : 'Réponse'} : <strong>${esc(puzzle.answer)}</strong></p>`
            : `<form class="guess-form" autocomplete="off">
                 <input name="guess" type="text" inputmode="text" enterkeyhint="send"
                        placeholder="Ta réponse…" aria-label="Ta réponse" autocapitalize="words" required />
                 <div class="row">
                   <button class="btn" type="button" data-skip>Indice suivant</button>
                   <button class="btn primary" type="submit">Valider</button>
                 </div>
                 <p class="attempts">Essai ${state.guesses.length + 1} / ${max}</p>
               </form>`
        }`;

      const form = root.querySelector<HTMLFormElement>('form');
      if (form) {
        const input = form.querySelector<HTMLInputElement>('input')!;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          submit(input.value);
        });
        form.querySelector('[data-skip]')!.addEventListener('click', () => submit(''));
        // No autofocus on touch screens: the virtual keyboard would hide the clues.
        if (!window.matchMedia('(pointer: coarse)').matches) input.focus();
      }
    };

    render();
  },
};
