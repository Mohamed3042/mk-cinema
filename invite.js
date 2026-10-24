// Invite links: one read-only GitHub key per person, carried in the URL fragment (#invite=…), which browsers never
// send to a server. The owner's invite list keeps only each key's last four characters.
export const OWNER = 'Mohamed';
export const REPO_OWNER = 'Mohamed3042';
export const REPO = 'mk-cinema-library';
export const INVITE_DAYS = 90;
export const NAME_MAX = 28; // "MK Cinema – " + name stays within GitHub's 40-character token name
export const INVITES_KEY = 'mkc.invites';
export const GUEST_KEY = 'mkc.guest';
export const TOKENS_PAGE = 'https://github.com/settings/personal-access-tokens';
const DAY = 86400000;
// A fine-grained key: github_pat_ then letters, digits and underscores. Classic keys (ghp_…) cannot be limited to
// one repository, so they never go into a link.
const FINE_GRAINED = /^github_pat_[A-Za-z0-9_]{20,255}$/u;

export const isFineGrained = token => typeof token === 'string' && FINE_GRAINED.test(token);
export function cleanName(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/gu, '').replace(/\s+/gu, ' ').trim();
  return [...name].slice(0, NAME_MAX).join('').trim();
}

const toBase64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
function fromBase64url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{1,2000}$/u.test(text)) return null;
  try { return Uint8Array.from(atob(text.replace(/-/gu, '+').replace(/_/gu, '/')), c => c.charCodeAt(0)); } catch { return null; }
}
export function encodeInvite({ name, token }) {
  const n = cleanName(name);
  if (!n || !isFineGrained(token)) throw new Error('invite needs a name and a fine-grained key');
  return toBase64url(new TextEncoder().encode(JSON.stringify({ v: 1, n, t: token })));
}
// Returns { name, token } or null for anything that is not exactly a version-1 invite.
export function decodeInvite(value) {
  const bytes = fromBase64url(value);
  if (!bytes) return null;
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1 || !isFineGrained(data.t)) return null;
  const name = cleanName(data.n);
  if (!name || name !== data.n) return null;
  return { name, token: data.t };
}
// The app's own address (no query, no fragment) plus the invite, e.g. https://mohamed3042.github.io/mk-cinema/#invite=…
export function inviteLink(appURL, invite) {
  const url = new URL('./', appURL);
  url.search = ''; url.hash = '';
  return `${url.href}#invite=${encodeInvite(invite)}`;
}
// Reads an invite from the address and removes it at once, before anything else can see or store the address.
// Returns null (no invite), { bad: true } or { name, token }.
export function takeInvite(loc = globalThis.location, hist = globalThis.history) {
  const hash = loc?.hash || '';
  if (!hash.startsWith('#invite=')) return null;
  try { hist.replaceState(hist.state, '', `${loc.pathname}${loc.search}`); } catch { /* the address keeps it; nothing is sent */ }
  return decodeInvite(hash.slice('#invite='.length)) || { bad: true };
}

// GitHub's new fine-grained token page, pre-filled (name, description, resource owner, 90 days, Contents: Read-only).
// Repository selection has no URL parameter: the owner picks mk-cinema-library by hand.
export function tokenPageURL(person) {
  const name = cleanName(person);
  const url = new URL(`${TOKENS_PAGE}/new`);
  url.searchParams.set('name', `MK Cinema – ${name}`);
  url.searchParams.set('description', `Read-only key for ${name} to watch MK Cinema. Repository access: Only select repositories → ${REPO}.`);
  url.searchParams.set('target_name', REPO_OWNER);
  url.searchParams.set('expires_in', String(INVITE_DAYS));
  url.searchParams.set('contents', 'read');
  return url.href;
}

// The owner's invite list, on this device only. Each entry: id, name, last4, made (ISO date), expires (ISO date),
// expiresKnown (true when GitHub said so; otherwise it is the planned 90 days).
const entry = item => item && typeof item === 'object' && typeof item.id === 'string' && cleanName(item.name) && typeof item.last4 === 'string' && /^[A-Za-z0-9_]{4}$/u.test(item.last4) && !Number.isNaN(Date.parse(item.made));
export function readInvites(storage) {
  try {
    const list = JSON.parse(storage.getItem(INVITES_KEY));
    return Array.isArray(list) ? list.filter(entry).map(({ id, name, last4, made, expires, expiresKnown }) => ({ id, name: cleanName(name), last4, made, expires: Number.isNaN(Date.parse(expires)) ? null : expires, expiresKnown: expiresKnown === true })) : [];
  } catch { return []; }
}
function writeInvites(storage, list) { try { storage.setItem(INVITES_KEY, JSON.stringify(list)); } catch { /* blocked storage: the list holds for this visit only */ } }
export function addInvite(storage, { name, token, expires = null, now = Date.now(), id = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}` }) {
  const made = new Date(now).toISOString();
  const known = expires != null && !Number.isNaN(Date.parse(expires));
  const item = { id, name: cleanName(name), last4: String(token).slice(-4), made, expires: known ? new Date(Date.parse(expires)).toISOString() : new Date(now + INVITE_DAYS * DAY).toISOString(), expiresKnown: known };
  const list = [item, ...readInvites(storage)];
  writeInvites(storage, list);
  return list;
}
export function removeInvite(storage, id) {
  const list = readInvites(storage).filter(item => item.id !== id);
  writeInvites(storage, list);
  return list;
}

// Who this device belongs to when it opened an invite: { name, left }.
export function readGuest(storage) {
  try {
    const data = JSON.parse(storage.getItem(GUEST_KEY));
    const name = cleanName(data?.name);
    return name ? { name, left: data.left === true } : null;
  } catch { return null; }
}
export function writeGuest(storage, guest) {
  try { if (guest) storage.setItem(GUEST_KEY, JSON.stringify({ name: guest.name, left: guest.left === true })); else storage.removeItem(GUEST_KEY); } catch { /* blocked */ }
}
