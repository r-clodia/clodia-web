<script lang="ts">
	/**
	 * Whitelist delle destinazioni in uscita, per agente e per tipo
	 * (clodia-platform#104 §7).
	 *
	 * SOLA LETTURA, e non per pigrizia: aggiungere una destinazione è più
	 * privilegiato del singolo invio, perché la rende silenziosa per sempre — e il
	 * posto giusto per concederla è il dialog che compare quando serve, dove
	 * l'informazione è completa («@clodia vuole scrivere a X»). Un campo di testo
	 * in una pagina di impostazioni è il posto in cui si incolla una lista senza
	 * guardarla.
	 *
	 * Qui si vede cosa è stato concesso e come — che è la domanda che un'ora di
	 * lavoro con la modalità di osservazione fa venire in mente.
	 */
	import { onMount } from 'svelte';
	import { getEgressWhitelist } from '$lib/api/client';

	let mode = 'unknown';
	let egressAllow: string[] = [];
	let sourceAllow: string[] = [];
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
			egressAllow = r.egress_allow ?? [];
			sourceAllow = r.source_allow ?? [];
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	});

</script>

<div class="card-h">
	<h2>Destinazioni e fonti</h2>
	<span class="mode mode-{mode}">{mode}</span>
</div>
<p class="hint">{MODE_LABEL[mode] ?? mode}</p>

{#if loading}
	<p class="hint">caricamento…</p>
{:else if err}
	<p class="hint err">⚠ {err}</p>
{:else}
	<h3>In uscita — dove gli agenti possono scrivere</h3>
	{#if !egressAllow.length}
		<p class="hint">
			Nessuna destinazione dichiarata. È il punto di partenza previsto: la lista è
			<em>opt-in</em> e si popola con l’uso — la prima volta che un agent scrive a
			un indirizzo nuovo ti viene chiesto, e approvando la destinazione resta
			<strong>per tutti</strong>: è la destinazione che giudichi, non chi spedisce.
		</p>
	{:else}
		<ul class="uris">
			{#each egressAllow as u}
				<li><code class:wide={u === '*'}>{u}</code></li>
			{/each}
		</ul>
	{/if}

	<h3>In ingresso — fonti che non contaminano</h3>
	{#if !sourceAllow.length}
		<p class="hint">
			Nessuna fonte fidata. Ogni lettura contamina il canale, e la prima uscita
			successiva chiede conferma. Questa lista va tenuta <em>piccola e statica</em>:
			sbagliare qui è silenzioso — un taint che non si accende non lo vedi.
		</p>
	{:else}
		<ul class="uris">
			{#each sourceAllow as u}
				<li><code>{u}</code></li>
			{/each}
		</ul>
	{/if}
{/if}

<p class="hint dim">
	Notazione URI: lo schema <em>è</em> il tipo — <code>mailto:</code>
	<code>tg:</code> <code>https://</code> <code>gdrive:</code>
	<code>gsheets:</code> in uscita, <code>mailfrom:</code> e <code>https://</code>
	come fonte. Liste separate di proposito: un errore su una destinazione è
	rumoroso, uno su una fonte è silenzioso.
</p>

<style>
	.card-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	h2 { margin: 0; font-size: 15px; }
	.mode { font-family: ui-monospace, monospace; font-size: 11px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--fg-muted); }
	.mode-gate { color: #d97706; border-color: #d97706; }
	.mode-off, .mode-report { color: var(--fg-muted); }
	.hint { font-size: 12px; color: var(--fg-muted); line-height: 1.5; margin: 6px 0 0; }
	.hint.err { color: var(--danger); }
	.hint.dim { opacity: .8; margin-top: 12px; }
	h3 { margin: 14px 0 4px; font-size: 12px; font-weight: 600; color: var(--fg-muted); }
	.uris { list-style: none; padding: 0; margin: 4px 0 0; display: flex; flex-direction: column; gap: 2px; }
	code { font-size: 11px; padding: 1px 5px; margin-right: 4px; background: var(--code-bg, rgba(127,127,127,.12)); border-radius: 4px; }
	code.wide { color: #d97706; }
</style>
