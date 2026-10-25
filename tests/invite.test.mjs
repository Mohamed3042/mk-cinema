import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeInvite, decodeInvite, inviteLink, takeInvite, inviteFromText, tokenPageURL, cleanName, isFineGrained, readInvites, addInvite, removeInvite, readGuest, writeGuest, INVITES_KEY, NAME_MAX } from '../invite.js';

// Made-up keys in the fine-grained shape. No real token is used anywhere in the tests.
const FAKE = 'github_pat_11FAKEFAKE0000000000_testonlynotarealkeyAbCdEfGh1234';
const OTHER = 'github_pat_22FAKEFAKE0000000000_anotherfakekeyZyXwVuTs9876';
const storage = (entries = {}) => ({ data: new Map(Object.entries(entries)), getItem(key) { return this.data.get(key) ?? null; }, setItem(key, value) { this.data.set(key, String(value)); }, removeItem(key) { this.data.delete(key); } });
const b64url = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

test('invite: a link round-trips the name and the key, and the payload is the agreed JSON', () => {
  const code = encodeInvite({ name: 'Mom', token: FAKE });
  assert.match(code, /^[A-Za-z0-9_-]+$/, 'base64url: no +, / or = in the fragment');
  assert.deepEqual(JSON.parse(Buffer.from(code, 'base64url').toString('utf8')), { v: 1, n: 'Mom', t: FAKE });
  assert.deepEqual(decodeInvite(code), { name: 'Mom', token: FAKE });
  const arabic = encodeInvite({ name: 'ماما', token: OTHER });
  assert.deepEqual(decodeInvite(arabic), { name: 'ماما', token: OTHER }, 'non-Latin names survive');
});

test('invite: the link is the app address plus a fragment; never a query string', () => {
  const link = inviteLink('https://mohamed3042.github.io/mk-cinema/?demo&x=1#old', { name: 'Dad', token: FAKE });
  const url = new URL(link);
  assert.equal(`${url.origin}${url.pathname}`, 'https://mohamed3042.github.io/mk-cinema/');
  assert.equal(url.search, '', 'no query string');
  assert.ok(url.hash.startsWith('#invite='));
  assert.ok(!link.split('#')[0].includes(FAKE), 'the key is only after #');
  assert.deepEqual(decodeInvite(url.hash.slice(8)), { name: 'Dad', token: FAKE });
  assert.equal(new URL(inviteLink('https://mohamed3042.github.io/mk-cinema/index.html', { name: 'Dad', token: FAKE })).pathname, '/mk-cinema/');
});

test('invite: bad links decode to null', () => {
  const bad = [
    '', 'not base64!', '%%%', b64url('{not json'), b64url('null'), b64url([1, 2]),
    b64url({ v: 2, n: 'Mom', t: FAKE }), b64url({ n: 'Mom', t: FAKE }), b64url({ v: 1, n: '', t: FAKE }), b64url({ v: 1, n: 7, t: FAKE }),
    b64url({ v: 1, n: 'Mom', t: 'ghp_classicclassicclassicclassic1234' }), b64url({ v: 1, n: 'Mom', t: 'github_pat_short' }),
    b64url({ v: 1, n: 'Mom', t: `${FAKE}\n` }), b64url({ v: 1, n: 'Mom', t: `${FAKE}<script>` }), b64url({ v: 1, n: 'Mom<b>', t: FAKE }),
    b64url({ v: 1, n: 'x'.repeat(NAME_MAX + 1), t: FAKE }), 'A'.repeat(2001), Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url'),
  ];
  for (const value of bad) assert.equal(decodeInvite(value), null, `refused: ${value.slice(0, 40)}`);
  assert.throws(() => encodeInvite({ name: 'Mom', token: 'ghp_classicclassicclassicclassic1234' }), 'a classic key never goes into a link');
  assert.throws(() => encodeInvite({ name: '  ', token: FAKE }));
});

test('invite: taking it from the address removes the fragment at once', () => {
  const calls = [];
  const hist = { state: { keep: 1 }, replaceState(...args) { calls.push(args); } };
  const loc = { hash: `#invite=${encodeInvite({ name: 'Mom', token: FAKE })}`, pathname: '/mk-cinema/', search: '' };
  assert.deepEqual(takeInvite(loc, hist), { name: 'Mom', token: FAKE });
  assert.deepEqual(calls, [[{ keep: 1 }, '', '/mk-cinema/']], 'replaceState with no fragment');
  assert.deepEqual(takeInvite({ hash: '#invite=garbage', pathname: '/', search: '?demo' }, hist), { bad: true });
  assert.deepEqual(calls.at(-1), [{ keep: 1 }, '', '/?demo'], 'a broken invite is removed as well');
  assert.equal(takeInvite({ hash: '#main', pathname: '/', search: '' }, hist), null, 'other fragments are left alone');
  assert.equal(calls.length, 2);
});

