/**
 * Alias pills in the chat input (clodia-platform#723).
 *
 * Every alias the signed-in person defined in Settings → «Alias canali»
 * (`GET /api/channel-aliases`, per principal since clodia-logic#172) shows as
 * a pill inside the composer; a click puts the alias TEXT into the textarea —
 * never `$name`, never a send. The person edits, then sends as usual.
 *
 * Plain JS with JSDoc so the guard (scripts/check-alias-pills.mjs) can import
 * and exercise it without a build.
 */

/**
 * The pills to show, in a stable order (by name). Entries with an empty name
 * or text are dropped: a pill that inserts nothing is noise.
 *
 * @param {Readonly<Record<string, string>> | null | undefined} aliases
 * @returns {{ name: string, text: string }[]}
 */
export function aliasPillList(aliases) {
	if (!aliases || typeof aliases !== 'object') return [];
	return Object.entries(aliases)
		.filter(([name, text]) => typeof text === 'string' && name.trim() !== '' && text.trim() !== '')
		.map(([name, text]) => ({ name: name.replace(/^\$/, ''), text }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Where the alias text lands and where the caret goes after it.
 *
 * - `atCursor` true (the input had the focus): the text replaces the current
 *   selection (or goes at the caret when the selection is empty);
 * - `atCursor` false: the text is appended at the end.
 *
 * A space is added on a side only when the text would otherwise glue onto a
 * word there, so «ciao|» + «fate summary» gives «ciao fate summary|», not
 * «ciaofate summary». The caret ends right after the inserted text (and the
 * separating space after it, if one was added).
 *
 * @param {string} value              current textarea value
 * @param {string} text               alias text to insert
 * @param {number | null | undefined} selStart
 * @param {number | null | undefined} selEnd
 * @param {boolean} atCursor
 * @returns {{ value: string, caret: number }}
 */
export function insertAliasText(value, text, selStart, selEnd, atCursor) {
	const v = String(value ?? '');
	const len = v.length;
	let start = len;
	let end = len;
	if (atCursor && Number.isInteger(selStart)) {
		start = Math.max(0, Math.min(len, /** @type {number} */ (selStart)));
		end = Number.isInteger(selEnd) ? Math.max(start, Math.min(len, /** @type {number} */ (selEnd))) : start;
	}
	const before = v.slice(0, start);
	const after = v.slice(end);
	const lead = before !== '' && !/\s$/.test(before) ? ' ' : '';
	const trail = after !== '' && !/^\s/.test(after) ? ' ' : '';
	const inserted = lead + text + trail;
	return { value: before + inserted + after, caret: before.length + inserted.length };
}
