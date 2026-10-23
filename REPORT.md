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
