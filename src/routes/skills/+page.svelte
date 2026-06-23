<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { API_BASE_URL, ApiError, listSkills, importSkillUrl, importSkillZip } from '$lib/api/client';
	import type { CatalogPack, Skill } from '$lib/api/types';
	import CatalogPackBadge from '$lib/components/CatalogPackBadge.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	type PackFilter = 'all' | CatalogPack;
	type State =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; items: ReadonlyArray<Skill> }
		| { kind: 'error'; message: string; status?: number };

	let state: State = { kind: 'idle' };
	let query = '';
	let pack: PackFilter = 'all';

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
			state = { kind: 'ok', items: await listSkills() };
		} catch (err) {
			state = { kind: 'error', ...errorMessage(err) };
		}
	}

	// NB: la reattività di Svelte traccia le variabili referenziate
	// sintatticamente nel blocco `$:`. Richiamiamo query/pack QUI dentro (non
	// solo dentro una closure) così `items` si ricomputa quando cambiano —
	// prima il filtro era inerte (search "decorativo").
	$: q = query.trim().toLowerCase();
	$: items =
		state.kind === 'ok'
			? state.items.filter(
					(item) =>
						(pack === 'all' || item.pack === pack) &&
						(!q || `${item.name} ${item.description} ${item.pack}`.toLowerCase().includes(q))
				)
			: [];
	$: packOptions =
		state.kind === 'ok'
			? Array.from(new Set(state.items.map((item) => item.pack))).sort()
			: [];

	// --- Importa skill (pack user-pack) — da .zip o da URL ---
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
				res = await importSkillZip(importFile);
			} else {
				const url = importUrl.trim();
				if (!url) {
					createError = 'Inserisci un URL (git repo o .zip)';
					return;
				}
				importing = true;
				res = await importSkillUrl(url);
			}
			showAdd = false;
			const names = res.imported ?? [];
			if (names.length === 1) {
				await goto(`/skills/${encodeURIComponent(names[0])}`);
			} else {
				await load();
			}
		} catch (err) {
			createError = err instanceof ApiError ? err.message : String(err);
		} finally {
			importing = false;
		}
	}
</script>

<header class="head">
	<div>
		<h1>Skills</h1>
		<p class="hint">
			GET <code>{API_BASE_URL}/clodia/skills</code> · catalog readonly by pack
		</p>
	</div>
	<div class="head-actions">
		<button type="button" class="add-btn" on:click={openAdd}>+ Importa skill</button>
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
			<h2>Importa skill</h2>
			<p class="hint">Importata nel pack <code>user-pack</code>. La skill è un asset (SKILL.md + asset/script): si importa e si rimuove, non si edita qui.</p>
			<div class="segmented import-tabs" role="tablist">
				<button type="button" role="tab" class:active={importTab === 'url'} on:click={() => (importTab = 'url')}>Da URL</button>
				<button type="button" role="tab" class:active={importTab === 'zip'} on:click={() => (importTab = 'zip')}>Da .zip</button>
			</div>
			{#if importTab === 'url'}
				<label>
					URL
					<input type="url" bind:value={importUrl} placeholder="https://github.com/utente/repo  oppure  https://…/skill.zip" autocomplete="off" />
					<span class="field-hint">repository git (clone) o archivio <code>.zip</code> remoto</span>
				</label>
			{:else}
				<label>
					Archivio .zip
					<input type="file" accept=".zip,application/zip" on:change={onPickFile} />
					<span class="field-hint">deve contenere uno o più <code>SKILL.md</code> (con eventuali asset)</span>
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

<div class="toolbar">
	<input type="search" bind:value={query} placeholder="Search skills..." aria-label="Search skills" />
	<div class="segmented" aria-label="Pack filter">
		<button type="button" class:active={pack === 'all'} on:click={() => (pack = 'all')}>All</button>
		{#each packOptions as option}
			<button type="button" class:active={pack === option} on:click={() => (pack = option)}>{option}</button>
		{/each}
	</div>
</div>

{#if state.kind === 'loading' || state.kind === 'idle'}
	<div class="list" aria-busy="true">
		{#each Array(6) as _}
			<div class="row skel">
				<Skeleton width="160px" height="14px" />
				<Skeleton width="56px" height="18px" radius="999px" />
				<Skeleton width="70%" height="12px" />
			</div>
		{/each}
	</div>
{:else if state.kind === 'error'}
	<div class="status error">
		<strong>Failed to load skills{state.status ? ` (HTTP ${state.status})` : ''}.</strong>
		<div class="error-msg">{state.message}</div>
		<button class="retry" type="button" on:click={load}>Retry</button>
	</div>
{:else if state.items.length === 0}
	<div class="status empty">
		<strong>Nessuna skill trovata.</strong>
		<p class="hint">Il server non ha cataloghi skills leggibili in logic o data.</p>
	</div>
{:else if items.length === 0}
	<div class="status empty">
		<strong>Nessuna skill matcha i filtri.</strong>
	</div>
{:else}
	<div class="list">
		{#each items as item (item.name)}
			<a class="row" href={`/skills/${encodeURIComponent(item.name)}`}>
				<div class="row-main">
					<div class="name">{item.name}</div>
					<div class="desc">{item.description || '—'}</div>
				</div>
				<CatalogPackBadge pack={item.pack} />
			</a>
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
	input {
		min-width: 240px;
		flex: 1 1 260px;
		padding: 9px 11px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--card-bg);
		color: var(--fg);
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
	.list {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 13px 16px;
		border-bottom: 1px solid var(--border);
		color: inherit;
		text-decoration: none;
	}
	.row:last-child {
		border-bottom: none;
	}
	a.row:hover {
		background: rgba(255, 107, 61, 0.06);
	}
	.row-main {
		min-width: 0;
	}
	.name {
		font-family: var(--mono);
		font-weight: 700;
		font-size: 13px;
	}
	.desc {
		margin-top: 3px;
		color: var(--fg-muted);
		font-size: 12.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.skel {
		align-items: flex-start;
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
