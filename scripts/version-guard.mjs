#!/usr/bin/env node
/**
 * Version guard for pull requests (clodia-platform#355).
 *
 * Every PR in this repo bumps `version` in `package.json` (and the two copies
 * in `package-lock.json`). Two PRs opened on the same day start from the same
 * `main` and often pick the same number: both are above `main`, both are green,
 * git reports no conflict at merge because the final line is identical, and the
 * second one ships a release with a number already used. Nothing re-runs the
 * second PR's check when `main` moves, so the collision has to be caught while
 * both PRs are still open.
 *
 * On a `pull_request` run this checks, in order:
 *   1. `package.json` and `package-lock.json` (root + `packages[""]`) declare
 *      the same version;
 *   2. that version is strictly above the one on the base branch NOW (read
 *      through the API at run time, not from where the branch started);
 *   3. no other open PR towards the same base declares the same version. The
 *      LOWER PR number keeps it: if both failed both would re-bump and could
 *      collide again, so exactly one has to move and the message names the PR
 *      that owns the number and the first free one.
 *
 * Cost: one paginated `GET /pulls?base=…` plus one `GET /contents/package.json`
 * per other open PR, with the workflow's read-only GITHUB_TOKEN (1000 req/h per
 * repository). No extra secret. Fork PRs work the same way: their head commit
 * is readable through the base repository with a read-only token.
 *
 * Twin of `server/version_guard.py --open-prs` in clodia-logic and
 * clodia-tools: same rules, different version file. If the logic changes here,
 * change it there too.
 *
 * Outside a pull_request run (`GITHUB_BASE_REF` empty) it does nothing: locally
 * there is no target, and on a push to `main` it would compare main to itself.
 * The pure functions are unit-tested by `check-version-guard.mjs`.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const GITHUB_API = 'https://api.github.com';
const NUMERIC = /^\d+(\.\d+)*$/;

export class ApiError extends Error {}

/** `"0.253.0"` → `[0, 253, 0]`; anything but digits and dots is an error. */
export function parseVersion(value) {
	const v = String(value ?? '').trim();
	if (!NUMERIC.test(v)) throw new Error(`not a numeric version: ${JSON.stringify(value)}`);
	return v.split('.').map(Number);
}

function padded(a, b) {
	const width = Math.max(a.length, b.length);
	const pad = (v) => [...v, ...Array(width - v.length).fill(0)];
	return [pad(a), pad(b)];
}

/** -1, 0, 1. Missing components count as zero: `1.2` equals `1.2.0`. */
export function compare(x, y) {
	const [a, b] = padded(parseVersion(x), parseVersion(y));
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
	return 0;
}

/** The version a `package.json` text declares. */
export function versionOfPackage(text) {
	const version = JSON.parse(text).version;
	parseVersion(version);
	return version;
}

/** Problems with `package.json` vs `package-lock.json`, as messages. */
export function lockMismatches(pkgText, lockText) {
	const version = JSON.parse(pkgText).version;
	const lock = JSON.parse(lockText);
	const out = [];
	if (lock.version !== version)
		out.push(`package-lock.json "version" is ${lock.version}, package.json says ${version}`);
	if (lock.packages?.['']?.version !== version)
		out.push(`package-lock.json packages[""].version is ${lock.packages?.['']?.version}, package.json says ${version}`);
	return out;
}

/** PRs declaring `own` split into `{ older, newer }` by PR number. */
export function collisions(ownNumber, own, claims) {
	const same = Object.entries(claims)
		.filter(([, v]) => compare(v, own) === 0)
		.map(([n]) => Number(n))
		.sort((a, b) => a - b);
	return { older: same.filter((n) => n < ownNumber), newer: same.filter((n) => n > ownNumber) };
}

/**
 * Next version above every claim, bumping the same component this PR bumped
 * against `base` (patch stays patch, minor stays minor). Above the maximum and
 * not "the first gap", so it does not go stale when the PRs below it merge.
 */
export function suggestFree(head, base, claimed) {
	const all = [head, base, ...claimed].map(parseVersion);
	const width = Math.max(...all.map((v) => v.length));
	const pad = (v) => [...v, ...Array(width - v.length).fill(0)];
	const [h, b] = [pad(all[0]), pad(all[1])];
	let position = h.findIndex((n, i) => n !== b[i]);
	if (position < 0) position = width - 1;
	const top = all.map(pad).reduce((m, v) => (compare(v.join('.'), m.join('.')) > 0 ? v : m));
	return [...top.slice(0, position), top[position] + 1, ...Array(width - position - 1).fill(0)].join('.');
}

/** Open PRs of `repo` towards `base` as `[{ number, sha }]`, all pages. */
export async function openPullRequests(repo, base, fetchText, api = GITHUB_API) {
	const found = [];
	for (let page = 1; ; page++) {
		const q = new URLSearchParams({ state: 'open', base, per_page: '100', page: String(page) });
		let batch;
		try {
			batch = JSON.parse(await fetchText(`${api}/repos/${repo}/pulls?${q}`, 'application/vnd.github+json'));
			found.push(...batch.map((pr) => ({ number: Number(pr.number), sha: pr.head.sha })));
		} catch (e) {
			if (e instanceof ApiError) throw e;
			throw new ApiError(`unexpected answer listing open PRs: ${e.message}`);
		}
		if (batch.length < 100) return found;
	}
}

