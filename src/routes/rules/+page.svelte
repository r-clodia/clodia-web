<script lang="ts">
	import { onMount } from 'svelte';
	import { API_BASE_URL, ApiError, listRules } from '$lib/api/client';
	import type { CatalogPack, Rule } from '$lib/api/types';
	import CatalogPackBadge from '$lib/components/CatalogPackBadge.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	type PackFilter = 'all' | CatalogPack;
	type State =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; items: ReadonlyArray<Rule> }
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
			state = { kind: 'ok', items: await listRules() };
		} catch (err) {
			state = { kind: 'error', ...errorMessage(err) };
		}
	}

	function matches(item: Rule): boolean {
		if (pack !== 'all' && item.pack !== pack) return false;
		const q = query.trim().toLowerCase();
		if (!q) return true;
		return `${item.name} ${item.description} ${item.pack}`.toLowerCase().includes(q);
	}

	$: items = state.kind === 'ok' ? state.items.filter(matches) : [];
	$: packOptions =
		state.kind === 'ok'
			? Array.from(new Set(state.items.map((item) => item.pack))).sort()
			: [];
</script>

<header class="head">
	<div>
		<h1>Rules</h1>
		<p class="hint">
			GET <code>{API_BASE_URL}/clodia/rules</code> · catalog readonly by pack
		</p>
	</div>
	<button type="button" on:click={load} disabled={state.kind === 'loading'}>
		{state.kind === 'loading' ? 'Loading…' : 'Reload'}
	</button>
</header>

<div class="toolbar">
	<input type="search" bind:value={query} placeholder="Search rules..." aria-label="Search rules" />
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
		<strong>Failed to load rules{state.status ? ` (HTTP ${state.status})` : ''}.</strong>
		<div class="error-msg">{state.message}</div>
		<button class="retry" type="button" on:click={load}>Retry</button>
	</div>
{:else if state.items.length === 0}
	<div class="status empty">
		<strong>Nessuna rule trovata.</strong>
		<p class="hint">Il server non ha cataloghi rules leggibili in logic o data.</p>
	</div>
{:else if items.length === 0}
	<div class="status empty">
		<strong>Nessuna rule matcha i filtri.</strong>
	</div>
{:else}
	<div class="list">
		{#each items as item (item.name)}
			<a class="row" href={`/rules/${encodeURIComponent(item.name)}`}>
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
</style>
