import { dateKey, msUntilNextDay } from '../engine/date';

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

let interval: number | undefined;

/** Shows the time left until the next puzzle and reloads the page when the day changes. */
export function startCountdown(el: HTMLElement, startedKey: string): void {
  window.clearInterval(interval);
  const tick = () => {
    if (dateKey() !== startedKey) {
      window.location.reload();
      return;
    }
    el.textContent = fmt(msUntilNextDay());
  };
  tick();
  interval = window.setInterval(tick, 1000);
}

/** Also handles a tab left open overnight (mobile resumes from background). */
export function reloadOnNewDay(startedKey: string): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && dateKey() !== startedKey) window.location.reload();
  });
}
