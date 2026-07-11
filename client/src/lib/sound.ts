// Tiny sound effects synthesized with the Web Audio API — no asset files needed.
let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain = 0.14) {
  const c = ac();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// A pleasant ascending chime for "it's your turn".
export function playTurnChime() {
  tone(523.25, 0, 0.35, "sine"); // C5
  tone(659.25, 0.12, 0.35, "sine"); // E5
  tone(783.99, 0.24, 0.45, "sine"); // G5
}

// A quick clatter for a dice roll.
export function playRoll() {
  for (let i = 0; i < 5; i++) tone(180 + Math.floor(Math.random() * 260), i * 0.05, 0.08, "square", 0.08);
  tone(440, 0.32, 0.25, "triangle", 0.12);
}

// A soft tick for the turn-timer warning.
export function playWarning() {
  tone(392, 0, 0.15, "sawtooth", 0.1);
  tone(392, 0.2, 0.15, "sawtooth", 0.1);
}

// Browsers require a user gesture before audio can start; call this on first click.
export function unlockAudio() {
  const c = ac();
  if (c && c.state === "suspended") void c.resume();
}
