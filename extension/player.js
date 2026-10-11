// In-panel player built on the Spotify embed, driven by the protocol observed in real Chrome
// (CLAUDE.md, "Spotify embed protocol"). Rules:
//   - one iframe; a song change reloads it (the embed ignores loadUri)
//   - only idempotent commands: 'resume' and 'pause' (never 'toggle'; 'play' restarts at 0:00)
//   - never send a command before this document's 'ready'
//   - state comes only from the embed's own reports, filtered by playingURI
//
// state: { trackId, status, position, duration }
//   status: idle | loading | paused | playing | ended | blocked | error
//     paused  = loaded and not playing (including "loaded, never started")
//     blocked = we asked it to start and it didn't (autoplay refused, or the embed ignored us)
//     error   = the embed never said it was ready
const ORIGIN = 'https://open.spotify.com';
const READY_TIMEOUT_MS = 10_000;
const START_TIMEOUT_MS = 5_000;
// A preview (logged-out) end sends no pause: updates just stop at position == duration.
const END_SILENCE_MS = 2_500;
// A full-track end reports paused at position 0 right after the last update near the end.
const END_WINDOW_MS = 2_000;
// A song carried to another window that starts this far before where it was gets a seek.
const START_SLACK_MS = 3_000;

export class Player {
  // trace(event, details): optional diagnostic log of what the player and the embed did.
  constructor(frame, { onChange = () => {}, onEnded = () => {}, trace = () => {} } = {}) {
    this.frame = frame;
    this.onChange = onChange;
    this.onEnded = onEnded;
    this.trace = (ev, d) => { try { trace(ev, d); } catch (_) {} };
    this.state = { trackId: null, status: 'idle', position: 0, duration: 0 };
    this.gen = 0;          // bumps on every iframe navigation; stale async work checks it
    this.ready = false;    // this document has said 'ready'
    this.lastPos = 0;
    this.endTimer = null;
    this.waiters = new Set();
    // Listen on the window that contains the iframe: the embed posts to its parent, which is not
    // this page's window when the player lives in another document (e.g. a picture-in-picture
    // window opened from the mini player).
    ((frame.ownerDocument && frame.ownerDocument.defaultView) || window).addEventListener('message', (e) => this._onMessage(e));
    // Every document the iframe loads, including any it navigates to by itself.
    if (frame.addEventListener) frame.addEventListener('load', () => this.trace('frame-load', { src: frame.src, ready: this.ready }));
  }

  get uri() {
    return this.state.trackId ? `spotify:track:${this.state.trackId}` : null;
  }

  _set(patch) {
    if (patch.status && patch.status !== this.state.status) this.trace('status', { status: patch.status });
    this.state = { ...this.state, ...patch };
    for (const w of [...this.waiters]) w();
    this.onChange(this.state);
  }

