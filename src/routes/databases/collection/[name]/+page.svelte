<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import '../../db.css';
	import {
		apiErrorDetail,
		deleteDatabase,
		getCollectionChunks,
		getCollectionDocuments,
		getDatabases,
		removeCollectionDocument,
		updateDataCatalogEntry,
		uploadToCollection,
		type DbCatalogueEntry,
		type RagChunksPage,
		type RagDocument
	} from '$lib/api/client';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import DeleteResourceDialog from '$lib/components/DeleteResourceDialog.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import {
		TIERS,
		UPLOAD_FORMATS,
		bytesLabel,
		dateLabel,
		originLabel,
		scopeHref,
		sizeLabel,
		uploadProblem
	} from '$lib/databases.js';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	// ─────────────────────────────────────────────────────────────────────────
	// One RAG collection (clodia-platform#672): its documents → the chunks of a
	// document; upload (drag & drop; PDF, DOCX, PPTX, MD, TXT) with the upload
	// progress, then the indexing; remove a document; for admins the catalogue
	// settings and the delete. A non-admin works through a scope that imports
	// the collection (`?scope=`). Uploading needs a clearance at least the
	// collection's tier: the server refuses otherwise and says so.
	// ─────────────────────────────────────────────────────────────────────────

	const CHUNKS_PAGE = 20;

	$: name = $page.params.name ?? '';
	$: urlScope = $page.url.searchParams.get('scope') || '';

	let entry: DbCatalogueEntry | null = null;
	let admin = false;
	let scope = '';
	let maxBytes = 20 * 1024 * 1024;
	let docs: RagDocument[] = [];
	let loading = true;
	let err = '';

	let loadedName = '';
	$: if (name && name !== loadedName) {
		loadedName = name;
		void loadAll();
	}

	async function loadAll() {
		loading = true;
		err = '';
		try {
			const cat = await getDatabases();
			admin = cat.is_admin;
			maxBytes = cat.upload_max_bytes || maxBytes;
			entry = cat.entries.find((e) => e.kind === 'rag' && e.name === name) || null;
			scope = urlScope || (!admin && entry ? entry.imported_by_scopes[0] || '' : '');
			await loadDocs();
		} catch (e) {
			err = apiErrorDetail(e);
		} finally {
			loading = false;
		}
	}

	async function loadDocs() {
		docs = (await getCollectionDocuments(name, scope || null)).documents;
	}

	function changeScope(s: string) {
		scope = s;
		const u = new URL($page.url);
		if (s) u.searchParams.set('scope', s);
		else u.searchParams.delete('scope');
		void goto(u.pathname + u.search, { replaceState: true, noScroll: true, keepFocus: true });
		void loadDocs().catch((e) => (err = apiErrorDetail(e)));
	}

	// ── Chunks of a document ─────────────────────────────────────────────────
	let openDoc: RagDocument | null = null;
	let chunks: RagChunksPage | null = null;
	let chunksErr = '';
	let chunkOffset = 0;

	async function showChunks(d: RagDocument, offset = 0) {
		openDoc = d;
		chunkOffset = offset;
		chunksErr = '';
		try {
			chunks = await getCollectionChunks(name, { doc: d.name, version: d.version, limit: CHUNKS_PAGE, offset, scope: scope || null });
		} catch (e) {
			chunks = null;
			chunksErr = apiErrorDetail(e);
		}
	}

	// ── Upload ───────────────────────────────────────────────────────────────
	let over = false;
	let file: File | null = null;
	let docName = '';
	let version = '1';
	let phase: 'idle' | 'upload' | 'index' = 'idle';
	let progress = 0;
	let fileInput: HTMLInputElement;

	$: problem = file ? uploadProblem(file, maxBytes) : '';

	function choose(f: File | null | undefined) {
		if (!f) return;
		file = f;
		docName = f.name.replace(/\.[^.]+$/, '');
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		over = false;
		choose(e.dataTransfer?.files?.[0]);
	}

	async function upload() {
		if (!file || problem || phase !== 'idle') return;
		phase = 'upload';
		progress = 0;
		try {
			const r = await uploadToCollection(name, file, { docName, version, scope: scope || null }, (sent, total) => {
				progress = total ? Math.round((sent / total) * 100) : 0;
				if (sent >= total) phase = 'index';
			});
			toastSuccess(`Indicizzato: ${r.document}`, `${r.chunks ?? '?'} chunk da ${bytesLabel(r.bytes)}`);
			file = null;
			docName = '';
			version = '1';
			if (fileInput) fileInput.value = '';
			await loadDocs();
		} catch (e) {
			toastError('Caricamento', apiErrorDetail(e));
		} finally {
			phase = 'idle';
		}
	}

	// ── Remove a document ────────────────────────────────────────────────────
	let pendingRemove: RagDocument | null = null;
	let removing = false;

	async function removeDoc() {
		if (!pendingRemove) return;
		removing = true;
		try {
			await removeCollectionDocument(name, pendingRemove.name, pendingRemove.version, scope || null);
			toastSuccess(`Rimosso: ${pendingRemove.name}`);
			if (openDoc?.name === pendingRemove.name) {
				openDoc = null;
				chunks = null;
			}
			pendingRemove = null;
			await loadDocs();
		} catch (e) {
			toastError('Rimozione', apiErrorDetail(e));
		} finally {
			removing = false;
		}
	}

	// ── Catalogue settings and delete (admins) ───────────────────────────────
	let draftTier = '';
	let draftImporters = '';
	let catBusy = false;
	$: if (entry && !draftTier) {
		draftTier = entry.tier;
		draftImporters = (entry.importers || []).join(', ');
	}

	async function saveCatalogue() {
		catBusy = true;
		try {
			await updateDataCatalogEntry('rag', name, {
				tier: draftTier,
				importers: draftImporters.split(',').map((s) => s.trim()).filter(Boolean)
			});
			toastSuccess('Catalogo aggiornato');
			draftTier = '';
			await loadAll();
		} catch (e) {
			toastError('Catalogo', apiErrorDetail(e));
		} finally {
			catBusy = false;
		}
	}

	let askDelete = false;
	let deleting = false;

	async function confirmDelete(e: CustomEvent<string>) {
		deleting = true;
		try {
			const r = await deleteDatabase('rag', name, e.detail);
			toastSuccess(`Eliminata: ${name}`, `Export in ${r.export_dir}`);
			await goto('/databases');
		} catch (er) {
			toastError('Eliminazione', apiErrorDetail(er));
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head>
	<title>{name} · Databases</title>
</svelte:head>

<div class="db-page">
	<div class="db-crumbs"><a href="/databases">Databases</a> › collection</div>
	<header class="db-head">
		<div>
			<h1 class="db-name" style="font-size:1.3rem">🧠 {name}</h1>
			{#if entry}
				<div class="db-meta">
					<span>{originLabel(entry)}</span>
					<span class="db-tag tier">{entry.tier}</span>
					<span>{sizeLabel(entry)}</span>
					<span>· aggiornata {dateLabel(entry.updated_at)}</span>
				</div>
			{/if}
		</div>
		<div class="db-head-actions">
			{#if entry && (entry.imported_by_scopes.length || scope)}
				<label class="db-small">
					Spazio
					<select value={scope} on:change={(e) => changeScope(e.currentTarget.value)}>
						{#if admin}<option value="">— nessuno (admin) —</option>{/if}
						{#each entry.imported_by_scopes as s (s)}<option value={s}>{s}</option>{/each}
					</select>
				</label>
			{/if}
			<button type="button" class="db-btn" on:click={loadAll} disabled={loading}>Aggiorna</button>
		</div>
	</header>

	{#if loading && !docs.length}
		<Skeleton height="160px" radius="10px" />
	{:else if err}
		<div class="db-error">{err} <button type="button" class="db-btn" on:click={loadAll}>Riprova</button></div>
	{:else}
		<section class="db-section">
			<div class="db-drop" class:over role="region" aria-label="Carica un documento"
				on:dragover|preventDefault={() => (over = true)}
				on:dragleave={() => (over = false)}
				on:drop={onDrop}>
				{#if file}
					<div class="db-colrow" style="justify-content:center">
						<b class="mono">{file.name}</b> <span class="db-small">{bytesLabel(file.size)}</span>
						<label class="db-small">Nome documento <input type="text" bind:value={docName} disabled={phase !== 'idle'} /></label>
						<label class="db-small">Versione <input type="text" bind:value={version} size="6" disabled={phase !== 'idle'} /></label>
						<button type="button" class="db-btn primary" on:click={upload} disabled={!!problem || phase !== 'idle'}>
							{phase === 'upload' ? `Carico… ${progress}%` : phase === 'index' ? 'Indicizzo…' : 'Carica e indicizza'}
						</button>
						<button type="button" class="db-btn" on:click={() => (file = null)} disabled={phase !== 'idle'}>Annulla</button>
					</div>
					{#if problem}<p class="db-error" style="justify-content:center">{problem}</p>{/if}
					{#if phase !== 'idle'}
						<div class="db-progress"><div style="width:{phase === 'index' ? 100 : progress}%"></div></div>
						{#if phase === 'index'}<p class="db-small">Estrazione del testo e calcolo degli embedding: può richiedere qualche minuto per un documento grande.</p>{/if}
					{/if}
				{:else}
					Trascina qui un file ({UPLOAD_FORMATS.join(', ')}, max {bytesLabel(maxBytes)}) oppure
					<button type="button" class="db-btn" on:click={() => fileInput.click()}>scegli un file</button>
				{/if}
				<input type="file" hidden bind:this={fileInput} accept={UPLOAD_FORMATS.join(',')}
					on:change={(e) => choose(e.currentTarget.files?.[0])} />
			</div>
			<p class="db-small">
				Il testo viene estratto dal gateway e indicizzato come contenuto esterno (non fidato). Serve una
				clearance almeno pari al tier della collection{entry ? ` (${entry.tier})` : ''}.
			</p>
		</section>

		<section class="db-section">
			<h2>Documenti <span class="db-count">({docs.length})</span></h2>
			{#if docs.length === 0}
				<p class="db-empty">Nessun documento.</p>
			{:else}
				<div class="db-table-wrap">
					<table class="db-tbl">
						<thead><tr><th>Nome</th><th>Versione</th><th>Stato</th><th>Chunk</th><th>Indicizzato</th><th>Fonte</th><th class="act"></th></tr></thead>
						<tbody>
							{#each docs as d (d.name + '@' + d.version)}
								<tr class:sel={openDoc?.name === d.name && openDoc?.version === d.version}>
									<td class="mono"><a href={'#chunks'} on:click|preventDefault={() => showChunks(d)}>{d.name}</a></td>
									<td class="mono">{d.version}</td>
									<td>{d.status}</td>
									<td>{d.chunks}</td>
									<td class="db-small">{dateLabel(d.ingested_at)}</td>
									<td class="db-small" title={d.source ?? ''}>{d.provenance ?? '—'}</td>
									<td class="act">
										<button type="button" class="db-btn" on:click={() => showChunks(d)}>Chunk</button>
										<button type="button" class="db-btn danger" on:click={() => (pendingRemove = d)}>Rimuovi</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		{#if openDoc}
			<section class="db-section" id="chunks">
				<h2>Chunk di <span class="mono">{openDoc.name}</span> <span class="db-count">v{openDoc.version}{chunks ? ` · ${chunks.total}` : ''}</span></h2>
				{#if chunksErr}
					<p class="db-error">{chunksErr}</p>
				{:else if chunks}
					<div class="db-list">
						{#each chunks.chunks as c, i (c.ordinal ?? i)}
							<div class="db-chunk">
								<span class="db-small">#{c.ordinal ?? chunkOffset + i}{c.section ? ` · ${c.section}` : ''}{c.page ? ` · p. ${c.page}` : ''}</span>
								{c.text}
							</div>
						{:else}
							<p class="db-empty">Nessun chunk.</p>
						{/each}
					</div>
					<div class="db-pager">
						<span>{chunks.total ? `${chunkOffset + 1}–${chunkOffset + chunks.chunks.length} di ${chunks.total}` : ''}</span>
						<button type="button" class="db-btn" disabled={chunkOffset === 0}
							on:click={() => openDoc && showChunks(openDoc, Math.max(0, chunkOffset - CHUNKS_PAGE))}>‹</button>
						<button type="button" class="db-btn" disabled={chunkOffset + chunks.chunks.length >= chunks.total}
							on:click={() => openDoc && showChunks(openDoc, chunkOffset + CHUNKS_PAGE)}>›</button>
					</div>
				{/if}
			</section>
		{/if}

		{#if admin && entry}
			<section class="db-section db-admin">
				<h3>Catalogo (admin)</h3>
				<div class="db-colrow">
					<label class="db-field">Tier
						<select bind:value={draftTier}>{#each TIERS as t (t)}<option value={t}>{t}</option>{/each}</select>
					</label>
					<label class="db-field" style="flex:1">Chi può importarla (<code>@admin</code> = ogni admin)
						<input type="text" bind:value={draftImporters} />
					</label>
					<button type="button" class="db-btn" on:click={saveCatalogue} disabled={catBusy}>Salva</button>
				</div>
				<div class="db-scopes" style="margin-top:8px">
					<span class="db-small">Importata in:</span>
					{#each entry.imported_by_scopes as s (s)}<a href={scopeHref(s)}>{s}</a>{:else}<span class="db-small">nessuno spazio</span>{/each}
				</div>
			</section>
		{/if}
		{#if admin}
			<section class="db-section db-admin">
				<h3>Zona pericolosa</h3>
				<p class="db-small">Elimina la collection e tutti i suoi documenti dalla piattaforma (prima viene scritto un export).</p>
				<button type="button" class="db-btn danger" on:click={() => (askDelete = true)}>Elimina collection</button>
			</section>
		{/if}
	{/if}
</div>

<ConfirmDialog
	open={pendingRemove !== null}
	title="Rimuovere il documento?"
	message={pendingRemove ? `«${pendingRemove.name}» (versione ${pendingRemove.version}) e i suoi ${pendingRemove.chunks} chunk escono dalla collection.` : ''}
	confirmLabel="Rimuovi"
	destructive
	loading={removing}
	on:confirm={removeDoc}
	on:cancel={() => (pendingRemove = null)}
/>

<DeleteResourceDialog
	open={askDelete}
	kind="rag"
	{name}
	scopes={entry?.imported_by_scopes ?? []}
	loading={deleting}
	on:confirm={confirmDelete}
	on:cancel={() => (askDelete = false)}
/>
