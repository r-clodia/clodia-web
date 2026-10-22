<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ApiError,
		apiErrorDetail,
		applyDataMigration,
		catalogLabel,
		catalogTopicTier,
		getDataCatalog,
		getDataMigrationPlan,
		listDatabases,
		purgeArchivedDatastore,
		setDataAccessMode,
		syncDataCatalog,
		updateDataCatalogEntry,
		type DataAccessMode,
		type DataCatalog,
		type DataCatalogEntry,
		type DataMigrationItem,
		type DataMigrationPlan
	} from '$lib/api/client';
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

	// ── MEMBER LIST delle collection (clodia-platform#341) ───────────────────
	// Le tre liste sono CALCOLATE dal backend girando i grant `rag_read`/
	// `rag_write` dei seed, non lette da un manifest: arrivano sempre tutte e
	// tre, già ordinate per nome, e `[]` è una risposta — «nessun seed dichiara
	// quel grant». Qui non si riordina e non si accorpa: l'ordine è quello del
	// backend, e lettura e scrittura restano due gruppi perché chi ingesta non
	// è chi consulta.

	/** `null` = il campo non è arrivato affatto (server più vecchio della member
	 *  list): è l'unico caso in cui la pagina non può dire «nessuno», perché non
	 *  ha ricevuto la risposta, non ha ricevuto una risposta vuota. */
	function lista(v: ReadonlyArray<string> | undefined): ReadonlyArray<string> | null {
		return Array.isArray(v) ? v : null;
	}

	function assi(r: RagCollectionEntry): ReadonlyArray<{
		label: string;
		seeds: ReadonlyArray<string> | null;
	}> {
		return [
			{ label: 'Lettura', seeds: lista(r.seeds_read) },
			{ label: 'Scrittura', seeds: lista(r.seeds_write) }
		];
	}

	// ── DATA CATALOG (clodia-platform#590) ───────────────────────────────────
	// The instance registry of datastores and collections: tier and who may
	// import them into a topic. Loaded apart from the inventory so that a
	// server without the catalog still shows the inventory above.
	const TIERS = ['SEAL-0', 'SEAL-1', 'SEAL-2', 'SEAL-3', 'SEAL-4'];

	let catalog: DataCatalog | null = null;
	let catalogErr = '';
	let catalogBusy = false;
	/** Admin drafts per entry key: tier and importers as typed. */
	let draftTier: Record<string, string> = {};
	let draftImporters: Record<string, string> = {};

	function resetDrafts(entries: DataCatalogEntry[]) {
		draftTier = Object.fromEntries(entries.map((e) => [e.key, e.tier]));
		draftImporters = Object.fromEntries(entries.map((e) => [e.key, e.importers.join(', ')]));
	}

	async function loadCatalog() {
		catalogErr = '';
		try {
			catalog = await getDataCatalog();
			resetDrafts(catalog.entries);
		} catch (err) {
			catalog = null;
			catalogErr = apiErrorDetail(err);
		}
	}

	/** `"SEAL-2/name"` → `/topics/SEAL-2/name`, each segment encoded. */
	function topicHref(t: string): string {
		const i = t.indexOf('/');
		return i < 0
			? `/topics/${encodeURIComponent(t)}`
			: `/topics/${encodeURIComponent(t.slice(0, i))}/${encodeURIComponent(t.slice(i + 1))}`;
	}

		function parseImporters(v: string): string[] {
		return v.split(',').map((x) => x.trim()).filter(Boolean);
	}

	function isDirty(e: DataCatalogEntry, tier: string, importers: string): boolean {
		return tier !== e.tier || parseImporters(importers).join(',') !== e.importers.join(',');
	}

	async function catalogAction(fn: () => Promise<string>) {
		if (catalogBusy) return;
		catalogBusy = true;
		try {
			toastSuccess(await fn());
			await loadCatalog();
		} catch (err) {
			toastError('Catalogo dati', apiErrorDetail(err));
		} finally {
			catalogBusy = false;
		}
	}

	function saveEntry(e: DataCatalogEntry) {
		void catalogAction(async () => {
			await updateDataCatalogEntry(e.kind, e.name, {
				tier: draftTier[e.key],
				importers: parseImporters(draftImporters[e.key] ?? '')
			});
			return `Aggiornato: ${e.name}`;
		});
	}

	function sync() {
		void catalogAction(async () => {
			const r = await syncDataCatalog();
			return r.added ? `Aggiunte ${r.added} risorse al catalogo` : 'Catalogo già allineato';
		});
	}

	// ── MIGRATION from seed grants (clodia-platform#596) ─────────────────────
	// The plan is computed by the server and only read here; the admin picks
	// which `ok` items to apply. `already`/`skipped` are shown, never applied.
	let plan: DataMigrationPlan | null = null;
	let planBusy = false;
	let selected = new Set<number>();
	let applyResult: { applied: string[]; failed: { item: unknown; error: string }[] } | null = null;

	async function computePlan() {
		if (planBusy) return;
		planBusy = true;
		applyResult = null;
		try {
			plan = await getDataMigrationPlan();
			selected = new Set(plan.items.flatMap((it, i) => (it.status === 'ok' ? [i] : [])));
		} catch (err) {
			toastError('Piano di migrazione', apiErrorDetail(err));
		} finally {
			planBusy = false;
		}
	}

	function toggle(i: number) {
		const next = new Set(selected);
		if (next.has(i)) next.delete(i);
		else next.add(i);
		selected = next;
	}

	function grantsLabel(g: DataMigrationItem['grants']): string {
		const parts = Object.entries(g).map(([a, m]) => `${a}: ${m === 'write' ? 'scrittura' : 'lettura'}`);
		return parts.length ? parts.join(', ') : '—';
	}

	async function applyPlan() {
		if (!plan || planBusy || selected.size === 0) return;
		planBusy = true;
		try {
			const items = plan.items.filter((_, i) => selected.has(i));
			applyResult = await applyDataMigration(items);
			if (applyResult.failed.length) {
				toastError(`Migrazione: ${applyResult.failed.length} voci non applicate`);
			} else {
				toastSuccess(`Migrazione: ${applyResult.applied.length} voci applicate`);
			}
			plan = null;
			selected = new Set();
		} catch (err) {
			toastError('Migrazione', apiErrorDetail(err));
		} finally {
			planBusy = false;
		}
	}

	function itemLabel(item: unknown): string {
		if (item && typeof item === 'object') {
			const it = item as Partial<DataMigrationItem>;
			if (it.topic && it.name) return `${it.topic} · ${it.kind}:${it.name}`;
		}
		return typeof item === 'string' ? item : JSON.stringify(item);
	}

	// ── DATA ACCESS MODE ──────────────────────────────────────────────────────
	let pendingMode: DataAccessMode | null = null;
	let modeBusy = false;

	async function confirmMode() {
		if (!pendingMode) return;
		modeBusy = true;
		try {
			const r = await setDataAccessMode(pendingMode);
			if (catalog) catalog = { ...catalog, data_access: r.data_access };
			toastSuccess(`Accesso ai dati: ${r.data_access}`);
			pendingMode = null;
		} catch (err) {
			toastError('Accesso ai dati', apiErrorDetail(err));
		} finally {
			modeBusy = false;
		}
	}

	onMount(() => {
		void load();
		void loadCatalog();
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
						{@const bypass = lista(r.seeds_bypass) ?? []}
						<div class="row rag">
							<div class="line">
								<span class="cell name">{r.name}</span>
								<span class="cell pack">{r.pack ?? '—'}</span>
								<span class="cell tier">{r.tier}</span>
								<span class="cell counts">{r.documents ?? 0} doc · {r.chunks ?? 0} chunk</span>
								<span class="badge status-{r.status}">{statusLabel(r.status)}</span>
							</div>
							<div class="members">
								{#each assi(r) as asse}
									<div class="axis">
										<span class="axis-label">{asse.label}</span>
										{#if asse.seeds === null}
											<span class="unreported">non riportata dal server</span>
										{:else if asse.seeds.length === 0}
											<span class="none">Nessun seed dichiarato</span>
										{:else}
											{#each asse.seeds as s (s)}
												<span class="seed">{s}</span>
											{/each}
										{/if}
									</div>
								{/each}
								{#if bypass.length > 0}
									<div class="axis bypass">
										<span class="axis-label">Passano comunque</span>
										{#each bypass as s (s)}
											<span class="seed">{s}</span>
										{/each}
										<span class="why">
											non sono membri: coprono <code>rag.*</code> ed entrano senza essere in
											lista
										</span>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
				<p class="hint small">
					Le collection RAG sono sola lettura: il servizio non espone ancora un modo di
					cancellarle. Lettura e scrittura sono due liste distinte, calcolate dai grant
					dei seed: «Nessun seed dichiarato» è una risposta, non un dato mancante.
				</p>
			{/if}
		</section>
	{/if}

	<section>
		<h2>
			Catalogo dati
			{#if catalog}<span class="count">({catalog.entries.length})</span>{/if}
		</h2>
		<p class="hint small top">
			Le risorse dell'istanza che un topic può importare. Un topic importa solo risorse con
			tier ≤ al suo, e solo chi è fra gli importatori può farlo (<code>@admin</code> = qualunque
			admin).
		</p>
		{#if catalogErr}
			<div class="error">
				{catalogErr}
				<button type="button" on:click={loadCatalog}>Riprova</button>
			</div>
		{:else if !catalog}
			<Skeleton height="28px" radius="6px" />
		{:else}
			{#if $isAdmin}
				<div class="toolbar">
					<span class="cell">
						Accesso ai dati: <b class="mode mode-{catalog.data_access}">{catalog.data_access}</b>
					</span>
					<button type="button" class="btn" disabled={modeBusy}
						on:click={() => (pendingMode = catalog?.data_access === 'topic' ? 'legacy' : 'topic')}>
						{catalog.data_access === 'topic' ? 'Torna a legacy' : 'Passa a topic'}
					</button>
					<button type="button" class="btn" disabled={catalogBusy} on:click={sync}
						title="Registra nel catalogo i datastore e le collection che non ci sono ancora">
						{catalogBusy ? '…' : 'Sincronizza'}
					</button>
				</div>
			{/if}
			{#if catalog.entries.length === 0}
				<p class="empty">Nessuna risorsa nel catalogo.</p>
			{:else}
				<div class="tbl">
					{#each catalog.entries as e (e.key)}
						<div class="row">
							<span class="badge kind-{e.kind}">{e.kind === 'rag' ? 'RAG' : 'DB'}</span>
							<span class="cell name" title={e.name}>
								{catalogLabel(e)}
								{#if catalogTopicTier(e)}<span class="topic-tier">{catalogTopicTier(e)}</span>{/if}
							</span>
							{#if $isAdmin}
								<select class="cat-tier" bind:value={draftTier[e.key]} disabled={catalogBusy}>
									{#each TIERS as t}<option value={t}>{t}</option>{/each}
								</select>
								<input class="cat-importers" type="text" placeholder="@admin, utente…"
									bind:value={draftImporters[e.key]} disabled={catalogBusy}
									title="Chi può importarla: nomi separati da virgola" />
								<button type="button" class="btn"
									disabled={catalogBusy || !isDirty(e, draftTier[e.key], draftImporters[e.key] ?? '')}
									on:click={() => saveEntry(e)}>Salva</button>
							{:else}
								<span class="cell tier">{e.tier}</span>
								<span class="cell purpose">
									{e.importers.length ? e.importers.join(', ') : 'nessun importatore'}
								</span>
							{/if}
							<span class="cell counts" title={`creata ${e.created_at} · ${e.source}`}>{e.owner}</span>
							{#if e.importing_topics}
								<div class="importing">
									<span class="axis-label">Importata da</span>
									{#each e.importing_topics as t (t)}
										<a class="seed" href={topicHref(t)}>{t}</a>
									{:else}
										<span class="none">nessuno</span>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			{#if $isAdmin}
				<h3>Migrazione</h3>
				<p class="hint small top">
					Trasforma i permessi dichiarati nei seed (<code>datastores[].seeds</code>,
					<code>rag_read</code>, <code>rag_write</code>) in import e permessi per agente nei topic
					che usano i dati oggi. Il piano si calcola senza scrivere nulla; si applicano solo le voci
					selezionate.
				</p>
				<div class="toolbar">
					<button type="button" class="btn" disabled={planBusy} on:click={computePlan}>
						{planBusy && !plan ? '…' : 'Calcola piano'}
					</button>
					{#if plan}
						<span class="cell counts">
							{plan.counts.ok} da applicare · {plan.counts.already} già presenti · {plan.counts.skipped} saltate
						</span>
						<button type="button" class="btn primary" disabled={planBusy || selected.size === 0}
							on:click={applyPlan}>Applica selezionati ({selected.size})</button>
					{/if}
				</div>
				{#if plan}
					{#if plan.notes.length}
						<ul class="notes">
							{#each plan.notes as n}<li>{n}</li>{/each}
						</ul>
					{/if}
					{#if plan.items.length === 0}
						<p class="empty">Nessuna voce: non c'è niente da migrare.</p>
					{:else}
						<div class="plan-wrap"><table class="plan">
							<thead>
								<tr><th></th><th>Topic</th><th>Risorsa</th><th>Permessi</th><th>Stato</th></tr>
							</thead>
							<tbody>
								{#each plan.items as it, i}
									<tr class="st-{it.status}">
										<td>
											{#if it.status === 'ok'}
												<input type="checkbox" checked={selected.has(i)} disabled={planBusy}
													on:change={() => toggle(i)} />
											{/if}
										</td>
										<td><code>{it.topic}</code></td>
										<td><code>{it.kind}:{it.name}</code> <span class="muted">{it.tier}</span></td>
										<td>{grantsLabel(it.grants)}</td>
										<td>
											{it.status === 'ok' ? 'da applicare' : it.status === 'already' ? 'già presente' : 'saltata'}
											{#if it.reason}<span class="muted"> · {it.reason}</span>{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table></div>
					{/if}
				{/if}
				{#if applyResult}
					<div class="apply-result">
						<p>Applicate: {applyResult.applied.length}</p>
						{#if applyResult.applied.length}
							<ul class="notes">{#each applyResult.applied as a}<li><code>{a}</code></li>{/each}</ul>
						{/if}
						{#if applyResult.failed.length}
							<p class="error">Non applicate: {applyResult.failed.length}</p>
							<ul class="notes">
								{#each applyResult.failed as f}<li><code>{itemLabel(f.item)}</code> — {f.error}</li>{/each}
							</ul>
						{/if}
					</div>
				{/if}
			{/if}
		{/if}
	</section>
</div>

<ConfirmDialog
	open={pendingMode !== null}
	title={pendingMode === 'topic' ? 'Passare all\'accesso per topic?' : 'Tornare all\'accesso legacy?'}
	message={pendingMode === 'topic'
		? 'In modalità topic gli agenti accedono a un datastore o a una collection RAG solo dentro un topic che la importa, e solo se l\'owner del topic ha dato loro il permesso. I permessi dichiarati nei seed non contano più: applica prima la migrazione, o gli agenti perderanno l\'accesso ai dati che usano oggi.'
		: 'In modalità legacy gli agenti accedono ai dati con i permessi dichiarati nei seed, in qualunque topic: gli import e i permessi dei topic non vengono più applicati.'}
	confirmLabel={pendingMode === 'topic' ? 'Passa a topic' : 'Torna a legacy'}
	destructive
	loading={modeBusy}
	on:confirm={confirmMode}
	on:cancel={() => (pendingMode = null)}
/>

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
	.row.rag {
		flex-direction: column;
		align-items: stretch;
		gap: 6px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.members {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.axis {
		display: flex;
		align-items: baseline;
		gap: 6px;
		flex-wrap: wrap;
		font-size: 11px;
	}
	.axis-label {
		color: var(--fg-muted);
		min-width: 120px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		font-size: 10px;
	}
	.seed {
		font-family: var(--mono);
		font-size: 11px;
		padding: 1px 6px;
		border: 1px solid var(--border);
		border-radius: 999px;
	}
	/* Il vuoto CALCOLATO e il campo mancante non sono la stessa cosa e non
	   devono somigliarsi: il primo è una risposta, il secondo un silenzio. */
	.none {
		color: var(--fg-muted);
		font-style: italic;
	}
	.unreported {
		color: #e0a800;
	}
	/* Il bypass non è un terzo gruppo di membri: sta staccato e porta scritto
	   accanto perché passa comunque. */
	.axis.bypass {
		border-top: 1px dashed var(--border);
		padding-top: 4px;
		margin-top: 1px;
	}
	.axis.bypass .axis-label {
		color: #e0a800;
	}
	.why {
		color: var(--fg-muted);
	}
	.why code {
		font-family: var(--mono);
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
	.topic-tier {
		font-size: 10px;
		opacity: 0.8;
		margin-left: 4px;
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
	h3 {
		font-size: 13px;
		margin: 20px 0 6px;
	}
	.hint.small.top {
		margin: 0 0 10px;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 8px;
	}
	.btn {
		font-size: 11px;
		padding: 3px 9px;
		border-radius: 6px;
		border: 1px solid var(--border);
		color: var(--fg);
		background: transparent;
		cursor: pointer;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.primary {
		border-color: rgba(22, 163, 74, 0.5);
		color: #16a34a;
	}
	.mode-topic {
		color: #16a34a;
	}
	.mode-legacy {
		color: #e0a800;
	}
	.kind-rag {
		color: #a855f7;
		border-color: rgba(168, 85, 247, 0.5);
	}
	.kind-datastore {
		color: #0ea5e9;
		border-color: rgba(14, 165, 233, 0.5);
	}
	.cat-tier,
	.cat-importers {
		font-size: 11px;
		padding: 2px 4px;
		border-radius: 4px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--fg);
	}
	.cat-importers {
		flex: 1;
		min-width: 140px;
	}
	.notes {
		font-size: 12px;
		color: var(--fg-muted);
		margin: 4px 0 8px;
		padding-left: 18px;
	}
	.muted {
		color: var(--fg-muted);
	}
	.plan-wrap {
		overflow-x: auto;
	}
	table.plan {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	table.plan th,
	table.plan td {
		text-align: left;
		padding: 4px 6px;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
	}
	table.plan th {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--fg-muted);
	}
	tr.st-already,
	tr.st-skipped {
		opacity: 0.6;
	}
	.importing {
		flex-basis: 100%;
		display: flex;
		align-items: baseline;
		gap: 6px;
		flex-wrap: wrap;
		font-size: 11px;
	}
	a.seed {
		color: var(--fg);
		text-decoration: none;
	}
	a.seed:hover {
		border-color: var(--fg-muted);
	}
		.apply-result {
		margin-top: 10px;
		font-size: 12px;
	}
</style>
