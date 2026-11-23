/**
 * File references printed by agents, made navigable (clodia-platform#725).
 *
 * An agent writes `local/report finale.pdf` or shared/fattura.xml; the reader
 * should be able to open it without hunting for it in the file browser. The
 * link is made only for a file that EXISTS for the reader: existence is read
 * from the folder listing the gateway serves, which already applies
 * participation and clearance. A path the reader cannot see stays plain text.
 *
 * Pure functions, in `.js` so the guard script can execute them.
 */

/** The roots a file path can start with in a topic. `files` and `dump`
 *  stay because they appear in messages already sent. */
export const FILE_ROOTS = ['local', 'shared', 'files', 'dump'];

/** Previewable in the preview window; the others are only downloadable. */
export const PREVIEWABLE = /\.(md|markdown|mdown|mkd|html?|png|jpe?g)$/i;

// A bare path: no spaces (in running text a space ends the reference), but
// letters of any script, digits and the usual punctuation of file names.
const BARE = '[\\p{L}\\p{N}_.\\-+~@%()\\[\\]/]';
// Inside a code span the whole span is the reference: spaces allowed.
const SPAN = '[^`\\n]';
const EXT = '\\.[\\p{L}\\p{N}]{1,8}';

/** @param {string[] | undefined} roots */
function rootsRe(roots) {
	return (roots || FILE_ROOTS).map((/** @type {string} */ r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}

/**
 * The file paths a text cites (bare or alone inside a code span).
 * @param {string} text
 * @param {string[]} [roots]
 * @returns {string[]}
 */
export function fileRefs(text, roots) {
	const r = rootsRe(roots);
	const out = new Set();
	const span = new RegExp('`((?:' + r + ')\\/' + SPAN + '+?' + EXT + ')`', 'gu');
	const bare = new RegExp('(?<![\\p{L}\\p{N}_/])((?:' + r + ')\\/' + BARE + '+?' + EXT + ')(?=$|[\\s,;:!?)"\'»\\]]|\\.(?:\\s|$))', 'gu');
	let m;
	const t = text || '';
	while ((m = span.exec(t))) out.add(m[1]);
	for (const seg of t.split(/(```[\s\S]*?```|`[^`]*`)/g).filter((_, i) => i % 2 === 0)) {
		while ((m = bare.exec(seg))) out.add(m[1]);
	}
	return [...out];
}

/** `local/a/b.pdf` → `local/a` (the folder whose listing says if it exists). */
/** @param {string} path */
export function parentDir(path) {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i);
}

/**
 * Every folder a text may be citing a file in: the folders of `fileRefs`, plus
 * the folders of any `root/…` token, so that a file whose name has a space in
 * running text («local/report finale.pdf») can be found in its listing.
 * @param {string} text
 * @param {string[]} [roots]
 * @returns {string[]}
 */
export function citedDirs(text, roots) {
	const r = rootsRe(roots);
	const out = new Set(fileRefs(text, roots).map(parentDir));
	const tok = new RegExp('(?<![\\p{L}\\p{N}_/])((?:' + r + ')(?:\\/' + BARE + '+)*)\\/', 'gu');
	let m;
	while ((m = tok.exec(text || ''))) out.add(m[1]);
	return [...out].filter(Boolean);
}

/** A markdown link the renderer of `$lib/markdown` reads: `[label](url)`,
 *  whose URL may not contain `)` or spaces, nor the label `]`. */
/** @param {string} label @param {string} url */
function mdLink(label, url) {
	const u = url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
	return `[${label.replace(/\[/g, '(').replace(/\]/g, ')')}](${u})`;
}

/**
 * Turn the cited paths that exist into markdown links.
 * @param {string} text
 * @param {(path: string) => boolean} exists  true only for a file the reader can see
 * @param {(path: string) => string} urlFor   download URL
 * @param {(path: string) => string} previewFor  preview URL
 * @param {string[]} [roots]
 * @param {string[]} [known]  existing file paths: matched literally too (spaces)
 */
export function linkifyFileRefs(text, exists, urlFor, previewFor, roots, known) {
	const r = rootsRe(roots);
	const link = (/** @type {string} */ p) => {
		const dl = mdLink(p, urlFor(p));
		return PREVIEWABLE.test(p) ? `${dl} ${mdLink('🔎', previewFor(p))}` : dl;
	};
	const t = text || '';
	// 1) a code span holding ONLY a path → the link (agents cite paths in `…`).
	const span = new RegExp('`((?:' + r + ')\\/' + SPAN + '+?' + EXT + ')`', 'gu');
	let s = t.replace(span, (whole, p) => (exists(p) ? link(p) : whole));
	// 2) outside code and existing links: known files literally (longest
	//    first, so a name with spaces wins over its first word), then bare
	//    paths by shape.
	const lit = [...new Set(known || [])].filter((p) => exists(p) && /\s/.test(p))
		.sort((a, b) => b.length - a.length);
	const bare = new RegExp('(?<![\\p{L}\\p{N}_/\\[(])((?:' + r + ')\\/' + BARE + '+?' + EXT + ')(?=$|[\\s,;:!?)"\'»\\]]|\\.(?:\\s|$))', 'gu');
	const protect = /(```[\s\S]*?```|`[^`]*`|\[[^\]]*\]\([^)\s]*\))/g;
	for (const p of lit) {
		s = s.split(protect).map((seg, i) => (i % 2 === 0 ? seg.split(p).join(link(p)) : seg)).join('');
	}
	return s
		.split(protect)
		.map((seg, i) => (i % 2 === 0 ? seg.replace(bare, (whole, p) => (exists(p) ? link(p) : whole)) : seg))
		.join('');
}
