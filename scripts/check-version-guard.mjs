#!/usr/bin/env node
/**
 * Unit tests for `scripts/version-guard.mjs` (clodia-platform#355), plus the
 * wiring that makes CI actually run it. Offline: the GitHub API is a fake
 * `fetchText(url, accept)` built from a `{ number: version }` map.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggiSorgente } from './lib/sorgente.mjs';
import {
	ApiError,
	claimedVersions,
	collisions,
	compare,
	githubFetcher,
	lockMismatches,
	openPullRequests,
	pullRequestNumber,
	run,
	suggestFree
} from './version-guard.mjs';

const API = 'https://api.example';
const REPO = 'r-clodia/clodia-web';

/** Fake GitHub: `prs` = { number: version | null }, `main` = base version. */
function fakeGitHub(prs, { main = '0.253.0', brokenListing = false } = {}) {
	const calls = [];
	const fetchText = async (url) => {
		calls.push(url);
		const u = new URL(url);
		if (u.pathname.endsWith('/pulls')) {
			if (brokenListing) throw new ApiError(`HTTP 502 from ${url}`);
			const page = Number(u.searchParams.get('page'));
			const all = Object.keys(prs).map(Number).sort((a, b) => b - a);
			return JSON.stringify(all.slice((page - 1) * 100, page * 100).map((n) => ({ number: n, head: { sha: `sha${n}` } })));
		}
		const ref = u.searchParams.get('ref');
		if (ref === 'main') return JSON.stringify({ version: main });
		const v = prs[Number(ref.replace('sha', ''))];
		if (v === null) throw new ApiError(`HTTP 404 from ${url}`);
		return JSON.stringify({ name: 'webui-v2', version: v });
	};
	return { fetchText, calls };
}

const pkg = (v) => JSON.stringify({ name: 'webui-v2', version: v });
const lock = (v, inner = v) => JSON.stringify({ name: 'webui-v2', version: v, packages: { '': { version: inner } } });
const env = (number) => ({ GITHUB_BASE_REF: 'main', GITHUB_REPOSITORY: REPO, GITHUB_REF: `refs/pull/${number}/merge`, GITHUB_API_URL: API });

async function check(number, version, gh, files) {
	const lines = [];
	const code = await run({ env: env(number), files: files ?? { pkg: pkg(version), lock: lock(version) }, fetchText: gh.fetchText, log: (l) => lines.push(l) });
	return { code, out: lines.join('\n') };
}

test('numeric comparison, missing components are zero', () => {
	assert.equal(compare('0.100.0', '0.99.0'), 1);
	assert.equal(compare('0.253', '0.253.0'), 0);
	assert.throws(() => compare('0.253.0-rc1', '0.253.0'));
});

test('package-lock.json must carry the same version twice', () => {
	assert.deepEqual(lockMismatches(pkg('0.261.0'), lock('0.261.0')), []);
	assert.equal(lockMismatches(pkg('0.261.0'), lock('0.253.0')).length, 2);
	assert.equal(lockMismatches(pkg('0.261.0'), lock('0.261.0', '0.253.0')).length, 1);
});

test('lists open PRs towards the same base, following pagination', async () => {
	const prs = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [i + 1, '0.1.0']));
	const gh = fakeGitHub(prs);
	const found = await openPullRequests(REPO, 'main', gh.fetchText, API);
	assert.equal(found.length, 250);
	assert.equal(gh.calls.length, 3);
	assert.match(gh.calls[0], /state=open/);
	assert.match(gh.calls[0], /base=main/);
});

