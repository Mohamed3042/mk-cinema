# MK Cinema home rebuild

Local branch: `netflix-home`. Date: 2026-10-23.

## Design and behavior

The owner's brief is the design reference: dark #141414 canvas, MK gold,
slim wordmark bar, scrollable chips, large billboard, and wide film rows.
The billboard is about 62vh on phone and 80vh on desktop. It uses a still
poster, a dark fade, title, facts, blurb, white Play button, and More info.
No preview video is downloaded in the background.

Cards have a 16:9 frame, scroll snap, next-card peek, visible keyboard focus,
and desktop hover controls. Search and chips open a counted grid. Clear
filters restores the home. Empty rows and no-match states are handled.

Details open in a native modal with a large poster, cut and shape choices,
Play, the existing Save to phone flow, date, safe HTTPS release link, and
More like this. Escape closes the sheet and restores focus.

Explicit groups collapse into one title. Newest date wins, then the number
of picture versions, then Desktop, then catalog order. Search and filters
include alternate cuts. No grouping is inferred from titles in the app.
Actual group decisions are recorded only in the private catalog repo.

Continue watching stores only numeric time, duration, and update time under
each original film id. It resumes the selected cut and hides completed films
at 95%. Demo progress is separate. Storage errors do not stop playback.

## Security and compatibility

Only optional catalog-field validation changed in `api.js`. Token headers,
media host/path checks, downloads, private poster caches, and error handling
are unchanged. The service worker has a new shell version and includes the
public catalog helper; it still caches only fixed public shell files.

Old catalogs work without new fields. Existing connect, offline, error,
player, and save states remain. No real title, catalog, image, video, or token
was copied here. Demo films are made up: eight entries, seven grouped titles.
No dependencies were added.

## Checks

- Unit/API checks: `npm.cmd test`: 19/19 pass.
- Browser checks: `npm.cmd run test:browser`: 45/45 pass; isolated local Chrome and demo
  or mock API data, never the owner's browser profile.
- Current result counts and console errors: `shots/results.json`.
- Required captures: `shots/home.png`, `shots/filtered-grid.png`,
  `shots/search.png`, `shots/detail.png`, `shots/player.png` at 390x844.
  Each also has a `-desktop.png` copy at 1440x900.
- The browser suite covers grouping, chips, Arabic search, saved progress,
  both player shapes, seek, expired URLs, save cancel/download/share, API
  errors, offline recovery, reduced motion, focus, and public-shell caching.
- No console or page errors. The ten requested captures were inspected.
  Solid-surface text colors pass AA (the lowest checked ratio is 7.93:1).
  Token and media code outside the catalog validator match the base exactly.

No push, publish, install, or message was made. Real-token access and native
iPhone Save Video/Photos still need device checks. The optional muted hero
preview was omitted; the requested poster billboard is complete.
The complete app folder is under 85 MB, including existing test packages and
all old and new captures. The private repo added only small text files and
Git objects. The 300 MB new-space limit was met.

Skills: `agent-skills:frontend-ui-engineering` and
`agent-skills:browser-testing-with-devtools`.

# Netflix motion

Local branch: `netflix-motion`, cut from `main` (620b81d). Date: 2026-10-23. Nothing was pushed.

The owner said the Netflix-style home "feels dead". This round adds the motion, the tabs, and the autoplay. Colours, type, and the gold accent are unchanged.

## What changed

- **Tabs.** Desktop top bar (Home, New & Hot, Films, Ads, Demos, My List, search, settings): clear over the billboard, solid #141414 within 80 px of scroll, with a gold ink that slides under the active tab. Phone bottom bar (Home, New & Hot, Search, My List) with icons and the iPhone safe-area inset. Tab switches crossfade for 250 ms (a view transition; older Safari gets a fade-in).
- **Billboard.** Poster, then the muted film crossfades in after about 2 s from 10% in. After about 6 s the blurb fades and the title shrinks and drops (1.2 s). A round mute button sits bottom-right; at the end the film fades back to the poster and the button becomes Replay. While nothing plays, the poster drifts slowly.
- **Rows.** Desktop: arrow paddles and page dashes on hover, paging by one view in 750 ms (cubic-bezier(.5,0,.1,1)), "Explore all" sliding out beside the title. Phone: native momentum scroll with snap. Skeleton shimmer until a poster loads.
- **Hover card (desktop).** 400 ms hover, grows 1.5x (left-edge card rightward, right-edge card leftward), muted preview 600 ms later, panel with Play, + My List, More info and NEW / duration / kind / Arabic. Collapses by playing the growth backwards. It lives in `<body>`, so rows never clip it.
- **More info.** Grows out of the clicked card (FLIP with an opening clip) into an 850 px panel over a dimmed, blurred page: autoplaying 16:9 preview, Play, + My List, mute, a versions list styled like episodes, and a More like this grid. Esc, the close button, or the backdrop reverse it. On a phone it is a bottom sheet with a spring that can be pulled down to close.
- **New & Hot.** A vertical feed of full-width films. The film nearest the middle moves only while you scroll, stops about 65 ms after the page stops moving, and rewinds when you scroll back. Title, date, Play, + and info on each; a glass-capsule rail shows where you are.
- **My List** (ids in `mkc.list`, demo `mkc.demo.list`) and Continue watching progress bars that wipe in.
- **Autoplay rules.** One preview at a time besides the billboard, an arbiter in `motion.js`; IntersectionObserver pauses the billboard and the feed offscreen; the sheet holds the billboard and the feed while open; Settings → Autoplay previews (on by default); `prefers-reduced-motion` means posters only, no hover card, no scrubbing, no scaling.

