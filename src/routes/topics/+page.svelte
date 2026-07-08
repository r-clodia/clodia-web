<script lang="ts">
	/**
	 * TOPICS — vista a card di sola lettura dei topic di Clodia.
	 *
	 * Ogni card mostra titolo, classificazione, ultimo commit, il TLDR
	 * renderizzato in markdown e i top action point. La card NON è più
	 * navigabile (niente più modal del summary): l'unico elemento interattivo
	 * è l'avatar dell'agent "contact point" del topic — cliccandolo si apre
	 * una chat dedicata con quell'agent, seedata con "topic <nome>, fai il
	 * punto" così l'agent fa subito il punto della situazione.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		API_BASE_URL,
		ApiError,
		createChannel,
		getTopics,
		getAdminState,
		getTopicsCatalog,
		exportTopicsBundle,
		importTopicsBundle,
		archiveTopic,
		setTopicStatus,
		TOPIC_STATUSES,
		type TopicCatalogItem
	} from '$lib/api/client';
	import type { Topic } from '$lib/api/types';
	import { session } from '$lib/auth/session';
	import { instanceProfile, ensureProfileLoaded, singleTopicHref, term } from '$lib/stores/instance';
	import Modal from '$lib/components/Modal.svelte';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	// Modalità topics:single (Modular Distro F2): la lista non esiste, si va
	// dritti al topic-workspace unico dell'edizione.
	$: if ($instanceProfile.features.topics === 'single') {
		void goto(singleTopicHref($instanceProfile), { replaceState: true });
	}
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { renderInline, renderMarkdown } from '$lib/markdown';

	type ListState =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; topics: ReadonlyArray<Topic> }
		| { kind: 'error'; message: string; status?: number };

	let listState: ListState = { kind: 'idle' };

	function fmtError(err: unknown): { message: string; status?: number } {
		if (err instanceof ApiError) return { message: err.message, status: err.status };
		if (err instanceof Error) return { message: err.message };
		return { message: String(err) };
	}

	async function loadList() {
		listState = { kind: 'loading' };
		try {
			listState = { kind: 'ok', topics: await getTopics() };
		} catch (err) {
			listState = { kind: 'error', ...fmtError(err) };
		}
	}

	// Vocabolario status (selezione unica) + scadenza todo più vicina sulla card.
	const statusOptions = TOPIC_STATUSES;
	let statusBusy: Record<string, boolean> = {};
	async function changeStatus(t: Topic, status: string) {
		if (status === (t.status ?? 'active')) return;
		const k = keyOf(t);
		statusBusy = { ...statusBusy, [k]: true };
		try {
			await setTopicStatus(t.tier, t.name, status);
			await loadList();
		} catch (e) {
			toastError('Status non aggiornato', e instanceof ApiError || e instanceof Error ? e.message : String(e));
		} finally {
			statusBusy = { ...statusBusy, [k]: false };
		}
	}
	/** Scadenza todo: formatta + segnala se scaduta/imminente (per lo stile). */
	function deadlineInfo(iso?: string | null): { label: string; cls: string } | null {
		if (!iso) return null;
		const d = new Date(iso + 'T00:00:00');
		if (Number.isNaN(d.getTime())) return null;
		const today = new Date(); today.setHours(0, 0, 0, 0);
		const days = Math.round((d.getTime() - today.getTime()) / 86400000);
		const label = d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
		const cls = days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'later';
		return { label, cls };
	}

	// --- Import/Export snapshot topic (solo admin) ---
	let isAdmin = false;
	let exporting = false;
	let importing = false;
	let importInput: HTMLInputElement;

	async function refreshAdmin() {
		try {
			const st = await getAdminState();
			isAdmin = !!$session && st.admins.includes($session.principal);
		} catch {
			isAdmin = false;
		}
	}

	// --- Export con selezione ---
	let showExport = false;
	let catalog: TopicCatalogItem[] = [];
	let exportSel: Record<string, boolean> = {};
	const catKey = (t: TopicCatalogItem) => `${t.tier}/${t.name}`;
	$: exportSelCount = Object.values(exportSel).filter(Boolean).length;
	$: allSelected = catalog.length > 0 && exportSelCount === catalog.length;

	async function openExport() {
		showExport = true;
		try {
			catalog = await getTopicsCatalog();
			// default: tutti selezionati (un click = export all)
			exportSel = Object.fromEntries(catalog.map((t) => [catKey(t), true]));
		} catch (e) {
			toastError('Catalogo non disponibile', e instanceof ApiError || e instanceof Error ? e.message : String(e));
		}
	}
	function toggleAll() {
		const v = !allSelected;
		exportSel = Object.fromEntries(catalog.map((t) => [catKey(t), v]));
	}

	async function doExport() {
		if (exporting) return;
		const keys = catalog.map(catKey).filter((k) => exportSel[k]);
		if (!keys.length) {
			toastError('Nessun topic selezionato', 'Seleziona almeno un topic da esportare');
			return;
		}
		exporting = true;
		try {
			// se sono tutti, passo lista vuota (= tutti) per un bundle "completo"
			const blob = await exportTopicsBundle(keys.length === catalog.length ? undefined : keys);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'clodia-topics-snapshot.tgz';
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			showExport = false;
			toastSuccess(`Snapshot esportato (${keys.length} topic)`, 'clodia-topics-snapshot.tgz');
		} catch (e) {
			toastError('Export fallito', e instanceof ApiError || e instanceof Error ? e.message : String(e));
		} finally {
			exporting = false;
		}
	}

	async function onImportFile(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		(e.target as HTMLInputElement).value = '';
		if (!f || importing) return;
		importing = true;
		try {
			const r = await importTopicsBundle(f);
			toastSuccess(
				`Import: ${r.imported_count} topic`,
				r.skipped_count ? `${r.skipped_count} già presenti (saltati)` : 'merge completato'
			);
			await loadList();
		} catch (err) {
			toastError('Import fallito', err instanceof ApiError || err instanceof Error ? err.message : String(err));
		} finally {
			importing = false;
		}
	}

	onMount(() => {
		void ensureProfileLoaded();
		pinnedTopics = loadPinnedTopics();
		void loadList();
		void refreshAdmin();
	});

	// --- Nuovo topic/canale ---
	let showNew = false;
	let nName = '';
	let nTitle = '';
	let nTier: 'SEAL-0' | 'SEAL-1' | 'SEAL-2' | 'SEAL-3' | 'SEAL-4' = 'SEAL-1';
	// Tipi di topic/pratica dell'edizione (topics_defaults.types del profilo);
	// fallback = set storico di piattaforma. Entry: stringa o {key, label}.
	const FALLBACK_TYPES = ['progetto', 'bando', 'contratto', 'amministrativo', 'evento'];
	$: editionTypes = (($instanceProfile.topics_defaults?.types?.length
		? $instanceProfile.topics_defaults.types
		: FALLBACK_TYPES) as ReadonlyArray<string | { key: string; label?: string }>)
		.map((t) => (typeof t === 'string' ? { key: t, label: t } : { key: t.key, label: t.label || t.key }));
	let nType = 'progetto';
	let nStorage: 'local' | 'drive' = 'local';
	let nDriveFolder = ''; // link/id cartella Drive (vuoto = crea nuova)
	let creating = false;
	let createErr = '';

	function openNew(presetType?: string) {
		nName = '';
		nTitle = '';
		nTier = 'SEAL-1';
		nType = presetType || editionTypes[0]?.key || 'progetto';
		nStorage = 'local';
		nDriveFolder = '';
		createErr = '';
		showNew = true;
	}
	// Bottoni per tipo (edizioni con topics_defaults.types): "+ bilancio",
	// "+ contenzioso", … accanto al bottone generico. Il click apre il dialog
	// col tipo preselezionato.
	$: typeButtons = $instanceProfile.topics_defaults?.types?.length ? editionTypes : [];

	async function submitNew() {
		const name = nName.trim().toLowerCase();
		if (!/^[a-z0-9][a-z0-9_-]{0,60}$/.test(name)) {
			createErr = 'Nome non valido: minuscole, cifre, - e _';
			return;
		}
		creating = true;
		createErr = '';
		try {
			const r = await createChannel({
				name, tier: nTier, title: nTitle.trim() || name, type: nType,
				...(nStorage === 'drive'
					? { storage_config: { type: 'drive' as const, folder: nDriveFolder.trim() || undefined } }
					: {})
			});
			showNew = false;
			await goto(`/topics/${r.tier}/${r.name}`);
		} catch (e) {
			createErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			creating = false;
		}
	}

	// I DM (canali a 2) NON compaiono qui: si aprono dall'icona chat della card
	// agent. Li filtriamo fuori dalla griglia dei topic.
	const isDm = (t: Topic) => t.kind === 'dm';

	/** Toggle "Mostra archiviati": di default gli archived sono nascosti. */
	let showArchived = false;

	/** Ricerca rapida: filtra per titolo, code-name e TLDR (case-insensitive). */
	let query = '';
	function matchesQuery(t: Topic, search = query): boolean {
		const q = search.trim().toLowerCase();
		if (!q) return true;
		return (
			(t.title ?? '').toLowerCase().includes(q) ||
			(t.name ?? '').toLowerCase().includes(q) ||
			(t.tldr ?? '').toLowerCase().includes(q)
		);
	}

	function topicStatus(t: Topic): string {
		const raw = String(t.status ?? 'active').trim().toLowerCase().replace(/[\s-]+/g, '_');
		if (!raw) return 'active';
		if (raw === 'attivo') return 'active';
		if (raw === 'in_attesa' || raw === 'waiting' || raw === 'awaiting' || raw === 'pending') return 'await';
		if (raw === 'completato' || raw === 'completed' || raw === 'done') return 'idle';
		if (raw === 'archiviato') return 'archived';
		return raw;
	}

	const isArchived = (t: Topic) => topicStatus(t) === 'archived';

	// Card collassabili: di default collassate (solo intestazione). Espanse
	// mostrano TLDR, top action point e l'avatar del contact agent.
	let expanded: Record<string, boolean> = {};
	const keyOf = (t: Topic) => `${t.tier}/${t.name}`;
	function toggleExpand(t: Topic) {
		const k = keyOf(t);
		expanded = { ...expanded, [k]: !expanded[k] };
	}

	const PINNED_TOPICS_KEY = 'clodia.topicPins';
	let pinnedTopics: Record<string, boolean> = {};

	function loadPinnedTopics(): Record<string, boolean> {
		if (typeof localStorage === 'undefined') return {};
		try {
			const raw = localStorage.getItem(PINNED_TOPICS_KEY);
			const parsed = raw ? JSON.parse(raw) : {};
			return parsed && typeof parsed === 'object' ? parsed : {};
		} catch {
			return {};
		}
	}

	function savePinnedTopics(next: Record<string, boolean>) {
		pinnedTopics = next;
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(PINNED_TOPICS_KEY, JSON.stringify(next));
	}

	function isPinned(t: Topic): boolean {
		return !!pinnedTopics[keyOf(t)];
	}

	function togglePinned(t: Topic) {
		const key = keyOf(t);
		const next = { ...pinnedTopics };
		if (next[key]) delete next[key];
		else next[key] = true;
		savePinnedTopics(next);
	}

	// --- archiviazione con conferma ---
	let archiveTarget: Topic | null = null;
	let archiving = false;
	async function confirmArchive() {
		if (!archiveTarget) return;
		archiving = true;
		try {
			await archiveTopic(archiveTarget.tier, archiveTarget.name);
			toastSuccess('Topic archiviato', archiveTarget.title || archiveTarget.name);
			archiveTarget = null;
			await loadList();
		} catch (e) {
			toastError('Archiviazione fallita', e instanceof Error ? e.message : String(e));
		} finally {
			archiving = false;
		}
	}

	/** Topic ordinati per ultimo commit (più recente prima), poi per titolo,
	 *  filtrando gli archived se il toggle è off. */
	// `pins` è passato esplicitamente così il {@const shown} lo traccia come
	// dipendenza reattiva → la lista si riordina al toggle del pin (altrimenti il
	// @const dipenderebbe solo da listState.topics e non si ricalcolerebbe).
	function sortTopics(
		topics: ReadonlyArray<Topic>,
		pins: Record<string, boolean> = pinnedTopics,
		search = query,
		includeArchived = showArchived
	): Topic[] {
		const pinned = (t: Topic) => !!pins[keyOf(t)];
		const ts = (t: Topic) => {
			const v = t.last_accessed || t.last_commit;
			return v ? new Date(v).getTime() : 0;
		};
		return [...topics]
			.filter((t) => !isDm(t) && (includeArchived || !isArchived(t)) && matchesQuery(t, search))
			.sort((a, b) => {
				const pa = pinned(a);
				const pb = pinned(b);
				if (pa !== pb) return pa ? -1 : 1;
				// Ordina per ISTANTE reale (ultimo accesso, fallback ultimo commit),
				// non per stringa: gli offset di fuso sono misti (+00:00 container
				// UTC, +02:00 Mac) e il confronto lessicografico sbaglia.
				const ta = ts(a);
				const tb = ts(b);
				if (ta !== tb) return tb - ta;
				return (a.title || a.name).toLowerCase().localeCompare((b.title || b.name).toLowerCase());
			});
	}

	/** Quanti archiviati ci sono in totale (per l'etichetta del toggle). */
	$: archivedCount =
		listState.kind === 'ok' ? listState.topics.filter(isArchived).length : 0;

	function fmtTs(ts: string | null | undefined): string {
		if (!ts) return '';
		try {
			const d = new Date(ts);
			if (Number.isNaN(d.getTime())) return ts;
			return d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
		} catch {
			return ts;
		}
	}

	function fileIcon(name: string): string {
		const ext = name.split('.').pop()?.toLowerCase() ?? '';
		if (['pdf'].includes(ext)) return '📄';
		if (['doc', 'docx'].includes(ext)) return '📝';
		if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
		if (['ppt', 'pptx'].includes(ext)) return '📑';
		if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return '🖼';
		if (['zip', 'tar', 'gz', '7z'].includes(ext)) return '🗜';
		if (['py', 'js', 'ts', 'sh', 'json', 'yaml', 'yml'].includes(ext)) return '💾';
		return '📎';
	}
