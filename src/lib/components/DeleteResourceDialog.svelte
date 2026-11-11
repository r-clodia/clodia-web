<script lang="ts">
	/**
	 * Delete a datastore or a RAG collection (clodia-platform#672).
	 *
	 * The confirm button stays disabled until the resource's name is typed
	 * exactly — the server checks the same string again — and the dialog says
	 * what happens: the data leaves the platform, the scopes lose their import,
	 * the pack declaration stays and will not re-create it, and an export is
	 * written first under `deleted/` in the data dir (kept as long as the backup
	 * keeps it).
	 */
	import { createEventDispatcher } from 'svelte';
	import Modal from './Modal.svelte';

	export let open = false;
	export let kind: 'datastore' | 'rag' = 'datastore';
	export let name = '';
	export let scopes: string[] = [];
	export let loading = false;

	const dispatch = createEventDispatcher<{ confirm: string; cancel: void }>();
	let typed = '';

	$: if (!open) typed = '';
	$: matches = typed === name && name !== '';
	$: label = kind === 'rag' ? 'la collection' : 'il datastore';
	$: exportWhat = kind === 'rag'
		? 'documenti e chunk in JSONL (documents.jsonl, chunks.jsonl)'
		: 'una copia SQLite del file';

	function cancel() {
		if (!loading) dispatch('cancel');
	}
	function confirm() {
		if (matches && !loading) dispatch('confirm', typed);
	}
</script>

<Modal {open} dismissable={!loading} on:close={cancel} maxWidth={480}>
	<h2 slot="title">Eliminare {label}?</h2>
	<div class="body">
		<p>
			<b>{name}</b> e tutti i suoi dati vengono rimossi dalla piattaforma.
			{#if scopes.length}
				Viene tolto anche dagli spazi che lo importano ({scopes.join(', ')}).
			{/if}
			La dichiarazione del pack resta, ma non lo ricrea: si ricrea solo con un'azione esplicita.
		</p>
		<p class="export">
			Prima di eliminare viene scritto un export — {exportWhat} — in
			<code>deleted/{kind}-…-&lt;data&gt;/</code> nella cartella dati dell'istanza. Il backup
			lo conserva secondo la sua retention; dopo, i dati non sono recuperabili.
		</p>
		<label>
			Per confermare scrivi <b>{name}</b>
			<!-- svelte-ignore a11y-autofocus -->
			<input type="text" bind:value={typed} disabled={loading} autocomplete="off"
				spellcheck="false" autofocus on:keydown={(e) => e.key === 'Enter' && confirm()} />
		</label>
	</div>
	<svelte:fragment slot="actions">
		<button type="button" class="btn-secondary" on:click={cancel} disabled={loading}>Annulla</button>
		<button type="button" class="btn-primary destructive" on:click={confirm}
			disabled={!matches || loading}>{loading ? 'Esporto ed elimino…' : 'Elimina'}</button>
	</svelte:fragment>
</Modal>

<style>
	.body { display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
	.body p { margin: 0; }
	.export { color: var(--fg-muted); font-size: 12px; }
	label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
	input { font: inherit; font-family: var(--mono); padding: 6px 8px; border: 1px solid var(--border);
		border-radius: 6px; background: var(--bg); color: var(--fg); }
	.btn-primary.destructive { background: var(--danger); color: #fff; border-color: var(--danger); }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
