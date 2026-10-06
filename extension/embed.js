// In-panel Spotify player built on the Spotify embed.
// The embed accepts commands posted from the page around it ({command: 'toggle'}
// is confirmed by Spotify's embed team) and reports its state back with
// 'ready' and 'playback_update' messages. Chrome only allows it to start with
// sound after a user click in the panel, which is why playback always begins
// from the Play button.

const ORIGIN = 'https://open.spotify.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class EmbedPlayer {
  constructor(frame, { onChange = () => {}, onEnded = () => {} } = {}) {
    this.frame = frame;
    this.onChange = onChange;
    this.onEnded = onEnded;
    this.state = { trackId: null, ready: false, playing: false, position: 0, duration: 0, heard: false };
    this._readyWaiters = [];
    window.addEventListener('message', (e) => this._onMessage(e));
  }

  _set(patch) {
    Object.assign(this.state, patch);
    this.onChange(this.state);
  }

  _onMessage(e) {
    if (e.origin !== ORIGIN || e.source !== this.frame.contentWindow) return;
    let d = e.data;
    if (typeof d === 'string') {
      try { d = JSON.parse(d); } catch (_) { return; }
    }
    if (!d || typeof d !== 'object') return;
    const type = d.type || d.event;
    const p = d.payload || d.data || {};
    if (type === 'ready') {
      this._set({ ready: true });
      this._readyWaiters.splice(0).forEach((f) => f(true));
    } else if (type === 'playback_update' || type === 'playback_started') {
      const wasPlaying = this.state.playing;
      const playing = type === 'playback_started' ? true : p.isPaused === false;
      const position = typeof p.position === 'number' ? p.position : this.state.position;
      const duration = typeof p.duration === 'number' ? p.duration : this.state.duration;
      this._set({ playing, position, duration, heard: true });
      const atEnd = duration > 0 && position >= duration - 1500;
      if (wasPlaying && !playing && atEnd) this.onEnded();
    }
  }

  send(command) {
    if (this.frame.contentWindow) this.frame.contentWindow.postMessage({ command }, ORIGIN);
  }

  _waitReady(ms) {
    if (this.state.ready) return Promise.resolve(true);
    return new Promise((res) => {
      this._readyWaiters.push(res);
      setTimeout(() => res(false), ms);
    });
  }

  async _waitPlaying(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (this.state.playing) return true;
      await sleep(100);
    }
    return this.state.playing;
  }

  // Loads the track (if it isn't already loaded) and starts it.
  // Resolves true when the embed reports it is playing.
  async play(id, type = 'track') {
    const trackId = `${type}:${id}`;
    if (this.state.trackId !== trackId) {
      this._set({ trackId, ready: false, playing: false, position: 0, duration: 0, heard: false });
      const loaded = new Promise((r) => this.frame.addEventListener('load', r, { once: true }));
      this.frame.src = `${ORIGIN}/embed/${type}/${encodeURIComponent(id)}?utm_source=generator`;
      await loaded;
      if (!(await this._waitReady(4000))) await sleep(800); // older embeds may not announce 'ready'
    }
    if (this.state.playing) return true;
    this.send('toggle');
    return this._waitPlaying(3000);
  }

  pause() {
    if (this.state.playing) this.send('toggle');
  }

  resume() {
    if (!this.state.playing) this.send('toggle');
  }

  stop() {
    this.frame.src = 'about:blank';
    this._set({ trackId: null, ready: false, playing: false, position: 0, duration: 0, heard: false });
  }
}