test('invite: a pasted link, or a message around it, opens the invite; a broken or foreign link is told apart', () => {
  const app = 'https://mohamed3042.github.io/mk-cinema/';
  const link = inviteLink(app, { name: 'Mom', token: FAKE }), mom = { name: 'Mom', token: FAKE };
  assert.deepEqual(inviteFromText(link, app), mom, 'the whole link');
  assert.deepEqual(inviteFromText(`Mohamed shared his cinema with you. ${link}`, app), mom, 'the shared message');
  assert.deepEqual(inviteFromText(`Here it is:\n${link}.`, `${app}index.html`), mom, 'a full stop after it; the app opened as index.html');
  assert.deepEqual(inviteFromText(`  ${link.replace('/mk-cinema/', '/mk-cinema/index.html')}  `, app), mom, 'the link to index.html');
  assert.deepEqual(inviteFromText(link.slice(link.indexOf('#')), app), mom, 'the fragment alone');
  for (const text of ['see you at 8', '', '   ', null, undefined, app]) assert.equal(inviteFromText(text, app), null, `no invite: ${text}`);
  assert.deepEqual(inviteFromText(link.slice(0, -12), app), { bad: true }, 'a link cut short');
  assert.deepEqual(inviteFromText(`${app}#invite=`, app), { bad: true });
  assert.deepEqual(inviteFromText(link.replace('/mk-cinema/', '/mk-news/'), app), { other: true }, "another app's invite");
  assert.deepEqual(inviteFromText(link.replace('https://mohamed3042.github.io', 'https://example.test'), app), { other: true });
  assert.deepEqual(inviteFromText(link.replace('https://mohamed3042.github.io', 'HTTPS://MOHAMED3042.GITHUB.IO'), app), mom, 'capitals in the scheme and host');
  assert.deepEqual(inviteFromText(link.replace('https://mohamed3042.github.io', 'HTTPS://example.test'), app), { other: true }, 'capitals never skip the check');
  assert.deepEqual(inviteFromText(link.replace('https://mohamed3042.github.io', 'https://example.test:99999'), app), { other: true }, 'an address that does not parse is refused');
});

test('invite: GitHub token page is pre-filled for the person', () => {
  const url = new URL(tokenPageURL('Mom'));
  assert.equal(`${url.origin}${url.pathname}`, 'https://github.com/settings/personal-access-tokens/new');
  assert.equal(url.searchParams.get('name'), 'MK Cinema – Mom');
  assert.equal(url.searchParams.get('target_name'), 'Mohamed3042');
  assert.equal(url.searchParams.get('expires_in'), '90');
  assert.equal(url.searchParams.get('contents'), 'read');
  assert.match(url.searchParams.get('description'), /mk-cinema-library/);
  assert.ok(url.searchParams.get('description').length <= 1024);
  for (const write of ['administration', 'workflows', 'pull_requests', 'issues']) assert.equal(url.searchParams.get(write), null);
  assert.ok([...new URL(tokenPageURL('x'.repeat(80))).searchParams.get('name')].length <= 40, "GitHub's 40-character name limit");
});

test('invite: names are cleaned and capped; only fine-grained keys pass', () => {
  assert.equal(cleanName('  Aunt \n  Sara  '), 'Aunt Sara');
  assert.equal(cleanName('<b>Dad</b>'), 'bDad/b');
  assert.equal([...cleanName('y'.repeat(60))].length, NAME_MAX);
  assert.equal(isFineGrained(FAKE), true);
  for (const key of ['ghp_abcdefabcdefabcdefabcdef123456', 'gho_x', '', null, `${FAKE} `]) assert.equal(isFineGrained(key), false);
});

test('invite list keeps only the last 4 characters, never the key', () => {
  const store = storage();
  addInvite(store, { name: 'Mom', token: FAKE, now: Date.parse('2026-10-24T09:00:00Z'), id: 'a' });
  addInvite(store, { name: 'Dad', token: OTHER, expires: '2027-01-22T10:00:00Z', now: Date.parse('2026-10-25T09:00:00Z'), id: 'b' });
  const raw = store.getItem(INVITES_KEY);
  assert.ok(!raw.includes(FAKE) && !raw.includes(OTHER) && !raw.includes('github_pat_'), 'no full key in storage');
  const list = readInvites(store);
  assert.deepEqual(list.map(item => [item.name, item.last4]), [['Dad', '9876'], ['Mom', '1234']], 'newest first');
  assert.equal(list[1].expires, '2027-01-22T09:00:00.000Z', 'unknown expiry: the planned 90 days');
  assert.equal(list[1].expiresKnown, false);
  assert.equal(list[0].expires, '2027-01-22T10:00:00.000Z');
  assert.equal(list[0].expiresKnown, true);
  assert.deepEqual(removeInvite(store, 'b').map(item => item.name), ['Mom']);
  assert.deepEqual(readInvites(storage({ [INVITES_KEY]: JSON.stringify([{ id: 'x', name: 'Eve', last4: FAKE, made: '2026-10-24' }, 'junk', null]) })), [], 'a stored full key is never shown back');
  assert.deepEqual(readInvites(storage({ [INVITES_KEY]: '{broken' })), []);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => addInvite(blocked, { name: 'Mom', token: FAKE }));
});

test('guest label is read back safely', () => {
  const store = storage();
  writeGuest(store, { name: 'Mom' });
  assert.deepEqual(readGuest(store), { name: 'Mom', left: false });
  writeGuest(store, { name: 'Mom', left: true });
  assert.deepEqual(readGuest(store), { name: 'Mom', left: true });
  assert.ok(!store.getItem('mkc.guest').includes('github_pat_'), 'the label never holds the key');
  writeGuest(store, null);
  assert.equal(readGuest(store), null);
  assert.equal(readGuest(storage({ 'mkc.guest': '{"name":""}' })), null);
  assert.equal(readGuest(storage({ 'mkc.guest': 'nope' })), null);
});