## Security and compatibility

- `api.js` is untouched: same token handling, same media host check. Previews use `getVideoURL` (the player's stream) and `downloadVideo`, never a token in a URL. No packages, CDN, or analytics were added; the CSP is unchanged, so there are no inline styles.
- iPhone: if Safari refuses GitHub's octet-stream films, a preview downloads the whole film (up to 40 MB) and plays it from memory, as the player already does. Larger films stay on the poster. If autoplay is refused (Low Power Mode) the billboard stays a poster and New & Hot steps frames with the scroll.
- `persistPlayback` now saves progress only on the player screen, because library screens now hold preview videos.
- The service worker cache is `mkc-shell-v4` and lists the new files.
- Demo clips: the 3-second test pattern is replaced by 13 made-up 12-second clips (a slow push-in on each film's own poster with a light beam), 2 MB in all. The catalog points at them; `scripts/make-assets.py` regenerates them.

## Checks

- `npm.cmd test`: 31/31 (19 old, 12 new: scroll-film chase, feed mapping, hover-card geometry, preview arbiter, autoplay switch, spring, My List, Films tab).
- `npm.cmd run test:browser`: 45/45 old (now with reduced motion on, so previews cannot disturb the player counters) and 22/22 new in real time: tabs and crossfade, top bar fade, phone bar and safe-area rule, My List (desktop and phone), hover card timing and edges and preview, hover card actions, More info (desktop and phone sheet with touch drag), billboard timeline and offscreen pause, one preview at a time, Settings switch, reduced motion, row paging and Explore all, skeleton and progress bars, New & Hot scroll film (desktop and phone), keyboard and AA contrast, the iPhone download fallback, service worker cache.
- Results: `shots/results.json`, `shots/results-motion.json`. No console or page errors.
- Required captures at 390x844 and 1440x900: `home`, `new-and-hot`, `my-list`, `modal` (the phone sheet), plus `bob-card-desktop` (the hover card has no phone version).
- Motion proof: `npm.cmd run shots:motion` records a scripted tour with Playwright video and cuts 12-frame strips: `shots/motion-desktop-*.png` and `shots/motion-phone-*.png`.

## Reused from the owner's portfolio

- `flagship-portfolio` commit `1482f84` (pop-3): `_astro/pop-and-ship.astro_astro_type_script_index_0_lang.CWMeI086.js` for the scroll-film controller (play to chase a target, seek when far or backward, pause when caught up, a quiet window) and the offscreen, hidden-tab, and reduced-motion handling. Ported as `chase` in `motion.js` and `feed.js`.
- `_astro/pop-and-ship.Cwwbw-6v.css` for the glass capsule (blur 14 px, saturate 160%) behind the feed rail and the bottom scrims.
- `_astro/_id_.PWE2yHB9.css` for `--w-ease` (cubic-bezier(.2,.8,.2,1)) and the rail label that grows by `max-width` (the "Explore all" slide).
- The `premium-web-motion` skill's glass-capsule and scroll-stop ideas, as CSS only: the WebGL recipes do not apply to a film player.

## Not finished, and limits

- It has not run on a real iPhone. Chrome 139 covers view transitions, the sheet drag, and scrolling; WebKit is untested here. The owner should open it on the phone and check the billboard, New & Hot, and the sheet.
- One change from pop-3: once input has been quiet for 50 ms the film finishes at full speed, or jumps if the gap is over 0.2 s. The original eased out over about 0.3 s. This is what makes it stop about 65 ms after the page stops.
- The hover preview starts 600 ms after the card opens (1 s after the pointer arrives).
- `scripts/make-assets.py` still holds an older catalog generator than the committed demo catalog (pre-existing); only its video paths changed.
- `shots/` is ignored by Git, so the captures and strips stay on this computer.
