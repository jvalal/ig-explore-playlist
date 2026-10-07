// player.js against message sequences copied from the real embed in real Chrome
// (tools/embed-probe/logs/2026-10-05-real-chrome-sidepanel.json). Unlike the browser tests,
// this controls e.source, so it can replay what real Chrome did: a stale update from the
// previous document that still passes the e.source check.
import { EXT_DIR } from '../ext-dir.mjs';
import { suite, tick } from '../check.mjs';

const { check, done } = suite();
const ORIGIN = 'https://open.spotify.com';

let handler = null;
globalThis.window = { addEventListener: (type, f) => { if (type === 'message') handler = f; } };
const { Player } = await import(EXT_DIR + 'player.js');

function setup() {
  const sent = [];
  const contentWindow = { postMessage: (data, origin) => sent.push({ ...data, origin }) };
  const frame = { contentWindow, src: '' };
  const ended = [];
  const player = new Player(frame, { onEnded: () => ended.push(Date.now()) });
  const deliver = (data, { source = contentWindow, origin = ORIGIN } = {}) => handler({ data, source, origin });
  const upd = (id, isPaused, position, duration = 213560) =>
    deliver({ type: 'playback_update', payload: { isPaused, isBuffering: false, duration, position, playingURI: id ? `spotify:track:${id}` : '' } });
  return { player, frame, sent, ended, deliver, upd };
}

// 1. Normal start: ready, resume, placeholder, real updates.
{
  const { player, sent, deliver, upd } = setup();
  const p = player.play('A');
  await tick(5);
  check('no command before ready', sent.length === 0, JSON.stringify(sent));
  deliver({ type: 'ready' });
  await tick(5);
  check('after ready: exactly one resume, to the Spotify origin', sent.length === 1 && sent[0].command === 'resume' && sent[0].origin === ORIGIN, JSON.stringify(sent));
  upd('', false, 0, 0); // placeholder seen in the logs
  check('placeholder update (empty playingURI) is not taken as playing', player.state.status === 'paused');
  upd('A', false, 0);
  check('play() resolves "playing" once the embed reports it', (await p) === 'playing');
}

// 2. Real Chrome, step 5 of the probe run: the iframe reloaded and the OLD document's update
//    arrived 248 ms later, before the new document's ready, passing the e.source check.
{
  const { player, sent, deliver, upd } = setup();
  const first = player.play('B');
  deliver({ type: 'ready' }); await tick(5); upd('B', false, 1000);
  await first;
  player.stop(); // about:blank; the next play of the same song reloads it
  const again = player.play('B');
  await tick(5);
  upd('B', false, 38775); // stale: same song, still "playing", from the outgoing document
  check('stale update before ready is ignored (same song)', player.state.status === 'loading', player.state.status);
  deliver({ type: 'ready' });
  await tick(5);
  check('the new document still gets its resume', sent.filter((s) => s.command === 'resume').length === 2, JSON.stringify(sent));
  upd('B', false, 0);
  check('and plays', (await again) === 'playing');
}

// 3. Switching songs: an update for the previous song after the new ready is ignored.
{
  const { player, deliver, upd } = setup();
  const a = player.play('A'); deliver({ type: 'ready' }); await tick(5); upd('A', false, 5000); await a;
  const b = player.play('B'); deliver({ type: 'ready' }); await tick(5);
  upd('A', false, 5250);
  check('update naming another song is ignored', player.state.status === 'paused', player.state.status);
  upd('B', false, 0);
  check('the new song plays', (await b) === 'playing');
}

// 4. Pause: real Chrome sends one trailing isPaused:false, then isPaused:true.
{
  const { player, sent, deliver, upd } = setup();
  const a = player.play('A'); deliver({ type: 'ready' }); await tick(5); upd('A', false, 14000); await a;
  player.pause();
  check('pause sends "pause"', sent[sent.length - 1].command === 'pause');
  upd('A', false, 14031);
  upd('A', true, 14031); upd('A', true, 14031); upd('A', true, 14031);
  check('ends up paused', player.state.status === 'paused');
  player.pause();
  check('pause while paused sends nothing', sent.filter((s) => s.command === 'pause').length === 1);
  const r = player.resume();
  await tick(5);
  check('resume sends "resume"', sent[sent.length - 1].command === 'resume');
  upd('A', false, 14031);
  check('resumed', (await r) === 'playing');
  check('never sends toggle or play', sent.every((s) => s.command === 'resume' || s.command === 'pause'), JSON.stringify(sent));
}

