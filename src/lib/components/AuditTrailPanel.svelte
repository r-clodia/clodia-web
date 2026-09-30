<script lang="ts">
	/*
	 * The admin's view of the audit trail (clodia-platform#447): is it healthy,
	 * is there an off-system copy that makes a cut tail detectable, and a
	 * signed export for an auditor. The export verifies offline with the
	 * verifier it carries (`python -m verifier.verify .`), and is itself
	 * recorded on the trail.
	 */
	import { onMount } from 'svelte';
	import { ApiError, downloadAuditExport, getAuditStatus, type AuditStatus } from '$lib/api/client';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	let status: AuditStatus | null = null;
	let loadError = '';
	let since = '';
	let until = '';
	let purpose = '';
	let exporting = false;

	async function load() {
		try {
			status = await getAuditStatus();
			loadError = '';
		} catch (e) {
			loadError = e instanceof ApiError ? e.message : String(e);
		}
	}

	async function doExport() {
		exporting = true;
		try {
			await downloadAuditExport({
				since: since || undefined,
				until: until || undefined,
				purpose: purpose || undefined
			});
			toastSuccess('Export del registro', 'pacchetto firmato scaricato; l’export è registrato');
			await load();
		} catch (e) {
			toastError('Export non riuscito', e instanceof ApiError ? e.message : String(e));
		} finally {
			exporting = false;
		}
	}

	onMount(load);
</script>

<section class="card audit" data-testid="audit-trail-panel">
	<header><h2>Registro di audit</h2></header>
	{#if loadError}
		<p class="warn">Stato non disponibile: {loadError}</p>
	{:else if status}
		<ul class="facts">
			<li>
				Stato: <strong class={status.ok ? 'run-ok' : 'run-fail'}>{status.ok ? 'integro' : 'con errori'}</strong>
				{#if status.failures}— {status.failures} scritture non riuscite{#if status.last_error}: {status.last_error}{/if}{/if}
			</li>
			<li>Eventi: {status.events ?? 0}{#if status.key_id} · chiave {status.key_id}{/if}</li>
			<li>
				{#if status.isolated}Volume del solo gateway
				{:else}<span class="warn">Il registro è sul volume condiviso con l’agent-server: non è indipendente</span>{/if}
			</li>
			<li>
				{#if status.off_system}Copia fuori sistema dei checkpoint: attiva
				{:else}<span class="warn">Nessuna copia fuori sistema dei checkpoint: un taglio della coda non sarebbe rilevabile</span>{/if}
				{#if status.last_checkpoint} · ultimo checkpoint #{status.last_checkpoint.seq}, {new Date(status.last_checkpoint.timestamp).toLocaleString('it-IT')}{/if}
				{#if status.unanchored_events} · {status.unanchored_events} eventi dopo l’ultimo checkpoint{/if}
			</li>
			{#if status.fail_closed}<li>Modalità fail-closed: un’azione che non si può registrare non viene eseguita</li>{/if}
		</ul>
	{:else}
		<p>Caricamento…</p>
	{/if}

	<form class="export" on:submit|preventDefault={doExport}>
		<label>Dal <input type="date" bind:value={since} /></label>
		<label>Al <input type="date" bind:value={until} /></label>
		<label class="purpose">Motivo <input type="text" bind:value={purpose} placeholder="es. audit di sorveglianza ISO 27001" /></label>
		<button class="btn" type="submit" disabled={exporting}>{exporting ? 'Export in corso…' : 'Esporta pacchetto firmato'}</button>
	</form>
	<p class="hint">Il pacchetto contiene i segmenti del periodo, la chiave pubblica, i checkpoint, un manifest firmato e il verificatore: <code>python -m verifier.verify .</code> dopo averlo estratto.</p>
</section>

<style>
	.facts { margin: 0.5rem 0 1rem; padding-left: 1.1rem; }
	.facts li { margin: 0.2rem 0; }
	.warn { color: var(--warn, #b45309); }
	.export { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: flex-end; }
	.export label { display: flex; flex-direction: column; font-size: 0.85rem; gap: 0.2rem; }
	.export .purpose { flex: 1 1 16rem; }
	.export .purpose input { width: 100%; }
	.hint { font-size: 0.8rem; opacity: 0.8; margin-top: 0.6rem; }
	.run-ok { color: var(--ok, #15803d); }
	.run-fail { color: var(--danger, #b91c1c); }
</style>
