<script lang="ts">
	/**
	 * One of the room's lists, named for what it holds (clodia-platform#662):
	 * Fonti / Destinazioni for the web, Mittenti / Destinatari for email,
	 * Gruppi e contatti for a chat. Underneath it is still the room's ingress
	 * or egress list; the gateway authorises the tool when an entry is added
	 * and, for an outbound entry, writes the tool's allow row too.
	 */
	import { createEventDispatcher } from 'svelte';
	import type { UriLabelInfo } from '$lib/api/client';
	import UriLabel from '$lib/components/UriLabel.svelte';

	export let title: string;
	export let hint = '';
	export let entries: string[] = [];
	export let labels: Record<string, UriLabelInfo> | undefined = undefined;
	/** Prefixed to a value typed without a scheme (`mailfrom`, `tg`…); empty
	 *  for the web, where the value is a URL. */
	export let scheme = '';
	export let placeholder = '';
	export let canEdit = false;
	export let busy = false;

	const dispatch = createEventDispatcher<{ add: string; remove: string }>();

	let value = '';

	function compose(v: string): string {
		if (!scheme || /^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
		return `${scheme}:${v}`;
	}

	function add() {
		const v = value.trim();
		if (!v || busy) return;
		dispatch('add', compose(v));
		value = '';
	}
</script>

<div class="room-list">
	<span class="title">{title} <span class="muted">({entries.length})</span></span>
	{#if hint}<span class="muted wrap">{hint}</span>{/if}
	{#if entries.length}
		<ul>
			{#each entries as u (u)}
				<li>
					<span class="who"><UriLabel uri={u} {labels} /></span>
					{#if canEdit}
						<button type="button" class="x" disabled={busy} aria-label="Togli {u}"
							title="Togli da questa stanza" on:click={() => dispatch('remove', u)}>✕</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if canEdit}
		<form on:submit|preventDefault={add}>
			<input type="text" bind:value {placeholder} disabled={busy} aria-label="Aggiungi a {title}" />
			<button type="submit" disabled={busy || !value.trim()}>+</button>
		</form>
	{/if}
</div>

<style>
	.room-list { display: flex; flex-direction: column; gap: 2px; }
	.title { font-size: 11px; font-weight: 600; }
	.muted { color: var(--fg-muted); font-size: 11px; font-weight: 400; }
	.wrap { white-space: normal; }
	ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	li { display: flex; align-items: center; gap: 6px; font-size: 11px; min-width: 0; }
	.who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	form { display: flex; gap: 4px; }
	input { flex: 1 1 120px; min-width: 0; font: inherit; font-size: 11px; padding: 2px 4px;
		border: 1px solid var(--border); border-radius: 4px; background: transparent; color: inherit; }
	form button { font: inherit; font-size: 11px; padding: 0 8px; cursor: pointer;
		border: 1px solid var(--border); border-radius: 4px; background: transparent; color: inherit; }
	form button:disabled { opacity: .5; cursor: default; }
	.x { background: transparent; border: none; color: var(--fg-muted); cursor: pointer;
		font-size: 11px; padding: 0 2px; flex-shrink: 0; }
	.x:hover:not(:disabled) { color: #dc2626; }
</style>