// 5. Full-track end, exactly as logged: last update at duration (still "playing"),
//    then paused at position 0 with a slightly different duration.
{
  const { player, ended, deliver, upd } = setup();
  const a = player.play('B'); deliver({ type: 'ready' }); await tick(5); upd('B', false, 213000); await a;
  upd('B', false, 213560, 213560);
  upd('B', true, 0, 213560); upd('B', true, 0, 213607); upd('B', true, 0, 213607);
  check('full end: onEnded fires once', ended.length === 1, String(ended.length));
  check('full end: status ended', player.state.status === 'ended');
}

// 6. Preview end (logged out, headless log): last update at duration, then silence.
{
  const { player, ended, deliver, upd } = setup();
  const a = player.play('C'); deliver({ type: 'ready' }); await tick(5); upd('C', false, 29000, 29713); await a;
  upd('C', false, 29713, 29713);
  await tick(2700);
  check('preview end: onEnded fires after the reports stop', ended.length === 1, String(ended.length));
}

// 7. A pause near the end is not an end.
{
  const { player, ended, deliver, upd } = setup();
  const a = player.play('D'); deliver({ type: 'ready' }); await tick(5); upd('D', false, 212500); await a;
  upd('D', true, 212600);
  check('pause in the last 2 s is a pause, not an end', player.state.status === 'paused' && ended.length === 0);
}

// 8. Started by the person inside the player (probe step 1): no command from us, still tracked.
{
  const { player, deliver, upd } = setup();
  player.play('A').catch(() => {});
  deliver({ type: 'ready' }); await tick(5);
  upd('A', false, 0);
  check('playing reported from the embed is reflected', player.state.status === 'playing');
}

// 9. Messages from other origins or frames are ignored.
{
  const { player, deliver, upd } = setup();
  player.play('A').catch(() => {});
  deliver({ type: 'ready' }, { origin: 'https://evil.example' });
  check('ready from another origin is ignored', player.state.status === 'loading');
  deliver({ type: 'ready' }, { source: {} });
  check('ready from another frame is ignored', player.state.status === 'loading');
  deliver({ type: 'ready' }); await tick(5);
  upd('A', false, 0);
}

// 9b. Playlist embed (headless log): reports the playing track's URI, advances by itself.
{
  const { player, sent, ended, deliver, upd } = setup();
  const p = player.play('PL1', 'playlist');
  deliver({ type: 'ready' }); await tick(5);
  check('playlist: resume after ready', sent.length === 1 && sent[0].command === 'resume');
  upd('trackA', false, 0, 20878);
  check('playlist: a track URI counts as playing', (await p) === 'playing');
  upd('trackA', false, 20878, 20878);
  upd('trackB', false, 0, 26662);
  await tick(2700);
  check('playlist: moving to the next track is not an "end" for us', ended.length === 0 && player.state.status === 'playing',
    `${ended.length} ${player.state.status}`);
  check('playlist: knows which track is playing', player.state.nowPlaying === 'spotify:track:trackB');
  const t = player.play('trackC');
  deliver({ type: 'ready' }); await tick(5);
  upd('trackB', false, 500, 26662);
  check('after switching to a song, playlist tracks are ignored', player.state.status === 'paused' && player.state.type === 'track');
  upd('trackC', false, 0);
  await t;
}

// 9c. Carrying a song to another window: load it at a position (embed URL parameter t).
{
  const { player, frame, deliver, upd } = setup();
  const p = player.play('A', 'track', { startAt: 83.7 });
  check('startAt loads the embed with t=<whole seconds>', /[?&]t=83(&|$)/.test(frame.src), frame.src);
  deliver({ type: 'ready' }); await tick(5);
  upd('A', false, 83000);
  await p;
  const before = player.currentSeconds();
  await tick(300);
  check('currentSeconds() runs on between the embed\'s reports while playing', player.currentSeconds() > before + 0.2, `${before} -> ${player.currentSeconds()}`);
  upd('A', true, 84000);
  const paused = player.currentSeconds();
  await tick(200);
  check('...and stands still while paused', player.currentSeconds() === paused && paused === 84);
  const p2 = setup();
  p2.player.play('B');
  check('no startAt: no t parameter (starts at 0:00)', !/[?&]t=/.test(p2.frame.src), p2.frame.src);
}

// 10. If nothing happens after resume, the status says so (slow: waits for the timeout).
{
  const { player, deliver } = setup();
  const p = player.play('E');
  deliver({ type: 'ready' });
  check('no response to resume: status "blocked"', (await p) === 'blocked');
}

done();
