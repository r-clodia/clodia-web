/**
 * The document title, composed (clodia-platform#510). Pure, in `.js` so the
 * guard script can execute it; the store that owns `document.title` is
 * `$lib/stores/pageTitle`.
 */

/**
 * `<page part> · <brand>`, or the brand alone.
 * @param {string | null | undefined} part
 * @param {string | null | undefined} brand
 * @returns {string}
 */
export function composeTitle(part, brand) {
	const b = (brand ?? '').trim() || 'Clodia';
	const p = (part ?? '').trim();
	return p ? `${p} · ${b}` : b;
}

/**
 * The «on» frame of the mention blink.
 * @param {string | null | undefined} brand
 * @returns {string}
 */
export function blinkTitle(brand) {
	return `● Mention — ${(brand ?? '').trim() || 'Clodia'}`;
}
