<script lang="ts">
	/**
	 * Pick the data to import into a topic (clodia-platform#595): a button that
	 * opens a centered dialog with a search field over the catalog entries the
	 * caller may import here, multiple selection. The caller filters the list
	 * (tier, already imported, archived topics' indexes, this topic's own
	 * index); this component only searches and picks.
	 */
	import { createEventDispatcher } from 'svelte';
	import { catalogLabel, type DataCatalogEntry } from '$lib/api/client';
	import Modal from '$lib/components/Modal.svelte';

	export let entries: DataCatalogEntry[] = [];
	export let disabled = false;

	const dispatch = createEventDispatcher<{ pick: DataCatalogEntry[] }>();

	const key = (e: DataCatalogEntry) => `${e.kind}:${e.name}`;
	const kindLabel = (e: DataCatalogEntry) => (e.kind === 'rag' ? 'RAG' : 'DB');

	let open = false;
	let query = '';
	let picked = new Set<string>();

	$: q = query.trim().toLowerCase();
	$: list = entries
		.filter((e) => !q || [catalogLabel(e), e.name, e.tier, kindLabel(e), e.topic ?? '']
			.some((s) => s.toLowerCase().includes(q)))
		.sort((a, b) => catalogLabel(a).localeCompare(catalogLabel(b)));
	$: count = picked.size;

	function show() {
		picked = new Set();
		query = '';
		open = true;
	}

	function toggle(e: DataCatalogEntry) {
		const next = new Set(picked);
		if (next.has(key(e))) next.delete(key(e));
		else next.add(key(e));
		picked = next;
	}

	function confirm() {
		if (count === 0) return;
		dispatch('pick', entries.filter((e) => picked.has(key(e))));
		open = false;
	}
</script>

<button type="button" class="link-btn open-btn" disabled={disabled || entries.length === 0}
	on:click={show}>
	{entries.length ? 'Importa dal catalogo…' : 'Nulla da importare'}
</button>

<Modal {open} maxWidth={620} on:close={() => (open = false)}>
	<h2 slot="title">Importa dati nel topic</h2>
	<div class="body">
		<p class="muted wrap">
			Raccolte RAG (anche l'indice di un altro topic) e database che puoi importare qui.
			I topic archiviati non compaiono.
		</p>
		<input class="search" type="search" placeholder="Cerca per nome, topic, tier…"
			bind:value={query} aria-label="Cerca nel catalogo" />
		{#if list.length === 0}
			<p class="muted">Nessuna risorsa corrisponde.</p>
		{/if}
		<ul class="items">
			{#each list as e (key(e))}
				<li class="item">
					<label class="check" title={e.name}>
						<input type="checkbox" checked={picked.has(key(e))} on:change={() => toggle(e)} />
						<span class="kind kind-{e.kind}">{kindLabel(e)}</span>
						<span class="label">{catalogLabel(e)}</span>
						<span class="muted">· {e.tier}</span>
					</label>
				</li>
			{/each}
		</ul>
	</div>
	<div slot="actions" class="actions">
		<button type="button" class="btn" on:click={() => (open = false)}>Annulla</button>
		<button type="button" class="btn primary" disabled={count === 0} on:click={confirm}>
			{count === 0 ? 'Importa' : `Importa ${count}`}
		</button>
	</div>
</Modal>

<style>
	.open-btn { margin-top: 8px; }
	.link-btn {
		font-size: 11px; background: transparent; border: 1px solid var(--border);
		border-radius: 4px; color: var(--fg); cursor: pointer; padding: 2px 8px; white-space: nowrap;
	}
	.link-btn:disabled { opacity: .5; cursor: default; }
	.body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
	.search {
		font-size: 13px; padding: 6px 8px; border-radius: 6px;
		border: 1px solid var(--border); background: var(--bg); color: var(--fg);
	}
	.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column;
		gap: 4px; max-height: 55vh; overflow-y: auto; }
	.item { flex: none; border-bottom: 1px solid var(--border); padding: 4px 0; }
	.check { display: flex; align-items: center; gap: 6px; min-width: 0; cursor: pointer; font-size: 13px; }
	.label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.muted { color: var(--fg-muted); font-size: 11px; white-space: nowrap; }
	.wrap { white-space: normal; margin: 0; }
	.kind {
		font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 999px;
		border: 1px solid var(--border); white-space: nowrap; flex-shrink: 0;
	}
	.kind-rag { color: #a855f7; border-color: rgba(168, 85, 247, 0.5); }
	.kind-datastore { color: #0ea5e9; border-color: rgba(14, 165, 233, 0.5); }
	.actions { display: flex; justify-content: flex-end; gap: 8px; }
	.btn {
		font-size: 13px; padding: 6px 12px; border-radius: 6px; cursor: pointer;
		border: 1px solid var(--border); background: transparent; color: var(--fg);
	}
	.btn.primary { background: var(--accent, #ff6b3d); border-color: transparent; color: #fff; }
	.btn:disabled { opacity: .5; cursor: default; }
</style>
