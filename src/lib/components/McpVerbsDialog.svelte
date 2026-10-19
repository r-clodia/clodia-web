<script lang="ts">
	/**
	 * The verbs of a tested MCP backend (clodia-platform#575): what the
	 * backend offers, by the name agents see, and whether the gateway lets
	 * each one through. Descriptions are a third party's text: rendered as
	 * plain text only (Svelte escapes `{…}`; never the raw-HTML tag here).
	 */
	import { createEventDispatcher } from 'svelte';
	import Modal from './Modal.svelte';
	import type { McpTestVerb } from '$lib/api/client';

	export let open: boolean = false;
	export let backend: string = '';
	export let verbs: McpTestVerb[] = [];

	const dispatch = createEventDispatcher<{ close: void }>();

	$: abilitati = verbs.filter((v) => v.enabled);
	$: esclusi = verbs.filter((v) => !v.enabled);
</script>

<Modal {open} on:close={() => dispatch('close')} maxWidth={640}>
	<h2 slot="title">
		Verbi di {backend}
		<span class="count">{abilitati.length} abilitati su {verbs.length}</span>
	</h2>

	<p class="scope">
		Abilitato = il gateway lo lascia passare su questa istanza. Quale agente può
		usarlo dipende dai suoi permessi.
	</p>

	{#if !verbs.length}
		<p class="empty">Il backend non espone nessun verbo.</p>
	{/if}

	{#if abilitati.length}
		<ul class="verbs">
			{#each abilitati as v, i (i)}
				<li>
					<code class="name">{v.name}</code>
					{#if v.description}<p class="desc">{v.description}</p>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if esclusi.length}
		<h3 class="sub">Non abilitati</h3>
		<ul class="verbs off">
			{#each esclusi as v, i (i)}
				<li>
					<code class="name">{v.name}</code>
					{#if v.reason}<p class="reason">{v.reason}</p>{/if}
					{#if v.description}<p class="desc">{v.description}</p>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<svelte:fragment slot="actions">
		<button type="button" class="btn-secondary" on:click={() => dispatch('close')}>Chiudi</button>
	</svelte:fragment>
</Modal>

<style>
	.count {
		margin-left: 8px;
		font-size: 12.5px;
		font-weight: 400;
		color: var(--fg-muted);
	}
	.scope {
		margin: 0 0 12px;
		color: var(--fg-muted);
		font-size: 12.5px;
		line-height: 1.45;
	}
	.empty {
		margin: 0;
		color: var(--fg-muted);
		font-size: 13.5px;
	}
	.verbs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.verbs li {
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		min-width: 0;
	}
	.name {
		font-family: var(--mono);
		font-size: 13px;
		color: var(--fg);
		overflow-wrap: anywhere;
	}
	.desc,
	.reason {
		margin: 4px 0 0;
		font-size: 12.5px;
		line-height: 1.45;
		color: var(--fg-muted);
		overflow-wrap: anywhere;
		white-space: pre-line;
	}
	.reason {
		color: var(--danger);
	}
	.sub {
		margin: 16px 0 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--fg-muted);
	}
	.off .name {
		color: var(--fg-muted);
	}
	.btn-secondary {
		background: transparent;
	}
</style>
