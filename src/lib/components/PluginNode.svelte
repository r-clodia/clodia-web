<script lang="ts">
	/**
	 * Nodo espandibile di un plugin nel tree della pagina Packs.
	 * plugin := [skills] + [rules] + [mcp] — figli raggruppati per tipo,
	 * skill/rule linkate alle pagine dettaglio, config MCP espandibile.
	 */
	import { createEventDispatcher } from 'svelte';
	import type { Plugin } from '$lib/api/types';

	export let plugin: Plugin;
	/** Mostra il bottone Rimuovi (usato solo per i plugin sciolti). */
	export let deletable = false;
	/** Forza l'espansione (search attiva). */
	export let forceOpen = false;

	const dispatch = createEventDispatcher<{ delete: Plugin }>();

	let open = false;
	let openMcp = new Set<string>();

	$: isOpen = forceOpen || open;

	function toggleMcp(name: string) {
		if (openMcp.has(name)) openMcp.delete(name);
		else openMcp.add(name);
		openMcp = new Set(openMcp);
	}

	const ORIGIN_LABELS: Record<string, string> = {
		logic: 'nativo',
		local: 'locale',
		external: 'esterno',
		user: 'utente',
		imported: 'importato'
	};

	function summary(p: Plugin): string {
		const parts: string[] = [];
		if (p.counts.skills) parts.push(`${p.counts.skills} skill`);
		if (p.counts.rules) parts.push(`${p.counts.rules} rule`);
		if (p.counts.mcp_servers) parts.push(`${p.counts.mcp_servers} MCP`);
		if (p.counts.workflows) parts.push(`${p.counts.workflows} workflow`);
		if (p.counts.datastores) parts.push(`${p.counts.datastores} datastore`);
		return parts.join(' · ') || 'vuoto';
	}
</script>