</script>

<svelte:head>
	<title>Topics — Clodia</title>
</svelte:head>

<header class="head">
	<div>
		<h1>{term($instanceProfile, 'topic', 'Topics', { plural: true, cap: true })}</h1>
		<p class="hint">
			GET <code>{API_BASE_URL}/topics</code> — clicca l’avatar dell’agent per aprire una chat sul
			topic.
		</p>
	</div>
	<div class="head-actions">
		{#if isAdmin}
			<input type="file" accept=".tgz,.gz,application/gzip" bind:this={importInput}
				on:change={onImportFile} hidden />
			<button type="button" class="snap" title="Importa topic da snapshot (merge, non sovrascrive)"
				on:click={() => importInput?.click()} disabled={importing}>
				{importing ? 'Import…' : '⬆ Importa'}
			</button>
			<button type="button" class="snap" title="Esporta topic selezionati (snapshot .tgz)"
				on:click={openExport} disabled={exporting}>
				{exporting ? 'Export…' : '⬇ Esporta'}
			</button>
		{/if}
		{#if $instanceProfile.features.topics === 'full'}
			<button type="button" class="new-topic" on:click={() => openNew()}>{$instanceProfile.vocabulary?.nuovo_topic || '+ Nuovo topic'}</button>
		{/if}
		<label class="archived-toggle" class:on={showArchived} title="Mostra/nascondi i topic archiviati">
			<input type="checkbox" bind:checked={showArchived} />
			<span>Mostra archiviati{archivedCount ? ` (${archivedCount})` : ''}</span>
		</label>
		<button type="button" on:click={loadList} disabled={listState.kind === 'loading'}>
			{listState.kind === 'loading' ? 'Loading…' : 'Reload'}
		</button>
	</div>
</header>

{#if typeButtons.length && $instanceProfile.features.topics === 'full'}
	<div class="type-chips">
		{#each typeButtons as t (t.key)}
			<button type="button" class="type-chip" title={t.label} on:click={() => openNew(t.key)}>+ {t.key}</button>
		{/each}
	</div>
{/if}

<div class="search-bar">
	<span class="search-ico" aria-hidden="true">🔎</span>
	<input
		type="search"
		class="search-input"
		placeholder="Cerca un topic per titolo, nome o TLDR…"
		bind:value={query}
		autocomplete="off"
		aria-label="Cerca topic"
	/>
	{#if query}
		<button type="button" class="search-clear" title="Pulisci" on:click={() => (query = '')}>✕</button>
	{/if}
</div>

{#if showNew}
	<div class="nt-overlay" role="button" tabindex="0"
		on:click={() => (showNew = false)} on:keydown={(e) => e.key === 'Escape' && (showNew = false)}>
		<div class="nt-modal" role="dialog" aria-modal="true" aria-label="Nuovo topic" tabindex="-1"
			on:click|stopPropagation on:keydown|stopPropagation>
			<h2>{$instanceProfile.vocabulary?.nuovo_topic || 'Nuovo topic / canale'}</h2>
			<p class="nt-note">Sei l'owner; partecipanti AI iniziali: <code>{(($instanceProfile.topics_defaults?.participants?.length ? $instanceProfile.topics_defaults.participants : [$instanceProfile.topics_defaults?.contact_agent || 'clodia'])).join(', ')}</code>. Potrai invitarne altri nel canale.</p>
			<label class="nt-field"><span>Nome</span>
				<input type="text" bind:value={nName} placeholder="es. progetto-acme" autocomplete="off" />
				<span class="nt-hint">minuscole, cifre, <code>-</code> e <code>_</code></span>
			</label>
			<label class="nt-field"><span>Titolo</span>
				<input type="text" bind:value={nTitle} placeholder="Titolo descrittivo (opzionale)" />
			</label>
			<div class="nt-row">
				<label class="nt-field"><span>Privacy (tier)</span>
					<select bind:value={nTier}>
						<option value="SEAL-0">SEAL-0 · Public</option>
						<option value="SEAL-1">SEAL-1 · Internal</option>
						<option value="SEAL-2">SEAL-2 · Confidential</option>
						<option value="SEAL-3">SEAL-3 · Restricted</option>
						<option value="SEAL-4">SEAL-4 · Sovereign</option>
					</select>
				</label>
				<label class="nt-field"><span>Tipo</span>
					<select bind:value={nType}>
						{#each editionTypes as t (t.key)}
							<option value={t.key}>{t.label}</option>
						{/each}
					</select>
				</label>
			</div>
			<div class="nt-row">
				<label class="nt-field"><span>Storage dei file</span>
					<select bind:value={nStorage}>
						<option value="local">Local (gateway)</option>
						<option value="drive">Google Drive</option>
					</select>
				</label>
				{#if nStorage === 'drive'}
					<label class="nt-field"><span>Cartella Drive</span>
						<input type="text" bind:value={nDriveFolder} placeholder="link/id cartella — vuoto = creane una nuova" autocomplete="off" />
						<span class="nt-hint">i file del topic vivranno su Drive (EU → cap SEAL-2)</span>
					</label>
				{/if}
			</div>
			{#if createErr}<div class="nt-err">{createErr}</div>{/if}
			<div class="nt-actions">
				<button type="button" class="nt-sec" on:click={() => (showNew = false)} disabled={creating}>Annulla</button>
				<button type="button" class="nt-pri" on:click={submitNew} disabled={creating}>{creating ? 'Creazione…' : 'Crea topic'}</button>
			</div>
		</div>
	</div>
{/if}

{#if showExport}
	<div class="nt-overlay" role="button" tabindex="0"
		on:click={() => (showExport = false)} on:keydown={(e) => e.key === 'Escape' && (showExport = false)}>
		<div class="nt-modal" role="dialog" aria-modal="true" aria-label="Esporta topic" tabindex="-1"
			on:click|stopPropagation on:keydown|stopPropagation>
			<h2>Esporta topic</h2>
			<p class="nt-note">Seleziona i topic da includere nello snapshot. All'import su un'altra istanza si aggiungono ai topic esistenti; quelli con lo stesso code-name vengono saltati.</p>
			<label class="exp-all">
				<input type="checkbox" checked={allSelected} on:change={toggleAll} />
				<span>Seleziona tutto ({exportSelCount}/{catalog.length})</span>
			</label>
			<div class="exp-list">
				{#each catalog as t (`${t.tier}/${t.name}`)}
					<label class="exp-row">
						<input type="checkbox" bind:checked={exportSel[`${t.tier}/${t.name}`]} />
						<span class="exp-tier cls-{t.tier}">{t.tier}</span>
						{#if t.kind === 'dm'}<span class="exp-dm">DM</span>{/if}
						<span class="exp-title">{t.title}</span>
						<code class="exp-name">{t.name}</code>
					</label>
				{:else}
					<p class="muted">Nessun topic.</p>
				{/each}
			</div>
			<div class="nt-actions">
				<button type="button" class="nt-sec" on:click={() => (showExport = false)} disabled={exporting}>Annulla</button>
				<button type="button" class="nt-pri" on:click={doExport} disabled={exporting || exportSelCount === 0}>
					{exporting ? 'Export…' : `Esporta ${exportSelCount} topic`}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if listState.kind === 'loading' || listState.kind === 'idle'}
	<div class="grid">
		{#each Array(8) as _}
			<div class="topic-card skel">
				<Skeleton width="40%" height="10px" />
				<Skeleton width="85%" height="14px" />
				<Skeleton width="60%" height="11px" />
			</div>
		{/each}
	</div>
{:else if listState.kind === 'error'}
	<div class="status error">
		<strong>Failed to load topics{listState.status ? ` (HTTP ${listState.status})` : ''}.</strong>
		<div class="error-msg">{listState.message}</div>
		<div class="error-hint">
			Check that the agent-server is reachable at <code>{API_BASE_URL}</code>.
		</div>
		<button class="retry" type="button" on:click={loadList}>Retry</button>
	</div>
{:else if listState.topics.length === 0}
	<div class="status">
		<strong>No topics found.</strong>
		<p class="hint">The server responded with an empty list.</p>
	</div>
{:else}
	{@const shown = sortTopics(listState.topics, pinnedTopics, query, showArchived)}
	{#if shown.length === 0}
		<div class="status">
			<strong>Nessun topic corrisponde a «{query}».</strong>
			<p class="hint">Prova un altro termine o pulisci la ricerca.</p>
		</div>
	{:else}
	<div class="grid">
		{#each shown as t (`${t.tier}/${t.name}`)}
			{@const status = topicStatus(t)}
			<article class="topic-card" class:expanded={expanded[keyOf(t)]} class:pinned={isPinned(t)}>
				<div class="topic-actions" aria-label="Azioni topic">
					{#if !isArchived(t)}
						<button
							type="button"
							class="archive-btn topic-action"
							title="Archivia topic"
							aria-label={`Archivia ${t.title || t.name}`}
							on:click|stopPropagation={() => (archiveTarget = t)}
						>🗄</button>
					{/if}
					<button
						type="button"
						class="pin-btn topic-action"
						class:on={isPinned(t)}
						title={isPinned(t) ? 'Rimuovi pin' : 'Pinna topic'}
						aria-label={isPinned(t) ? `Rimuovi pin da ${t.title || t.name}` : `Pinna ${t.title || t.name}`}
						aria-pressed={isPinned(t) ? 'true' : 'false'}
						on:click|stopPropagation={() => togglePinned(t)}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M15 4.5l4.5 4.5-3.1 3.1.3 4.4-1.4 1.4-4.1-4.1-4.9 4.9-1-1 4.9-4.9-4.1-4.1 1.4-1.4 4.4.3L15 4.5z" />
						</svg>
					</button>
				</div>
				<!-- Intestazione sempre visibile (collassata) — click per espandere -->
				<button
					type="button"
					class="card-head"
					on:click={() => toggleExpand(t)}
					aria-expanded={expanded[keyOf(t)] ? 'true' : 'false'}
				>
					<div class="card-top">
						{#if status !== 'active'}
							<span class="state state-{status}">{status}</span>
						{/if}
						{#if deadlineInfo(t.next_deadline)}
							{@const dl = deadlineInfo(t.next_deadline)}
							<span class="deadline deadline-{dl?.cls}" title="Scadenza todo più vicina">⏰ {dl?.label}</span>
						{/if}
						{#if t.storage}
							<span class="storage" title="Storage backend del topic">⛁ {t.storage}</span>
						{/if}
						{#if t.last_commit}
							<span class="topic-date" title={t.last_commit_subject || t.last_commit}
								>{fmtTs(t.last_commit)}</span
							>
						{/if}
						<span class="caret" class:open={expanded[keyOf(t)]}>▸</span>
					</div>
					<span class="topic-title">{t.title || t.name}</span>
					<code class="topic-name">{t.name}</code>
				</button>

				<!-- Corpo espanso: TLDR, top action point, contact agent -->
				{#if expanded[keyOf(t)]}
					<div class="card-body">
						<a class="open-channel" href={`/topics/${t.tier}/${t.name}`} on:click|stopPropagation>
							💬 Apri canale
						</a>
						<div class="status-row" on:click|stopPropagation on:keydown|stopPropagation role="presentation">
							<span class="status-label">Stato</span>
							<select class="status-select" value={t.status ?? 'active'}
								disabled={statusBusy[keyOf(t)]}
								on:change={(e) => changeStatus(t, (e.currentTarget as HTMLSelectElement).value)}>
								{#each statusOptions as s}
									<option value={s}>{s}</option>
								{/each}
							</select>
						</div>
						{#if t.tldr}
							<div class="topic-tldr md">{@html renderMarkdown(t.tldr)}</div>
						{/if}
						{#if t.action_points?.length}
							<ul class="action-points" aria-label="Top action points">
								{#each t.action_points.slice(0, 3) as point}
									<li>{@html renderInline(point)}</li>
								{/each}
							</ul>
						{/if}
						{#if t.recent_artifacts?.length}
							<ul class="artifacts" aria-label="Artefatti recenti">
								{#each t.recent_artifacts as a}
									<li class="artifact">
										<span class="artifact-icon">{fileIcon(a.name)}</span>
										<a
											class="artifact-name"
											title={a.path}
											href={`${API_BASE_URL}/topics/${t.tier}/${t.name}/download?path=${encodeURIComponent(a.path)}`}
											download={a.name}
											on:click|stopPropagation
										>{a.name}</a>
										<span class="artifact-date">{fmtTs(a.mtime_iso)}</span>
									</li>
								{/each}
							</ul>
						{/if}
						<div class="card-foot">
							{#if t.owner}
								<div class="member-row" title="Owner del canale">
									<span class="member-label">Owner</span>
									<span class="member">
										<AgentAvatar name={t.owner} size={22} />
										<span class="member-name">{t.owner}</span>
									</span>
								</div>
							{/if}
							{#if t.participants?.length}
								<div class="member-row" title="Partecipanti del canale">
									<span class="member-label">Partecipanti</span>
									<span class="members">
										{#each t.participants as p}
											<span class="member" title={p}>
												<AgentAvatar name={p} size={22} />
												<span class="member-name">{p}</span>
											</span>
										{/each}
									</span>
								</div>
							{/if}
						</div>
					</div>
				{/if}
				<footer class="card-seal cls-{t.tier}" title={t.tier_name ?? ''}>
					{t.tier}{t.tier_name ? ' · ' + t.tier_name : ''}
				</footer>
			</article>
		{/each}
	</div>
	{/if}
{/if}

<Modal open={!!archiveTarget} dismissable={!archiving} maxWidth={420} on:close={() => (archiveTarget = null)}>
	<div class="confirm">
		<h3>Archiviare il topic?</h3>
		<p>«{archiveTarget?.title || archiveTarget?.name}» verrà spostato tra gli archiviati (nascosto di default, ripristinabile col toggle «Mostra archived»).</p>
		<div class="confirm-actions">
			<button type="button" class="btn" on:click={() => (archiveTarget = null)} disabled={archiving}>Annulla</button>
			<button type="button" class="btn danger" on:click={confirmArchive} disabled={archiving}>{archiving ? 'Archivio…' : 'Archivia'}</button>
		</div>
	</div>
</Modal>

<style>
	/* Barra di ricerca rapida in cima alla lista Topics */
	.search-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
		padding: 8px 12px;
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 9px;
	}
	.search-bar:focus-within { border-color: var(--accent); }
	.search-ico { font-size: 13px; opacity: 0.7; flex-shrink: 0; }
	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		color: var(--fg);
		font: inherit;
		font-size: 13.5px;
		outline: none;
		min-width: 0;
	}
	.search-input::placeholder { color: var(--fg-muted); }
	.search-clear {
		background: transparent;
		border: none;
		color: var(--fg-muted);
		cursor: pointer;
		font-size: 13px;
		padding: 2px 6px;
		border-radius: 5px;
		flex-shrink: 0;
	}
	.search-clear:hover { color: var(--fg); background: rgba(255, 255, 255, 0.06); }
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 18px;
	}
	.hint {
		margin: 4px 0 0;
		color: var(--fg-muted);
		font-size: 12px;
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.archived-toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--fg-muted);
		cursor: pointer;
		user-select: none;
	}
	.archived-toggle.on {
		color: var(--fg);
	}
	.archived-toggle input {
		cursor: pointer;
	}

	/* Badge stato topic */
	.state {
		font-size: 9.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 999px;
		white-space: nowrap;
		flex: 0 0 auto;
	}
	.storage {
			font-size: 9.5px;
			letter-spacing: 0.03em;
			padding: 2px 7px;
			border-radius: 999px;
			background: rgba(120, 144, 156, 0.16);
			color: var(--fg-muted);
			font-family: var(--mono);
			white-space: nowrap;
			flex: 0 0 auto;
		}
		.state-archived {
		background: rgba(140, 140, 140, 0.16);
		color: var(--fg-muted);
	}
	.state-await {
		background: rgba(199, 154, 46, 0.18);
		color: #c79a2e;
	}
	.state-idle {
		background: rgba(96, 165, 250, 0.14);
		color: #60a5fa;
	}
	.state:not(.state-archived):not(.state-await):not(.state-idle) {
		background: rgba(120, 144, 156, 0.16);
		color: var(--fg-muted);
	}
	.state-urgent {
		background: rgba(239, 68, 68, 0.18);
		color: #ef4444;
	}
	/* Badge scadenza todo più vicina */
	.deadline {
		font-size: 9.5px;
		letter-spacing: 0.03em;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 999px;
		background: rgba(120, 144, 156, 0.16);
		color: var(--fg-muted);
		white-space: nowrap;
		flex: 0 0 auto;
	}
	.deadline-soon { background: rgba(199, 154, 46, 0.18); color: #c79a2e; }
	.deadline-overdue { background: rgba(239, 68, 68, 0.18); color: #ef4444; }
	/* Selettore stato nella card */
	.status-row { display: flex; align-items: center; gap: 8px; margin: 6px 0 2px; }
	.status-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); }
	.status-select {
		font: inherit; font-size: 12px; padding: 3px 8px; border-radius: 6px;
		border: 1px solid var(--border); background: var(--card-bg, transparent); color: var(--fg); cursor: pointer;
	}
	.status-select:disabled { opacity: 0.5; cursor: default; }

	/* Card grid ----------------------------------------------------------- */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 14px;
	}

	.topic-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 10px;
		color: var(--fg);
		overflow: hidden;
		transition: border-color 0.12s ease;
	}
	.topic-card.expanded {
		border-color: var(--accent);
	}
	.topic-card.pinned {
		border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
	}
	.topic-card.skel {
		pointer-events: none;
		padding: 14px 16px;
		gap: 8px;
	}
	.topic-actions {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.topic-action {
		display: inline-grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--fg-muted);
		font: inherit;
		line-height: 1;
		cursor: pointer;
	}
	.topic-action:hover { background: color-mix(in srgb, var(--card-bg) 78%, #000); }
	.archive-btn { font-size: 14px; }
	.archive-btn:hover { color: var(--danger); }
	.confirm { display: flex; flex-direction: column; gap: 12px; }
	.confirm h3 { margin: 0; font-size: 16px; }
	.confirm p { margin: 0; font-size: 13px; color: var(--fg-muted); line-height: 1.5; }
	.confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
	.confirm-actions .btn { background: rgba(0,0,0,.2); border: 1px solid var(--border); color: var(--fg); border-radius: 8px; padding: 8px 14px; font: inherit; font-size: 13px; cursor: pointer; }
	.confirm-actions .btn.danger { background: var(--danger); border-color: var(--danger); color: #fff; font-weight: 700; }
	.pin-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linejoin: round; }
	.pin-btn:hover,
	.pin-btn.on {
		color: var(--accent);
		background: rgba(255, 107, 61, 0.08);
	}
	.pin-btn.on svg { fill: currentColor; }

	/* Intestazione cliccabile (collassata) */
	.card-head {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
		text-align: left;
		width: 100%;
		padding: 14px 88px 14px 16px;
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
	}
	.card-head:hover {
		background: rgba(255, 107, 61, 0.05);
	}
	.card-body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0 16px 14px;
	}
	.caret {
		font-size: 11px;
		color: var(--fg-muted);
		transition: transform 0.12s ease;
		margin-left: 4px;
	}
	.caret.open {
		transform: rotate(90deg);
	}

	.card-top {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px 8px;
	}
	/* la data spinge il caret a destra */
	.topic-date {
		margin-left: auto;
	}

	.cls {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--border);
		color: var(--fg-muted);
	}
	.cls-personal {
		background: rgba(96, 165, 250, 0.12);
		color: #60a5fa;
	}
	.cls-confidential {
		background: rgba(239, 68, 68, 0.12);
		color: #ef4444;
	}
	/* Tier SEAL-0..4 (Public/Internal/Confidential/Restricted/Sovereign): freddo → caldo. */
	.card-seal {
		margin-top: auto;
		width: 100%;
		padding: 6px 12px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-align: center;
		border-top: 1px solid var(--border);
	}
	.cls-SEAL-0 {
		background: rgba(148, 163, 184, 0.14);
		color: #94a3b8;
	}
	.cls-SEAL-1 {
		background: rgba(96, 165, 250, 0.12);
		color: #60a5fa;
	}
	.cls-SEAL-2 {
		background: rgba(245, 158, 11, 0.14);
		color: #f59e0b;
	}
	.cls-SEAL-3 {
		background: rgba(239, 68, 68, 0.12);
		color: #ef4444;
	}
	.cls-SEAL-4 {
		background: rgba(168, 85, 247, 0.16);
		color: #a855f7;
	}

	.topic-date {
		font-size: 10.5px;
		color: var(--fg-muted);
		white-space: nowrap;
	}

	.topic-title {
		font-size: 13.5px;
		line-height: 1.4;
		font-weight: 600;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.topic-tldr {
		margin: 0;
		color: var(--fg-muted);
		font-size: 12px;
		line-height: 1.45;
	}

	.action-points {
		margin: 2px 0 0;
		padding-left: 16px;
		color: var(--fg);
		font-size: 11.5px;
		line-height: 1.45;
	}
	.action-points li {
		margin: 2px 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.action-points li::marker {
		color: var(--accent);
	}
	.action-points :global(code) {
		background: rgba(255, 255, 255, 0.06);
		padding: 0 4px;
		border-radius: 3px;
		font-size: 0.92em;
	}
	.action-points :global(a) {
		color: #6fb6ff;
		text-decoration: underline;
	}
	.action-points :global(strong) {
		color: var(--fg);
	}

	/* Footer: owner + partecipanti del canale ----------------------------- */
	.card-foot {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 4px;
		padding-top: 8px;
		border-top: 1px solid var(--border);
	}
	.topic-name {
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--fg-muted);
		background: transparent;
		padding: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.member-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.member-label {
		font-size: 9.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		color: var(--fg-muted);
		flex-shrink: 0;
		width: 70px;
	}
	.members {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		min-width: 0;
	}
	.member {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 8px 2px 2px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: transparent;
	}
	.member-name {
		font-size: 11px;
		font-weight: 600;
	}

	/* Artefatti recenti ---------------------------------------------------- */
	.artifacts {
		margin: 2px 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.artifact {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--fg-muted);
		min-width: 0;
	}
	.artifact-icon {
		font-size: 12px;
		flex-shrink: 0;
	}
	.artifact-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--fg);
		text-decoration: none;
	}
	.artifact-name:hover {
		text-decoration: underline;
		color: var(--accent);
	}
	.artifact-date {
		flex-shrink: 0;
		font-size: 10px;
		color: var(--fg-muted);
	}

	/* TLDR markdown inline (compatto) ------------------------------------- */
	.md :global(p) {
		margin: 0 0 0.4em;
	}
	.md :global(p:last-child) {
		margin-bottom: 0;
	}
	.md :global(ul),
	.md :global(ol) {
		margin: 0.2em 0;
		padding-left: 1.2em;
	}
	.md :global(code) {
		background: rgba(255, 255, 255, 0.06);
		padding: 0 4px;
		border-radius: 3px;
		font-size: 0.92em;
	}
	.md :global(a) {
		color: #6fb6ff;
		text-decoration: underline;
	}
	.md :global(strong) {
		color: var(--fg);
	}
	.md :global(h1),
	.md :global(h2),
	.md :global(h3) {
		font-size: 1em;
		margin: 0 0 0.3em;
	}

	/* Status panels --------------------------------------------------------- */
	.status {
		padding: 14px 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.02);
	}
	.status.error {
		border-color: rgba(232, 93, 117, 0.6);
		background: rgba(232, 93, 117, 0.08);
	}
	.error-msg {
		margin-top: 6px;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--danger);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.error-hint {
		margin-top: 8px;
		font-size: 12px;
		color: var(--fg-muted);
	}
	.retry {
		margin-top: 10px;
		font-size: 11px;
		padding: 4px 10px;
	}
	.new-topic { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font: inherit; font-weight: 700; font-size: 12.5px; padding: 7px 13px; border-radius: 7px; cursor: pointer; }
	.type-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 2px; }
	.type-chip { background: color-mix(in srgb, var(--accent) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); color: inherit; font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
	.type-chip:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
	.snap { background: transparent; border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 12.5px; padding: 7px 11px; border-radius: 7px; cursor: pointer; }
	.snap:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
	.snap:disabled { opacity: .5; cursor: not-allowed; }
	.nt-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: center; z-index: 60; padding: 16px; }
	.nt-modal { width: min(460px, 100%); background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
	.nt-modal h2 { margin: 0; font-size: 18px; }
	.nt-note { margin: 0; font-size: 12px; color: var(--fg-muted); line-height: 1.5; }
	.nt-field { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--fg-muted); flex: 1 1 0; }
	.nt-field input, .nt-field select { background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 6px; }
	.nt-hint { font-size: 11px; }
	.nt-row { display: flex; gap: 10px; }
	.nt-err { color: var(--danger); font-size: 12px; }
	.nt-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
	.nt-sec { background: transparent; border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 8px 13px; border-radius: 6px; cursor: pointer; }
	.nt-pri { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font: inherit; font-weight: 700; font-size: 13px; padding: 8px 13px; border-radius: 6px; cursor: pointer; }
	.nt-sec:disabled, .nt-pri:disabled { opacity: .5; cursor: not-allowed; }
	.exp-all { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; padding: 6px 0; border-bottom: 1px solid var(--border); }
	.exp-list { display: flex; flex-direction: column; max-height: 320px; overflow-y: auto; margin: 4px 0; }
	.exp-row { display: flex; align-items: center; gap: 8px; padding: 6px 2px; font-size: 12.5px; border-bottom: 1px solid rgba(255,255,255,0.04); cursor: pointer; }
	.exp-row:hover { background: rgba(255,255,255,0.03); }
	.exp-tier { font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: var(--border); color: var(--fg-muted); }
	.exp-dm { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 999px; background: rgba(96,165,250,0.16); color: #60a5fa; }
	.exp-title { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.exp-name { font-family: var(--mono); font-size: 10.5px; color: var(--fg-muted); }
	.muted { color: var(--fg-muted); font-size: 12px; padding: 8px 0; }
</style>
