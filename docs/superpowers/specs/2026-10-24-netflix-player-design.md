# MK Cinema: a Netflix-style full-screen player (design, 2026-10-24)

## Intent
The owner, on his iPhone (home-screen web app), said: "the full screen isn't full like the Netflix player; we need a full-screen player for phone, just like the Netflix movie player." His screenshots show two problems:
1. The in-app player (`main.player`, `app.js` ~line 556) shows the film in a box: a header with back and title on top, margins around the video, the seek bar and buttons below it.
2. The full-screen button calls `video.webkitEnterFullscreen()` on iPhone, which opens Apple's own player: a 16:9 film then sits tiny in the middle of a portrait screen with black above and below.

He wants what Netflix does: the film fills the whole screen, controls float over it and fade away, and a landscape film plays sideways, filling the phone.

## Goals
1. **Immersive by default on the phone**: opening a film shows only the film, edge to edge, black around it, under the notch and home indicator (`viewport-fit=cover` and `black-translucent` are already set). No page header, margins or controls below the video.
2. **Landscape films fill the phone**: a 16:9 cut on a phone held upright turns sideways (the player is rotated 90° with CSS, filling the screen as if the phone were turned), like Netflix forcing landscape. When the phone really is in landscape, nothing is rotated. Where the browser allows it (Android Chrome after `requestFullscreen`), also try `screen.orientation.lock('landscape')`; iPhone Safari cannot lock, so the CSS rotation is the iPhone path.
3. **Fit or Fill**: the film is shown whole (`contain`) by default, so text near the frame's edges (his films have big titles) is never cut. A **Fill** toggle in the controls zooms it to cover the screen (like Netflix's fill button on iPhone); a two-finger pinch out/in does the same. The choice is remembered (the existing `mkc.settings` key) and also appears in Settings → Playback.
4. **Netflix control layout**, over the film:
   - Top: Back on the left, title (brand line + name) next to it, AirPlay (`webkitShowPlaybackTargetPicker`, only when available) and sound on the right.
   - Centre: back 10 s, big play/pause, forward 10 s.
   - Bottom: a scrubber with elapsed and remaining time, then Fit/Fill, the cut switch (Phone / Desktop, only when both exist) and, on desktop, full screen.
   - Controls fade in on tap and fade out 3 s after the last touch while playing; they stay while paused. Double-tap the left or right third to jump 10 s back or forward with a brief "-10"/"+10" ripple. Reduced motion: no fades or ripples, instant show/hide.
5. **The scrubber works in the rotated player**: a custom scrubber driven by pointer events, mapping the touch into the rotated frame (a native range input rotated by CSS is not reliable in iOS Safari). Keyboard: arrows ±10 s, Home/End, a real label and value text.
6. **Desktop**: the same overlay player filling the window (no letterbox chrome); `F` or the button toggles real full screen (`requestFullscreen` on the player), Space plays/pauses, arrows ±10 s, `M` mutes, Esc leaves full screen then the player.
7. **Keep everything that works**: resume and progress saving, the fresh-link retry for expired URLs, the refused-stream download fallback, Save to phone, screen-reader labels and the `role=status` messages, reduced transparency.

## Non-goals
No change to the token, catalog, media host/path checks, poster cache or service-worker rules (bump the shell cache version for changed files). No new dependency. Reels are not touched (they already fill the screen).

## Anti-goals (a failure even if it "works")
- Apple's own player opening by default on iPhone, or a landscape film tiny on a portrait phone.
- Controls that cover the picture while playing and never go away, or that can't be brought back with one tap.
- Text in the film cut off by default.
- Losing iPhone sound or the resume position.

## Constraints
- Plain ES modules and CSS, no build step; Liquid Glass look (frosted capsules, the one main action a white pill, 44 pt targets, visible focus). Fonts and icons as the app already uses.
- Tests: `npm.cmd test`, `node tests/browser.mjs`, `node tests/motion.mjs` all pass. Update checks that assumed the old player. Add checks: at 390x844 the video's box covers the viewport (portrait 9:16 cut); a 16:9 cut on a portrait viewport is rotated and covers it; at 844x390 nothing is rotated; controls hide 3 s after the last touch and come back on one tap; double-tap left/right seeks ∓10 s; the scrubber seeks correctly while rotated; Fit/Fill toggles `object-fit`, is remembered and shows in Settings; desktop F/Space/arrows/M/Esc; resume still works.
- Evidence: screenshots (demo data, `?demo`) of: phone 390x844 with a 9:16 cut, controls shown and hidden; the same with Fill; phone 390x844 with a 16:9 cut (rotated), controls shown; phone 844x390 with a 16:9 cut; desktop 1440x900 with controls. Look at each picture before reporting.

## My calls
Fit by default (his films carry big titles near the edges); the rotation approach for iPhone; 3 s auto-hide; double-tap to seek; AirPlay shown only where Safari offers it.

## Left to the builder
Exact layout, icon drawings, fade timing, how the rotation is structured in CSS/JS, gesture details, test structure.
