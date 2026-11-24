<script lang="ts">
	/**
	 * «Connetti» (clodia-platform#709, owner 21 Nov 2026): one list to connect
	 * and disconnect a room's MCPs and the data imported into its topic. It
	 * merges the elements of the «Autorizza MCP» picker and of the «Importa dati
	 * nel topic» picker — nothing else: no room lists, no index switch, no
	 * resources (those stay in the sidebar panels).
	 *
	 * Same calls as those pickers' panels: `setChannelMcp` enable/disable for
	 * MCPs, `importTopicData` / `removeTopicData` for data; same candidates
	 * (`mcp_catalogue` of the room's toolbox, `importableEntries` of the data
	 * catalog). Owner or admin acts; anyone else sees the state only.
	 */
	import { createEventDispatcher, onMount } from 'svelte';
	import {
		apiErrorDetail,
		catalogLabel,
		getChannelTools,
		getDataCatalog,
		importTopicData,
		mcpVerbsLabel,
		removeTopicData,
		setChannelMcp,
		type DataCatalogEntry,
		type McpInfo,
		type TopicDataImport,
		type Toolbox
	} from '$lib/api/client';
	import { toastError, toastSuccess } from '$lib/stores/toasts';
	import { dataKey, importableEntries } from '$lib/topicData';

	export let tier: string;
	export let name: string;
	/** `meta.data` of the topic. */
	export let imports: TopicDataImport[] = [];
	/** The topic's own RAG collection (`meta.index.collection`): never offered. */
	export let indexCollection = '';
	/** Owner or admin: may connect and disconnect. */
	export let canEdit = false;

	const dispatch = createEventDispatcher<{ changed: void }>();

	type Row = {
		kind: 'mcp' | 'mail' | 'rag' | 'datastore';
		id: string;
		label: string;
		detail: string;
		connected: boolean;
		search: string;
	};

	let box: Toolbox | null = null;
	let catalog: DataCatalogEntry[] = [];
	let err = '';
	let busy = '';
	let query = '';
	/** Imports changed here, until the page reloads the meta. */
	let localImports: TopicDataImport[] | null = null;
	$: current = localImports ?? imports;

	async function load() {
		err = '';
		try {
			const [b, c] = await Promise.all([getChannelTools(tier, name), getDataCatalog()]);
			box = b;
			catalog = c.entries;
		} catch (e) {
			err = apiErrorDetail(e);
		}
	}
	onMount(() => void load());

	$: mcpCatalogue = (box?.mcp_catalogue ?? {}) as Record<string, McpInfo>;
	$: authorised = new Set(Object.keys(box?.mcp ?? {}));
	// Mailboxes (#734) are connected here like MCPs, one by one. Where the
	// instance offers them, the old room-wide «Email» capability is not listed.
	$: hasMailboxes = Object.values(mcpCatalogue).some((m) => m.kind === 'mailbox');
	$: mcpRows = Object.values(mcpCatalogue)
		.filter((m) => !(hasMailboxes && m.id === 'email' && !authorised.has('email')))
		.map((m): Row => m.kind === 'mailbox'
			? {
					kind: 'mail',
					id: m.id,
					label: m.label,
					detail: m.send_only ? 'solo invio' : 'il corriere la legge · si spedisce da qui',
					connected: authorised.has(m.id),
					search: [m.label, m.id, 'casella email mail'].join(' ').toLowerCase()
				}
			: {
					kind: 'mcp',
					id: m.id,
					label: m.label,
					detail: mcpVerbsLabel(m),
					connected: authorised.has(m.id),
					search: [m.label, m.id, ...m.namespaces].join(' ').toLowerCase()
				});

	$: importedKeys = new Set(current.map((i) => dataKey(i.kind, i.name)));
	$: dataRows = importableEntries(catalog, current, indexCollection, tier, true).map((e): Row => ({
		kind: e.kind === 'rag' ? 'rag' : 'datastore',
		id: e.name,
		label: catalogLabel(e),
		detail: e.tier,
		connected: importedKeys.has(dataKey(e.kind, e.name)),
		search: [catalogLabel(e), e.name, e.tier, e.topic ?? ''].join(' ').toLowerCase()
	}));

	const kindLabel = (r: Row) => (r.kind === 'mcp' ? 'MCP' : r.kind === 'mail' ? 'MAIL' : r.kind === 'rag' ? 'RAG' : 'DB');

	// ONE list (owner, 21 Nov 2026): the type badge tells MCP, RAG and DB
	// apart. Connected first, then by name, the type as tie-break. The search
	// matches the type label too, so «rag» lists the RAG items.
	$: q = query.trim().toLowerCase();
	const order = (a: Row, b: Row) =>
		Number(b.connected) - Number(a.connected)
		|| a.label.localeCompare(b.label)
		|| kindLabel(a).localeCompare(kindLabel(b));
	$: list = [...mcpRows, ...dataRows]
		.filter((r) => !q || r.search.includes(q) || kindLabel(r).toLowerCase().includes(q))
		.sort(order);

	async function toggle(r: Row) {
		if (!canEdit || busy) return;
		if (r.connected && !confirm(`Scollegare ${r.label}?`
			+ (r.kind === 'mcp' ? ' Le sue risorse nella stanza vengono rimosse.'
				: r.kind === 'mail' ? ' Il corriere smette di leggerla per questo canale e non si spedisce più da qui.' : ''))) return;
		busy = `${r.kind}:${r.id}`;
		try {
			if (r.kind === 'mcp' || r.kind === 'mail') {
				await setChannelMcp(tier, name,
					{ action: r.connected ? 'disable_mcp' : 'enable_mcp', mcp: r.id });
				box = await getChannelTools(tier, name);
			} else {
				if (r.connected) await removeTopicData(tier, name, r.kind, r.id);
				else await importTopicData(tier, name, r.kind, r.id);
				localImports = r.connected
					? current.filter((i) => !(i.kind === r.kind && i.name === r.id))
					: [...current, { kind: r.kind, name: r.id }];
			}
			toastSuccess(`${r.connected ? 'Scollegato' : 'Collegato'}: ${r.label}`);
			dispatch('changed');
		} catch (e) {
			toastError('Connetti', apiErrorDetail(e));
		} finally {
			busy = '';
		}
	}
