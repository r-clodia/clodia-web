<script lang="ts">
	import { onMount } from 'svelte';
	import {
		API_BASE_URL,
		ApiError,
		listPacks,
		listPlugins,
		importPackUrl,
		importPackZip,
		deletePack,
		deletePlugin,
		updatePack as apiUpdatePack,
		checkPackUpdate as apiCheckPackUpdate
	} from '$lib/api/client';
	import type { Pack, Plugin } from '$lib/api/types';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import PluginNode from '$lib/components/PluginNode.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { toastSuccess, toastError } from '$lib/stores/toasts';
	import { isAdmin } from '$lib/stores/capabilities';

	type State =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; packs: ReadonlyArray<Pack>; plugins: ReadonlyArray<Plugin> }
		| { kind: 'error'; message: string; status?: number };

	let state: State = { kind: 'idle' };
	let query = '';
	let expandedPacks = new Set<string>();
	let updating: string | null = null;
	let checking: string | null = null;
	// Esito del "Check update" per pack: {remote, update_available}.
	let checkResults: Record<string, { remote: string; update_available: boolean }> = {};

	async function checkUpdate(p: Pack) {
		if (checking) return;
		checking = p.name;
		try {
			const r = await apiCheckPackUpdate(p.name);
			checkResults = { ...checkResults, [p.name]: { remote: r.remote, update_available: r.update_available } };
			if (!r.update_available) toastSuccess(`${p.name} è aggiornato (v${r.installed})`);
		} catch (err) {
			toastError(errorMessage(err).message);
		} finally {
			checking = null;
		}
	}

	async function updatePack(p: Pack) {
		if (updating) return;
		updating = p.name;
		try {
			const r = await apiUpdatePack(p.name);
			toastSuccess(`${p.name} aggiornato a v${r.version} · ${r.agents_restarted} agenti riavviati`);
			checkResults = { ...checkResults, [p.name]: { remote: r.version, update_available: false } };
			await load();
		} catch (err) {
			toastError(errorMessage(err).message);
		} finally {
			updating = null;
		}
	}

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
			const [packs, plugins] = await Promise.all([listPacks(), listPlugins()]);
			state = { kind: 'ok', packs, plugins };
		} catch (err) {
			state = { kind: 'error', ...errorMessage(err) };
		}
	}

	function togglePack(name: string) {
		if (expandedPacks.has(name)) expandedPacks.delete(name);
		else expandedPacks.add(name);
		expandedPacks = new Set(expandedPacks);
	}

	function isPluginResolved(p: Pack['plugins'][number]): p is Plugin {
		return !('missing' in p && p.missing);
	}

	function pluginText(p: Plugin): string {
		const children = [...p.skills, ...p.rules].map((e) => `${e.name} ${e.description}`);
		const mcp = p.mcp_servers.map((s) => s.name);
		return `${p.name} ${p.description} ${children.join(' ')} ${mcp.join(' ')}`.toLowerCase();
	}

	function packText(p: Pack): string {
		const agents = p.agents.map((a) => `${a.name} ${a.description}`);
		const plugins = p.plugins.map((c) => (isPluginResolved(c) ? pluginText(c) : c.name));
		return `${p.name} ${p.description} ${agents.join(' ')} ${plugins.join(' ')}`.toLowerCase();
	}

	// Ricerca cross-livello: un pack/plugin matcha se il testo aggregato dei
	// suoi discendenti contiene la query; con query attiva i nodi sono espansi.
	$: q = query.trim().toLowerCase();
	$: packs = state.kind === 'ok' ? state.packs.filter((p) => !q || packText(p).includes(q)) : [];
	$: packPluginNames =
		state.kind === 'ok'
			? new Set(state.packs.flatMap((p) => p.plugins.map((c) => c.name)))
			: new Set<string>();
	$: loosePlugins =
		state.kind === 'ok'
			? state.plugins.filter(
					(p) => !packPluginNames.has(p.name) && (!q || pluginText(p).includes(q))
				)
			: [];
	$: isPackOpen = (name: string) => q !== '' || expandedPacks.has(name);

	function packSummary(p: Pack): string {
		const parts: string[] = [];
		if (p.counts.agents) parts.push(`${p.counts.agents} agent`);
		if (p.counts.plugins) parts.push(`${p.counts.plugins} plugin`);
		return parts.join(' · ') || 'vuoto';
	}

	// --- Importa (unificato: pack o plugin sciolto) — da .zip o da URL ---
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
			if (res.kind === 'pack') {
				const agents = res.agents ?? [];
				const installed = agents.filter((a) => a.status === 'installed').length;
				toastSuccess(
					`Pack "${res.pack}" importato`,
					`${installed}/${agents.length} agent installati · ${(res.plugins ?? []).length} plugin`
				);
				if (res.pack) {
					expandedPacks.add(res.pack);
					expandedPacks = new Set(expandedPacks);
				}
			} else {
				toastSuccess(
					`Plugin "${res.plugin}" importato`,
					`${(res.skills ?? []).length} skill · ${(res.rules ?? []).length} rule · ${(res.mcp_servers ?? []).length} MCP`
				);
			}
			await load();
		} catch (err) {
			createError = err instanceof ApiError ? err.message : String(err);
		} finally {
			importing = false;
		}
	}

	// --- Elimina pack / plugin sciolto ---
	let pendingDelete: { kind: 'pack'; item: Pack } | { kind: 'plugin'; item: Plugin } | null = null;
	let deleting = false;

	async function onConfirmDelete() {
		if (!pendingDelete) return;
		deleting = true;
		try {
			if (pendingDelete.kind === 'pack') {
				await deletePack(pendingDelete.item.name);
				toastSuccess(`Pack "${pendingDelete.item.name}" rimosso`);
			} else {
				await deletePlugin(pendingDelete.item.name);
				toastSuccess(`Plugin "${pendingDelete.item.name}" rimosso`);
			}
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
			pack := [agent seeds] + [plugins] · plugin := [skills] + [rules] + [mcp] — GET
			<code>{API_BASE_URL}/clodia/packs</code>
		</p>
	</div>
	<div class="head-actions">
		{#if $isAdmin}<button type="button" class="add-btn" on:click={openAdd}>+ Importa</button>{/if}
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
			<h2>Importa pack o plugin</h2>
			<p class="hint">
				Import unificato: un <strong>pack</strong> (<code>pack.yaml</code> +
				<code>agents/</code> + <code>plugins/</code> — gli agenti vengono installati e
				registrati), un <strong>Claude plugin</strong>
				(<code>.claude-plugin/plugin.json</code> + skills + mcpServers), un
				<strong>plugin clodia</strong> (<code>plugin.yaml</code>) o
				<strong>skill semplici</strong> (→ <code>user-pack</code>).
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
					<span class="field-hint">un pack completo, un plugin o anche una singola skill</span>
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
	title={`Rimuovere ${pendingDelete?.kind === 'pack' ? 'il pack' : 'il plugin'} "${pendingDelete?.item.name ?? ''}"?`}
	message={pendingDelete?.kind === 'pack'
		? 'Verranno rimossi i plugin del pack e i suoi agenti (non nativi). L\'azione non è reversibile.'
		: 'Verranno rimosse tutte le skill, rule e configurazioni MCP del plugin. L\'azione non è reversibile.'}
	confirmLabel="Rimuovi"
	destructive
	loading={deleting}
	on:confirm={onConfirmDelete}
	on:cancel={() => (pendingDelete = null)}
/>

<div class="toolbar">
	<input type="search" bind:value={query} placeholder="Cerca pack, agent, plugin, skill, rule, MCP…" aria-label="Search packs" />
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
{:else}
	{#if packs.length}
		<div class="section-label">Packs</div>
		<div class="tree" role="tree">
			{#each packs as p (p.name)}
				<div class="pack" role="treeitem" aria-expanded={isPackOpen(p.name)} aria-selected="false">
					<div class="pack-head">
						<button type="button" class="pack-toggle" on:click={() => togglePack(p.name)} aria-label={isPackOpen(p.name) ? 'Chiudi' : 'Apri'}>
							<span class="chevron" class:open={isPackOpen(p.name)}>▸</span>
							<span class="kind-chip">pack</span>
							<span class="pack-name">{p.name}</span>
							{#if p.version}<span class="version">v{p.version}</span>{/if}
							<span class="counts">{packSummary(p)}</span>
						</button>
						<span class="pack-badges">
							{#if p.license}<span class="lic-badge" title={p.license_note || 'Licenza dichiarata'}>{p.license}</span>
							{:else if p.licenses && p.licenses.length}<span class="lic-badge" title="Licenze effettive">{p.licenses.join(' · ')}</span>{/if}
							{#if p.third_party}<span class="tp-badge" title="Pack di terze parti: download opt-in, accetti la licenza">3ª parte</span>{/if}
							{#if p.license_missing}<span class="warn-badge" title="Licenza non dichiarata su alcune skill — bloccante all'install">⚠ licenza</span>{/if}
							{#if p.dpa_missing}<span class="warn-badge" title="Provider senza profilo DPA/sovranità completo — bloccante + consenso owner">⚠ DPA</span>{/if}
						</span>
						{#if p.has_upstream && $isAdmin}
							{#if checkResults[p.name]?.update_available}
								<button type="button" class="update-btn" disabled={updating === p.name} on:click={() => updatePack(p)}>{updating === p.name ? 'Aggiorno…' : `Update v${checkResults[p.name].remote}`}</button>
							{:else if checkResults[p.name]}
								<span class="update-badge" title="Sei alla versione più recente">✓ aggiornato</span>
							{:else}
								<button type="button" class="check-btn" disabled={checking === p.name} on:click={() => checkUpdate(p)}>{checking === p.name ? 'Controllo…' : 'Check update'}</button>
							{/if}
						{/if}
						{#if p.deletable !== false}
							{#if $isAdmin}<button type="button" class="danger-ghost" on:click={() => (pendingDelete = { kind: 'pack', item: p })}>Rimuovi</button>{/if}
						{/if}
					</div>
					{#if p.description}
						<div class="pack-desc">{p.description}</div>
					{/if}
					{#if isPackOpen(p.name)}
						<div class="children" role="group">
							{#if p.agents.length}
								<div class="group-label">Agents</div>
								{#each p.agents as a (a.name)}
									<a class="child" href={a.installed ? `/agents/${encodeURIComponent(a.name)}` : undefined} class:disabled={!a.installed}>
										<span class="child-kind kind-agent">agent</span>
										<span class="child-name">{a.name}</span>
										<span class="child-desc">{a.description || (a.installed ? '—' : 'non installato')}</span>
										{#if a.missing_plugins.length}
											<span class="warn" title={`Plugin richiesti mancanti: ${a.missing_plugins.join(', ')}`}>
												⚠ manca: {a.missing_plugins.join(', ')}
											</span>
										{/if}
									</a>
								{/each}
							{/if}
							{#if p.plugins.length}
								<div class="group-label">Plugins</div>
								<div class="plugin-list">
									{#each p.plugins as c (c.name)}
										{#if isPluginResolved(c)}
											<PluginNode plugin={c} forceOpen={q !== ''} />
										{:else}
											<div class="child disabled">
												<span class="child-kind kind-plugin-missing">plugin</span>
												<span class="child-name">{c.name}</span>
												<span class="child-desc">non installato</span>
											</div>
										{/if}
									{/each}
								</div>
							{/if}
							{#if !p.agents.length && !p.plugins.length}
								<div class="child empty-child">pack vuoto</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if loosePlugins.length}
		<div class="section-label">Plugins{packs.length ? ' (fuori dai pack)' : ''}</div>
		<div class="tree" role="tree">
			{#each loosePlugins as p (p.name)}
				<PluginNode
					plugin={p}
					deletable={$isAdmin}
					forceOpen={q !== ''}
					on:delete={(e) => (pendingDelete = { kind: 'plugin', item: e.detail })}
				/>
			{/each}
		</div>
	{/if}

	{#if !packs.length && !loosePlugins.length}
		<div class="status empty">
			<strong>{q ? 'Nessun pack o plugin matcha la ricerca.' : 'Nessun pack o plugin trovato.'}</strong>
		</div>
	{/if}
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
	.section-label {
		margin: 18px 0 8px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--fg-muted);
	}
	.section-label:first-of-type {
		margin-top: 0;
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
	.kind-chip {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 1px 6px;
		border-radius: 999px;
		border: 1px solid rgba(97, 175, 254, 0.6);
		color: #61affe;
		flex-shrink: 0;
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
	.update-badge {
		font-family: var(--mono);
		font-size: 11px;
		color: #16a34a;
		border: 1px solid #16a34a55;
		border-radius: 4px;
		padding: 1px 5px;
	}
	.update-btn {
		font-size: 12px;
		padding: 2px 10px;
		border-radius: 5px;
		border: 1px solid #16a34a;
		background: #16a34a1a;
		color: #16a34a;
		cursor: pointer;
	}
	.update-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.check-btn {
		font-size: 12px;
		padding: 2px 10px;
		border-radius: 5px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--fg-muted);
		cursor: pointer;
	}
	.check-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.counts {
		margin-left: auto;
		font-size: 12px;
		color: var(--fg-muted);
		white-space: nowrap;
	}
	.pack-badges {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.lic-badge, .tp-badge, .warn-badge {
		font-size: 10px;
		padding: 1px 7px;
		border-radius: 999px;
		white-space: nowrap;
		flex-shrink: 0;
		border: 1px solid var(--border);
	}
	.lic-badge { font-family: var(--mono); color: var(--fg-muted); }
	.tp-badge { color: #a855f7; border-color: rgba(168,85,247,0.5); }
	.warn-badge { color: #e0a800; border-color: rgba(224,168,0,0.5); font-weight: 600; }
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
	.plugin-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 4px 0;
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
	.child.disabled {
		opacity: 0.65;
		pointer-events: none;
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
	.kind-agent {
		border-color: rgba(214, 143, 255, 0.6);
		color: #d68fff;
	}
	.kind-plugin-missing {
		border-color: rgba(232, 93, 117, 0.5);
		color: #e85d75;
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
	.warn {
		margin-left: auto;
		font-size: 11px;
		color: #e8a33d;
		white-space: nowrap;
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
