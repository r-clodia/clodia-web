<script lang="ts">
	import { onMount } from 'svelte';
	import {
		API_BASE_URL,
		ApiError,
		listPacks,
		importPackUrl,
		importPackZip,
		deletePack
	} from '$lib/api/client';
	import type { Pack, PackEntry, PackMcpServer } from '$lib/api/types';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { toastSuccess, toastError } from '$lib/stores/toasts';

	type State =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; items: ReadonlyArray<Pack> }
		| { kind: 'error'; message: string; status?: number };

	let state: State = { kind: 'idle' };
	let query = '';
	let expanded = new Set<string>();
	let expandedMcp = new Set<string>(); // "<pack>/<server>"

	onMount(() => {
		void load();
	});

	function errorMessage(err: unknown): { message: string; status?: number } {
		if (err instanceof ApiError) return { message: err.message, status: err.status };
		if (err instanceof Error) return { message: err.message };
		return { message: String(err) };
	}

	async function load() {
		state = { kind: 'loading' };
		try {
			state = { kind: 'ok', items: await listPacks() };
		} catch (err) {
			state = { kind: 'error', ...errorMessage(err) };
		}
	}

	function toggle(name: string) {
		if (expanded.has(name)) expanded.delete(name);
		else expanded.add(name);
		expanded = new Set(expanded); // trigger reattività
	}

	function toggleMcp(key: string) {
		if (expandedMcp.has(key)) expandedMcp.delete(key);
		else expandedMcp.add(key);
		expandedMcp = new Set(expandedMcp);
	}

	function entryMatches(e: PackEntry, q: string): boolean {
		return `${e.name} ${e.description}`.toLowerCase().includes(q);
	}

	function mcpMatches(s: PackMcpServer, q: string): boolean {
		return s.name.toLowerCase().includes(q);
	}

	// Filtro: un pack matcha se matcha il suo nome/descrizione o un figlio.
	// Con query attiva i figli vengono filtrati e i pack matchati auto-espansi.
	$: q = query.trim().toLowerCase();
	$: packs =
		state.kind === 'ok'
			? state.items
					.map((p) => {
						if (!q) return p;
						const self = `${p.name} ${p.description}`.toLowerCase().includes(q);
						const skills = p.skills.filter((e) => entryMatches(e, q));
						const rules = p.rules.filter((e) => entryMatches(e, q));
						const mcp = p.mcp_servers.filter((s) => mcpMatches(s, q));
						if (!self && !skills.length && !rules.length && !mcp.length) return null;
						return self ? p : { ...p, skills, rules, mcp_servers: mcp };
					})
					.filter((p): p is Pack => p !== null)
			: [];
	$: isOpen = (name: string) => q !== '' || expanded.has(name);

	function summary(p: Pack): string {
		const parts: string[] = [];
		if (p.counts.skills) parts.push(`${p.counts.skills} skill`);
		if (p.counts.rules) parts.push(`${p.counts.rules} rule`);
		if (p.counts.mcp_servers) parts.push(`${p.counts.mcp_servers} MCP`);
		return parts.join(' · ') || 'vuoto';
	}

	const ORIGIN_LABELS: Record<string, string> = {
		logic: 'nativo',
		local: 'locale',
		external: 'esterno',
		user: 'utente',
		imported: 'importato'
	};

	// --- Importa pack — da .zip o da URL ---
	let showAdd = false;
	let importTab: 'url' | 'zip' = 'url';
	let importUrl = '';
	let importFile: File | null = null;
	let importing = false;
	let createError = '';

	function openAdd() {
		importTab = 'url';
		importUrl = '';
		importFile = null;
		createError = '';
		showAdd = true;
	}

	function onPickFile(e: Event) {
		importFile = (e.target as HTMLInputElement).files?.[0] ?? null;
	}

	async function submitImport() {
		createError = '';
		try {
			let res;
			if (importTab === 'zip') {
				if (!importFile) {
					createError = 'Seleziona un archivio .zip';
					return;
				}
				importing = true;
				res = await importPackZip(importFile);
			} else {
				const url = importUrl.trim();
				if (!url) {
					createError = 'Inserisci un URL (git repo o .zip)';
					return;
				}
				importing = true;
				res = await importPackUrl(url);
			}
			showAdd = false;
			toastSuccess(
				`Pack "${res.pack}" importato`,
				`${res.skills.length} skill · ${res.rules.length} rule · ${res.mcp_servers.length} MCP`
			);
			await load();
			expanded.add(res.pack);
			expanded = new Set(expanded);
		} catch (err) {
			createError = err instanceof ApiError ? err.message : String(err);
		} finally {
			importing = false;
		}
	}

	// --- Elimina pack (solo non nativi) ---
	let pendingDelete: Pack | null = null;
	let deleting = false;

	async function onConfirmDelete() {
		if (!pendingDelete) return;
		deleting = true;
		try {
			await deletePack(pendingDelete.name);
			toastSuccess(`Pack "${pendingDelete.name}" rimosso`);
			pendingDelete = null;
			await load();
		} catch (err) {
			toastError('Rimozione fallita', errorMessage(err).message);
		} finally {
			deleting = false;
		}
	}
