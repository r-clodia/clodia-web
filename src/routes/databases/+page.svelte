<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError, listDatabases, purgeArchivedDatastore } from '$lib/api/client';
	import type { DatabaseEntry, DatabasesInventory, RagCollectionEntry } from '$lib/api/types';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { toastSuccess, toastError } from '$lib/stores/toasts';
	import { isAdmin } from '$lib/stores/capabilities';

	// ─────────────────────────────────────────────────────────────────────────
	// Sezione DATABASES — dati (SQL, vector-db) indipendenti dai TOPIC, creati
	// e popolati dai pack via due primitive del manifest: `datastores:` (SQLite,
	// posseduto dall'MCP del pack) e `rag_collections:` (vector-db, pgvector
	// condiviso). Disinstallare un pack non cancella mai i suoi dati: i
	// datastore vengono ARCHIVIATI (`plugins-archive/`), le collection RAG
	// restano vive — la pulizia definitiva è un atto umano, da qui.
	//
	// Le collection RAG sono SOLA LETTURA: il servizio eu-rag-search (fuori dai
	// repo git) non espone ancora un modo di cancellarle (9 set 2026).
	// ─────────────────────────────────────────────────────────────────────────

	type State =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; data: DatabasesInventory }
		| { kind: 'error'; message: string; status?: number };

	let state: State = { kind: 'idle' };
	let pendingPurge: DatabaseEntry | null = null;
	let purging = false;

	function errorMessage(err: unknown): { message: string; status?: number } {
		if (err instanceof ApiError) return { message: err.message, status: err.status };
		if (err instanceof Error) return { message: err.message };
		return { message: String(err) };
	}

	async function load() {
		state = { kind: 'loading' };
		try {
			const data = await listDatabases();
			state = { kind: 'ok', data };
		} catch (err) {
			const e = errorMessage(err);
			state = { kind: 'error', message: e.message, status: e.status };
		}
	}

	function askPurge(entry: DatabaseEntry) {
		pendingPurge = entry;
	}

	async function confirmPurge() {
		if (!pendingPurge?.archive_dir) return;
		purging = true;
		try {
			await purgeArchivedDatastore(pendingPurge.archive_dir);
			toastSuccess(`Eliminato: ${pendingPurge.archive_dir}`);
			pendingPurge = null;
			await load();
		} catch (err) {
			toastError(errorMessage(err).message);
		} finally {
			purging = false;
		}
	}

	function statusLabel(s: DatabaseEntry['status']): string {
		return s === 'active' ? 'attivo' : s === 'archived' ? 'archiviato' : 'orfano';
	}

	onMount(() => {
		void load();
	});
</script>

<svelte:head>
	<title>Databases</title>
</svelte:head>

