/** Petits sons synthétisés (Web Audio) et vibration. Le réglage muet est mémorisé via le moteur. */
import { load, save } from '../engine/storage';

let muted = load<boolean>('mute', false);
let actx: AudioContext | null = null;
let gestured = false;

type AudioCtor = typeof AudioContext;
const Ctor = (): AudioCtor | undefined =>
  window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;

['pointerdown', 'keydown'].forEach((e) =>
  addEventListener(e, () => { gestured = true; }, { capture: true }),
);
// Créer un AudioContext coûte ~100 ms : on le fait à un moment creux après le chargement plutôt qu'au premier son,
// qui tombe souvent en plein glisser du globe. Il démarre en pause ; ac() le relance après un geste du joueur.
const idle: (f: () => void) => void =
  'requestIdleCallback' in window ? (f) => requestIdleCallback(f, { timeout: 5000 }) : (f) => setTimeout(f, 3000);
idle(() => {
  try {
    const C = Ctor();
    if (C) actx ??= new C();
  } catch {
    /* pas de son */
  }
});

function ac(): AudioContext | null {
  if (!gestured || muted) return null;
  try {
    const C = Ctor();
    if (!C) return null;
    actx ??= new C();
    if (actx.state === 'suspended') void actx.resume();
  } catch {
    return null;
  }
  return actx;
}

export function tone(f: number, dur = 0.3, type: OscillatorType = 'sine', gain = 0.06, when = 0): void {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
export const ping = (i: number) => {
  const f = 440 * 2 ** (SCALE[i % SCALE.length] / 12);
  tone(f, 0.45, 'sine', 0.05);
  tone(f * 2, 0.2, 'triangle', 0.012);
};
export const chime = () => [0, 4, 7, 12, 16].forEach((s, i) => tone(523.25 * 2 ** (s / 12), 0.7, 'sine', 0.06, i * 0.09));
export const thud = () => {
  tone(150, 0.25, 'sine', 0.09);
  tone(110, 0.3, 'triangle', 0.04, 0.05);
};
export const sadTone = () => {
  tone(220, 0.6, 'sine', 0.06);
  tone(196, 0.8, 'sine', 0.05, 0.25);
};
export const buzz = () => {
  try {
    navigator.vibrate?.(30);
  } catch {
    /* */
  }
};

export const isMuted = () => muted;
export function toggleMute(): boolean {
  muted = !muted;
  save('mute', muted);
  if (!muted) tone(880, 0.2, 'sine', 0.05);
  return muted;
}