</script>

{#if err}
	<p class="err" role="alert">{err}</p>
{:else if !box}
	<p class="muted">Caricamento…</p>
{:else}
	<input class="search" type="search" placeholder="Cerca MCP, raccolte RAG, database…"
		bind:value={query} aria-label="Cerca" />
	{#if !canEdit}
		<p class="muted wrap">Solo l'owner del canale o un admin può collegare e scollegare.</p>
	{/if}
	{#if list.length === 0}
		<p class="muted">Nessun MCP, raccolta RAG o database corrisponde.</p>
	{:else}
		<ul class="rows" aria-label="MCP, raccolte RAG e database">
			{#each list as r (`${r.kind}:${r.id}`)}
				<li class="row" class:on={r.connected}>
					<span class="kind kind-{r.kind}">{kindLabel(r)}</span>
					<span class="label" title={r.id}>{r.label}</span>
					<span class="muted">{r.detail}</span>
					{#if canEdit}
						<button type="button" class="tog" class:on={r.connected}
							disabled={!!busy} on:click={() => void toggle(r)}
							aria-label={`${r.connected ? 'Scollega' : 'Collega'} ${r.label}`}>
							{busy === `${r.kind}:${r.id}` ? '…' : r.connected ? 'Scollega' : 'Collega'}
						</button>
					{:else}
						<span class="state" class:on={r.connected}>{r.connected ? 'collegato' : '—'}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.search { width: 100%; box-sizing: border-box; font-size: 13px; padding: 6px 8px; border-radius: 6px;
		border: 1px solid var(--border); background: var(--bg); color: var(--fg); margin-bottom: 8px; }
	.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px;
		max-height: 60vh; overflow-y: auto; }
	.row { flex: none; display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px;
		padding: 4px 2px; border-bottom: 1px solid var(--border); }
	.row.on .label { font-weight: 600; }
	.label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.muted { color: var(--fg-muted); font-size: 11px; white-space: nowrap; }
	.wrap { white-space: normal; margin: 0 0 8px; }
	.err { color: #dc2626; font-size: 12px; }
	.kind { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 999px;
		border: 1px solid var(--border); white-space: nowrap; flex-shrink: 0; min-width: 28px; text-align: center; }
	.kind-mcp { color: #16a34a; border-color: rgba(22, 163, 74, 0.5); }
	.kind-rag { color: #a855f7; border-color: rgba(168, 85, 247, 0.5); }
	.kind-datastore { color: #0ea5e9; border-color: rgba(14, 165, 233, 0.5); }
	.kind-mail { color: #f59e0b; border-color: rgba(245, 158, 11, 0.5); }
	.tog { font: inherit; font-size: 11px; padding: 2px 10px; border-radius: 6px; cursor: pointer;
		border: 1px solid var(--success, #16a34a); background: var(--success, #16a34a); color: #fff;
		white-space: nowrap; flex-shrink: 0; min-width: 72px; }
	.tog.on { background: transparent; color: var(--fg-muted); border-color: var(--border); }
	.tog.on:hover:not(:disabled) { color: var(--danger, #dc2626); border-color: var(--danger, #dc2626); }
	.tog:disabled { opacity: .5; cursor: default; }
	.state { font-size: 11px; color: var(--fg-muted); flex-shrink: 0; }
	.state.on { color: #16a34a; }
</style>
