<script lang="ts">
	/**
	 * The topic's "Dati" section (clodia-platform#595): the datastores and RAG
	 * collections the topic imports, and each agent's access to them inside
	 * this topic. The topic declares; the gateway enforces on the signed topic.
	 *
	 * The imports come from `meta.data`, which the page already loads: after
	 * every action the panel fires `changed` and the page reloads the meta,
	 * so there is one source of truth and no local copy to drift.
	 */
	import { createEventDispatcher, onDestroy, onMount } from 'svelte';
	import {
		apiErrorDetail,
		catalogLabel,
		getDataCatalog,
		getTopicIndexStatus,
		importTopicData,
		removeTopicData,
		setTopicIndex,
		type DataCatalogEntry,
		type TopicDataImport,
		type TopicIndexMeta,
		type TopicIndexStatus
	} from '$lib/api/client';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import DataPicker from '$lib/components/DataPicker.svelte';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	export let tier: string;
	export let name: string;
	/** `meta.data` of the topic. */
	export let imports: TopicDataImport[] = [];
	/** `meta.index`: the topic's own RAG collection (clodia-platform#599). */
	export let topicIndex: TopicIndexMeta | undefined = undefined;
	/** The channel's AI participants: since #653 every one of them reads and
	 *  writes what is imported here (no per-agent roles). Used for the count. */
	export let agents: string[] = [];
	/** Owner or admin: may import, remove and grant. */
	export let canEdit = false;
	/** A DM (`kind: dm`): its owner sets its tier like a topic's
	 *  (clodia-platform#670, owner 11 Nov 2026); the panel offers the control. */
	export let isDm = false;

	const dispatch = createEventDispatcher<{
		changed: void;
		/** The toggle's job, for the section header (#648). */
		indexjob: { running: boolean; label: string };
		/** Open the page's re-classification dialog (a DM's tier, #670). */
		retier: void;
	}>();

	let catalog: DataCatalogEntry[] | null = null;
	let catalogErr = '';
	let busy = false;
	let pendingRemove: TopicDataImport | null = null;
	let confirmIndexOff = false;

	// The room's toggle (clodia-platform#648): OFF unless `on: true`. The
	// status (and its job) comes from the gateway; the meta is the fallback
	// until the first answer.
	let status: TopicIndexStatus | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let destroyed = false;
	$: indexEnabled = status ? status.on : topicIndex?.on === true;
	$: indexCollection = status?.collection || topicIndex?.collection || '';
	$: job = status?.job;
	$: jobRunning = job?.state === 'indexing' || job?.state === 'deindexing';
	$: jobLabel = !jobRunning
		? ''
		: `${job?.state === 'indexing' ? 'Indicizzazione' : 'Deindicizzazione'} in corso` +
			(job?.total ? ` · ${job?.done ?? 0}/${job.total}` : '…');
	$: dispatch('indexjob', { running: jobRunning, label: jobLabel });

	/** True while this panel has seen a job running: when it ends, the page
	 *  reloads the meta (the collection may have changed). */
	let wasRunning = false;

	async function loadStatus() {
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = null;
		try {
			status = await getTopicIndexStatus(tier, name);
		} catch {
			// A transient error: keep the last state and try again below.
		}
		const running = status?.job?.state === 'indexing' || status?.job?.state === 'deindexing';
		if (running) {
			wasRunning = true;
			if (!destroyed) pollTimer = setTimeout(() => void loadStatus(), 2000);
		} else if (wasRunning) {
			wasRunning = false;
			dispatch('changed');
		}
	}

	onDestroy(() => {
		destroyed = true;
		if (pollTimer) clearTimeout(pollTimer);
	});
	const isOwnIndex = (imp: TopicDataImport) =>
		imp.kind === 'rag' && !!indexCollection && imp.name === indexCollection;

	/** SEAL rank; legacy P0..P3 map to SEAL-0..3. Unknown → -1. */
	function rank(t: string | undefined): number {
		const m = /^(?:SEAL-|P)(\d)$/.exec(t ?? '');
		return m ? Number(m[1]) : -1;
	}

	const key = (kind: string, n: string) => `${kind}:${n}`;

	$: tierOf = Object.fromEntries((catalog ?? []).map((e) => [key(e.kind, e.name), e.tier]));
	$: entryOf = Object.fromEntries((catalog ?? []).map((e) => [key(e.kind, e.name), e]));
	// Imports carry only {kind, name}: the topic of an index comes from the catalog.
	$: importLabel = (imp: TopicDataImport) =>
		imp.kind === 'rag' && !!indexCollection && imp.name === indexCollection
			? 'Indice di questo topic'
			: catalogLabel(entryOf[key(imp.kind, imp.name)] ?? imp);
	$: importedKeys = new Set(imports.map((i) => key(i.kind, i.name)));
	// Data never moves down a level: only resources at or below the topic tier.
	// Not offered: what is already imported, this topic's own index, and the
	// index of an archived topic (owner, 26 Oct 2026).
	$: importable = (catalog ?? []).filter(
		(e) => !importedKeys.has(key(e.kind, e.name))
			&& !(e.kind === 'rag' && !!indexCollection && e.name === indexCollection)
			&& e.topic_status !== 'archived'
			&& rank(e.tier) >= 0 && rank(e.tier) <= rank(tier)
	);

	async function loadCatalog() {
		catalogErr = '';
		try {
			catalog = (await getDataCatalog()).entries;
		} catch (e) {
			catalogErr = apiErrorDetail(e);
		}
	}
	// The tier shown next to each import comes from the catalog too, so it
	// loads with the section, for every viewer (a non-admin receives only
	// the entries they may import: the others show no tier).
	onMount(() => {
		void loadCatalog();
		void loadStatus();
	});

	async function run(label: string, fn: () => Promise<unknown>) {
		if (busy) return;
		busy = true;
		try {
			await fn();
			if (label) toastSuccess(label);
			dispatch('changed');
		} catch (e) {
			toastError('Dati del topic', apiErrorDetail(e));
		} finally {
			busy = false;
		}
	}

	/** One import call per picked resource; the first failure stops and is shown. */
	function doImport(picked: DataCatalogEntry[]) {
		if (!picked.length) return;
		const label = picked.length === 1
			? `Importato: ${catalogLabel(picked[0])}`
			: `Importate ${picked.length} risorse`;
		void run(label, async () => {
			for (const e of picked) await importTopicData(tier, name, e.kind, e.name);
		});
	}

	async function switchIndex(enabled: boolean) {
		if (busy || jobRunning) return;
		busy = true;
		try {
			status = await setTopicIndex(tier, name, enabled);
			wasRunning = true;
			toastSuccess(enabled ? 'Indicizzazione avviata' : 'Deindicizzazione avviata');
		} catch (e) {
			toastError('Indice RAG del canale', apiErrorDetail(e));
		} finally {
			busy = false;
		}
		void loadStatus();
	}

	async function confirmIndexDisable() {
		await switchIndex(false);
		confirmIndexOff = false;
	}

	async function confirmRemove() {
		const imp = pendingRemove;
		if (!imp) return;
		await run(`Rimosso: ${importLabel(imp)}`, () => removeTopicData(tier, name, imp.kind, imp.name));
		pendingRemove = null;
	}
