const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

/** Single-pass composer tokenizer. Generated output is never scanned again. */
export function expandChannelAliases(
	input: string,
	aliases: Readonly<Record<string, string>>,
	agentNames: ReadonlyArray<string>
): string {
	const agents = new Set(agentNames.map((name) => name.toLowerCase()));
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
			const replacement = agents.has(name.toLowerCase()) ? undefined : aliases[name];
			out += replacement ?? line.slice(i, end);
			i = end;
		}
		return out;
	}).join('\n');
}