test('reads each version at the PR head, skips its own, warns on unreadable ones', async () => {
	const gh = fakeGitHub({ 300: '0.253.1', 301: null, 302: 'nope', 303: '0.255.0' });
	const warnings = [];
	const claims = await claimedVersions(REPO, 'main', 303, gh.fetchText, API, (l) => warnings.push(l));
	assert.deepEqual(claims, { 300: '0.253.1' });
	assert.ok(!gh.calls.some((c) => c.includes('ref=sha303')));
	assert.equal(warnings.length, 2);
	assert.match(warnings.join('\n'), /#301/);
	assert.match(warnings.join('\n'), /#302/);
});

test('the lower PR number keeps the version', () => {
	assert.deepEqual(collisions(301, '0.253.1', { 300: '0.253.1', 302: '0.253.1', 303: '0.256.0' }), { older: [300], newer: [302] });
});

test('suggestion bumps the same component above every claim', () => {
	const claimed = ['0.256.0', '0.258.1', '0.260.0'];
	assert.equal(suggestFree('0.253.1', '0.253.0', claimed), '0.260.1');
	assert.equal(suggestFree('0.256.0', '0.253.0', claimed), '0.261.0');
});

test('collision with an older open PR fails and names it (web#300 / #301 on 0.253.1)', async () => {
	const { code, out } = await check(301, '0.253.1', fakeGitHub({ 300: '0.253.1', 310: '0.260.0' }));
	assert.equal(code, 1);
	assert.match(out, /::error::.*#300/);
	assert.match(out, /first free: 0\.260\.1/);
});

test('the older PR stays green and warns about the newer one', async () => {
	const { code, out } = await check(300, '0.253.1', fakeGitHub({ 301: '0.253.1' }));
	assert.equal(code, 0);
	assert.match(out, /::warning::#301/);
});

test('a free version above main passes', async () => {
	const { code, out } = await check(311, '0.261.0', fakeGitHub({ 300: '0.253.1', 310: '0.260.0' }));
	assert.equal(code, 0, out);
});

test('a version not above main fails', async () => {
	const { code, out } = await check(311, '0.253.0', fakeGitHub({}));
	assert.equal(code, 1);
	assert.match(out, /stale/);
});

test('a lock out of step fails before any API call', async () => {
	const gh = fakeGitHub({});
	const { code } = await check(311, '0.261.0', gh, { pkg: pkg('0.261.0'), lock: lock('0.253.0') });
	assert.equal(code, 1);
	assert.equal(gh.calls.length, 0);
});

test('an API failure is red, not green', async () => {
	const { code, out } = await check(311, '0.261.0', fakeGitHub({}, { brokenListing: true }));
	assert.equal(code, 1);
	assert.match(out, /::error::/);
});

test('without a token it says how to wire it; outside a PR it does nothing', async () => {
	const lines = [];
	assert.equal(await run({ env: env(311), files: { pkg: pkg('0.261.0'), lock: lock('0.261.0') }, log: (l) => lines.push(l) }), 1);
	assert.match(lines.join('\n'), /GITHUB_TOKEN/);
	assert.equal(await run({ env: {}, files: {}, log: () => {} }), 0);
});

test('PR number from the event payload, else from the merge ref', () => {
	assert.equal(pullRequestNumber('/e.json', null, () => '{"pull_request":{"number":42}}'), 42);
	assert.equal(pullRequestNumber(null, 'refs/pull/7/merge'), 7);
	assert.equal(pullRequestNumber(null, 'refs/heads/main'), null);
});

test('HTTP layer: token header, rate limit reported as such', async () => {
	let seen;
	const ok = githubFetcher('tok', async (url, init) => {
		seen = init.headers;
		return { ok: true, text: async () => 'body' };
	});
	assert.equal(await ok('https://api.example/x', 'raw'), 'body');
	assert.equal(seen.Authorization, 'Bearer tok');
	assert.equal(seen.Accept, 'raw');
	const limited = githubFetcher('tok', async () => ({ ok: false, status: 403, headers: new Map([['x-ratelimit-remaining', '0']]) }));
	await assert.rejects(limited('https://api.example/x', 'raw'), /rate limit/);
	const missing = githubFetcher('tok', async () => ({ ok: false, status: 404, headers: new Map() }));
	await assert.rejects(missing('https://api.example/x', 'raw'), /404/);
});

test('wired into CI: npm script, workflow step, read-only token', () => {
	const guasti = [];
	const pkgJson = leggiSorgente('package.json', guasti);
	const workflow = leggiSorgente('.github/workflows/tests.yml', guasti, 'the CI workflow');
	assert.deepEqual(guasti, []);
	assert.equal(JSON.parse(pkgJson).scripts['version-check'], 'node scripts/version-guard.mjs');
	assert.match(workflow, /run: npm run version-check/);
	assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
	assert.match(workflow, /^\s+pull-requests:\s*read\s*$/m);
	assert.doesNotMatch(workflow, /pull-requests:\s*write/);
});
