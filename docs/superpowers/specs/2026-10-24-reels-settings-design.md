# MK Cinema: Reels tab + Settings tab (design, 2026-10-24)

## Intent
The owner (Mohamed, iPhone + Windows PC, ADHD: hates typing and reading) asked: "instead of the tab that says SAVED, it could be replaced by Settings, and Settings has some config that I want to decide, and another one there, REELS, so I just watch reels." He already asked for a reel once; it was built this morning as **Shuffle** (`reel.js`, commits 1191f8d + ad3de38 on `shuffle-reel`) but never merged, so he never saw it. Now it becomes a tab.

Reading of "SAVED" (my call): the phone tab that holds saved films, today labelled **My List**.

## Goals
1. Build on `origin/shuffle-reel` (polish ff63e98, Shuffle 1191f8d, harden ad3de38). All of it ships with this change.
2. **Phone tab bar** (below 900 px): Home · New & Hot · Reels · Search · Settings. My List leaves the phone tab bar.
3. **Desktop top bar**: tabs Home · New & Hot · Films · Ads · Demos · Reels · My List. The Shuffle capsule goes away (the Reels tab replaces it). The gear opens the Settings page (same page as the phone tab), not the old dialog.
4. **Reels tab** = the Shuffle reel as a tab, TikTok style:
   - Phone: the reel fills the screen above the tab bar; the tab bar stays visible and working. Desktop: the reel fills the area under the top bar.
   - Sound starts inside the tap that opens the tab (iPhone keeps sound only then); everything `reel.js` already handles (muted fallback "Tap for sound", broken-link resume, three-failures stop, brightness shade, reduced motion, screen reader rules) keeps working.
   - Leaving the tab pauses and releases the video. Coming back in the same visit resumes the same film where it was.
   - Swipe / wheel / arrows / tap-to-pause / m to mute work as today; swipes must never fight the tab bar.
5. **Settings page** (replaces the `#settings` dialog), sections, each control actually changes behaviour:
   - Playback: Autoplay previews (the existing toggle and note).
   - Reels: Start with sound (default on) · Which titles: Films / Ads / Demos (default all on; at least one stays on) · Order: Shuffle (default) or Newest first · When a film ends: Play the next (default) or Wait.
   - My List: count of saved titles and "Open My List" (opens the existing list view; back returns to Settings).
   - Connection: token status in plain words and the existing **Forget token** flow, unchanged in effect.
   - About: number of titles, demo or private collection, shell cache version.
   - Stored in `localStorage` under one key (for example `mkc.settings`), JSON, defaults when missing or broken; storage errors never break playback.
6. **My List on Home**: a "My List" row on Home when it has titles, so saved films stay one tap away on the phone.
7. Service worker: bump the shell cache version; any new module is in the fixed shell list.

## Non-goals
No backend, no catalog or library repo change, no new dependency, no change to token, media host/path checks, poster cache, downloads or Save to phone.

## Anti-goals (a failure even if it "works")
- Reels lose sound on iPhone, or the tab bar overlaps the reel's controls or title.
- A setting that does nothing, or settings written as paragraphs.
- The player, detail sheet, save flows, search or connect screens regress.

## Constraints
- Plain HTML/CSS/ES modules, no build step, no CDN. Liquid Glass look as in README/`styles.css`/`motion.css`: frosted capsules, white pill for the one main action, ink background, 44 pt touch targets, visible focus, `dir="auto"` Arabic, reduced motion and reduced transparency respected.
- Tests: `npm.cmd test` and `npm.cmd run test:browser` all pass. Add tests: settings defaults/persistence/broken JSON, Reels filter (kinds) and order (shuffle vs newest), "Wait" at film end, phone tab bar order, My List row and Open My List.
- Evidence: screenshots (demo data, `?demo`) at 390x844 and 1440x900 of the Reels tab playing, Settings, Home with the My List row, desktop top bar. Look at every picture before reporting.

## Left to the builder
Icons (a reels glyph in the existing icon style), exact layout and spacing, how Settings sections are drawn, animation details, test structure, how the reel module is mounted inside the tab.
