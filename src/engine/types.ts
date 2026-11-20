export type GameStatus = 'playing' | 'won' | 'lost';

export interface GameResult {
  won: boolean;
  /** Attempts used (1-based). On a loss, usually equal to maxAttempts. */
  attempts: number;
  maxAttempts: number;
  /** Shared emoji grid. Must never reveal the answer. */
  grid: string;
  /** Sentence shown in the end modal (not shared). */
  summary?: string;
}

export interface GameContext<P, S> {
  puzzle: P;
  /** 1-based game number (#1 = launch day). */
  dayNumber: number;
  /** Local date YYYY-MM-DD. */
  dateKey: string;
  saved: S | null;
  status: GameStatus;
  result: GameResult | null;
}

export interface GameApi<S> {
  save(state: S): void;
  finish(result: GameResult): void;
  toast(message: string): void;
}

export interface GameModule<P, S> {
  mount(root: HTMLElement, ctx: GameContext<P, S>, api: GameApi<S>): void;
}

export interface DaySave<S> {
  dateKey: string;
  status: GameStatus;
  state: S | null;
  result: GameResult | null;
}
