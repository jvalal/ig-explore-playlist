# Embed probe (temporary)

A tiny separate extension that logs every message between a Chrome side panel and the Spotify
embed. It exists to answer questions only real Chrome can answer: autoplay rules in a side
panel, and how the embed behaves when you're logged in to Spotify. Remove it from Chrome when
we're done. It doesn't touch Explore Finds or its storage.

`logs/` holds the runs. `2026-10-05-headless-logged-out.txt` is the automated headless run.

## Run it

Setup (once):
1. Make sure you're logged in at open.spotify.com in this Chrome profile.
2. Go to `chrome://extensions` → **Load unpacked** → select this folder (`tools/embed-probe`).
3. Click the puzzle-piece icon → **Embed probe (temporary)**. Its side panel opens.
   (Leave Explore Finds installed; nothing needs to change there.)

Two kinds of buttons:
- **Probe buttons:** small gray text buttons ("Load A", "resume", "pause", …) above and below
  the player.
- **Spotify player buttons:** the round play/pause button inside the dark Spotify player.

Only steps 1 and 7 touch the Spotify player. Everything else uses probe buttons. Before each
step, type the step number in **Notes** and press Enter. "Sound yes/no" means: did the song start
without you touching the Spotify player?

1. Probe **Load A** → wait 5 s → round **play button inside the Spotify player** → wait 5 s →
   round **pause button inside the Spotify player** → wait 3 s.
2. Probe **resume** → wait 5 s → probe **resume** again → wait 3 s → probe **pause** → wait 3 s.
3. Probe **Load B + resume on first message** → wait 8 s → type `sound yes` or `sound no`.
4. Probe **pause** → wait 2 s → probe **resume in 8 s (no click)** → hands off for 12 s →
   type `sound yes` or `sound no`.
5. Probe **Load B, resume 8 s later (no click)** → hands off for 12 s → type `sound yes` or
   `sound no`.
6. Probe **Load A + resume on load** → wait 8 s → type `sound yes` or `sound no`.
7. Touch nothing: let the song play to its end, then wait 10 s.
8. Probe **Download full log** → it saves `embed-probe-log-….json` to Downloads.

Skip the probe buttons **toggle**, **play**, **seek 0**, **loadUri B** and **Send custom**; they
were already tested headless.

Then tell me "done" (I can read the newest file in ~/Downloads myself), or click **Copy compact
log** and paste it.

If a song shows "unavailable", paste any Spotify song link (Share → Copy Song Link) into the A or
B box and restart from step 1.
