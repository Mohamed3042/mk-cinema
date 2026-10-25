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

## Watch and save

Choose a card or **More info** to open its detail sheet. Pick a cut, then Phone or Desktop when both exist. The sheet also shows the date added, a release link when supplied, and films with the same product. Play starts the existing full-frame player, with play/pause, seek, mute, and full-screen controls. Arabic titles use `dir="auto"` and a local Arabic font.

Search and chips open a grid with a title count. Clear filters returns to the home. Rows show Continue watching, New this week (the last seven days), each product, Ads & loops, Demos, and Arabic. Empty rows are hidden. **Explore all** in a row's heading opens that row as a grid.

### Tabs

- **Desktop:** a top bar with Home, New & Hot, Films, Ads, Demos, My List, search, and settings. The tabs sit in one frosted capsule and a white pill slides to the open tab. The bar is clear over the billboard and turns to frosted ink (72 %) within the first 80 px of scroll.
- **Phone:** a floating frosted capsule with Home, New & Hot, Search, and My List, 10 px above the iPhone home indicator.
- Films, Ads, and Demos are the home again, limited to that kind. Switching tabs crossfades for 250 ms (a view transition; older browsers get a fade-in).
- **New & Hot** is a vertical feed of every title, newest first. The film nearest the middle of the screen moves only while you scroll and stops about 50 ms after the last input; scrolling back rewinds it. It is the owner's pop-and-ship scroll film, adapted (`chase` in `motion.js`, `feed.js`).
- **My List** keeps film ids in `mkc.list` (demo: `mkc.demo.list`). Nothing else is stored, and there is no token. A title with several cuts counts as listed when any cut is.

### Previews and autoplay

- The billboard shows its poster, crossfades to the muted film after about 2 s (starting about 10% in), quiets its blurb and shrinks its title after about 6 s, and returns to the poster with a replay button at the end. A round button mutes and unmutes.
- On desktop, resting on a card for 400 ms grows it 1.5x (the left-edge card grows rightward, the right-edge card leftward). A muted preview starts 600 ms later, and a panel slides in with Play, + My List, and More info. Rows page with arrow paddles (750 ms) and page dashes.
- More info grows out of the card into a centred panel with an autoplaying 16:9 preview, a versions list, and More like this. Esc, the close button, or the dimmed page closes it by playing the growth backwards. On a phone it is a bottom sheet that springs up and can be pulled down to close.
- At most one preview plays at a time besides the billboard. Anything offscreen pauses. **Settings → Autoplay previews** switches every preview off (it is on by default). `prefers-reduced-motion` turns all of it off whatever the switch says: posters only, no hover card, no scroll scrubbing, no growing sheet.
- Previews use the same stream the player gets from `api.js`, with the same token handling. If the browser refuses the stream (iPhone Safari with GitHub's octet-stream films), a film of up to 40 MB is downloaded whole for its preview; larger films stay on the poster. Previews are not saved or cached beyond the visit.

Watch progress is saved per original film id in `mkc.progress`. It contains only numeric time, duration, and update time; no title, token, or URL. Demo progress uses `mkc.demo.progress`. Play resumes an unfinished film. Films at 95% or more are removed from Continue watching and replay from the start. Blocked browser storage does not prevent playback.

Optional catalog fields are `product`, `kind`, `lang`, `group`, `variant`, and `blurb`. Old catalogs still work. Only entries with an explicit shared `group` collapse. The newest cut is the main card; ties prefer more picture versions, then Desktop, then original catalog order. Filters and search inspect every cut and show the matching cut. Real group decisions belong only in the private catalog repo.

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

The browser suite uses headless Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`, with a separate test profile inside this folder. It starts and stops its own local server. Close another server on port 4173 first. `tests/browser.mjs` runs with reduced motion on (the screens, player, and save flow); `tests/motion.mjs` then runs in real time with motion on (tabs, billboard, hover card, More info, rows, New & Hot, My List, Settings, reduced motion). `$env:ONLY='hover card'; node tests/motion.mjs` runs only the motion checks whose name contains that text.

- Phone captures: `shots/<screen>.png` at 390 × 844.
- Desktop captures: `shots/<screen>-desktop.png` at 1440 × 900.
- Current screens: `home`, `new-and-hot`, `my-list`, `modal` (the phone sheet), `bob-card` (desktop only), `filtered-grid`, `search`, `detail`, and `player`. Error and save state captures are also refreshed.
- Machine results: `shots/results.json` and `shots/results-motion.json`.
- Motion proof: `npm.cmd run shots:motion` records a scripted tour (desktop, then phone) with Playwright video in `shots/motion/` and cuts 12-frame contact strips with ffmpeg to `shots/motion-<name>.png`.
- Human review and test scope: `REPORT.md`.

The browser suite uses only this repo and does not compare the old mockups. Runtime fonts are local SIL OFL files; see `fonts/README.md` and the license files. Sample assets can be regenerated with `py -3.12 scripts/make-assets.py` (Pillow and ffmpeg are needed only for asset work).

## Owner checks still needed

- Use a real read-only token to load, play, seek, and save private films.
- On an iPhone home screen, check safe areas, rotation, full screen, and the native **Save Video** action. Check Photos after saving.
- On the iPhone, watch the billboard and New & Hot with real films. Previews start muted and inline. Low Power Mode refuses autoplay, so the billboard stays a poster there and New & Hot steps frames with your scroll. A film over 40 MB that Safari will not stream stays on its poster.
- Chrome and the tests cover view transitions, the sheet drag, and scrolling; none of it has run on a real iPhone yet.

No remote, push, publish, install on a phone, or message to another person was made.

Implementation references: [GitHub repository contents](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28), [Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
