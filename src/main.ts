import './styles/main.css';
import { CONFIG } from './config';
import { getDaily } from './engine/puzzle';
import { getStats, recordResult } from './engine/stats';
import { load, save } from './engine/storage';
import type { DaySave, GameResult } from './engine/types';
import { game, type Puzzle, type State } from './game/game';
import { reloadOnNewDay } from './ui/countdown';
import { renderEndView } from './ui/end-view';
import { createModal } from './ui/modal';
import { toast } from './ui/toast';

const daily = getDaily<Puzzle>();
const { dateKey, dayNumber } = daily;

document.title = CONFIG.title;
document.querySelector('[data-title]')!.textContent = CONFIG.title;
document.querySelector('[data-day]')!.textContent = `#${dayNumber}`;

const rules = createModal('rules-modal');
const end = createModal('end-modal');

// Day save: dropped if it belongs to another day.
const stored = load<DaySave<State> | null>('day', null);
let day: DaySave<State> =
  stored && stored.dateKey === dateKey ? stored : { dateKey, status: 'playing', state: null, result: null };

const openEnd = () => {
  renderEndView(end.body, { stats: getStats(dateKey), result: day.result, dayNumber, dateKey });
  end.open();
};

document.querySelector('[data-open="rules"]')!.addEventListener('click', () => rules.open());
document.querySelector('[data-open="stats"]')!.addEventListener('click', openEnd);

game.mount(
  document.getElementById('game')!,
  { puzzle: daily.puzzle, dayNumber, dateKey, saved: day.state, status: day.status, result: day.result },
  {
    save(state) {
      day = { ...day, state };
      save('day', day);
    },
    finish(result: GameResult) {
      if (day.status !== 'playing') return;
      day = { ...day, status: result.won ? 'won' : 'lost', result };
      save('day', day);
      recordResult(dateKey, result);
      window.setTimeout(openEnd, 900);
    },
    toast,
  },
);

if (!load<boolean>('seenRules', false)) {
  rules.open();
  save('seenRules', true);
} else if (day.status !== 'playing') {
  openEnd();
}

reloadOnNewDay(dateKey);
