<script lang="ts">
	import { onMount } from 'svelte';
	import './db.css';
	import {
		apiErrorDetail,
		createCollection,
		createDatastore,
		deleteDatabase,
		getDatabases,
		listDatabases,
		purgeArchivedDatastore,
		restoreDatabase,
		type DbCatalogue,
		type DbCatalogueEntry,
		type DbTombstone
	} from '$lib/api/client';
	import type { DatabaseEntry } from '$lib/api/types';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import DeleteResourceDialog from '$lib/components/DeleteResourceDialog.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import ViewToggle from '$lib/components/ViewToggle.svelte';
	import { readView } from '$lib/viewPref.js';
	import {
		TIERS,
		dateLabel,
		entryHref,
		filterEntries,
		originLabel,
		packsOf,
		scopeHref,
		sizeLabel,
		statusLabel,
		validName
	} from '$lib/databases.js';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	// ─────────────────────────────────────────────────────────────────────────
	// DATABASES (clodia-platform#672) — one uniform catalogue of the instance's
	// datastores (SQLite) and RAG collections, declared by packs or created
	// here. A topic's own index (`topic-*`) is never listed: it belongs to its
	// room. Who reaches the content: an admin everything (within clearance),
	// anybody else only what is imported into a scope they are in — the server
	// sends a non-admin only those resources, and only those scopes.
	// ─────────────────────────────────────────────────────────────────────────

	let view = readView('databases');

	let cat: DbCatalogue | null = null;
	let loading = true;
	let err = '';

	let fKind = '';
	let fPack = '';
	let fTier = '';
	let fQ = '';

	$: admin = !!cat?.is_admin;
	$: shown = cat ? filterEntries(cat.entries, { kind: fKind, pack: fPack, tier: fTier, q: fQ }) : [];
	$: packs = cat ? packsOf(cat.entries) : [];

	async function load() {
		loading = true;
		err = '';
		try {
			cat = await getDatabases();
		} catch (e) {
			err = apiErrorDetail(e);
		} finally {
			loading = false;
		}
		void loadArchived();
	}

	// ── New datastore / collection (admins) ──────────────────────────────────
	let creating: 'datastore' | 'rag' | null = null;
	let newName = '';
	let newTier = 'SEAL-1';
	let newPurpose = '';
	let newPii = false;
	let createBusy = false;

	function openCreate(kind: 'datastore' | 'rag') {
		creating = kind;
		newName = '';
		newTier = 'SEAL-1';
		newPurpose = '';
		newPii = false;
	}

	async function submitCreate() {
		if (!creating || !validName(newName) || createBusy) return;
		createBusy = true;
		try {
			const r = creating === 'datastore'
				? await createDatastore({ name: newName, tier: newTier, purpose: newPurpose, pii: newPii })
				: await createCollection({ name: newName, tier: newTier, description: newPurpose });
			toastSuccess(`Creato: ${r.created.name}`);
			creating = null;
			await load();
		} catch (e) {
			toastError('Creazione', apiErrorDetail(e));
		} finally {
			createBusy = false;
		}
	}

	// ── Delete (admins): typed name, export first ────────────────────────────
	let pendingDelete: DbCatalogueEntry | null = null;
	let deleting = false;

	async function confirmDelete(e: CustomEvent<string>) {
		if (!pendingDelete) return;
		deleting = true;
		try {
			const r = await deleteDatabase(pendingDelete.kind, pendingDelete.name, e.detail);
			toastSuccess(`Eliminato: ${pendingDelete.name}`, `Export in ${r.export_dir}`);
			if (r.imports_failed.length) {
				toastError('Import non rimossi', r.imports_failed.map((f) => f.scope).join(', '));
			}
			pendingDelete = null;
			await load();
		} catch (er) {
			toastError('Eliminazione', apiErrorDetail(er));
		} finally {
			deleting = false;
		}
	}

	// ── Tombstones (admins) ──────────────────────────────────────────────────
	let restoring = '';

	async function restore(t: DbTombstone) {
		restoring = `${t.kind}:${t.name}`;
		try {
			await restoreDatabase(t.kind, t.name);
			toastSuccess(`Ripristinabile: ${t.name}`, 'Il pack che lo dichiara può ricrearlo.');
			await load();
		} catch (e) {
			toastError('Ripristino', apiErrorDetail(e));
		} finally {
			restoring = '';
		}
	}

	// ── Datastores archived with a removed pack (unchanged behaviour) ────────
	let archived: DatabaseEntry[] = [];
	let pendingPurge: DatabaseEntry | null = null;
	let purging = false;

	async function loadArchived() {
		if (!admin) return;
		try {
			const inv = await listDatabases({ cache: false });
			archived = inv.datastores.filter((d) => d.status === 'archived');
		} catch {
			archived = [];
		}
	}

	async function confirmPurge() {
		if (!pendingPurge?.archive_dir) return;
		purging = true;
		try {
			await purgeArchivedDatastore(pendingPurge.archive_dir);
			toastSuccess(`Eliminato: ${pendingPurge.archive_dir}`);
			pendingPurge = null;
			await loadArchived();
		} catch (e) {
			toastError('Eliminazione', apiErrorDetail(e));
		} finally {
			purging = false;
		}
	}

	function glyph(e: DbCatalogueEntry): string {
		return e.kind === 'rag' ? '🧠' : '🗄️';
	}

	onMount(load);
