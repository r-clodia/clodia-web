/**
 * The single owner of `document.title` (clodia-platform#510).
 *
 * Three writers used to fight over it: `app.html`, the Sidebar (the branding
 * name, re-applied on every profile change, overwriting any page title) and
 * the mention blink (which saved `document.title` as its base and could
 * restore a stale one after a navigation). Now each says only its part:
 * - the Sidebar sets the brand (`setBrand`);
 * - a page sets its own part, through `<PageTitle part=…>` (`setPagePart`);
 * - the mention blink sets a temporary override (`setTitleOverride`), and
 *   clearing it shows whatever the page title is NOW.
 */
import { derived, writable } from 'svelte/store';
import { composeTitle } from '$lib/pageTitle';

const _brand = writable('Clodia');
const _part = writable('');
const _override = writable<string | null>(null);

export const brand = { subscribe: _brand.subscribe };
export const pageTitle = derived([_part, _brand], ([p, b]) => composeTitle(p, b));

let _owner = 0;

export function setBrand(name: string | null | undefined): void {
	_brand.set((name ?? '').trim() || 'Clodia');
}

/** Set this page's part of the title; the returned function clears it,
 *  unless another page has set its own in the meantime. */
export function setPagePart(part: string | null | undefined): () => void {
	const me = ++_owner;
	_part.set((part ?? '').trim());
	return () => {
		if (_owner === me) _part.set('');
	};
}

export function setTitleOverride(text: string | null): void {
	_override.set(text);
}

if (typeof document !== 'undefined') {
	derived([pageTitle, _override], ([t, o]) => o ?? t).subscribe((t) => {
		document.title = t;
	});
}
