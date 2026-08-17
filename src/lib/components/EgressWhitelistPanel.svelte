<script lang="ts">
	/**
	 * Riepilogo delle destinazioni e fonti censite, con il link alla pagina.
	 *
	 * Prima questo pannello stampava le due liste INTERE dentro `/settings`. Con
	 * 48 fonti era già una parete di testo; l'owner l'ha detto il 17 ago 2026:
	 * «la pagina egress/ingress in settings deve essere separata e navigabile,
	 * potrebbe contenere centinaia di elementi».
	 *
	 * Quindi qui resta ciò che una pagina di impostazioni deve dire — il MODO del
	 * confinamento, che è una decisione, e quante voci ci sono, che dice se
	 * qualcuno le sta usando — e gli elenchi vivono in `/settings/egress`, dove si
	 * cercano e si filtrano.
	 *
	 * Il modo resta qui e non solo là perché è l'unica di queste informazioni che
	 * cambia il comportamento del sistema: `off` significa che nessuna delle due
	 * liste ha effetto, e chi apre le impostazioni deve vederlo senza navigare.
	 */
	import { onMount } from 'svelte';
	import { getEgressWhitelist } from '$lib/api/client';

	let mode = 'unknown';
	let nEgress = 0;
	let nSource = 0;
	let loading = true;
	let err = '';

	const MODE_LABEL: Record<string, string> = {
		gate: 'chiede — una destinazione nuova passa da un’approvazione, e approvando resta',
		on: 'nega — una destinazione fuori lista è rifiutata senza chiedere',
		report: 'osserva — decide e registra, non blocca nulla',
		off: 'spento — nessun controllo sulle destinazioni',
		unknown: 'non leggibile dal gateway'
	};

	onMount(async () => {
		try {
			const r = await getEgressWhitelist();
			mode = r.mode ?? 'unknown';
			nEgress = (r.egress_allow ?? []).length;
			nSource = (r.source_allow ?? []).length;
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	});
</script>

<div class="card-h">
	<h2>Destinazioni e fonti</h2>
	{#if err}
		<p class="err">Non leggibile: {err}</p>
	{:else if loading}
		<p class="muted">Carico…</p>
	{:else}
		<p class="mode">
			Confinamento delle uscite: <strong>{mode}</strong> — {MODE_LABEL[mode] ?? MODE_LABEL.unknown}
		</p>
		<p class="conte">
			<a href="/settings/egress">
				<strong>{nEgress}</strong> destinazioni in uscita · <strong>{nSource}</strong> fonti in ingresso →
			</a>
		</p>
		{#if mode === 'off'}
			<p class="avviso">
				Con il modo <strong>off</strong> nessuna delle due liste ha effetto: le
				voci restano scritte e non vengono consultate.
			</p>
		{/if}
	{/if}
</div>

<style>
	.mode { font-size: 12px; opacity: 0.85; margin: 0 0 6px; line-height: 1.5; }
	.conte { font-size: 13px; margin: 0; }
	.conte a { text-decoration: none; }
	.conte a:hover { text-decoration: underline; }
	.avviso { font-size: 12px; opacity: 0.9; margin: 8px 0 0; line-height: 1.5; }
	.muted { font-size: 13px; opacity: 0.8; }
	.err { font-size: 13px; color: #f87171; }
</style>