<div class="page">
	<h1>Databases</h1>
	<p class="hint">
		Datastore e collection RAG creati dai pack, indipendenti dai topic. Un pack disinstallato
		non cancella mai i suoi dati: i datastore vengono archiviati, le collection RAG restano vive
		— la pulizia è un atto umano.
	</p>

	{#if state.kind === 'idle' || state.kind === 'loading'}
		<div class="tbl">
			{#each Array(4) as _}
				<Skeleton height="28px" radius="6px" />
			{/each}
		</div>
	{:else if state.kind === 'error'}
		<div class="error">
			Errore{state.status ? ` (${state.status})` : ''}: {state.message}
			<button type="button" on:click={load}>Riprova</button>
		</div>
	{:else}
		<section>
			<h2>Datastore <span class="count">({state.data.datastores.length})</span></h2>
			{#if state.data.datastores.length === 0}
				<p class="empty">Nessun datastore dichiarato.</p>
			{:else}
				<div class="tbl">
					{#each state.data.datastores as d (d.pack + '/' + (d.path ?? '.') + '/' + (d.archive_dir ?? ''))}
						<div class="row">
							<span class="cell pack">{d.pack}</span>
							<span class="cell path">{d.path ?? '.'}</span>
							<span class="cell purpose">{d.purpose}</span>
							<span class="badge status-{d.status}">{statusLabel(d.status)}</span>
							{#if d.pii}<span class="badge pii-badge">PII</span>{/if}
							{#if d.status === 'archived' && d.archived_at}
								<span class="cell archived-at">dal {d.archived_at}</span>
							{/if}
							{#if $isAdmin && d.status === 'archived' && d.archive_dir}
								<button type="button" class="danger" on:click={() => askPurge(d)}>
									Elimina definitivamente
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section>
			<h2>Collection RAG <span class="count">({state.data.rag_collections.length})</span></h2>
			{#if state.data.rag_collections.length === 0}
				<p class="empty">Nessuna collection RAG.</p>
			{:else}
				<div class="tbl">
					{#each state.data.rag_collections as r (r.name)}
						<div class="row">
							<span class="cell name">{r.name}</span>
							<span class="cell pack">{r.pack ?? '—'}</span>
							<span class="cell tier">{r.tier}</span>
							<span class="cell counts">{r.documents ?? 0} doc · {r.chunks ?? 0} chunk</span>
							<span class="badge status-{r.status}">{statusLabel(r.status)}</span>
						</div>
					{/each}
				</div>
				<p class="hint small">
					Le collection RAG sono sola lettura: il servizio non espone ancora un modo di
					cancellarle.
				</p>
			{/if}
		</section>
	{/if}
</div>

<ConfirmDialog
	open={pendingPurge !== null}
	title="Eliminare definitivamente?"
	message={pendingPurge
		? `«${pendingPurge.archive_dir}» verrà cancellato dal disco. L'azione non è reversibile.`
		: ''}
	confirmLabel="Elimina"
	destructive
	loading={purging}
	on:confirm={confirmPurge}
	on:cancel={() => (pendingPurge = null)}
/>

<style>
	.page {
		max-width: 960px;
		margin: 0 auto;
		padding: 16px;
	}
	.hint {
		color: var(--fg-muted);
		font-size: 13px;
		margin: 0 0 20px;
	}
	.hint.small {
		font-size: 11px;
		margin: 8px 0 0;
	}
	section {
		margin-bottom: 28px;
	}
	h2 {
		font-size: 15px;
		margin: 0 0 8px;
	}
	.count {
		color: var(--fg-muted);
		font-weight: 400;
	}
	.empty {
		color: var(--fg-muted);
		font-size: 13px;
	}
	.tbl {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
		flex-wrap: wrap;
	}
	.cell {
		font-size: 12px;
	}
	.cell.pack {
		font-weight: 600;
		min-width: 100px;
	}
	.cell.path,
	.cell.name {
		font-family: var(--mono);
		color: var(--fg-muted);
	}
	.cell.purpose {
		color: var(--fg-muted);
		flex: 1;
	}
	.cell.archived-at,
	.cell.counts,
	.cell.tier {
		color: var(--fg-muted);
		font-size: 11px;
	}
	.badge {
		font-size: 10px;
		padding: 1px 7px;
		border-radius: 999px;
		white-space: nowrap;
		flex-shrink: 0;
		border: 1px solid var(--border);
	}
	.status-active {
		color: #16a34a;
		border-color: rgba(22, 163, 74, 0.4);
	}
	.status-archived {
		color: #e0a800;
		border-color: rgba(224, 168, 0, 0.5);
		font-weight: 600;
	}
	.status-orphaned {
		color: #dc2626;
		border-color: rgba(220, 38, 38, 0.4);
		font-weight: 600;
	}
	.pii-badge {
		color: #a855f7;
		border-color: rgba(168, 85, 247, 0.5);
	}
	button.danger {
		margin-left: auto;
		font-size: 11px;
		padding: 3px 9px;
		border-radius: 6px;
		border: 1px solid rgba(220, 38, 38, 0.4);
		color: #dc2626;
		background: transparent;
		cursor: pointer;
	}
	.error {
		color: #dc2626;
		font-size: 13px;
	}
</style>