  // Resolves true when pred() holds, false on timeout or when the iframe moves on to another song.
  _until(pred, ms, gen) {
    if (gen !== this.gen) return Promise.resolve(false);
    if (pred()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (v) => { clearTimeout(timer); this.waiters.delete(check); resolve(v); };
      const check = () => {
        if (gen !== this.gen) done(false);
        else if (pred()) done(true);
      };
      const timer = setTimeout(() => done(false), ms);
      this.waiters.add(check);
    });
  }

  _send(command, extra = {}) {
    const w = this.frame.contentWindow;
    this.trace('send', { command, ...extra, ready: this.ready });
    if (w) w.postMessage({ command, ...extra }, ORIGIN);
  }

  _onMessage(e) {
    if (e.origin !== ORIGIN) return;
    const d = e.data;
    if (d && typeof d === 'object' && d.type) {
      const p = d.payload || {};
      this.trace('msg', { type: d.type, fromOurs: e.source === this.frame.contentWindow, ready: this.ready, paused: p.isPaused,
        buffering: p.isBuffering, pos: p.position, dur: p.duration, uri: p.playingURI });
    }
    if (e.source !== this.frame.contentWindow) return;
    if (!d || typeof d !== 'object') return;

    if (d.type === 'ready') {
      if (this.state.status === 'loading' && !this.ready) {
        this.ready = true;
        this._set({ status: 'paused' });
      }
      return;
    }
    // Before 'ready', the iframe can still deliver a last update from the previous document
    // (seen in real Chrome, even when reloading the same song). Ignore it.
    if (!this.ready || d.type !== 'playback_update') return;
    const p = d.payload || {};
    // The first update after a command can be a placeholder with playingURI "" and duration 0.
    if (!p.playingURI || p.playingURI !== this.uri) {
      if (p.playingURI && this.starting) this.wrongDoc = true;
      return;
    }
    const position = Number(p.position) || 0;
    const duration = Number(p.duration) || this.state.duration;
    clearTimeout(this.endTimer);

    this.posAt = Date.now();
    if (p.isPaused === false) {
      // Loaded at a position (startAt) but started earlier: the user saw Keep on top start at
      // 0:00 in their Chrome (logged in), where Chrome first refuses to start the sound. The
      // embed's own `t` didn't hold there; seek once, on the first real start.
      if (this.startAt) {
        const want = this.startAt;
        this.startAt = 0;
        this.trace('first-start', { pos: position, wanted: want * 1000 });
        if (position < want * 1000 - START_SLACK_MS) this._send('seek', { timestamp: want });
      }
      this.lastPos = position;
      this._set({ status: 'playing', position, duration });
      if (duration > 0 && position >= duration - 300) {
        const gen = this.gen;
        this.endTimer = setTimeout(() => { if (gen === this.gen) this._ended(); }, END_SILENCE_MS);
      }
      return;
    }
    const wasNearEnd = duration > 0 && this.lastPos >= duration - END_WINDOW_MS;
    if (position === 0 && wasNearEnd && this.state.status === 'playing') this._ended();
    else if (this.state.status !== 'ended') this._set({ status: 'paused', position, duration });
  }

  _ended() {
    if (this.state.status === 'ended') return;
    this.lastPos = 0;
    this._set({ status: 'ended', position: 0 });
    this.onEnded();
  }

  // startAt (seconds): the embed's own `t` URL parameter, as Spotify's iFrame API uses it.
  // Used to carry a song over to another window without restarting it.
  _load(trackId, startAt = 0) {
    this.gen++;
    this.ready = false;
    this.lastPos = 0;
    clearTimeout(this.endTimer);
    this._set({ trackId, status: 'loading', position: 0, duration: 0 });
    this.startAt = startAt > 0 ? startAt : 0;
    const t = startAt > 0 ? `&t=${Math.floor(startAt)}` : '';
    this.frame.src = `${ORIGIN}/embed/track/${encodeURIComponent(trackId)}?utm_source=generator${t}`;
    this.trace('load', { src: this.frame.src, startAt });
    return this.gen;
  }

  // Loads the song if it isn't the one in the player, then starts it.
  // Resolves to the final status, or 'superseded' if something else took over meanwhile.
  async play(trackId, { startAt = 0 } = {}) {
    const fresh = trackId !== this.state.trackId || ['idle', 'error'].includes(this.state.status);
    const gen = fresh ? this._load(trackId, startAt) : this.gen;

    if (!(await this._until(() => this.ready, READY_TIMEOUT_MS, gen))) {
      if (gen !== this.gen) return 'superseded';
      this._set({ status: 'error' });
      return 'error';
    }
    if (this.state.status === 'playing') return 'playing';

    // Rare: a quick song change can let the previous document's 'ready' through. If the
    // reports then name another song, wait for this document's own 'ready' and ask again.
    for (let attempt = 0; attempt < 2; attempt++) {
      this.starting = true;
      this.wrongDoc = false;
      this._send('resume');
      const ok = await this._until(() => this.state.status === 'playing' || this.wrongDoc, START_TIMEOUT_MS, gen);
      this.starting = false;
      if (gen !== this.gen) return 'superseded';
      if (ok && this.state.status === 'playing') return 'playing';
      if (!this.wrongDoc) break;
      this.ready = false;
      this._set({ status: 'loading' });
      if (!(await this._until(() => this.ready, READY_TIMEOUT_MS, gen))) break;
    }
    if (gen !== this.gen) return 'superseded';
    this._set({ status: this.ready ? 'blocked' : 'error' });
    return this.state.status;
  }

  // Where the song is now, in seconds: the last reported position plus the time since, while
  // playing. For carrying the song over to another window.
  currentSeconds() {
    const { status, position } = this.state;
    if (!['playing', 'paused', 'blocked'].includes(status)) return 0;
    const since = status === 'playing' && this.posAt ? Date.now() - this.posAt : 0;
    return (position + since) / 1000;
  }

  // Starts the loaded song again (from where it paused; after the end, from 0:00).
  resume() {
    if (!this.state.trackId) return Promise.resolve('idle');
    return this.play(this.state.trackId);
  }

  pause() {
    if (this.ready && this.state.status === 'playing') this._send('pause');
  }

  stop() {
    this.gen++;
    this.ready = false;
    this.startAt = 0;
    clearTimeout(this.endTimer);
    this.frame.src = 'about:blank';
    this._set({ trackId: null, status: 'idle', position: 0, duration: 0 });
  }
}
