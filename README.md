# MK Cinema

A private film player for one owner. Plain HTML, CSS, and ES modules. No build step, runtime packages, CDN, analytics, or third-party scripts. The phone layout follows the approved **Velvet Premiere** mockups. Desktop uses the same tall feature and film list.

This repo holds **no private film data**: no real catalog, titles, posters, videos, or token. `demo/` holds seven made-up films, original sample art, and two three-second test clips. `shots/` is local review evidence and is ignored by Git.

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

Choose a film, then Phone or Desktop when both exist. The player contains the whole video without cropping. It has play/pause, seek, mute, and full-screen controls. Arabic titles use `dir="auto"` and a local Arabic font.

**Save to phone** downloads the selected file into memory. Progress uses Content-Length when available; otherwise it shows received MB. **Cancel** stops the fetch. Once ready, tap **Save video** to open the device share sheet, then choose **Save Video** on iPhone. This second tap preserves the user gesture required by Web Share. When file sharing is not available, **Download video** uses the browser download function. A cancelled share can be tried again without another download.

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

The browser suite uses headless Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`, with a separate test profile inside this folder. It starts and stops its own local server. Close another server on port 4173 first.

- Phone captures: `shots/<screen>.png` at 390 × 844.
- Desktop captures: `shots/<screen>-desktop.png` at 1440 × 900.
- Side-by-side reviews: `shots/compare-<screen>.png`; mockup left, app right.
- Machine results: `shots/results.json`.
- Human review and test scope: `REPORT.md`.

The comparison script reads the approved mockups from `..\mk-cinema-concepts\velvet-premiere\`. They are not copied into the site's tracked files. Runtime fonts are local SIL OFL files; see `fonts/README.md` and the license files. Sample assets can be regenerated with `py -3.12 scripts/make-assets.py` (Pillow and ffmpeg are needed only for asset work).

## Owner checks still needed

- Use a real read-only token to load, play, seek, and save private films.
- On an iPhone home screen, check safe areas, rotation, full screen, and the native **Save Video** action. Check Photos after saving.

No remote, push, publish, install on a phone, or message to another person was made.

Implementation references: [GitHub repository contents](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28), [Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