/**
 * `{ number: version }` declared by every OTHER open PR towards `base`.
 * Listing is fail-closed; one unreadable PR is a warning, because that input
 * comes from somebody else's branch and must not block an unrelated PR.
 */
export async function claimedVersions(repo, base, ownNumber, fetchText, api = GITHUB_API, log = console.log) {
	const claims = {};
	for (const { number, sha } of await openPullRequests(repo, base, fetchText, api)) {
		if (number === ownNumber) continue;
		try {
			const text = await fetchText(`${api}/repos/${repo}/contents/package.json?ref=${sha}`, 'application/vnd.github.raw+json');
			claims[number] = versionOfPackage(text);
		} catch (e) {
			log(`::warning::cannot read the version declared by #${number}: ${e.message}`);
		}
	}
	return claims;
}

/** The real HTTP layer: Node 20 `fetch`, token, rate-limit aware errors. */
export function githubFetcher(token, fetchImpl = globalThis.fetch) {
	return async (url, accept) => {
		let res;
		try {
			res = await fetchImpl(url, {
				headers: {
					Accept: accept,
					Authorization: `Bearer ${token}`,
					'X-GitHub-Api-Version': '2022-11-28',
					'User-Agent': 'clodia-version-guard'
				}
			});
		} catch (e) {
			throw new ApiError(`cannot reach ${url}: ${e.message}`);
		}
		if (!res.ok) {
			if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0')
				throw new ApiError(`GitHub API rate limit exhausted (${url}); re-run the job later`);
			throw new ApiError(`HTTP ${res.status} from ${url}`);
		}
		return res.text();
	};
}

/** The PR number from the event payload, or from `refs/pull/<n>/merge`. */
export function pullRequestNumber(eventPath, ref, read = (p) => readFileSync(p, 'utf8')) {
	if (eventPath) {
		try {
			const n = JSON.parse(read(eventPath))?.pull_request?.number;
			if (n) return Number(n);
		} catch {
			/* fall back to the ref */
		}
	}
	const m = /^refs\/pull\/(\d+)\//.exec(ref ?? '');
	return m ? Number(m[1]) : null;
}

/**
 * The whole check. Returns the exit code; every message goes through `log`.
 * `files` = `{ pkg, lock }` texts of this PR; `fetchText` is injectable.
 */
export async function run({ env, files, fetchText, log = console.log }) {
	const base = env.GITHUB_BASE_REF;
	if (!base) {
		log('version-check: not a pull request run, nothing to compare against');
		return 0;
	}
	const repo = env.GITHUB_REPOSITORY;
	const number = pullRequestNumber(env.GITHUB_EVENT_PATH, env.GITHUB_REF);
	if (!repo || !number) {
		log('::error::version-check: GITHUB_REPOSITORY or the PR number is missing');
		return 1;
	}
	if (!fetchText) {
		if (!env.GITHUB_TOKEN) {
			log('::error::version-check: GITHUB_TOKEN is not set; the workflow must pass `GITHUB_TOKEN: ${{ github.token }}` to this step');
			return 1;
		}
		fetchText = githubFetcher(env.GITHUB_TOKEN);
	}
	const api = env.GITHUB_API_URL || GITHUB_API;

	let head;
	try {
		head = versionOfPackage(files.pkg);
		const mismatches = lockMismatches(files.pkg, files.lock);
		if (mismatches.length) {
			for (const m of mismatches) log(`::error::${m}`);
			return 1;
		}
	} catch (e) {
		log(`::error::version-check: cannot read this PR's version: ${e.message}`);
		return 1;
	}

	let baseVersion, claims;
	try {
		baseVersion = versionOfPackage(
			await fetchText(`${api}/repos/${repo}/contents/package.json?ref=${encodeURIComponent(base)}`, 'application/vnd.github.raw+json')
		);
		if (compare(head, baseVersion) <= 0) {
			log(`::error::version is ${head} but ${base} is already at ${baseVersion}: the bump is stale. Re-bump from ${base} — git would not report a conflict and the release would reuse a number.`);
			return 1;
		}
		log(`version ${head} > ${baseVersion} on ${base}: ok`);
		claims = await claimedVersions(repo, base, number, fetchText, api, log);
	} catch (e) {
		log(`::error::version-check: ${e.message}`);
		return 1;
	}

	const { older, newer } = collisions(number, head, claims);
	if (older.length) {
		const free = suggestFree(head, baseVersion, Object.values(claims));
		log(`::error::version ${head} is already declared by open PR ${older.map((n) => `#${n}`).join(', ')} towards ${base}. The lower PR number keeps it: re-bump this PR (first free: ${free}).`);
		return 1;
	}
	for (const n of newer) log(`::warning::#${n} also declares ${head}; it is newer than #${number} and its own check asks it to re-bump`);
	log(
		newer.length
			? `version ${head}: #${number} is the oldest open PR declaring it towards ${base}, so it keeps it: ok`
			: `version ${head} not claimed by the other ${Object.keys(claims).length} open PR(s) towards ${base}: ok`
	);
	return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	let files;
	try {
		files = { pkg: readFileSync('package.json', 'utf8'), lock: readFileSync('package-lock.json', 'utf8') };
	} catch (e) {
		console.log(`::error::version-check: ${e.message}`);
		process.exit(1);
	}
	process.exitCode = await run({ env: process.env, files });
}
