// Owns everything about what is playing: which song is in the player, which song's Play
// was just pressed, and moving through the list. The Player owns the embed itself.
export class Playback {
  // getSongs(): songs in list order; request(t): Promise<match> (queue, urgent);
  // onChange(): re-render; onNotFound(t): tell the person to use Choose.
  constructor({ player, getSongs, getMatch, request, onChange = () => {}, onNotFound = () => {} }) {
    Object.assign(this, { player, getSongs, getMatch, request, onChange, onNotFound });
    this.key = null;      // song loaded in the player
    this.wantKey = null;  // song whose Play was pressed and isn't loaded yet
  }

  get status() {
    return this.player.state.status;
  }

  get playlistLoaded() {
    return this.player.state.type === 'playlist' && !!this.player.state.trackId;
  }

  // What the playlist's Play control shows.
  playlistState() {
    if (!this.playlistLoaded) return { label: 'Play', disabled: false };
    switch (this.status) {
      case 'loading': return { label: 'Starting…', disabled: true };
      case 'playing': return { label: 'Pause', disabled: false };
      case 'paused': return { label: 'Resume', disabled: false };
      default: return { label: 'Play', disabled: false };
    }
  }

  // A click on the playlist's Play control. Rows show Play while a playlist is loaded.
  clickPlaylist(pl) {
    if (this.playlistLoaded && this.player.state.trackId === pl.id) {
      if (this.status === 'playing') return this.player.pause();
      if (this.status !== 'loading') return this.player.resume();
      return undefined;
    }
    this.key = null;
    this.wantKey = null;
    this.onChange();
    return this.player.play(pl.id, 'playlist').finally(() => this.onChange());
  }

  // What a row's button shows.
  rowState(t) {
    if (this.wantKey === t.key) return { label: 'Starting…', on: false, disabled: true };
    if (this.key !== t.key) return { label: 'Play', on: false, disabled: false };
    switch (this.status) {
      case 'loading': return { label: 'Starting…', on: false, disabled: true };
      case 'playing': return { label: 'Playing', on: true, disabled: false };
      case 'paused': return { label: 'Paused', on: false, disabled: false };
      default: return { label: 'Play', on: false, disabled: false }; // ended, blocked, error
    }
  }

  // A click on a row's button.
  click(t) {
    if (this.key === t.key && !this.wantKey) {
      if (this.status === 'playing') return this.player.pause();
      if (this.status !== 'loading') return this.player.resume();
      return undefined;
    }
    return this.playSong(t);
  }

  // Resolves to the player's status, or 'none' if the song isn't on Spotify,
  // or 'superseded' if another song was pressed meanwhile.
  // startAt (seconds): continue from there, e.g. when the song moves to another window.
  async playSong(t, { startAt = 0 } = {}) {
    this.wantKey = t.key;
    this.onChange();
    let m;
    try {
      m = await this.request(t);
    } catch (err) {
      if (this.wantKey === t.key) this.wantKey = null;
      this.onChange();
      throw err;
    }
    if (this.wantKey !== t.key) return 'superseded';
    if (!m || m.status !== 'matched') {
      this.wantKey = null;
      this.onChange();
      this.onNotFound(t);
      return 'none';
    }
    this.key = t.key;
    this.wantKey = null;
    this.onChange();
    const status = await this.player.play(m.id, 'track', { startAt });
    this.onChange();
    return status;
  }

  // Next/previous in list order, skipping songs known not to be on Spotify.
  step(dir) {
    const songs = this.getSongs();
    let i = songs.findIndex((t) => t.key === this.key);
    if (i < 0) return undefined;
    for (i += dir; i >= 0 && i < songs.length; i += dir) {
      const m = this.getMatch(songs[i]);
      if (!m || m.status === 'matched') return this.playSong(songs[i]);
    }
    return undefined;
  }

  // Position of the current song, for the dock.
  position() {
    const songs = this.getSongs();
    const i = songs.findIndex((t) => t.key === this.key);
    return { i, n: songs.length };
  }

  stop() {
    this.key = null;
    this.wantKey = null;
    this.player.stop();
    this.onChange();
  }
}