<div class="plugin" role="treeitem" aria-expanded={isOpen} aria-selected="false">
	<div class="plugin-head">
		<button type="button" class="plugin-toggle" on:click={() => (open = !open)} aria-label={isOpen ? 'Chiudi' : 'Apri'}>
			<span class="chevron" class:open={isOpen}>▸</span>
			<span class="kind-chip">plugin</span>
			<span class="plugin-name">{plugin.name}</span>
			<span class="origin-chip origin-{plugin.origin}">{ORIGIN_LABELS[plugin.origin] ?? plugin.origin}</span>
			{#if plugin.version}<span class="version">v{plugin.version}</span>{/if}
			<span class="counts">{summary(plugin)}</span>
		</button>
		{#if deletable && plugin.deletable}
			<button type="button" class="danger-ghost" on:click={() => dispatch('delete', plugin)}>Rimuovi</button>
		{/if}
	</div>
	{#if plugin.description}
		<div class="plugin-desc">{plugin.description}</div>
	{/if}
	{#if isOpen}
		<div class="children" role="group">
			{#if plugin.skills.length}
				<div class="group-label">Skills</div>
				{#each plugin.skills as s, i (s.name + '#' + i)}
					<a class="child" href={`/skills/${encodeURIComponent(s.name)}`}>
						<span class="child-kind kind-skill">skill</span>
						<span class="child-name">{s.name}</span>
						<span class="child-desc">{s.description || '—'}</span>
					</a>
				{/each}
			{/if}
			{#if plugin.rules.length}
				<div class="group-label">Rules</div>
				{#each plugin.rules as r, i (r.name + '#' + i)}
					<a class="child" href={`/rules/${encodeURIComponent(r.name)}`}>
						<span class="child-kind kind-rule">rule</span>
						<span class="child-name">{r.name}</span>
						<span class="child-desc">{r.description || '—'}</span>
					</a>
				{/each}
			{/if}
			{#if plugin.mcp_servers.length}
				<div class="group-label">MCP servers</div>
				{#each plugin.mcp_servers as s, i (s.name + '#' + i)}
					<div class="child mcp">
						<button type="button" class="mcp-row" on:click={() => toggleMcp(s.name)}>
							<span class="child-kind kind-mcp">mcp</span>
							<span class="child-name">{s.name}</span>
							<span class="child-desc">{s.transport}</span>
						</button>
						{#if openMcp.has(s.name)}
							<pre class="mcp-config">{JSON.stringify(s.config, null, 2)}</pre>
							<div class="mcp-hint">
								Non montato automaticamente: per attivarlo usa <a href="/tools">Integrations → Add MCP server</a>.
							</div>
						{/if}
					</div>
				{/each}
			{/if}
			{#if plugin.workflows?.length}
				<div class="group-label">Workflows</div>
				{#each plugin.workflows as w (w.name)}
					<a class="child workflow" href="/workflows">
						<span class="child-kind kind-wf">wf</span>
						<span class="child-name">{w.name}</span>
						<span class="child-desc">{w.stages.map((st) => st.lane + (st.human_gate ? ' 🔒' : '')).join(' → ')}</span>
					</a>
				{/each}
			{/if}
			{#if plugin.datastores?.length}
				<div class="group-label">Datastore</div>
				{#each plugin.datastores as d (d.path)}
					<div class="child datastore">
						<span class="child-kind kind-ds">db</span>
						<span class="child-name">{d.path}</span>
						<span class="child-desc">{d.purpose}{d.pii ? ' · PII' : ''}{d.backup ? ' · backup' : ''}</span>
					</div>
				{/each}
			{/if}
			{#if !plugin.skills.length && !plugin.rules.length && !plugin.mcp_servers.length && !plugin.workflows?.length && !plugin.datastores?.length}
				<div class="child empty-child">plugin vuoto</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.plugin {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 8px 12px;
	}
	.plugin-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.plugin-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		padding: 3px 0;
		cursor: pointer;
		color: inherit;
		text-align: left;
	}
	.chevron {
		display: inline-block;
		transition: transform 0.12s ease;
		color: var(--fg-muted);
	}
	.chevron.open {
		transform: rotate(90deg);
	}
	.kind-chip {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 1px 6px;
		border-radius: 999px;
		border: 1px solid rgba(255, 107, 61, 0.55);
		color: var(--accent);
		flex-shrink: 0;
	}
	.plugin-name {
		font-family: var(--mono);
		font-weight: 700;
		font-size: 13px;
	}
	.version {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--fg-muted);
	}
	.counts {
		margin-left: auto;
		font-size: 12px;
		color: var(--fg-muted);
		white-space: nowrap;
	}
	.origin-chip {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 2px 7px;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--fg-muted);
	}
	.origin-logic {
		border-color: var(--accent);
		color: var(--accent);
	}
	.origin-external {
		border-color: rgba(97, 175, 254, 0.7);
		color: #61affe;
	}
	.origin-user,
	.origin-imported {
		border-color: rgba(73, 204, 144, 0.7);
		color: #49cc90;
	}
	.plugin-desc {
		margin: 2px 0 0 22px;
		color: var(--fg-muted);
		font-size: 12px;
	}
	.children {
		margin: 6px 0 4px 22px;
		border-left: 1px solid var(--border);
		padding-left: 12px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.group-label {
		margin-top: 8px;
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
	}
	.group-label:first-child {
		margin-top: 2px;
	}
	.child {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 4px 8px;
		border-radius: 6px;
		color: inherit;
		text-decoration: none;
		min-width: 0;
	}
	a.child:hover {
		background: rgba(255, 107, 61, 0.06);
	}
	.child-kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 1px 6px;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--fg-muted);
		flex-shrink: 0;
	}
	.kind-skill {
		border-color: rgba(255, 107, 61, 0.55);
		color: var(--accent);
	}
	.kind-rule {
		border-color: rgba(97, 175, 254, 0.55);
		color: #61affe;
	}
	.kind-mcp {
		border-color: rgba(73, 204, 144, 0.55);
		color: #49cc90;
	}
	.kind-wf {
		border-color: rgba(199, 154, 46, 0.55);
		color: #c79a2e;
	}
	.kind-ds {
		border-color: rgba(147, 112, 219, 0.55);
		color: #9370db;
	}
	.child-name {
		font-family: var(--mono);
		font-size: 12.5px;
		font-weight: 600;
		flex-shrink: 0;
	}
	.child-desc {
		color: var(--fg-muted);
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.child.mcp {
		display: block;
		padding: 0;
	}
	.mcp-row {
		display: flex;
		align-items: baseline;
		gap: 10px;
		width: 100%;
		background: transparent;
		border: none;
		padding: 4px 8px;
		border-radius: 6px;
		cursor: pointer;
		color: inherit;
		text-align: left;
	}
	.mcp-row:hover {
		background: rgba(73, 204, 144, 0.06);
	}
	.mcp-config {
		margin: 4px 8px 6px;
		padding: 10px 12px;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 11.5px;
		overflow: auto;
	}
	.mcp-hint {
		margin: 0 8px 8px;
		font-size: 11px;
		color: var(--fg-muted);
	}
	.mcp-hint a {
		color: var(--accent);
	}
	.empty-child {
		color: var(--fg-muted);
		font-size: 12px;
		font-style: italic;
	}
	.danger-ghost {
		background: transparent;
		border: 1px solid rgba(232, 93, 117, 0.5);
		color: #e85d75;
		font-size: 12px;
	}
</style>
