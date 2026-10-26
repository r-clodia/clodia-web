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
	import { createEventDispatcher, onMount } from 'svelte';
	import {
		apiErrorDetail,
		catalogLabel,
		getDataCatalog,
		grantTopicData,
		importTopicData,
		removeTopicData,
		setTopicIndex,
		type DataCatalogEntry,
		type DataGrantMode,
		type TopicDataImport,
		type TopicIndexMeta
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
	/** The channel's AI participants (humans have no grants here). */
	export let agents: string[] = [];
	/** Owner or admin: may import, remove and grant. */
	export let canEdit = false;

	const dispatch = createEventDispatcher<{ changed: void }>();

	let catalog: DataCatalogEntry[] | null = null;
	let catalogErr = '';
	let busy = false;
	let pendingRemove: TopicDataImport | null = null;
	let confirmIndexOff = false;

	// Absent `meta.index` = not indexed yet: enabled, collection unknown.
	$: indexEnabled = topicIndex?.enabled !== false;
	$: indexCollection = topicIndex?.collection ?? '';
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
	onMount(() => void loadCatalog());

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

	function setGrant(imp: TopicDataImport, agent: string, value: string) {
		const mode = value === 'read' || value === 'write' ? (value as DataGrantMode) : null;
		void run('', () => grantTopicData(tier, name, imp.kind, imp.name, agent, mode));
	}

	function switchIndex(enabled: boolean) {
		return run(
			enabled ? 'Indicizzazione riattivata' : 'Indicizzazione disattivata',
			() => setTopicIndex(tier, name, enabled)
		);
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
		<span class="index-label">Indice RAG del topic</span>
		<span class="index-state" class:off={!indexEnabled}>{indexEnabled ? 'attivo' : 'disattivato'}</span>
	</div>
	<p class="muted">
		{#if indexCollection}<code title={indexCollection}>{indexCollection}</code>{:else}in preparazione{/if}
	</p>
	{#if canEdit}
		{#if indexEnabled}
			<button type="button" class="link-btn" disabled={busy}
				on:click={() => (confirmIndexOff = true)}>Disattiva indicizzazione</button>
		{:else}
			<button type="button" class="link-btn" disabled={busy}
				on:click={() => void switchIndex(true)}>{busy ? '…' : 'Riattiva indicizzazione'}</button>
		{/if}
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
				{#if agents.length === 0}
					<p class="muted">Nessun agente nel canale.</p>
				{:else}
					<ul class="grants">
						{#each agents as a (a)}
							{@const mode = imp.grants?.[a] ?? ''}
							<li>
								<span class="agent" title={a}>{a}</span>
								{#if canEdit}
									<select value={mode} disabled={busy}
										on:change={(e) => setGrant(imp, a, e.currentTarget.value)}>
										<option value="">nessuno</option>
										<option value="read">lettura</option>
										<option value="write">scrittura</option>
									</select>
								{:else}
									<span class="muted">{mode === 'write' ? 'scrittura' : mode === 'read' ? 'lettura' : 'nessuno'}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if canEdit}
	{#if catalogErr}
		<p class="err" role="alert">{catalogErr}</p>
	{:else if catalog}
		<DataPicker entries={importable} disabled={busy} on:pick={(ev) => doImport(ev.detail)} />
		<p class="muted">
			Solo le risorse con tier ≤ {tier} che puoi importare. Gli agenti accedono ai dati
			solo con il permesso dato qui.
		</p>
	{/if}
{/if}

<ConfirmDialog
	open={confirmIndexOff}
	title="Disattivare l'indicizzazione?"
	message="L'indice delle conversazioni e dei file di questo topic verrà cancellato e gli agenti non potranno più cercarvi. Se la riattivi, l'indice viene ricostruito da zero nei cicli successivi."
	confirmLabel="Disattiva"
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
	.topic-index code { overflow-wrap: anywhere; }
	.index-label { flex: 1; min-width: 0; }
	.index-state { font-size: 10px; color: #16a34a; white-space: nowrap; }
	.index-state.off { color: var(--fg-muted); }
	.own-index {
		font-size: 9px; padding: 1px 5px; border-radius: 999px; white-space: nowrap; flex-shrink: 0;
		color: var(--fg-muted); border: 1px dashed var(--border);
	}
	.data-remove {
		background: transparent; border: none; color: var(--fg-muted); cursor: pointer;
		font-size: 11px; padding: 0 2px; flex-shrink: 0;
	}
	.data-remove:hover:not(:disabled) { color: #dc2626; }
	.grants { list-style: none; margin: 4px 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 3px; }
	.grants li { display: flex; align-items: center; gap: 6px; font-size: 11px; min-width: 0; }
	.agent { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.grants select {
		font-size: 11px; padding: 2px 4px; border-radius: 4px;
		border: 1px solid var(--border); background: var(--bg); color: var(--fg);
	}
	.link-btn {
		font-size: 11px; background: transparent; border: 1px solid var(--border);
		border-radius: 4px; color: var(--fg); cursor: pointer; padding: 2px 8px; white-space: nowrap;
	}
	.link-btn:disabled { opacity: .5; cursor: default; }
</style>
