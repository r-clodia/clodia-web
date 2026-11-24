<script lang="ts">
	/**
	 * Alias pills inside a chat input (clodia-platform#723).
	 *
	 * One pill per alias of the signed-in person; a click inserts the alias
	 * TEXT into `target` at the caret (or at the end when the input did not
	 * have the focus) and then STARTS THE TURN through `onSend`, the input's
	 * own send (owner, 24 Nov 2026: «deve anche avviare il turno e non solo
	 * riempire l'input»). The component never calls an API itself: sending is
	 * the input's, with its checks. The value is written on the element and an
	 * `input` event is dispatched, so the parent's `bind:value` and its own
	 * `on:input` handlers run exactly as if the person had typed; `onSend` runs
	 * after a tick, once `bind:value` holds the text. Without `onSend` the pill
	 * only inserts.
	 *
	 * No aliases → nothing is rendered.
	 */
	import { onMount, tick } from 'svelte';
	import { channelAliases, loadChannelAliases } from '$lib/stores/channelAliases';
	import { aliasPillList, insertAliasText } from '$lib/aliasPills.js';

	export let target: HTMLTextAreaElement | null | undefined = null;
	export let disabled = false;
	/** The input's own send: called after the text is in. */
	export let onSend: (() => void | Promise<void>) | null = null;

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

	async function insert(text: string) {
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
		if (onSend) {
			await tick();
			await onSend();
		}
	}
</script>

{#if pills.length}
	<div class="alias-pills" bind:this={row} role="toolbar" aria-label={onSend ? "Alias: un clic invia il testo" : "Alias: un clic inserisce il testo nel messaggio"}>
		{#each pills as p (p.name)}
			<!-- mousedown is cancelled so a click keeps the focus (and the caret) in the input -->
			<button type="button" class="alias-pill" title={p.text}
				aria-label="{onSend ? 'Invia' : 'Inserisci'} l'alias {p.name}: {p.text}"
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
