/**
 * Links the owner posts in chat, offered as room sources (clodia-platform#663).
 *
 * Owner, 9 Nov 2026: «quando inserisco un link in chat deve apparire un
 * bottoncino che mi invita a inserirlo tra le fonti autorizzate». Under a
 * message the viewer wrote, each web link not yet covered by the room's Fonti
 * (its ingress list) gets a button that adds its SITE, `https://host/`: a
 * source covers by prefix, and the agent that follows the link will read
 * other pages of the same site.
 *
 * Coverage mirrors the gateway's `egress._matches` for hierarchical schemes:
 * the entry is a prefix of the link on a path boundary (`…/repo` covers
 * `…/repo/tree`, never `…/repo-fork`); `https:*` (the open web of a room)
 * covers every https link. Host lower-cased, path as written.
 *
 * Plain JS, like `autolink.js`: `scripts/check-link-fonte.mjs` imports and
 * RUNS it.
 */

const CANDIDATO = /(?<![A-Za-z0-9@/.-])https?:\/\/[^\s<>"'`]+/gi;
const CODA = '.,;:!?*_';

/** @param {string} s @param {string} c */
function conta(s, c) {
	let n = 0;
	for (const ch of s) if (ch === c) n++;
	return n;
}

/** Trailing sentence punctuation and unbalanced closers are not the URL's.
 *  @param {string} u */
function ripulisci(u) {
	for (;;) {
		const ultimo = u.slice(-1);
		if (!ultimo) return u;
		if (CODA.includes(ultimo)) u = u.slice(0, -1);
		else if (ultimo === ')' && conta(u, ')') > conta(u, '(')) u = u.slice(0, -1);
		else if (ultimo === ']' && conta(u, ']') > conta(u, '[')) u = u.slice(0, -1);
		else return u;
	}
}

/** Hosts that are never a web source: this machine, the LAN, the webui.
 *  @param {string} host @param {string} ownHost */
function interno(host, ownHost) {
	const h = host.toLowerCase();
	if (ownHost && h === ownHost.toLowerCase().replace(/:\d+$/, '')) return true;
	if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
	if (/^\[/.test(h)) return true; // IPv6 literal
	const ip = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
	if (ip) {
		const [a, b] = [Number(ip[1]), Number(ip[2])];
		return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) ||
			(a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
	}
	return false;
}

/** `https://Host/p` → `https://host/p` (path kept), or null if not a URL.
 *  @param {string} u */
function canonico(u) {
	let p;
	try {
		p = new URL(u);
	} catch {
		return null;
	}
	if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
	if (!p.hostname) return null;
	return { url: `${p.protocol}//${p.host.toLowerCase()}${p.pathname || '/'}`, sito: `${p.protocol}//${p.host.toLowerCase()}/`, host: p.hostname.toLowerCase(), https: p.protocol === 'https:' };
}

/**
 * Is `url` (canonical) covered by one of the room's source entries?
 * @param {string} url @param {boolean} https @param {string[]} fonti
 */
export function coperto(url, https, fonti) {
	const d = url.toLowerCase();
	for (const f of fonti) {
		const r0 = (f || '').trim();
		if (r0.toLowerCase() === 'https:*') {
			if (https) return true;
			continue;
		}
		const c = canonico(r0);
		if (!c) continue;
		const r = c.url.toLowerCase();
		if (d === r) return true;
		if (d.startsWith(r) && (r.endsWith('/') || '/?#'.includes(d[r.length]))) return true;
	}
	return false;
}

/**
 * The sites to offer for a message: one per host, in order of appearance,
 * skipping links already covered and internal hosts.
 *
 * @param {string} text the message as written
 * @param {string[]} fonti the room's ingress entries
 * @param {string} [ownHost] the webui's host (its links are not sources)
 * @returns {{ sito: string, host: string }[]}
 */
export function fontiDaProporre(text, fonti, ownHost = '') {
	const out = [];
	const visti = new Set();
	for (const m of (text || '').matchAll(CANDIDATO)) {
		const c = canonico(ripulisci(m[0]));
		if (!c || interno(c.host, ownHost) || visti.has(c.sito)) continue;
		visti.add(c.sito);
		if (coperto(c.url, c.https, fonti)) continue;
		out.push({ sito: c.sito, host: c.host });
	}
	return out;
}
