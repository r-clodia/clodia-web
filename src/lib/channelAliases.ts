const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

/**
 * Single-pass composer tokenizer. Generated output is never scanned again.
 *
 * `$` belongs to aliases only: since clodia-platform#391 `$name` is no longer a
 * (soft) mention, so agent names are not special here. `$x` expands when an
 * alias `x` exists and stays literal otherwise; `$$` is the literal escape.
 */
export function expandChannelAliases(
	input: string,
	aliases: Readonly<Record<string, string>>
): string {
	let fenced = false;
	return input.split('\n').map((line) => {
		if (/^\s*(```|~~~)/.test(line)) {
			fenced = !fenced;
			return line;
		}
		if (fenced || /^\s*>/.test(line)) return line;
		let out = '';
		let inlineCode = false;
		for (let i = 0; i < line.length;) {
			if (line[i] === '`') {
				inlineCode = !inlineCode;
				out += line[i++];
				continue;
			}
			if (inlineCode || line[i] !== '$') {
				out += line[i++];
				continue;
			}
			if (line[i + 1] === '$') {
				out += '$';
				i += 2;
				continue;
			}
			if (!IDENT_START.test(line[i + 1] || '')) {
				out += line[i++];
				continue;
			}
			let end = i + 2;
			while (end < line.length && IDENT_PART.test(line[end])) end += 1;
			const name = line.slice(i + 1, end);
			const replacement = Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : undefined;
			out += replacement ?? line.slice(i, end);
			i = end;
		}
		return out;
	}).join('\n');
}
