# MK Cinema

A private film player for one owner. Plain HTML, CSS, and ES modules. No build step, runtime packages, CDN, analytics, or third-party scripts. The home has tabs, a billboard that plays a muted preview, side-scroll film rows, search, and filters.

The look is **Liquid Glass**: Netflix's layout in Apple TV calm. The page is ink black (#05060a) lit by the film on show: `ambient.js` shrinks the billboard poster (in New & Hot, the playing film's; in a grid, the first result's) to a 48 × 27 canvas and lays it under the page as a soft wash of its colours. Controls that float over film are frosted capsules; the one action that matters is a white pill. Titles read as a brand line over a clean name: `splitTitle` in `catalog.js` turns "North Studio — Night Swim (film)" into "NORTH STUDIO" over "Night Swim", and keeps only the bracket notes that add something ("app 2.4.1"). Without backdrop blur, or with "Reduce transparency" on, the same controls sit on solid ink.

This repo holds **no private film data**: no real catalog, titles, posters, videos, or token. `demo/` holds eight made-up entries grouped into seven titles, original sample art, and one 12-second clip per film and shape. `shots/` is local review evidence and is ignored by Git.

## Run locally

Requires Node.js. From this folder:

```powershell
node scripts/serve.mjs
```

Open `http://127.0.0.1:4173/?demo`. Open `http://127.0.0.1:4173/` for the connect form. The server listens only on this computer. No package install is needed to run the site.

The root files also work as a GitHub Pages static site under a repository path. This work does not set a Git remote or publish the site. Installation and Web Share need HTTPS, or localhost for browser tests.

## Token and private media

On the connect form, follow three steps:

1. Make a fine-grained token.
2. Only select repositories: `mk-cinema-library`.
3. Set Contents: Read-only.

The form links to GitHub's token settings. Paste the token once. It stays in this browser's `localStorage`, under `mkc.token`. The app sends it only in the `Authorization` header to the GitHub REST API. It is never put in a URL, source file, or log. Local storage is not encrypted; use the read-only token on your own device.

The app reads `cinema.json` from `Mohamed3042/mk-cinema-library`. It loads posters as blobs and streams a selected film from a short-lived GitHub raw URL. A playback error gets a fresh URL and resumes at the previous time. The app checks catalog fields, paths, media host, and poster signatures before use.

Posters are stored by the **app** in a separate private Cache Storage cache, with local keys that contain no token. The cache refreshes when the catalog's `updated` value changes. The **service worker** caches only the fixed public app shell. It never caches films, catalog/API responses, or the token. An offline launch shows a retry screen; it does not offer offline film playback.

Settings → **Forget token** removes the stored token and cached private posters, stops pending work, and returns to Connect.

## Invite links

Settings → Invites → **Invite someone** makes a link for one person (Mom, Dad, a friend). Each person gets a key of their own, so one can be stopped without touching the others, and the link works whether or not the owner's PC is on: GitHub serves the app and the library. Design: `docs/superpowers/specs/2026-10-24-invites-design.md`.

