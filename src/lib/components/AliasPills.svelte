<script lang="ts">
	/**
	 * Alias pills inside a chat input (clodia-platform#723).
	 *
	 * One pill per alias of the signed-in person; a click inserts the alias
	 * TEXT into `target` at the caret (or at the end when the input did not
	 * have the focus), focuses it and leaves the caret after the text. It never
	 * sends. The value is written on the element and an `input` event is
	 * dispatched, so the parent's `bind:value` and its own `on:input` handlers
	 * (mentions, commands, auto-grow) run exactly as if the person had typed.
	 *
	 * No aliases → nothing is rendered.
	 */
	import { onMount } from 'svelte';
	import { channelAliases, loadChannelAliases } from '$lib/stores/channelAliases';
	import { aliasPillList, insertAliasText } from '$lib/aliasPills.js';

	export let target: HTMLTextAreaElement | null | undefined = null;
	export let disabled = false;

	let row: HTMLDivElement;
	/** Keyboard path: focus came to the pills straight from the input, so the
	 *  caret the person left there is where the text goes. */
	let fromInput = false;

	$: pills = aliasPillList($channelAliases);

	onMount(() => {
		void loadChannelAliases();
	});

	function onPillFocus(e: FocusEvent) {
		const prev = e.relatedTarget;
		if (target && prev === target) fromInput = true;
		else if (!(prev instanceof Node && row?.contains(prev))) fromInput = false;
	}

	function insert(text: string) {
		const el = target;
		if (!el || disabled) return;
		const atCursor = document.activeElement === el || fromInput;
		const next = insertAliasText(el.value, text, el.selectionStart, el.selectionEnd, atCursor);
		fromInput = false;
		el.focus();
		el.value = next.value;
		el.setSelectionRange(next.caret, next.caret);
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.setSelectionRange(next.caret, next.caret);
	}
</script>

{#if pills.length}
	<div class="alias-pills" bind:this={row} role="toolbar" aria-label="Alias: un clic inserisce il testo nel messaggio">
		{#each pills as p (p.name)}
			<!-- mousedown is cancelled so a click keeps the focus (and the caret) in the input -->
			<button type="button" class="alias-pill" title={p.text}
				aria-label="Inserisci l'alias {p.name}: {p.text}"
				{disabled}
				on:mousedown|preventDefault
				on:focus={onPillFocus}
				on:click={() => insert(p.text)}>{p.name}</button>
		{/each}
	</div>
{/if}

<style>
	.alias-pills {
		display: flex;
		flex-wrap: nowrap;
		gap: 4px;
		overflow-x: auto;
		overflow-y: hidden;
		padding: 5px 8px 1px;
		scrollbar-width: thin;
		-webkit-overflow-scrolling: touch;
		min-width: 0;
		max-width: 100%;
	}
	.alias-pill {
		flex: 0 0 auto;
		max-width: 14em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
		color: var(--fg-muted);
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		height: 22px;
		padding: 0 9px;
		border-radius: 999px;
		cursor: pointer;
	}
	.alias-pill:hover:not(:disabled) {
		color: var(--accent);
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}
	.alias-pill:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.alias-pill:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	@media (pointer: coarse) {
		.alias-pill { height: 28px; font-size: 12px; padding: 0 11px; }
	}
</style>