</script>

<svelte:head>
	<title>Databases</title>
</svelte:head>

<!-- Same actions in both views: one snippet, two renderers. -->
{#snippet actions(e: DbCatalogueEntry)}
	<a class="db-btn db-link" href={entryHref(e, admin)}>Apri</a>
	{#if admin}
		<button type="button" class="db-btn danger" on:click={() => (pendingDelete = e)}>Elimina</button>
	{/if}
{/snippet}

{#snippet scopes(e: DbCatalogueEntry)}
	<div class="db-scopes">
		{#each e.imported_by_scopes as s (s)}
			<a href={scopeHref(s)} title="importato in {s}">{s}</a>
		{:else}
			<span class="db-small">nessuno spazio lo importa</span>
		{/each}
	</div>
{/snippet}

<div class="db-page">
	<header class="db-head">
		<div>
			<h1>Databases</h1>
			<p class="db-hint">
				Datastore e collection RAG dell'istanza, dichiarati dai pack o creati qui. I dati si usano
				importandoli in uno spazio (topic, DM, job){admin ? '' : ': qui vedi quelli importati negli spazi di cui fai parte'}.
			</p>
		</div>
		<div class="db-head-actions">
			<ViewToggle page="databases" bind:view />
			{#if admin}
				<button type="button" class="db-btn primary" on:click={() => openCreate('datastore')}>＋ Nuovo datastore</button>
				<button type="button" class="db-btn primary" on:click={() => openCreate('rag')}
					disabled={cat !== null && !cat.rag_available}>＋ Nuova collection</button>
			{/if}
			<button type="button" class="db-btn" on:click={load} disabled={loading}>{loading ? '…' : 'Aggiorna'}</button>
		</div>
	</header>

	<div class="db-filters">
		<select bind:value={fKind} aria-label="Tipo">
			<option value="">Tutti i tipi</option>
			<option value="datastore">Datastore</option>
			<option value="rag">Collection RAG</option>
		</select>
		<select bind:value={fPack} aria-label="Origine">
			<option value="">Tutte le origini</option>
			<option value="@platform">Piattaforma</option>
			{#each packs as p (p)}<option value={p}>{p}</option>{/each}
		</select>
		<select bind:value={fTier} aria-label="Tier">
			<option value="">Tutti i tier</option>
			{#each TIERS as t (t)}<option value={t}>{t}</option>{/each}
		</select>
		<input type="search" placeholder="Cerca per nome…" bind:value={fQ} />
		{#if cat && !cat.rag_available}
			<span class="db-error">Servizio RAG non raggiungibile: le collection potrebbero mancare.</span>
		{/if}
	</div>

	{#if loading && !cat}
		<div class="db-grid">
			{#each Array(4) as _}<Skeleton height="120px" radius="10px" />{/each}
		</div>
	{:else if err}
		<div class="db-error">{err} <button type="button" class="db-btn" on:click={load}>Riprova</button></div>
	{:else if cat}
		{#if shown.length === 0}
			<p class="db-empty">
				{cat.entries.length === 0
					? admin ? 'Nessun datastore o collection.' : 'Nessun dato importato negli spazi di cui fai parte.'
					: 'Nessun risultato con questi filtri.'}
			</p>
		{:else if view === 'table'}
			<div class="db-table-wrap">
				<table class="db-tbl">
					<thead>
						<tr>
							<th></th><th>Nome</th><th>Origine</th><th>Tier</th><th>Stato</th><th>Dimensione</th>
							<th>Aggiornato</th><th>Spazi</th><th class="act">Azioni</th>
						</tr>
					</thead>
					<tbody>
						{#each shown as e (e.key)}
							<tr>
								<td title={e.kind === 'rag' ? 'Collection RAG' : 'Datastore'}>{glyph(e)}</td>
								<td class="mono"><a href={entryHref(e, admin)}>{e.name}</a>{#if e.pii} <span class="db-tag">PII</span>{/if}</td>
								<td>{originLabel(e)}</td>
								<td><span class="db-tag tier">{e.tier}</span></td>
								<td><span class="db-tag st-{e.status}">{statusLabel(e.status)}</span></td>
								<td class="db-small">{sizeLabel(e)}</td>
								<td class="db-small">{dateLabel(e.updated_at)}</td>
								<td>{@render scopes(e)}</td>
								<td class="act">{@render actions(e)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="db-grid">
				{#each shown as e (e.key)}
					<div class="db-card" class:missing={e.status !== 'active'}>
						<div class="db-card-head">
							<span class="db-glyph" aria-hidden="true">{glyph(e)}</span>
							<div>
								<div class="db-name"><a href={entryHref(e, admin)}>{e.name}</a></div>
								<div class="db-small">{e.kind === 'rag' ? 'Collection RAG' : 'Datastore'} · {originLabel(e)}</div>
							</div>
						</div>
						{#if e.purpose}<div class="db-small">{e.purpose}</div>{/if}
						<div class="db-meta">
							<span class="db-tag tier">{e.tier}</span>
							<span class="db-tag st-{e.status}">{statusLabel(e.status)}</span>
							{#if e.pii}<span class="db-tag">PII</span>{/if}
							<span>{sizeLabel(e)}</span>
						</div>
						<div class="db-small">Aggiornato {dateLabel(e.updated_at)}</div>
						{@render scopes(e)}
						<div class="db-actions">{@render actions(e)}</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if admin && cat.tombstones && cat.tombstones.length}
			<section class="db-section">
				<h2>Eliminati <span class="db-count">({cat.tombstones.length})</span></h2>
				<p class="db-hint">
					Risorse eliminate da qui: il pack che le dichiara non le ricrea finché non le ripristini
					(o non ne crei una nuova con lo stesso nome). L'export è nella cartella dati.
				</p>
				<div class="db-table-wrap">
					<table class="db-tbl">
						<thead><tr><th>Risorsa</th><th>Eliminata</th><th>Da</th><th>Export</th><th class="act"></th></tr></thead>
						<tbody>
							{#each cat.tombstones as t (t.kind + ':' + t.name)}
								<tr>
									<td class="mono">{t.kind === 'rag' ? '🧠' : '🗄️'} {t.name}</td>
									<td class="db-small">{dateLabel(t.deleted_at)}</td>
									<td>{t.by}</td>
									<td class="mono">{t.export || '—'}</td>
									<td class="act">
										<button type="button" class="db-btn" disabled={restoring === `${t.kind}:${t.name}`}
											on:click={() => restore(t)}>Ripristina</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		{#if admin && archived.length}
			<section class="db-section">
				<h2>Archiviati con un pack rimosso <span class="db-count">({archived.length})</span></h2>
				<div class="db-table-wrap">
					<table class="db-tbl">
						<thead><tr><th>Pack</th><th>File</th><th>Dal</th><th class="act"></th></tr></thead>
						<tbody>
							{#each archived as d (d.archive_dir + '/' + (d.path ?? '.'))}
								<tr>
									<td>{d.pack}</td>
									<td class="mono">{d.path ?? '.'}</td>
									<td class="db-small">{d.archived_at ?? '—'}</td>
									<td class="act">
										<button type="button" class="db-btn danger" on:click={() => (pendingPurge = d)}>
											Elimina definitivamente
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}
	{/if}
</div>

<Modal open={creating !== null} dismissable={!createBusy} on:close={() => (creating = null)} maxWidth={460}>
	<h2 slot="title">{creating === 'rag' ? 'Nuova collection RAG' : 'Nuovo datastore'}</h2>
	<form class="db-form" on:submit|preventDefault={submitCreate}>
		<label class="db-field">
			Nome
			<input type="text" bind:value={newName} placeholder="es. procedure-interne" autocomplete="off" />
			{#if newName && !validName(newName)}
				<span class="db-error">Minuscole, cifre, «-» e «_» (max 63), iniziale lettera o cifra.</span>
			{:else if creating === 'datastore' && newName}
				<span class="db-small">Sarà <code>platform/{newName}</code>, un file SQLite vuoto.</span>
			{/if}
		</label>
		<label class="db-field">
			Tier
			<select bind:value={newTier}>{#each TIERS as t (t)}<option value={t}>{t}</option>{/each}</select>
		</label>
		<label class="db-field">
			{creating === 'rag' ? 'Descrizione' : 'Scopo'}
			<input type="text" bind:value={newPurpose} />
		</label>
		{#if creating === 'datastore'}
			<label class="db-field inline"><input type="checkbox" bind:checked={newPii} /> Contiene dati personali (PII)</label>
		{/if}
	</form>
	<svelte:fragment slot="actions">
		<button type="button" class="db-btn" on:click={() => (creating = null)} disabled={createBusy}>Annulla</button>
		<button type="button" class="db-btn primary" on:click={submitCreate}
			disabled={createBusy || !validName(newName)}>{createBusy ? '…' : 'Crea'}</button>
	</svelte:fragment>
</Modal>

<DeleteResourceDialog
	open={pendingDelete !== null}
	kind={pendingDelete?.kind ?? 'datastore'}
	name={pendingDelete?.name ?? ''}
	scopes={pendingDelete?.imported_by_scopes ?? []}
	loading={deleting}
	on:confirm={confirmDelete}
	on:cancel={() => (pendingDelete = null)}
/>

<ConfirmDialog
	open={pendingPurge !== null}
	title="Eliminare definitivamente?"
	message={pendingPurge ? `«${pendingPurge.archive_dir}» verrà cancellato dal disco. L'azione non è reversibile.` : ''}
	confirmLabel="Elimina"
	destructive
	loading={purging}
	on:confirm={confirmPurge}
	on:cancel={() => (pendingPurge = null)}
/>
