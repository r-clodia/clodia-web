<script lang="ts">
	/**
	 * The data an agentic job imports (clodia-platform#670): a job is a scope
	 * like a topic, and its agent reaches a datastore or a RAG collection only
	 * if the job imports it (#669). Same catalog and picker as the topic's
	 * «Dati» panel (`DataPicker`); the agent-server asks the gateway to check
	 * every import (catalog, importer, clearance, job tier) before writing it.
	 *
	 * The imports come from the job record the page already loads: after every
	 * action the panel fires `changed` and the page reloads the job.
	 */
	import { createEventDispatcher, onMount } from 'svelte';
	import {
		apiErrorDetail,
		catalogLabel,
		getDataCatalog,
		importJobData,
		removeJobData,
		type DataCatalogEntry,
		type JobDataImport
	} from '$lib/api/client';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import DataPicker from '$lib/components/DataPicker.svelte';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	export let jobId: string;
	/** `data` of the job. */
	export let imports: ReadonlyArray<JobDataImport> = [];
	/** Declared tier; empty = none, and the job imports nothing until it has one. */
	export let tier = '';
	/** The agent that runs the job: the only one that uses its data. */
	export let agent = '';
	/** Owner or admin: may import and remove. */
	export let canEdit = false;

	const dispatch = createEventDispatcher<{ changed: void }>();

	let catalog: DataCatalogEntry[] | null = null;
	let catalogErr = '';
	let busy = false;
	let pendingRemove: JobDataImport | null = null;

	function rank(t: string | undefined): number {
		const m = /^(?:SEAL-|P)(\d)$/.exec(t ?? '');
		return m ? Number(m[1]) : -1;
	}

	const key = (kind: string, n: string) => `${kind}:${n}`;

	$: entryOf = Object.fromEntries((catalog ?? []).map((e) => [key(e.kind, e.name), e]));
	$: label = (imp: JobDataImport) => catalogLabel(entryOf[key(imp.kind, imp.name)] ?? imp);
	$: importedKeys = new Set(imports.map((i) => key(i.kind, i.name)));
	// A room's own index stays in its room; only resources at or below the
	// job's tier (owner, 11 Nov 2026: no tier, no imports).
	$: importable = (catalog ?? []).filter(
		(e) => !importedKeys.has(key(e.kind, e.name))
			&& !e.topic && !e.name.startsWith('topic-')
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
	onMount(() => void loadCatalog());

	async function run(okLabel: string, fn: () => Promise<unknown>) {
		if (busy) return;
		busy = true;
		try {
			await fn();
			toastSuccess(okLabel);
			dispatch('changed');
		} catch (e) {
			toastError('Dati del job', apiErrorDetail(e));
		} finally {
			busy = false;
		}
	}

	function doImport(picked: DataCatalogEntry[]) {
		if (!picked.length) return;
		const okLabel = picked.length === 1
			? `Importato: ${catalogLabel(picked[0])}`
			: `Importate ${picked.length} risorse`;
		void run(okLabel, async () => {
			for (const e of picked) await importJobData(jobId, e.kind, e.name);
		});
	}

	async function confirmRemove() {
		const imp = pendingRemove;
		if (!imp) return;
		await run(`Rimosso: ${label(imp)}`, () => removeJobData(jobId, imp.kind, imp.name));
		pendingRemove = null;
	}
</script>

{#if imports.length === 0}
	<p class="muted">Nessun dato importato: in questo job l'agente non raggiunge datastore né collection.</p>
{:else}
	<ul class="data-list">
		{#each imports as imp (key(imp.kind, imp.name))}
			<li class="data-head">
				<span class="kind kind-{imp.kind}">{imp.kind === 'rag' ? 'RAG' : 'DB'}</span>
				<code class="data-name" title={imp.name}>{label(imp)}</code>
				{#if entryOf[key(imp.kind, imp.name)]}
					<span class="muted">{entryOf[key(imp.kind, imp.name)].tier}</span>
				{/if}
				{#if canEdit}
					<button type="button" class="data-remove" disabled={busy}
						title="Togli dal job (i dati restano nel catalogo)"
						on:click={() => (pendingRemove = imp)}>✕</button>
				{/if}
			</li>
		{/each}
	</ul>
	<p class="muted">Li legge e li scrive {agent || "l'agente del job"}, solo durante i run di questo job.</p>
{/if}

{#if canEdit && !tier}
	<p class="muted" role="note">
		Imposta il tier del job (Modifica → Tier dei dati) prima di importare dati.
	</p>
{:else if canEdit}
	{#if catalogErr}
		<p class="err" role="alert">{catalogErr}</p>
	{:else if catalog}
		<DataPicker entries={importable} disabled={busy} on:pick={(ev) => doImport(ev.detail)} />
		<p class="muted">
			Solo le risorse con tier ≤ {tier} che puoi importare. {agent || "L'agente del job"}
			deve avere clearance ≥ {tier}, altrimenti i run non usano i dati.
		</p>
	{/if}
{/if}

<ConfirmDialog
	open={pendingRemove !== null}
	title="Togliere dal job?"
	message={pendingRemove
		? `«${label(pendingRemove)}» non sarà più importato in questo job e l'agente perderà l'accesso nei suoi run. I dati non vengono cancellati.`
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
	.data-list { list-style: none; margin: 0 0 4px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.data-head { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
	.data-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.kind {
		font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 999px;
		border: 1px solid var(--border); white-space: nowrap; flex-shrink: 0;
	}
	.kind-rag { color: #a855f7; border-color: rgba(168, 85, 247, 0.5); }
	.kind-datastore { color: #0ea5e9; border-color: rgba(14, 165, 233, 0.5); }
	.data-remove {
		background: transparent; border: none; color: var(--fg-muted); cursor: pointer;
		font-size: 11px; padding: 0 2px; flex-shrink: 0;
	}
	.data-remove:hover:not(:disabled) { color: #dc2626; }
</style>
