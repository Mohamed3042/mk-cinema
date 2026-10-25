# Invite links — design (2026-10-24)

Owner's ask: "Allow me to generate an invitation link that allows any of my friends or mom or dad to open my MK Cinema... even if the PC is off." The app never needs his PC: GitHub Pages serves the app and the GitHub API serves the private library, so a link only has to carry a key that can read `Mohamed3042/mk-cinema-library`.

## Decisions (owner's)

1. **One key per person.** One leak is cut off alone. Settings → Invites → **Invite someone**: type a name ("Mom") → **Make Mom's key on GitHub** opens GitHub's new fine-grained token page pre-filled → paste the new key → the app checks it → the link is built → **Share** (`navigator.share`) or **Copy**.
2. **Link format:** `https://mohamed3042.github.io/mk-cinema/#invite=<base64url of {"v":1,"n":"Mom","t":"<token>"}>`. The key travels only in the URL fragment, which browsers never send to a server. On open the app reads the fragment, removes it at once with `history.replaceState`, validates it, and stores the key under `mkc.token` (the same key the app already uses) with the guest label in `mkc.guest`. The key is never logged.
3. **Guest experience:** no connect form and no GitHub words. A short welcome ("Mohamed shared his cinema with you"), then the normal cinema. Settings shows **Shared by Mohamed** and **Leave** (forgets the key). A revoked or expired key shows "This invite has ended. Ask Mohamed for a new link." — never the owner's token-help screen.
4. **Owner's invite list** (this device only, `mkc.invites`): name, the key's last 4 characters, the date it was made, the expiry when known, **Stop access** (opens GitHub's fine-grained token list with one line of instructions) and **Remove from list**. A full key is never stored in the list.
5. **The owner's own key is never put in a link.** The invite flow refuses a key equal to the one this device uses.

## What GitHub's pre-fill supports (verified)

Source: GitHub Docs, "Managing your personal access tokens" → "Pre-filling fine-grained personal access token details using URL parameters" (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#pre-filling-fine-grained-personal-access-token-details-using-url-parameters).

| Parameter | Used as | Supported |
| --- | --- | --- |
| `name` (≤ 40 chars) | `MK Cinema – Mom` (person's name capped at 28 chars) | yes |
| `description` (≤ 1024) | who it is for and the one manual step | yes |
| `target_name` | `Mohamed3042` | yes |
| `expires_in` (1–366 or `none`) | `90` | yes |
| `contents=read` | Contents: Read-only (Metadata read comes with it) | yes |
| repository selection | — | **no parameter**: shown as the manual step "Repository access → Only select repositories → mk-cinema-library" |

## Checking a pasted key

- Must look like a fine-grained key (`github_pat_…`). A classic key (`ghp_…` and friends) is refused: it cannot be limited to one repository.
- Must differ from this device's own key.
- Must read `mk-cinema-library/cinema.json` (a valid catalog). 401/403 → "GitHub refused this key"; 404 → "This key can't see mk-cinema-library" with the manual step repeated.
- **Write access:** GitHub's REST API has no endpoint or header that reports a fine-grained token's own permissions (`X-Accepted-GitHub-Permissions` names what an endpoint needs, not what the token has; `X-OAuth-Scopes` exists only for classic tokens). So: a response carrying `X-OAuth-Scopes` with a write scope (`repo`, `public_repo`, `write:*`) is refused; for a fine-grained key the app shows a warning to check that Contents says Read-only (the pre-filled page already sets it). No write request is ever sent to probe.
- Expiry: read from GitHub's `GitHub-Authentication-Token-Expiration` header when the browser can see it; otherwise the list shows the planned date (made + 90 days) marked "about".

## Guest states

| State | Screen |
| --- | --- |
| Valid link, fresh device | Welcome → cinema (catalog loads behind the welcome) |
| Valid link, device already has the owner's own key | "This device already opens your cinema": Keep my key / Switch to Mom's invite |
| Broken link | "This invite link is incomplete. Ask Mohamed to send it again." |
| Key revoked/expired (401/403/404 at any time) | "This invite has ended. Ask Mohamed for a new link." · Try again · Forget this invite |
| After Leave | "You left Mohamed's cinema. Open his link again to come back." |
| Home-screen app with no key (added 2026-10-25) | "Paste your invite link": Paste invite link (clipboard) or the box, then the welcome · I'm Mohamed → connect form |
| After Leave, in a home-screen app | "To come back, paste his invite link." · Paste his invite link |

## iPhone home screen (2026-10-25)

An iPhone's home-screen app has its own storage, apart from Safari's (WebKit bug 181849, closed as by design), and opens the manifest `start_url`, which has no fragment. A guest who opened the link in Safari and then added the app to the Home Screen therefore has no key there and used to meet the owner's connect form.

- The welcome tip on an iPhone (and inside any home-screen app) is "Keep this link: tap it any time to watch." Android and computers share storage with their installed app and keep "Add it to your home screen to come back in one tap."
- A home-screen app (`navigator.standalone`, or `display-mode: standalone`) with no key and no guest record shows "Paste your invite link". The button reads `navigator.clipboard.readText()` inside the tap; a refusal or an empty clipboard hands over to the box, and a whole link pasted into the box opens at once. The text may be the link or the shared message around it; a broken link, another app's link (a different app address) and text with no invite are refused in place and store nothing. A good link runs the same path as a tapped one (`openInvite`).
- No GitHub words on that screen. The owner's own phone has one quiet button, **I'm Mohamed**, to his connect form; there, in a home-screen app with no key, **I have an invite link** leads back. An invite link pasted into the token box opens the invite instead of being saved as a token.
- Guest screens with no key (left, broken link, paste) have no Settings gear: its Connection rows talk about tokens and lead to the connect form.
- With no key nothing loads, so going offline leaves the screen as it is: Retry there would try the missing key and show the token screen.

## Not in scope (my call)

- No server, no shortener, no QR code. The link is long; Share and Copy carry it whole.
- No check of "All repositories" selection: the API cannot tell a fine-grained token's repository list from a browser reliably; the manual step says it plainly.
- Demo mode has no invites (it never reads or sends a key).

## Tests

`tests/invite.test.mjs` (encode/decode round trip, bad links, pre-fill URL, list keeps last 4 only, fragment taking), `tests/api.test.mjs` (key check: read ok, classic/write refused, 401/404, expiry header), `tests/browser.mjs` (guest open: fragment gone, key never in a request URL or console; welcome; guest Settings; Leave; ended screen on 401/404; owner flow with mocked GitHub; Share falls back to Copy). Screenshots at 390 × 844 in `shots/invites/`.
