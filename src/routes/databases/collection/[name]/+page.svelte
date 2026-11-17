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
		uploadProblem,
		uploadNote,
		uploadDetail
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
	// Several files at once (#698): each one is uploaded and indexed in turn,
	// with its own progress; an error on one file does not stop the others.
	type QueueItem = {
		file: File;
		docName: string;
		problem: string;
		status: 'pending' | 'upload' | 'index' | 'done' | 'error';
		progress: number;
		note: string;
		detail: string;
	};
	let over = false;
	let queue: QueueItem[] = [];
	let version = '1';
	let running = false;
	let fileInput: HTMLInputElement;

	$: valid = queue.filter((q) => !q.problem);

	function choose(list: FileList | File[] | null | undefined) {
		if (!list || running) return;
		const names = new Set(queue.map((q) => q.file.name));
		for (const f of Array.from(list)) {
			if (names.has(f.name)) continue;
			names.add(f.name);
			queue = [...queue, {
				file: f,
				docName: f.name.replace(/\.[^.]+$/, ''),
				problem: uploadProblem(f, maxBytes),
				status: 'pending',
				progress: 0,
				note: '',
				detail: ''
			}];
		}
		if (fileInput) fileInput.value = '';
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		over = false;
		choose(e.dataTransfer?.files);
	}

	function drop(i: number) {
		if (running) return;
		queue = queue.filter((_, k) => k !== i);
	}

	function clearQueue() {
		if (running) return;
		queue = [];
		version = '1';
	}

	async function upload() {
		if (running || !valid.length) return;
		running = true;
		let ok = 0;
		let ko = 0;
		for (let i = 0; i < queue.length; i++) {
			const q = queue[i];
			if (q.problem || q.status === 'done') continue;
			q.status = 'upload';
			q.progress = 0;
			queue = queue;
			try {
				const r = await uploadToCollection(name, q.file, { docName: q.docName, version, scope: scope || null }, (sent, total) => {
					q.progress = total ? Math.round((sent / total) * 100) : 0;
					if (sent >= total) q.status = 'index';
					queue = queue;
				});
				q.status = 'done';
				q.note = uploadNote(r);
				q.detail = uploadDetail(r);
				if (r.archive && r.errors && !r.indexed) { q.status = 'error'; ko++; } else ok++;
			} catch (e) {
				q.status = 'error';
				q.note = apiErrorDetail(e);
				ko++;
			}
			queue = queue;
		}
		running = false;
		if (ok) toastSuccess(`Indicizzati ${ok} file`, ko ? `${ko} con errore: vedi l'elenco` : '');
		else if (ko) toastError('Caricamento', `${ko} file non caricati: vedi l'elenco`);
		// Keep only what still needs attention (errors), so a retry is one click.
		queue = queue.filter((q) => q.status === 'error' || q.problem).map((q) => (q.problem ? q : { ...q, status: 'pending' }));
		await loadDocs();
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
			<div class="db-drop" class:over role="region" aria-label="Carica uno o più documenti"
				on:dragover|preventDefault={() => (over = true)}
				on:dragleave={() => (over = false)}
				on:drop={onDrop}>
				{#if queue.length}
					<ul class="db-queue">
						{#each queue as q, i (q.file.name)}
							<li class="db-colrow">
								<b class="mono">{q.file.name}</b> <span class="db-small">{bytesLabel(q.file.size)}</span>
								<label class="db-small">Nome documento <input type="text" bind:value={q.docName} disabled={running} /></label>
								{#if q.problem}
									<span class="db-error">{q.problem}</span>
								{:else if q.status === 'upload'}
									<span class="db-small">Carico… {q.progress}%</span>
								{:else if q.status === 'index'}
									<span class="db-small">Indicizzo…</span>
								{:else if q.status === 'done'}
									<span class="db-small" title={q.detail}>✓ {q.note}</span>
								{:else if q.status === 'error'}
									<span class="db-error" title={q.detail}>{q.note}</span>
								{/if}
								<button type="button" class="db-btn" on:click={() => drop(i)} disabled={running} aria-label="Togli {q.file.name}">✕</button>
								{#if q.status === 'upload' || q.status === 'index'}
									<div class="db-progress"><div style="width:{q.status === 'index' ? 100 : q.progress}%"></div></div>
								{/if}
							</li>
						{/each}
					</ul>
					<div class="db-colrow" style="justify-content:center">
						<label class="db-small">Versione <input type="text" bind:value={version} size="6" disabled={running} /></label>
						<button type="button" class="db-btn primary" on:click={upload} disabled={running || !valid.length}>
							{running ? 'Carico e indicizzo…' : `Carica e indicizza ${valid.length} file`}
						</button>
						<button type="button" class="db-btn" on:click={() => fileInput.click()} disabled={running}>Aggiungi file</button>
						<button type="button" class="db-btn" on:click={clearQueue} disabled={running}>Annulla</button>
					</div>
					{#if running}<p class="db-small">Estrazione del testo e calcolo degli embedding, un file alla volta: può richiedere qualche minuto.</p>{/if}
				{:else}
					Trascina qui uno o più file ({UPLOAD_FORMATS.join(', ')}, max {bytesLabel(maxBytes)} ciascuno; uno ZIP viene aperto sul server e ne viene indicizzato ogni file) oppure
					<button type="button" class="db-btn" on:click={() => fileInput.click()}>scegli i file</button>
				{/if}
				<input type="file" hidden multiple bind:this={fileInput} accept={UPLOAD_FORMATS.join(',')}
					on:change={(e) => choose(e.currentTarget.files)} />
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
