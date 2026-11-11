<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import '../../../db.css';
	import {
		apiErrorDetail,
		datastoreRowOp,
		datastoreSchema,
		deleteDatabase,
		getDatabases,
		getDatastoreRows,
		getDatastoreTables,
		updateDataCatalogEntry,
		type DbCatalogueEntry,
		type DbColumnSpec,
		type DbRowsPage,
		type DbTable
	} from '$lib/api/client';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import DeleteResourceDialog from '$lib/components/DeleteResourceDialog.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { TIERS, dateLabel, originLabel, scopeHref, sizeLabel } from '$lib/databases.js';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	// ─────────────────────────────────────────────────────────────────────────
	// One datastore (clodia-platform#672): tables → paginated rows with search,
	// add / edit / delete a row (scope members, admins); for admins the schema
	// editor (create table, add column, drop table), the catalogue settings and
	// the delete. A non-admin works through a scope that imports the datastore:
	// `?scope=SEAL-2/name`, chosen among the scopes the server lists for them.
	// ─────────────────────────────────────────────────────────────────────────

	const PAGE = 50;
	const COLUMN_TYPES = ['TEXT', 'INTEGER', 'REAL', 'NUMERIC', 'BLOB'];

	$: key = `${$page.params.pack}/${$page.params.name}`;
	$: urlScope = $page.url.searchParams.get('scope') || '';

	let entry: DbCatalogueEntry | null = null;
	let admin = false;
	let scope = '';
	let tables: DbTable[] = [];
	let missing = false;
	let loadErr = '';
	let loading = true;

	let table = '';
	let rows: DbRowsPage | null = null;
	let rowsErr = '';
	let offset = 0;
	let q = '';
	let qApplied = '';

	$: current = tables.find((t) => t.name === table) || null;
	$: canEdit = !!rows?.editable && (admin || !!scope);

	let loadedKey = '';
	$: if (key && key !== loadedKey) {
		loadedKey = key;
		void loadAll();
	}

	async function loadAll() {
		loading = true;
		loadErr = '';
		try {
			const cat = await getDatabases();
			admin = cat.is_admin;
			entry = cat.entries.find((e) => e.kind === 'datastore' && e.name === key) || null;
			scope = urlScope || (!admin && entry ? entry.imported_by_scopes[0] || '' : '');
			await loadTables();
		} catch (e) {
			loadErr = apiErrorDetail(e);
		} finally {
			loading = false;
		}
	}

	async function loadTables() {
		const r = await getDatastoreTables(key, scope || null);
		tables = r.tables;
		missing = !!r.missing;
		if (!tables.find((t) => t.name === table)) {
			table = tables[0]?.name || '';
			offset = 0;
		}
		if (table) await loadRows();
		else rows = null;
	}

	async function loadRows() {
		rowsErr = '';
		try {
			rows = await getDatastoreRows(key, { table, limit: PAGE, offset, q: qApplied, scope: scope || null });
		} catch (e) {
			rows = null;
			rowsErr = apiErrorDetail(e);
		}
	}

	function pick(t: string) {
		table = t;
		offset = 0;
		q = qApplied = '';
		void loadRows();
	}

	function search() {
		qApplied = q.trim();
		offset = 0;
		void loadRows();
	}

	function go(delta: number) {
		offset = Math.max(0, offset + delta);
		void loadRows();
	}

	function changeScope(s: string) {
		scope = s;
		const u = new URL($page.url);
		if (s) u.searchParams.set('scope', s);
		else u.searchParams.delete('scope');
		void goto(u.pathname + u.search, { replaceState: true, noScroll: true, keepFocus: true });
		void loadTables().catch((e) => (loadErr = apiErrorDetail(e)));
	}

	function cell(v: unknown): string {
		if (v === null || v === undefined) return '∅';
		return typeof v === 'object' ? JSON.stringify(v) : String(v);
	}

	// ── Row editor ───────────────────────────────────────────────────────────
	let editing: { rowid: number | null; values: Record<string, string>; nulls: Record<string, boolean> } | null = null;
	let rowBusy = false;

	function openInsert() {
		if (!current) return;
		const values: Record<string, string> = {};
		const nulls: Record<string, boolean> = {};
		for (const c of current.columns) {
			values[c.name] = '';
			nulls[c.name] = !c.notnull;    // empty optional columns stay NULL / default
		}
		editing = { rowid: null, values, nulls };
	}

	function openEdit(r: Record<string, unknown>) {
		if (!current) return;
		const values: Record<string, string> = {};
		const nulls: Record<string, boolean> = {};
		for (const c of current.columns) {
			const v = r[c.name];
			nulls[c.name] = v === null || v === undefined;
			values[c.name] = nulls[c.name] ? '' : String(v);
		}
		editing = { rowid: Number(r.__rowid__), values, nulls };
	}

	function typed(col: string, raw: string): unknown {
		const t = (current?.columns.find((c) => c.name === col)?.type || '').toUpperCase();
		if (raw !== '' && (t.includes('INT') || t.includes('REAL') || t.includes('NUM') || t.includes('FLOA') || t.includes('DOUB'))) {
			const n = Number(raw);
			if (!Number.isNaN(n)) return n;
		}
		return raw;
	}

	async function saveRow() {
		if (!editing || !current) return;
		rowBusy = true;
		const values: Record<string, unknown> = {};
		for (const c of current.columns) {
			if (editing.nulls[c.name]) {
				if (editing.rowid !== null) values[c.name] = null;   // update: explicit NULL
			} else {
				values[c.name] = typed(c.name, editing.values[c.name]);
			}
		}
		try {
			await datastoreRowOp(key, editing.rowid === null
				? { op: 'insert', table, values, scope: scope || null }
				: { op: 'update', table, rowid: editing.rowid, values, scope: scope || null });
			toastSuccess(editing.rowid === null ? 'Riga aggiunta' : 'Riga aggiornata');
			editing = null;
			await loadTables();
		} catch (e) {
			toastError('Riga', apiErrorDetail(e));
		} finally {
			rowBusy = false;
		}
	}

	let pendingRowDelete: Record<string, unknown> | null = null;

	async function deleteRow() {
		if (!pendingRowDelete) return;
		rowBusy = true;
		try {
			await datastoreRowOp(key, { op: 'delete', table, rowid: Number(pendingRowDelete.__rowid__), scope: scope || null });
			toastSuccess('Riga eliminata');
			pendingRowDelete = null;
			await loadTables();
		} catch (e) {
			toastError('Riga', apiErrorDetail(e));
		} finally {
			rowBusy = false;
		}
	}

	// ── Schema editor (admins) ───────────────────────────────────────────────
	let schemaBusy = false;
	let newTable = '';
	let newCols: DbColumnSpec[] = [{ name: 'id', type: 'INTEGER', pk: true }, { name: '', type: 'TEXT' }];
	let addCol: DbColumnSpec = { name: '', type: 'TEXT' };
	let pendingDrop = '';

	async function schema(body: Parameters<typeof datastoreSchema>[1], done: string) {
		schemaBusy = true;
		try {
			await datastoreSchema(key, body);
			toastSuccess(done);
			await loadTables();
			return true;
		} catch (e) {
			toastError('Schema', apiErrorDetail(e));
			return false;
		} finally {
			schemaBusy = false;
		}
	}

	async function createTable() {
		const columns = newCols.filter((c) => c.name.trim());
		if (!newTable.trim() || !columns.length) return;
		if (await schema({ op: 'create_table', table: newTable.trim(), columns }, `Tabella ${newTable} creata`)) {
			table = newTable.trim();
			newTable = '';
			newCols = [{ name: 'id', type: 'INTEGER', pk: true }, { name: '', type: 'TEXT' }];
			await loadRows();
		}
	}

	async function addColumn() {
		if (!table || !addCol.name.trim()) return;
		if (await schema({ op: 'add_column', table, column: { ...addCol, name: addCol.name.trim() } }, `Colonna ${addCol.name} aggiunta`)) {
			addCol = { name: '', type: 'TEXT' };
		}
	}

	async function dropTable() {
		const t = pendingDrop;
		if (await schema({ op: 'drop_table', table: t }, `Tabella ${t} eliminata`)) pendingDrop = '';
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
		if (!entry) return;
		catBusy = true;
		try {
			await updateDataCatalogEntry('datastore', key, {
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
			const r = await deleteDatabase('datastore', key, e.detail);
			toastSuccess(`Eliminato: ${key}`, `Export in ${r.export_dir}`);
			await goto('/databases');
		} catch (er) {
			toastError('Eliminazione', apiErrorDetail(er));
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head>
	<title>{key} · Databases</title>
</svelte:head>

<div class="db-page">
	<div class="db-crumbs"><a href="/databases">Databases</a> › datastore</div>
	<header class="db-head">
		<div>
			<h1 class="db-name" style="font-size:1.3rem">🗄️ {key}</h1>
			{#if entry}
				<div class="db-meta">
					<span>{originLabel(entry)}</span>
					<span class="db-tag tier">{entry.tier}</span>
					{#if entry.pii}<span class="db-tag">PII</span>{/if}
					<span>{sizeLabel(entry)}</span>
					<span>· aggiornato {dateLabel(entry.updated_at)}</span>
				</div>
				{#if entry.purpose}<p class="db-hint">{entry.purpose}</p>{/if}
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

	{#if loading && !tables.length}
		<Skeleton height="160px" radius="10px" />
	{:else if loadErr}
		<div class="db-error">{loadErr} <button type="button" class="db-btn" on:click={loadAll}>Riprova</button></div>
	{:else}
		{#if missing}
			<p class="db-error">Il file del datastore non esiste (ancora): nessuna tabella da mostrare.</p>
		{/if}
		<div class="db-split">
			<div>
				<h2 style="font-size:13px">Tabelle <span class="db-count">({tables.length})</span></h2>
				<div class="db-list">
					{#each tables as t (t.name)}
						<button type="button" class:on={t.name === table} on:click={() => pick(t.name)}>
							<span>{t.type === 'view' ? '👁 ' : ''}{t.name}</span>
							<span class="db-small">{t.rows ?? '?'}</span>
						</button>
					{:else}
						<p class="db-empty">Nessuna tabella.</p>
					{/each}
				</div>
			</div>
			<div>
				{#if table}
					<div class="db-filters" style="margin-top:0">
						<form on:submit|preventDefault={search} style="display:flex;gap:6px">
							<input type="search" placeholder="Cerca in {table}…" bind:value={q} />
							<button type="submit" class="db-btn">Cerca</button>
						</form>
						{#if canEdit}
							<button type="button" class="db-btn primary" on:click={openInsert}>＋ Riga</button>
						{/if}
						{#if rows && !rows.editable}
							<span class="db-small">{current?.type === 'view' ? 'Vista: sola lettura' : 'Tabella senza rowid: sola lettura'}</span>
						{/if}
					</div>
					{#if rowsErr}
						<p class="db-error">{rowsErr}</p>
					{:else if rows}
						<div class="db-table-wrap">
							<table class="db-tbl">
								<thead>
									<tr>
										{#each rows.columns as c (c.name)}
											<th title={c.type}>{c.name}{c.pk ? ' 🔑' : ''}</th>
										{/each}
										{#if canEdit}<th class="act"></th>{/if}
									</tr>
								</thead>
								<tbody>
									{#each rows.rows as r, i (r.__rowid__ ?? i)}
										<tr>
											{#each rows.columns as c (c.name)}
												<td class="cell" title={cell(r[c.name])}>{cell(r[c.name])}</td>
											{/each}
											{#if canEdit}
												<td class="act">
													<button type="button" class="db-btn" on:click={() => openEdit(r)}>Modifica</button>
													<button type="button" class="db-btn danger" on:click={() => (pendingRowDelete = r)}>Elimina</button>
												</td>
											{/if}
										</tr>
									{:else}
										<tr><td colspan={rows.columns.length + 1} class="db-empty">{qApplied ? 'Nessuna riga trovata.' : 'Tabella vuota.'}</td></tr>
									{/each}
								</tbody>
							</table>
						</div>
						<div class="db-pager">
							{#if rows.truncated}<span class="db-error">pagina tagliata: righe troppo grandi</span>{/if}
							<span>{rows.total ? `${offset + 1}–${offset + rows.rows.length} di ${rows.total}` : '0 righe'}</span>
							<button type="button" class="db-btn" disabled={offset === 0} on:click={() => go(-PAGE)}>‹</button>
							<button type="button" class="db-btn" disabled={offset + rows.rows.length >= rows.total} on:click={() => go(PAGE)}>›</button>
						</div>
					{/if}
				{/if}
			</div>
		</div>

		{#if admin}
			<section class="db-section db-admin">
				<h3>Schema (admin)</h3>
				{#if entry?.pack}
					<p class="db-small">Datastore del pack <b>{entry.pack}</b>: il suo MCP si aspetta lo schema che ha creato. Cambialo solo se sai cosa fa il pack.</p>
				{/if}
				<div class="db-form">
					<div class="db-field">
						Nuova tabella
						<div class="db-colrow">
							<input type="text" placeholder="nome tabella" bind:value={newTable} />
						</div>
						<div class="db-cols">
							{#each newCols as c, i}
								<div class="db-colrow">
									<input type="text" placeholder="colonna" bind:value={c.name} />
									<select bind:value={c.type}>{#each COLUMN_TYPES as t (t)}<option value={t}>{t}</option>{/each}</select>
									<label class="db-small"><input type="checkbox" bind:checked={c.pk} /> chiave</label>
									<label class="db-small"><input type="checkbox" bind:checked={c.notnull} /> obbligatoria</label>
									<button type="button" class="db-btn" on:click={() => (newCols = newCols.filter((_, j) => j !== i))} disabled={newCols.length < 2}>✕</button>
								</div>
							{/each}
						</div>
						<div class="db-colrow">
							<button type="button" class="db-btn" on:click={() => (newCols = [...newCols, { name: '', type: 'TEXT' }])}>＋ colonna</button>
							<button type="button" class="db-btn primary" on:click={createTable} disabled={schemaBusy || !newTable.trim()}>Crea tabella</button>
						</div>
					</div>
					{#if current && current.type === 'table'}
						<div class="db-field">
							Aggiungi colonna a <b>{table}</b>
							<div class="db-colrow">
								<input type="text" placeholder="colonna" bind:value={addCol.name} />
								<select bind:value={addCol.type}>{#each COLUMN_TYPES as t (t)}<option value={t}>{t}</option>{/each}</select>
								<button type="button" class="db-btn" on:click={addColumn} disabled={schemaBusy || !addCol.name.trim()}>Aggiungi</button>
								<button type="button" class="db-btn danger" on:click={() => (pendingDrop = table)} disabled={schemaBusy}>Elimina tabella {table}</button>
							</div>
						</div>
					{/if}
				</div>
			</section>

			{#if entry}
				<section class="db-section db-admin">
					<h3>Catalogo (admin)</h3>
					<div class="db-colrow">
						<label class="db-field">Tier
							<select bind:value={draftTier}>{#each TIERS as t (t)}<option value={t}>{t}</option>{/each}</select>
						</label>
						<label class="db-field" style="flex:1">Chi può importarlo (<code>@admin</code> = ogni admin)
							<input type="text" bind:value={draftImporters} />
						</label>
						<button type="button" class="db-btn" on:click={saveCatalogue} disabled={catBusy}>Salva</button>
					</div>
					<div class="db-scopes" style="margin-top:8px">
						<span class="db-small">Importato in:</span>
						{#each entry.imported_by_scopes as s (s)}<a href={scopeHref(s)}>{s}</a>{:else}<span class="db-small">nessuno spazio</span>{/each}
					</div>
				</section>
			{/if}

			<section class="db-section db-admin">
				<h3>Zona pericolosa</h3>
				<p class="db-small">Elimina il datastore e tutti i suoi dati dalla piattaforma (prima viene scritto un export).</p>
				<button type="button" class="db-btn danger" on:click={() => (askDelete = true)}>Elimina datastore</button>
			</section>
		{/if}
	{/if}
</div>

<Modal open={editing !== null} dismissable={!rowBusy} on:close={() => (editing = null)} maxWidth={520}>
	<h2 slot="title">{editing?.rowid === null ? `Nuova riga in ${table}` : `Riga ${editing?.rowid} di ${table}`}</h2>
	{#if editing && current}
		<form class="db-form" on:submit|preventDefault={saveRow}>
			{#each current.columns as c (c.name)}
				<label class="db-field">
					<span>{c.name} <span class="db-small">{c.type}{c.pk ? ' · chiave' : ''}{c.notnull ? ' · obbligatoria' : ''}</span></span>
					<div class="db-colrow">
						<input type="text" style="flex:1" bind:value={editing.values[c.name]} disabled={editing.nulls[c.name]}
							on:input={() => editing && (editing.nulls[c.name] = false)} />
						{#if !c.notnull}
							<label class="db-small"><input type="checkbox" bind:checked={editing.nulls[c.name]} /> {editing.rowid === null ? 'default' : 'NULL'}</label>
						{/if}
					</div>
				</label>
			{/each}
		</form>
	{/if}
	<svelte:fragment slot="actions">
		<button type="button" class="db-btn" on:click={() => (editing = null)} disabled={rowBusy}>Annulla</button>
		<button type="button" class="db-btn primary" on:click={saveRow} disabled={rowBusy}>{rowBusy ? '…' : 'Salva'}</button>
	</svelte:fragment>
</Modal>

<ConfirmDialog
	open={pendingRowDelete !== null}
	title="Eliminare la riga?"
	message={pendingRowDelete ? `La riga ${pendingRowDelete.__rowid__} di «${table}» verrà eliminata.` : ''}
	confirmLabel="Elimina"
	destructive
	loading={rowBusy}
	on:confirm={deleteRow}
	on:cancel={() => (pendingRowDelete = null)}
/>

<ConfirmDialog
	open={pendingDrop !== ''}
	title="Eliminare la tabella?"
	message={`La tabella «${pendingDrop}» e tutte le sue righe verranno eliminate. Non c'è export automatico per una singola tabella.`}
	confirmLabel="Elimina tabella"
	destructive
	loading={schemaBusy}
	on:confirm={dropTable}
	on:cancel={() => (pendingDrop = '')}
/>

<DeleteResourceDialog
	open={askDelete}
	kind="datastore"
	name={key}
	scopes={entry?.imported_by_scopes ?? []}
	loading={deleting}
	on:confirm={confirmDelete}
	on:cancel={() => (askDelete = false)}
/>
