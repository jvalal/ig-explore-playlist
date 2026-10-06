// One queue for every Spotify search, so background matching, Play and Build never race
// each other or match the same song twice. Requests from a click jump the queue.
import { MATCHER_VERSION } from './spotify.js';

// Unmatched, or given up on by an older matcher.
export const needsMatch = (m) => !m || (m.status === 'none' && (m.v || 1) < MATCHER_VERSION);

export class MatchQueue {
  constructor({ getMatch, setMatch, match, onChange = () => {}, onError = () => {}, pause = 600 }) {
    Object.assign(this, { getMatch, setMatch, match, onChange, onError, pause });
    this.jobs = [];            // waiting jobs, in order
    this.byKey = new Map();    // key -> job (waiting or running)
    this.running = false;
  }

  // Songs a person is waiting on (shown as "Finding on Spotify…").
  isFinding(key) {
    const j = this.byKey.get(key);
    return !!(j && j.visible);
  }

  // Resolves with the song's match (cached if it has one).
  request(track, { urgent = false } = {}) {
    const have = this.getMatch(track.key);
    if (!needsMatch(have)) return Promise.resolve(have);
    let job = this.byKey.get(track.key);
    if (!job) {
      job = { track, waiters: [], visible: false, background: false };
      this.byKey.set(track.key, job);
      this.jobs.push(job);
    }
    if (urgent && !job.running) {
      this.jobs.splice(this.jobs.indexOf(job), 1);
      this.jobs.unshift(job);
    }
    job.visible = true;
    job.background = false;
    const p = new Promise((resolve, reject) => job.waiters.push({ resolve, reject }));
    this.onChange();
    this._run();
    return p;
  }

  // Quietly match songs nobody has asked for yet (newest first).
  background(tracks) {
    let added = false;
    for (const t of tracks) {
      if (this.byKey.has(t.key) || !needsMatch(this.getMatch(t.key))) continue;
      const job = { track: t, waiters: [], visible: false, background: true };
      this.byKey.set(t.key, job);
      this.jobs.push(job);
      added = true;
    }
    if (added) this._run();
  }

  // Drops everything not yet started (e.g. after Clear or Disconnect).
  cancelAll(reason = new Error('Cancelled.')) {
    for (const j of this.jobs) {
      this.byKey.delete(j.track.key);
      j.waiters.forEach((w) => w.reject(reason));
    }
    this.jobs = [];
    this.onChange();
  }

  async _run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift();
        job.running = true;
        try {
          const m = await this.match(job.track);
          await this.setMatch(job.track.key, m);
          job.waiters.forEach((w) => w.resolve(m));
        } catch (err) {
          job.waiters.forEach((w) => w.reject(err));
          if (job.background) {
            // Don't hammer the API; background work resumes on the next capture.
            this.onError(err);
            for (const j of this.jobs.filter((x) => x.background)) this.byKey.delete(j.track.key);
            this.jobs = this.jobs.filter((x) => !x.background);
          }
        } finally {
          this.byKey.delete(job.track.key);
          this.onChange();
        }
        if (job.background && this.jobs.length && this.pause) await new Promise((r) => setTimeout(r, this.pause));
      }
    } finally {
      this.running = false;
    }
  }
}