</script>

<div class="topic-index">
	<div class="data-head">
		<span class="kind kind-rag">RAG</span>
		<span class="index-label">Indicizza nel RAG</span>
		{#if canEdit}
			<label class="switch" title={jobRunning ? 'Attendi la fine del lavoro in corso' : ''}>
				<input type="checkbox" checked={indexEnabled} disabled={busy || jobRunning}
					on:click|preventDefault={() =>
						indexEnabled ? (confirmIndexOff = true) : void switchIndex(true)} />
				<span class="slider" aria-hidden="true"></span>
			</label>
		{:else}
			<span class="index-state" class:off={!indexEnabled}>{indexEnabled ? 'attivo' : 'spento'}</span>
		{/if}
	</div>
	{#if jobRunning}
		<p class="index-job" role="status">
			<span class="spinner" aria-hidden="true"></span>{jobLabel}
			{#if job?.total}<progress max={job.total} value={job.done ?? 0}></progress>{/if}
		</p>
		<p class="muted">Puoi aprire altri topic: il lavoro continua e qui resta visibile fino alla fine.</p>
	{:else if job?.state === 'error'}
		<p class="err" role="alert">
			{indexEnabled ? 'Indicizzazione' : 'Deindicizzazione'} non riuscita{job.error ? `: ${job.error}` : ''}.
			{#if canEdit}
				<button type="button" class="link-btn" disabled={busy}
					on:click={() => void switchIndex(indexEnabled)}>Riprova</button>
			{/if}
		</p>
	{:else if indexEnabled}
		<p class="muted">
			Indicizzati tutti i file del canale (Drive collegato compreso) e i messaggi dal
			{status?.since ? new Date(status.since).toLocaleString() : 'momento dell\'attivazione'}.
		</p>
	{:else}
		<p class="muted">Spento: nulla di questo canale è nel RAG.</p>
	{/if}
</div>

{#if imports.length === 0}
	<p class="muted">Nessun dato importato in questo topic.</p>
{:else}
	<ul class="data-list">
		{#each imports as imp (key(imp.kind, imp.name))}
			<li>
				<div class="data-head">
					<span class="kind kind-{imp.kind}">{imp.kind === 'rag' ? 'RAG' : 'DB'}</span>
					<code class="data-name" title={imp.name}>{importLabel(imp)}</code>
					{#if isOwnIndex(imp)}
						<span class="own-index">indice del topic</span>
					{/if}
					{#if tierOf[key(imp.kind, imp.name)]}
						<span class="muted">{tierOf[key(imp.kind, imp.name)]}</span>
					{/if}
					{#if canEdit}
						<button type="button" class="data-remove" disabled={busy}
							title="Togli dal topic (i dati restano nel catalogo)"
							on:click={() => (pendingRemove = imp)}>✕</button>
					{/if}
				</div>
				<p class="muted">
					{#if isOwnIndex(imp)}
						Gli agenti del canale ({agents.length}) lo leggono; lo scrive solo l'indicizzazione automatica.
					{:else}
						Gli agenti del canale ({agents.length}) lo leggono e lo scrivono.
					{/if}
				</p>
			</li>
		{/each}
	</ul>
{/if}

{#if isDm}
	<div class="dm-tier">
		<span class="muted">
			Questo DM è {tier}: importa solo dati di livello ≤ {tier}, e l'agente deve avere
			clearance ≥ {tier}.
		</span>
		{#if canEdit}
			<button type="button" class="link-btn" disabled={busy}
				title="Il livello non può superare la tua clearance né scendere sotto i dati importati"
				on:click={() => dispatch('retier')}>Cambia livello</button>
		{/if}
	</div>
{/if}

{#if canEdit}
	{#if catalogErr}
		<p class="err" role="alert">{catalogErr}</p>
	{:else if catalog}
		<DataPicker entries={importable} disabled={busy} on:pick={(ev) => doImport(ev.detail)} />
		<p class="muted">
			Solo le risorse con tier ≤ {tier} che puoi importare. Ogni agente del canale
			li legge e li scrive.
		</p>
	{/if}
{/if}

<ConfirmDialog
	open={confirmIndexOff}
	title="Togliere il canale dal RAG?"
	message="Tutti i contenuti di questo canale (file, Drive collegato e messaggi) vengono tolti dal RAG e gli agenti non potranno più cercarvi. Riattivando, i file vengono reindicizzati ma i messaggi solo da quel momento in poi."
	confirmLabel="Togli dal RAG"
	destructive
	loading={busy}
	on:confirm={confirmIndexDisable}
	on:cancel={() => (confirmIndexOff = false)}
/>

<ConfirmDialog
	open={pendingRemove !== null}
	title="Togliere dal topic?"
	message={pendingRemove
		? `«${importLabel(pendingRemove)}» non sarà più importato in questo topic e gli agenti perderanno l'accesso da qui. I dati non vengono cancellati.`
		: ''}
	confirmLabel="Togli"
	destructive
	loading={busy}
	on:confirm={confirmRemove}
	on:cancel={() => (pendingRemove = null)}
/>

<style>
	.muted { color: var(--fg-muted); font-size: 11px; margin: 4px 0; }
	.err { color: #dc2626; font-size: 11px; margin: 4px 0; }
	.data-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.data-head { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
	.data-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.kind {
		font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 999px;
		border: 1px solid var(--border); white-space: nowrap; flex-shrink: 0;
	}
	.kind-rag { color: #a855f7; border-color: rgba(168, 85, 247, 0.5); }
	.kind-datastore { color: #0ea5e9; border-color: rgba(14, 165, 233, 0.5); }
	.topic-index {
		margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border);
	}
	.index-label { flex: 1; min-width: 0; }
	.index-state { font-size: 10px; color: #16a34a; white-space: nowrap; }
	.index-state.off { color: var(--fg-muted); }
	.index-job { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; margin: 6px 0 2px; color: var(--fg); }
	.index-job progress { flex: 1 1 80px; min-width: 60px; height: 6px; }
	.spinner { width: 10px; height: 10px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.switch { position: relative; display: inline-block; width: 30px; height: 16px; flex: 0 0 auto; }
	.switch input { opacity: 0; width: 0; height: 0; }
	.slider { position: absolute; inset: 0; border-radius: 16px; background: var(--border); cursor: pointer; transition: background .15s; }
	.slider::before { content: ''; position: absolute; left: 2px; top: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--bg); transition: transform .15s; }
	.switch input:checked + .slider { background: var(--accent); }
	.switch input:checked + .slider::before { transform: translateX(14px); }
	.switch input:disabled + .slider { opacity: .5; cursor: default; }
	.own-index {
		font-size: 9px; padding: 1px 5px; border-radius: 999px; white-space: nowrap; flex-shrink: 0;
		color: var(--fg-muted); border: 1px dashed var(--border);
	}
	.data-remove {
		background: transparent; border: none; color: var(--fg-muted); cursor: pointer;
		font-size: 11px; padding: 0 2px; flex-shrink: 0;
	}
	.data-remove:hover:not(:disabled) { color: #dc2626; }
	.link-btn {
		font-size: 11px; background: transparent; border: 1px solid var(--border);
		border-radius: 4px; color: var(--fg); cursor: pointer; padding: 2px 8px; white-space: nowrap;
	}
	.link-btn:disabled { opacity: .5; cursor: default; }
	.dm-tier { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 0; }
</style>
