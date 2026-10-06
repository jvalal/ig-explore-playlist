// Song goal: "18 of 30 songs" with a progress bar while you scroll, and a short chime once
// when the count crosses the goal. Nothing here scrolls or touches Instagram.
import { $ } from './dom.js';

export const GOALS = [0, 10, 20, 30, 50, 100]; // 0 = off
let lastN = null; // count at the previous render; the chime plays only on crossing the goal

export function renderGoal(n, goal) {
  const on = goal > 0;
  const done = on && n >= goal;
  const word = (k) => (k === 1 ? 'song' : 'songs');
  $('#n-song').textContent = on ? `${n} of ${goal} ${word(goal)}${done ? ' · goal reached' : ''}` : `${n} ${word(n)}`;
  $('#goal-bar').hidden = !on;
  $('#goal-bar').classList.toggle('done', done);
  $('#goal-fill').style.width = on ? `${Math.min(100, Math.round((n / goal) * 100))}%` : '0%';
  const sel = $('#goal');
  if (document.activeElement !== sel && sel.value !== String(goal)) sel.value = String(goal);

  const crossed = on && lastN !== null && lastN < goal && n >= goal;
  lastN = n;
  if (crossed) chime();
  return crossed;
}

// Two soft notes. The panel has had a click by the time a goal is set, so Chrome lets it play.
function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [[660, 0], [880, 0.16]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch (_) {}
}
