<script lang="ts">
	/**
	 * Cards / table switch for a list page (clodia-platform#656).
	 *
	 * The page owns the value and reads it with `readView(page)` while it
	 * initialises, so the first paint already uses the stored layout. This
	 * component only renders the switch and persists a change to the
	 * `clodia_view_<page>` cookie.
	 */
	import { writeView } from '$lib/viewPref.js';

	/** Page id: the cookie becomes `clodia_view_<page>`. */
	export let page: string;
	export let view: 'cards' | 'table' = 'cards';

	function choose(v: 'cards' | 'table') {
		if (v === view) return;
		view = v;
		writeView(page, v);
	}
</script>

<div class="view-toggle" role="group" aria-label="Vista">
	<button type="button" class:active={view === 'cards'} aria-pressed={view === 'cards'}
		title="Vista a schede" on:click={() => choose('cards')}>▦ Schede</button>
	<button type="button" class:active={view === 'table'} aria-pressed={view === 'table'}
		title="Vista a tabella" on:click={() => choose('table')}>☰ Tabella</button>
</div>

<style>
	.view-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
	.view-toggle button { background: transparent; border: 0; border-radius: 0; color: var(--fg-muted);
		font: inherit; font-size: 12px; font-weight: 600; padding: 6px 10px; cursor: pointer; }
	.view-toggle button + button { border-left: 1px solid var(--border); }
	.view-toggle button:hover { color: var(--fg); }
	.view-toggle button.active { background: var(--accent); color: var(--accent-fg); }
</style>