</script>

<header class="head">
	<div>
		<h1>Packs</h1>
		<p class="hint">
			GET <code>{API_BASE_URL}/clodia/packs</code> · pack = [skills] + [rules] + [mcp] — nessuno
			obbligatorio, compatibile con i plugin Claude
		</p>
	</div>
	<div class="head-actions">
		<button type="button" class="add-btn" on:click={openAdd}>+ Importa pack</button>
		<button type="button" on:click={load} disabled={state.kind === 'loading'}>
			{state.kind === 'loading' ? 'Loading…' : 'Reload'}
		</button>
	</div>
</header>

{#if showAdd}
	<div
		class="modal-backdrop"
		role="button"
		tabindex="0"
		on:click={() => (showAdd = false)}
		on:keydown={(e) => e.key === 'Escape' && (showAdd = false)}
	>
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
			<h2>Importa pack</h2>
			<p class="hint">
				Formati riconosciuti: <strong>Claude plugin</strong> (<code>.claude-plugin/plugin.json</code>
				+ skills + mcpServers), <strong>pack clodia</strong> (<code>pack.yaml</code> + skills +
				rules + mcp) o <strong>skill semplici</strong> (senza manifest → pack
				<code>user-pack</code>).
			</p>
			<div class="segmented import-tabs" role="tablist">
				<button type="button" role="tab" class:active={importTab === 'url'} on:click={() => (importTab = 'url')}>Da URL</button>
				<button type="button" role="tab" class:active={importTab === 'zip'} on:click={() => (importTab = 'zip')}>Da .zip</button>
			</div>
			{#if importTab === 'url'}
				<label>
					URL
					<input type="url" bind:value={importUrl} placeholder="https://github.com/utente/repo  oppure  https://…/pack.zip" autocomplete="off" />
					<span class="field-hint">repository git (clone) o archivio <code>.zip</code> remoto</span>
				</label>
			{:else}
				<label>
					Archivio .zip
					<input type="file" accept=".zip,application/zip" on:change={onPickFile} />
					<span class="field-hint">un pack completo o anche una singola skill (<code>SKILL.md</code>)</span>
				</label>
			{/if}
			{#if createError}
				<div class="form-error">{createError}</div>
			{/if}
			<div class="modal-actions">
				<button type="button" class="ghost" on:click={() => (showAdd = false)} disabled={importing}>
					Annulla
				</button>
				<button type="button" class="add-btn" on:click={submitImport} disabled={importing}>
					{importing ? 'Import…' : 'Importa'}
				</button>
			</div>
		</div>
	</div>
{/if}

<ConfirmDialog
	open={pendingDelete !== null}
	title={`Rimuovere il pack "${pendingDelete?.name ?? ''}"?`}
	message="Verranno rimosse tutte le skill, rule e configurazioni MCP del pack. L'azione non è reversibile."
	confirmLabel="Rimuovi"
	destructive
	loading={deleting}
	on:confirm={onConfirmDelete}
	on:cancel={() => (pendingDelete = null)}
/>

<div class="toolbar">
	<input type="search" bind:value={query} placeholder="Cerca pack, skill, rule, MCP…" aria-label="Search packs" />
</div>

{#if state.kind === 'loading' || state.kind === 'idle'}
	<div class="tree" aria-busy="true">
		{#each Array(4) as _}
			<div class="pack skel">
				<Skeleton width="180px" height="14px" />
				<Skeleton width="60%" height="12px" />
			</div>
		{/each}
	</div>
{:else if state.kind === 'error'}
	<div class="status error">
		<strong>Failed to load packs{state.status ? ` (HTTP ${state.status})` : ''}.</strong>
		<div class="error-msg">{state.message}</div>
		<button class="retry" type="button" on:click={load}>Retry</button>
	</div>
{:else if state.items.length === 0}
	<div class="status empty">
		<strong>Nessun pack trovato.</strong>
		<p class="hint">Il server non ha cataloghi leggibili in logic o data.</p>
	</div>
{:else if packs.length === 0}
	<div class="status empty">
		<strong>Nessun pack matcha la ricerca.</strong>
	</div>
{:else}
	<div class="tree" role="tree">
		{#each packs as p (p.name)}
			<div class="pack" role="treeitem" aria-expanded={isOpen(p.name)} aria-selected="false">
				<div class="pack-head">
					<button type="button" class="pack-toggle" on:click={() => toggle(p.name)} aria-label={isOpen(p.name) ? 'Chiudi' : 'Apri'}>
						<span class="chevron" class:open={isOpen(p.name)}>▸</span>
						<span class="pack-name">{p.name}</span>
						<span class="origin-chip origin-{p.origin}">{ORIGIN_LABELS[p.origin] ?? p.origin}</span>
						{#if p.version}<span class="version">v{p.version}</span>{/if}
						<span class="counts">{summary(p)}</span>
					</button>
					{#if p.deletable}
						<button type="button" class="danger-ghost" on:click={() => (pendingDelete = p)}>Rimuovi</button>
					{/if}
				</div>
				{#if p.description}
					<div class="pack-desc">{p.description}</div>
				{/if}
				{#if isOpen(p.name)}
					<div class="children" role="group">
						{#if p.skills.length}
							<div class="group-label">Skills</div>
							{#each p.skills as s (s.name)}
								<a class="child" href={`/skills/${encodeURIComponent(s.name)}`}>
									<span class="child-kind kind-skill">skill</span>
									<span class="child-name">{s.name}</span>
									<span class="child-desc">{s.description || '—'}</span>
								</a>
							{/each}
						{/if}
						{#if p.rules.length}
							<div class="group-label">Rules</div>
							{#each p.rules as r (r.name)}
								<a class="child" href={`/rules/${encodeURIComponent(r.name)}`}>
									<span class="child-kind kind-rule">rule</span>
									<span class="child-name">{r.name}</span>
									<span class="child-desc">{r.description || '—'}</span>
								</a>
							{/each}
						{/if}
						{#if p.mcp_servers.length}
							<div class="group-label">MCP servers</div>
							{#each p.mcp_servers as s (s.name)}
								<div class="child mcp">
									<button type="button" class="mcp-row" on:click={() => toggleMcp(`${p.name}/${s.name}`)}>
										<span class="child-kind kind-mcp">mcp</span>
										<span class="child-name">{s.name}</span>
										<span class="child-desc">{s.transport}</span>
									</button>
									{#if expandedMcp.has(`${p.name}/${s.name}`)}
										<pre class="mcp-config">{JSON.stringify(s.config, null, 2)}</pre>
										<div class="mcp-hint">
											Non montato automaticamente: per attivarlo usa <a href="/tools">Integrations → Add MCP server</a>.
										</div>
									{/if}
								</div>
							{/each}
						{/if}
						{#if !p.skills.length && !p.rules.length && !p.mcp_servers.length}
							<div class="child empty-child">pack vuoto</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 18px;
		flex-wrap: wrap;
	}
	.hint {
		margin: 4px 0 0;
		color: var(--fg-muted);
		font-size: 12px;
	}
	.toolbar {
		display: flex;
		gap: 10px;
		margin-bottom: 14px;
		flex-wrap: wrap;
	}
	.toolbar input {
		min-width: 240px;
		flex: 1 1 260px;
		padding: 9px 11px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--card-bg);
		color: var(--fg);
	}
	.tree {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.pack {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 10px 14px;
	}
	.pack-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.pack-toggle {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		padding: 4px 0;
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
	.pack-name {
		font-family: var(--mono);
		font-weight: 700;
		font-size: 14px;
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
	.pack-desc {
		margin: 2px 0 0 24px;
		color: var(--fg-muted);
		font-size: 12.5px;
	}
	.children {
		margin: 8px 0 4px 24px;
		border-left: 1px solid var(--border);
		padding-left: 14px;
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
		padding: 5px 8px;
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
		padding: 5px 8px;
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
	.skel {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.status {
		padding: 16px 18px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card-bg);
	}
	.status.error {
		border-color: rgba(232, 93, 117, 0.6);
		background: rgba(232, 93, 117, 0.08);
	}
	.status.empty {
		text-align: center;
		padding: 36px 24px;
	}
	.error-msg {
		margin-top: 8px;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--danger);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.retry {
		margin-top: 12px;
	}
	.head-actions {
		display: flex;
		gap: 8px;
	}
	.add-btn {
		background: var(--accent);
		color: #1a1a1a;
		border-color: var(--accent);
		font-weight: 600;
	}
	.danger-ghost {
		background: transparent;
		border: 1px solid rgba(232, 93, 117, 0.5);
		color: #e85d75;
		font-size: 12px;
	}
	.segmented {
		display: inline-flex;
		gap: 4px;
	}
	.segmented button {
		padding: 8px 10px;
	}
	.segmented button.active {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-fg);
		font-weight: 700;
	}
	.import-tabs {
		margin-top: 10px;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
		padding: 16px;
	}
	.modal {
		background: var(--bg, #15161a);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 20px 22px;
		width: min(560px, 100%);
		max-height: 90vh;
		overflow: auto;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
	}
	.modal h2 {
		margin: 0 0 4px;
	}
	.modal label {
		display: block;
		margin-top: 14px;
		font-size: 13px;
		color: var(--fg-muted);
	}
	.modal input {
		width: 100%;
		margin-top: 5px;
		box-sizing: border-box;
		font-family: inherit;
		padding: 9px 11px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--card-bg);
		color: var(--fg);
	}
	.field-hint {
		display: block;
		font-size: 11px;
		color: var(--fg-muted);
		margin-top: 3px;
	}
	.form-error {
		margin-top: 12px;
		color: #ff6b6b;
		font-size: 13px;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 18px;
	}
	.modal-actions .ghost {
		background: transparent;
	}
</style>
