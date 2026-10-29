<script lang="ts">
	/**
	 * The verbs of a tested MCP backend (clodia-platform#575): what the
	 * backend offers, by the name agents see, and whether the gateway lets
	 * each one through. Descriptions are a third party's text: rendered as
	 * plain text only (Svelte escapes `{…}`; never the raw-HTML tag here).
	 *
	 * Since #633 each reachable tool has a tick: every tool is on until an
	 * admin unticks it here, and an unticked tool is off for the whole
	 * instance — no room, rule or approval brings it back. The tick dispatches
	 * `toggle`; the page calls the gateway and passes the new state back.
	 */
	import { createEventDispatcher } from 'svelte';
	import Modal from './Modal.svelte';
	import type { McpTestVerb } from '$lib/api/client';

	export let open: boolean = false;
	export let backend: string = '';
	export let verbs: McpTestVerb[] = [];
	/** tools whose toggle is in flight, by tool name */
	export let busy: Record<string, boolean> = {};

	const dispatch = createEventDispatcher<{
		close: void;
		toggle: { tool: string; enabled: boolean };
	}>();

	$: abilitati = verbs.filter((v) => v.enabled);
	// Unreachable anyway, but one an admin disabled keeps its tick: otherwise
	// it could never be switched back on from here.
	$: esclusi = verbs.filter((v) => !v.enabled);
	$: attivi = abilitati.filter((v) => !v.disabled);
	// A gateway before #633 sends no `tool`: no ticks, as before.
	$: toggles = abilitati.some((v) => typeof v.tool === 'string');

	function flip(v: McpTestVerb, e: Event) {
		if (!v.tool) return;
		const on = (e.currentTarget as HTMLInputElement).checked;
		// Back to the gateway's state until it answers.
		(e.currentTarget as HTMLInputElement).checked = !v.disabled;
		dispatch('toggle', { tool: v.tool, enabled: on });
	}
</script>

<Modal {open} on:close={() => dispatch('close')} maxWidth={640}>
	<h2 slot="title">
		Verbi di {backend}
		<span class="count">{attivi.length} attivi su {verbs.length}</span>
	</h2>

	<p class="scope">
		{#if toggles}
			Togli la spunta per disattivare un tool su tutta l'istanza: nessun agente lo vede e
			nessuna regola o approvazione lo riattiva. I tool nuovi sono attivi finché non li spegni qui.
		{:else}
			Abilitato = il gateway lo lascia passare su questa istanza. Quale agente può
			usarlo dipende dai suoi permessi.
		{/if}
	</p>

	{#if !verbs.length}
		<p class="empty">Il backend non espone nessun verbo.</p>
	{/if}

	{#if abilitati.length}
		<ul class="verbs">
			{#each abilitati as v, i (i)}
				<li class:spento={v.disabled}>
					{#if toggles && v.tool}
						<label class="riga">
							<input
								type="checkbox"
								checked={!v.disabled}
								disabled={Boolean(busy[v.tool])}
								on:change={(e) => flip(v, e)}
								aria-label={`${v.disabled ? 'Riattiva' : 'Disattiva'} ${v.name}`} />
							<code class="name">{v.name}</code>
							{#if v.new}<span class="nuovo">nuovo</span>{/if}
							{#if v.gone}<span class="off-tag">non più esposto</span>{:else if v.disabled}<span class="off-tag">disattivato</span>{/if}
						</label>
					{:else}
						<code class="name">{v.name}</code>
					{/if}
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
					{#if toggles && v.tool && v.disabled}
						<label class="riga">
							<input
								type="checkbox"
								checked={false}
								disabled={Boolean(busy[v.tool])}
								on:change={(e) => flip(v, e)}
								aria-label={`Riattiva ${v.name}`} />
							<code class="name">{v.name}</code>
							<span class="off-tag">disattivato</span>
						</label>
					{:else}
						<code class="name">{v.name}</code>
					{/if}
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
	.riga {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		cursor: pointer;
	}
	.riga input {
		flex: none;
		margin: 0;
	}
	.name {
		font-family: var(--mono);
		font-size: 13px;
		color: var(--fg);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.spento .name {
		color: var(--fg-muted);
		text-decoration: line-through;
	}
	.nuovo,
	.off-tag {
		flex: none;
		font-size: 11px;
		padding: 1px 6px;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--fg-muted);
	}
	.nuovo {
		color: var(--accent, var(--fg));
	}
	.off-tag {
		color: var(--danger);
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