1. Type their name. **Make Mom's key on GitHub** opens GitHub's new fine-grained token page pre-filled: name `MK Cinema – Mom`, resource owner `Mohamed3042`, 90 days, Contents: Read-only ([GitHub's URL parameters](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#pre-filling-fine-grained-personal-access-token-details-using-url-parameters)). Repository selection has no parameter: choose **Only select repositories** → `mk-cinema-library` by hand.
2. Paste the new key. The app refuses its own key, classic keys, a key that cannot read `cinema.json`, and a key that reports a write scope. GitHub does not let an app read a fine-grained key's permissions, so the ready screen asks to check Contents: Read-only on GitHub.
3. **Share link** (the share sheet; it falls back to copying) or **Copy link**. The link is `<app>/#invite=<base64url of {"v":1,"n":"Mom","t":"<key>"}>`: the key is only in the fragment, which browsers never send to a server.

The invite list (`mkc.invites`, this device only) keeps the name, the key's last four characters, the date and the expiry (GitHub's when the browser can read it, otherwise about 90 days). **Stop access** opens GitHub's token list with one line on what to delete; **Remove from list** only forgets the row.

Opening a link removes the fragment from the address at once (`history.replaceState`), stores the key under `mkc.token` and the name under `mkc.guest`, and shows a welcome ("Mohamed shared his cinema with you") while the library loads behind it. A guest never sees the connect form or GitHub words: Settings shows **Shared by Mohamed** and **Leave**, and a key GitHub no longer accepts shows "This invite has ended. Ask Mohamed for a new link." A device that already holds the owner's key asks before switching.

On an iPhone a home-screen app keeps its own storage, apart from Safari's ([WebKit bug 181849](https://bugs.webkit.org/show_bug.cgi?id=181849)), and opens the start address, so the key saved from the link is not there. So on an iPhone the welcome says "Keep this link: tap it any time to watch." (Android and computers share storage with their home-screen app and keep the Home Screen tip), and a home-screen app with no key asks **Paste your invite link** (the clipboard on tap, or a box) instead of the connect form; the pasted link takes the same path as a tapped one. **I'm Mohamed** there leads to the connect form, and **I have an invite link** leads back; an invite link pasted into the token box opens the invite.

## Watch and save

Choose a card or **More info** to open its detail sheet. Pick a cut, then Phone or Desktop when both exist. The sheet also shows the date added, a release link when supplied, and films with the same product. Play opens the player (below). Arabic titles use `dir="auto"` and a local Arabic font.

Search and chips open a grid with a title count. Clear filters returns to the home. Rows show Continue watching, New this week (the last seven days), each product, Ads & loops, Demos, and Arabic. Empty rows are hidden. **Explore all** in a row's heading opens that row as a grid.

### The player

The player is Netflix's phone player in the app's glass (`player.js`). The film fills the screen edge to edge on black, under the notch and the home indicator; there is no page header and no strip of controls around it.

- **Controls float over the film** and fade 3 s after the last touch while it plays; they stay while it is paused, and one tap on the picture brings them back (another tap sends them away). Top: Back, the brand line and title, AirPlay (only where Safari offers a target) and sound. Middle: back 10 s, a white play/pause, forward 10 s. Bottom: the scrubber with elapsed and remaining time, then **Fill**, the cut switch (Phone / Desktop, when both exist; it carries on at the same time) and, where the browser has it, full screen.
- **Double-tap** the left or right third of the picture to jump 10 s back or forward, with a "−10"/"+10" ripple; more taps keep adding.
- **A landscape cut turns sideways on a phone held upright**, filling it as if the phone were turned (iPhone Safari cannot lock the orientation or put a page element full screen, so the rotation is CSS). Taps, double-taps, the scrubber and the safe areas all work in the turned frame. A phone already in landscape, a tablet or a desktop is never turned. On Android, the full-screen button also locks landscape for a landscape cut.
- **Fit or Fill:** the film is shown whole by default, so titles near its edges are never cut. **Fill** (or a two-finger pinch out) zooms it to cover the screen; a pinch in shows it whole again. The choice is kept in `mkc.settings` and is also in Settings → Playback.
- **Keyboard:** Space (or K) plays and pauses, arrows jump 10 s, M mutes, F toggles full screen (desktop), Esc leaves full screen and then the player. The scrubber is a labelled slider: arrows, Page Up/Down (1 min), Home and End. With reduced motion the controls show and hide at once and there are no ripples or zooms.
- Resume, progress saving, the fresh-link retry for an expired URL, the whole-file fallback when Safari refuses the stream, and the `role=status` messages work as before. Sound comes from the Play tap: the film is started inside it, before its address arrives.

### Tabs

- **Desktop:** a top bar with Home, New & Hot, Films, Ads, Demos, Reels, My List, search, and the Settings gear. The tabs sit in one frosted capsule and a white pill slides to the open tab; the gear turns white while Settings is open. The bar is clear over the billboard and turns to frosted ink (72 %) within the first 80 px of scroll.
- **Phone:** a floating frosted capsule with Home, New & Hot, Reels, Search, and Settings, 10 px above the iPhone home indicator. My List is one tap away as a row on Home and through Settings → **Open My List** (its back button returns to Settings).
- Films, Ads, and Demos are the home again, limited to that kind. Switching tabs crossfades for 250 ms (a view transition; older browsers get a fade-in).
- **New & Hot** is a vertical feed of every title, newest first. The film nearest the middle of the screen moves only while you scroll and stops about 50 ms after the last input; scrolling back rewinds it. It is the owner's pop-and-ship scroll film, adapted (`chase` in `motion.js`, `feed.js`).
- **My List** keeps film ids in `mkc.list` (demo: `mkc.demo.list`). Nothing else is stored, and there is no token. A title with several cuts counts as listed when any cut is. Home shows a **My List** row (after Continue watching) when the list has titles; it updates in place, and the row you are looking at stays where it is.

### Reels

The **Reels** tab plays the cinema as a reel, TikTok style: one film fills the screen and plays from the start with sound, and when it ends the next one comes up. On a phone the film runs edge to edge under the floating tab bar, which stays working; the title, the controls and the progress line all sit above it. On a desktop the reel fills the area under the top bar. Swipe up or down on a phone; on a desktop use the wheel, the arrow keys or the arrows on the right. Tap the film to pause, **m** mutes; the reel is a keyboard stop after the bar, where Space pauses. Leaving the tab stops and releases the film; coming back in the same visit finds the same films in the same order, on the same film, at the same time (a change in Settings starts a fresh reel). What plays, the order, the sound and what happens at a film's end are set in Settings. In Shuffle order the order is new every time: each title appears once per round, one product never plays twice in a row when that can be avoided, and a new round is drawn before the last one runs out (`shuffleDeck` in `reel.js`). In either order the screen's version comes first: on a phone the titles that have a 9:16 cut play first and the desktop-only ones after; on a desktop the titles with a 16:9 cut first and the phone-only ones after. Each part keeps the chosen order (shuffled on its own, or newest first), and every round is grouped the same way (`reelDeck` in `settings.js`). A phone plays the 9:16 cut and a desktop the 16:9 cut, each falling back to the other; every cut is shown whole, never cropped (Reels ignore the player's Fill), over a blur of its poster; on an upright phone a 16:9 film sits between the counter and the title, so nothing covers it, and a 9:16 film fills the height with the title over its foot. There is one video element, started inside the tap on the Reels tab (the tab skips the crossfade for that), so an iPhone keeps playing with sound from film to film; if a browser still refuses sound, the reel plays muted and shows **Tap for sound**. On an iPhone, where Safari refuses GitHub's streams, each film is downloaded whole before it plays (up to 40 MB, as for previews; every phone cut in the library is smaller). A film whose short-lived link expires midway gets a fresh one and carries on where it was. A film that cannot play shows a note and moves on after 2.5 s; three in a row stop the reel instead of cycling through the cinema, and a token, access or rate-limit problem goes to the same screens as the player. About once a second the brightness of the frame on screen (when the browser can read it) deepens the shade under the title, as pale posters do; on a dark frame the shade stays light and low, just enough for the white type. With reduced motion, or **When a film ends: Wait**, nothing moves on by itself: a film that ends waits for a swipe, and a tap plays it again (with reduced motion a film that cannot play waits too). If the chosen kinds hold no titles, Reels shows a calm empty screen with **Open Settings** and **Browse everything**. The reel's place is kept in memory only.

### Settings

Settings is a page (the phone's Settings tab, the desktop gear, and the gear on the Connect and error screens, where a back button returns). Every control changes what the app does:

- **Playback:** Autoplay previews (on by default; off under reduced motion, and the switch says so) · Picture in the player: Fit or Fill · Language: the one the app follows, read from the device (no control).
- **Reels:** Start with sound (on) · Which titles: Films, Ads, Demos with their counts (all on; the last one stays on) · Order: Shuffle or Newest first (your screen's version first) · When a film ends: Play the next or Wait.
- **My List:** Open My List, with the number of saved titles.
- **Invites** (owner): **Invite someone** and the invite list (see Invite links).
- **Connection:** the token state in plain words and **Forget token**.
- **Sharing** (guest, instead of Invites and Connection): Shared by Mohamed, the invite's name, and **Leave**.
- **About:** number of titles, demo or private collection, and the app shell version this browser holds for offline.

The choices are one JSON key, `mkc.settings` (`settings.js`); a missing or broken value falls back to its default, an older `mkc.autoplay` choice is carried over, and blocked storage keeps the choices for the visit.

### Previews and autoplay

- The billboard shows its poster, crossfades to the muted film after about 2 s (starting about 10% in), quiets its blurb and shrinks its title after about 6 s, and returns to the poster with a replay button at the end. A round button mutes and unmutes.
- On desktop, resting on a card for 400 ms grows it 1.5x (the left-edge card grows rightward, the right-edge card leftward). A muted preview starts 600 ms later, and a panel slides in with Play, + My List, and More info. Rows page with arrow paddles (750 ms) and page dashes.
- More info grows out of the card into a centred panel with an autoplaying 16:9 preview, a versions list, and More like this. Esc, the close button, or the dimmed page closes it by playing the growth backwards. On a phone it is a bottom sheet that springs up and can be pulled down to close.
- At most one preview plays at a time besides the billboard. Anything offscreen pauses. **Settings → Autoplay previews** switches every preview off (it is on by default). `prefers-reduced-motion` turns all of it off whatever the switch says: posters only, no hover card, no scroll scrubbing, no growing sheet.
- Previews use the same stream the player gets from `api.js`, with the same token handling. If the browser refuses the stream (iPhone Safari with GitHub's octet-stream films), a film of up to 40 MB is downloaded whole for its preview; larger films stay on the poster. Previews are not saved or cached beyond the visit.

Watch progress is saved per original film id in `mkc.progress`. It contains only numeric time, duration, and update time; no title, token, or URL. Demo progress uses `mkc.demo.progress`. Only films of 30 minutes or more resume (`RESUME_MIN_SECONDS` in `catalog.js`; the catalog `seconds`, or the saved duration when that is missing): Play picks up an unfinished long film, and only long films appear in Continue watching with a progress bar. A shorter film always starts from the beginning, though its progress is still saved; switching cuts inside the player still keeps the current time. Films at 95% or more are removed from Continue watching and replay from the start. Blocked browser storage does not prevent playback.

Optional catalog fields are `product`, `kind`, `lang`, `group`, `variant`, and `blurb`. Old catalogs still work. `kind` is one of `film`, `episode` (one part of a series), `ad`, `loop`, `teaser`, `demo` and `reel`. An optional value the app cannot read is dropped (an unknown kind shows as Film, an unknown product as More films), and a film whose required fields cannot be read (id, title, paths, sizes, shape) is left out and counted under Settings → About → **Left out**, so one bad entry never closes the cinema. Only entries with an explicit shared `group` collapse. The newest cut is the main card; ties prefer more picture versions, then Desktop, then original catalog order. A language pair (films in one `group` with `lang` `ar` and `en`; no `lang` counts as English) shows as one title in the device's language: Arabic when the first browser language is Arabic, else English, falling back to the other when the group has none. Cards, rows, search, New & Hot, Reels and the billboard all show that film; filters and search inspect every cut in that language and show the matching cut. The other language is one link in More info (**English version** / **النسخة العربية**), never a card of its own. Real group decisions belong only in the private catalog repo.

**Save to phone** (**Download** on a desktop) downloads the selected file into memory. Progress uses Content-Length when available; otherwise it shows received MB. **Cancel** stops the fetch. Once ready, tap **Save video** to open the device share sheet, then choose **Save Video** on iPhone. This second tap preserves the user gesture required by Web Share. When file sharing is not available, **Download video** uses the browser download function. A cancelled share can be tried again without another download.

“Saved” means the file was handed to the device. The app cannot prove that it is in Photos. Large films need enough free memory on the phone.

## Demo states

Use `?demo&state=` with any of:

`connect`, `connect-error`, `loading`, `offline`, `github-unreachable`, `empty`, `save-progress`, `saved`.

Demo mode does not read or send the stored token. Its “Saved” preview does not create a file. Use the normal demo film flow to test downloading. The Arabic sample is `رحلة الضوء`; `Velvet Steps` has only a phone version.

## Checks and screenshots

Install test-only packages and run checks:

```powershell
npm.cmd ci --cache .npm-cache
npm.cmd test
npm.cmd run test:browser
```

The browser suite uses headless Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`, with a separate test profile inside this folder. It starts and stops its own local server. Close another server on port 4173 first. `tests/browser.mjs` runs with reduced motion on (the screens, player, and save flow); `tests/motion.mjs` then runs in real time with motion on (tabs, billboard, hover card, More info, rows, New & Hot, My List, Reels, Settings, reduced motion). `$env:ONLY='hover card'; node tests/motion.mjs` runs only the motion checks whose name contains that text.

- Phone captures: `shots/<screen>.png` at 390 × 844.
- Desktop captures: `shots/<screen>-desktop.png` at 1440 × 900.
- Current screens: `home`, `new-and-hot`, `my-list`, `reels`, `settings`, `modal` (the phone sheet), `bob-card` (desktop only), `filtered-grid`, `search`, `detail`, `player-portrait`, `player-landscape` and `player-landscape-phone` (844 × 390). Error and save state captures are also refreshed.
- Player review set: `shots/netflix-player/` (phone 9:16 with and without controls, Fill, a 16:9 cut turned sideways, a landscape phone, desktop), written by the `Player:` checks in `tests/motion.mjs`.
- Machine results: `shots/results.json` and `shots/results-motion.json`.
- Motion proof: `npm.cmd run shots:motion` records a scripted tour (desktop, then phone) with Playwright video in `shots/motion/` and cuts 12-frame contact strips with ffmpeg to `shots/motion-<name>.png`.
- Human review and test scope: `REPORT.md`.

The browser suite uses only this repo and does not compare the old mockups. `npm.cmd run shots:compare -- <mockups folder>` puts each mockup next to the capture of the same name as `shots/compare-<name>.png`. Runtime fonts are local SIL OFL files; see `fonts/README.md` and the license files. Sample assets can be regenerated with `py -3.12 scripts/make-assets.py` (Pillow and ffmpeg are needed only for asset work).

## Owner checks still needed

- Use a real read-only token to load, play, seek, and save private films.
- On an iPhone home screen, check safe areas, the player turned sideways for a 16:9 cut (controls, scrubber and double-taps), Fill and pinch, sound after Play, and the native **Save Video** action. Check Photos after saving.
- On the iPhone, watch the billboard and New & Hot with real films. Previews start muted and inline. Low Power Mode refuses autoplay, so the billboard stays a poster there and New & Hot steps frames with your scroll. A film over 40 MB that Safari will not stream stays on its poster.
- Chrome and the tests cover view transitions, the sheet drag, and scrolling; none of it has run on a real iPhone yet.

No remote, push, publish, install on a phone, or message to another person was made.

Implementation references: [GitHub repository contents](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28), [Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
