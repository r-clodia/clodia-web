<script lang="ts">
	/**
	 * Pick the MCPs to authorise in a room (clodia-platform#620): a button that
	 * opens a centered dialog with every MCP the gateway can give, multiple
	 * selection. An MCP is authorised whole — all its verbs — and its
	 * resources are decided afterwards, in its own panel. What is already
	 * authorised shows checked and cannot be picked again.
	 */
	import { createEventDispatcher } from 'svelte';
	import { toolMayAsk, type McpInfo } from '$lib/api/client';
	import Modal from '$lib/components/Modal.svelte';

	export let catalogue: Record<string, McpInfo> = {};
	/** Ids already authorised. */
	export let authorised: string[] = [];
	export let gated: string[] = [];
	export let disabled = false;

	const dispatch = createEventDispatcher<{ pick: string[] }>();

	let open = false;
	let query = '';
	let picked = new Set<string>();

	$: have = new Set(authorised);
	$: q = query.trim().toLowerCase();
	$: list = Object.values(catalogue)
		.filter((m) => !q || m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
			|| m.namespaces.some((n) => n.toLowerCase().includes(q)))
		.sort((a, b) => a.label.localeCompare(b.label));
	$: count = picked.size;

	const mayAsk = (m: McpInfo) => m.namespaces.some((ns) => toolMayAsk(`${ns}.*`, gated));

	function show() {
		picked = new Set();
		query = '';
		open = true;
	}

	function toggle(id: string) {
		const next = new Set(picked);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		picked = next;
	}

	function confirm() {
		if (count === 0) return;
		dispatch('pick', [...picked].sort());
		open = false;
	}
</script>

<button type="button" class="link-btn open-btn" {disabled} on:click={show}>Autorizza MCP…</button>

<Modal {open} maxWidth={620} on:close={() => (open = false)}>
	<h2 slot="title">Autorizza MCP</h2>
	<div class="body">
		<p class="muted wrap">
			Autorizzare un MCP rende disponibili tutti i suoi verbi a ogni partecipante di questo canale.
			Le risorse che può toccare si decidono dopo, nel suo pannello.
		</p>
		<input class="search" type="search" placeholder="Cerca MCP…" bind:value={query}
			aria-label="Cerca MCP" />
		{#if list.length === 0}
			<p class="muted">Nessun MCP corrisponde.</p>
		{/if}
		<ul class="groups">
			{#each list as m (m.id)}
				<li class="group">
					<label class="check">
						<input type="checkbox" checked={have.has(m.id) || picked.has(m.id)}
							disabled={have.has(m.id)} on:change={() => toggle(m.id)} />
						<span class="ns" title={m.namespaces.join(', ')}>{m.label}</span>
						{#if m.enumerable}
							<span class="muted">· {m.verbs.length} verbi</span>
						{:else}
							<span class="muted" title="Il backend nomina i propri verbi">· verbi del backend</span>
						{/if}
						{#if m.write.length > 0}<span class="badge w">scrive</span>{/if}
						{#if m.verbs.length > m.write.length || !m.enumerable}<span class="badge r">legge</span>{/if}
						{#if mayAsk(m)}<span class="gated" role="img" aria-label="Può chiedere conferma" title="Alcuni verbi possono chiedere conferma">⚠</span>{/if}
						{#if have.has(m.id)}<span class="muted">· già autorizzato</span>{/if}
					</label>
				</li>
			{/each}
		</ul>
	</div>
	<div slot="actions" class="actions">
		<button type="button" class="btn" on:click={() => (open = false)}>Annulla</button>
		<button type="button" class="btn primary" disabled={count === 0} on:click={confirm}>
			{count === 0 ? 'Autorizza' : `Autorizza ${count}`}
		</button>
	</div>
</Modal>

<style>
	.open-btn { margin-top: 8px; }
	.link-btn {
		font-size: 11px; background: transparent; border: 1px solid var(--border);
		border-radius: 4px; color: var(--fg); cursor: pointer; padding: 2px 8px; white-space: nowrap;
	}
	.link-btn:disabled { opacity: .5; cursor: default; }
	.body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
	.search {
		font-size: 13px; padding: 6px 8px; border-radius: 6px;
		border: 1px solid var(--border); background: var(--bg); color: var(--fg);
	}
	.groups { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column;
		gap: 4px; max-height: 55vh; overflow-y: auto; }
	.group { flex: none; border-bottom: 1px solid var(--border); padding: 4px 0; }
	.check { display: flex; align-items: center; gap: 6px; min-width: 0; cursor: pointer; font-size: 13px; }
	.ns { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.muted { color: var(--fg-muted); font-size: 11px; white-space: nowrap; }
	.wrap { white-space: normal; margin: 0; }
	.gated { color: #d97706; }
	.badge { font-size: 10px; border-radius: 3px; padding: 0 4px; border: 1px solid var(--border);
		color: var(--fg-muted); white-space: nowrap; }
	.badge.w { color: #b45309; border-color: #b45309; }
	.actions { display: flex; justify-content: flex-end; gap: 8px; }
	.btn {
		font-size: 13px; padding: 6px 12px; border-radius: 6px; cursor: pointer;
		border: 1px solid var(--border); background: transparent; color: var(--fg);
	}
	.btn.primary { background: var(--accent, #ff6b3d); border-color: transparent; color: #fff; }
	.btn:disabled { opacity: .5; cursor: default; }
</style>
