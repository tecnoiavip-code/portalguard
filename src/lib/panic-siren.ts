// Sirene contínua de coação para a guarita (Web Audio API)
let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const beep = () => {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(700, now);
    osc.frequency.linearRampToValueAtTime(1400, now + 0.4);
    osc.frequency.linearRampToValueAtTime(700, now + 0.8);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.setValueAtTime(0.25, now + 0.75);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.85);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.9);
  } catch (e) {
    console.warn('Siren unavailable', e);
  }
};

export const startPanicSiren = () => {
  if (timer) return;
  beep();
  timer = setInterval(beep, 1000);
};

export const stopPanicSiren = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
