<script lang="ts">
	import { onMount } from 'svelte';
	import {
		deleteTopicCronTrigger,
		getTopicCronTrigger,
		putTopicCronTrigger,
		type TopicCronTrigger
	} from '$lib/api/client';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	export let tier: string;
	export let name: string;
	export let agents: string[] = [];

	/** Floor lato server (clodia-platform#46: ogni fire è un turno agentico).
	 *  Qui è replicato solo per dirlo PRIMA del round trip — la validazione che
	 *  conta resta quella del server, questa è cortesia. */
	const MIN_INTERVAL_MINUTES = 10;

	let trigger: TopicCronTrigger | null = null;
	let intervalMinutes: number | null = null;
	let repeatCount = 0;
	/** Il cron di un trigger creato prima del #239: sta ancora girando così, e
	 *  resta finché l'owner non salva. Vuoto = trigger già a intervallo. */
	let legacyCron = '';
	let prompt = '';
	let agent = '';
	let loading = true;
	let busy = false;

	function applyTrigger(value: TopicCronTrigger | null) {
		trigger = value;
		const isLegacy = !!value && !value.interval_minutes && !!value.cron_expr;
		legacyCron = isLegacy ? value!.cron_expr : '';
		// Su un legacy pre-compiliamo la cadenza SUGGERITA dal server (può essere
		// null: allora il campo resta vuoto e la sceglie l'owner) e "senza fine",
		// che è ciò che il cron faceva. Nessuno dei due è salvato finché non
		// preme Aggiorna: la sostituzione la decide lui, non l'apertura del form.
		intervalMinutes = value?.interval_minutes ?? value?.suggested_interval_minutes ?? null;
		repeatCount = isLegacy ? 0 : (value?.repeat_count ?? 0);
		prompt = value?.prompt ?? '';
		agent = value?.agent ?? '';
	}

	/** Riepilogo in chiaro di ciò che si sta per salvare: due numeri si
	 *  scambiano senza accorgersene, una frase no. */
	$: riepilogo =
		intervalMinutes && intervalMinutes > 0
			? `Ripeti ogni ${intervalMinutes} minuti ` +
				(repeatCount > 0 ? `per ${repeatCount} volte` : 'senza fine')
			: '';

	/** Avanzamento di un trigger finito: `null` se non c'è niente da contare. */
	$: avanzamento =
		trigger && trigger.interval_minutes && trigger.repeat_count > 0
			? `${trigger.fired_count} di ${trigger.repeat_count} esecuzioni` +
				(trigger.enabled ? '' : ' — completato')
			: null;

	async function load() {
		loading = true;
		try {
			const result = await getTopicCronTrigger(tier, name);
			applyTrigger(result.trigger);
		} catch (error) {
			toastError('Trigger cron', error instanceof Error ? error.message : String(error));
		} finally {
			loading = false;
		}
	}

	async function save() {
		if (busy) return;
		const minuti = Number(intervalMinutes);
		const volte = Number(repeatCount ?? 0);
		const text = prompt.trim();
		if (!Number.isInteger(minuti) || minuti < MIN_INTERVAL_MINUTES) {
			toastError(
				'Trigger cron',
				`L'intervallo è un numero intero di minuti, almeno ${MIN_INTERVAL_MINUTES}`
			);
			return;
		}
		if (!Number.isInteger(volte) || volte < 0) {
			toastError('Trigger cron', 'Le ripetizioni sono un intero ≥ 0 (0 = senza fine)');
			return;
		}
		if (!text) {
			toastError('Trigger cron', 'Il prompt è obbligatorio');
			return;
		}
		busy = true;
		try {
			const wasConfigured = trigger !== null;
			const result = await putTopicCronTrigger(tier, name, {
				interval_minutes: minuti,
				repeat_count: volte,
				prompt: text,
				agent: agent || null
			});
			applyTrigger(result.trigger);
			toastSuccess(wasConfigured ? 'Trigger cron aggiornato' : 'Trigger cron attivato');
		} catch (error) {
			toastError('Trigger cron', error instanceof Error ? error.message : String(error));
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!trigger || busy || !confirm('Rimuovere il trigger cron di questo topic?')) return;
		busy = true;
		try {
			await deleteTopicCronTrigger(tier, name);
			applyTrigger(null);
			toastSuccess('Trigger cron rimosso');
		} catch (error) {
			toastError('Trigger cron', error instanceof Error ? error.message : String(error));
		} finally {
			busy = false;
		}
	}

	onMount(load);
</script>

<div class="triggers">
	<section class="trigger-kind cron">
		<header>
			<span>Cron</span>
			<button type="button" class="info" aria-label="Informazioni sul trigger cron">
				<span aria-hidden="true">ⓘ</span>
				<span class="tooltip" role="tooltip">
					Posta il prompt nel topic ogni N minuti, per il numero di ripetizioni
					indicato (0 = senza fine). Se scegli un agente, il messaggio lo menziona
					direttamente; altrimenti usa il routing normale.
				</span>
			</button>
		</header>

		{#if loading}
			<p class="muted">Carico…</p>
		{:else}
			{#if legacyCron}
				<p class="legacy">
					Questo trigger usa ancora un'espressione cron (<code>{legacyCron}</code>) e
					continua a funzionare così. Salvando la sostituisci con l'intervallo qui
					sotto{intervalMinutes
						? ', già impostato sulla cadenza equivalente'
						: ' — la cadenza di questo cron non ha un equivalente in minuti, scegline una'}.
				</p>
			{/if}
			<form on:submit|preventDefault={save}>
				<label>
					<span>Ogni</span>
					<span class="numero">
						<input
							type="number"
							bind:value={intervalMinutes}
							min={MIN_INTERVAL_MINUTES}
							step="1"
							placeholder="30"
							autocomplete="off"
							disabled={busy}
						/>
						<em>minuti (min. {MIN_INTERVAL_MINUTES})</em>
					</span>
				</label>
				<label>
					<span>Ripetizioni</span>
					<span class="numero">
						<input
							type="number"
							bind:value={repeatCount}
							min="0"
							step="1"
							placeholder="4"
							autocomplete="off"
							disabled={busy}
						/>
						<em>volte (0 = senza fine)</em>
					</span>
				</label>
				{#if riepilogo}
					<p class="riepilogo">{riepilogo}</p>
				{/if}
				<label>
					<span>Prompt</span>
					<textarea
						bind:value={prompt}
						rows="3"
						placeholder="Messaggio da pubblicare nel topic"
						disabled={busy}
					></textarea>
				</label>
				<label>
					<span>Agente</span>
					<select bind:value={agent} disabled={busy}>
						<option value="">Routing automatico</option>
						{#each agents as candidate}
							<option value={candidate}>{candidate}</option>
						{/each}
					</select>
				</label>
				<div class="actions">
					<button class="save" type="submit" disabled={busy}>
						{busy ? '…' : trigger ? 'Aggiorna' : 'Attiva'}
					</button>
					{#if trigger}
						<button class="remove" type="button" on:click={remove} disabled={busy}>
							Rimuovi
						</button>
					{/if}
				</div>
			</form>
			{#if avanzamento}
				<p class="status">{avanzamento}</p>
			{/if}
			{#if trigger?.last_run_at}
				<p class="status" title={trigger.last_status ?? ''}>
					Ultimo avvio {new Date(trigger.last_run_at).toLocaleString()}
				</p>
			{/if}
		{/if}
	</section>
</div>

<style>
	.triggers { display: flex; min-width: 0; flex-direction: column; gap: 12px; }
	.trigger-kind { min-width: 0; }
	header { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 700; }
	.info { position: relative; border: 0; padding: 0; background: none; color: var(--fg-muted); cursor: help; font: inherit; line-height: 1; outline: none; }
	.info:hover, .info:focus { color: var(--accent); }
	.tooltip {
		position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; display: none;
		width: min(240px, 70vw); padding: 7px 8px; border: 1px solid var(--border);
		border-radius: 6px; background: var(--card-bg); color: var(--fg);
		font-size: 11px; font-weight: 400; line-height: 1.35; box-shadow: 0 6px 18px rgba(0,0,0,.28);
	}
	.info:hover .tooltip, .info:focus .tooltip { display: block; }
	form { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
	label { display: grid; grid-template-columns: 74px minmax(0, 1fr); align-items: start; gap: 7px; font-size: 11px; color: var(--fg-muted); }
	label > span { padding-top: 5px; }
	input, textarea, select {
		box-sizing: border-box; min-width: 0; width: 100%; border: 1px solid var(--border);
		border-radius: 6px; padding: 5px 7px; background: var(--bg); color: var(--fg);
		font: inherit; font-size: 11px;
	}
	textarea { resize: vertical; line-height: 1.35; }
	input:focus, textarea:focus, select:focus { border-color: var(--accent); outline: none; }
	input:disabled, textarea:disabled, select:disabled { opacity: .55; }
	.actions { display: flex; justify-content: flex-end; gap: 6px; }
	button { border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; background: transparent; color: var(--fg); font: inherit; font-size: 11px; cursor: pointer; }
	button.save { border-color: var(--accent); background: var(--accent); color: var(--accent-fg); font-weight: 700; }
	button.remove:hover { border-color: var(--danger); color: var(--danger); }
	button:disabled { cursor: default; opacity: .5; }
	.numero { display: flex; align-items: center; gap: 6px; min-width: 0; }
	.numero input { width: 5.5em; flex: 0 0 auto; }
	.numero em { color: var(--fg-muted); font-size: 11px; font-style: normal; }
	.legacy {
		margin: 8px 0 0; border: 1px solid var(--border); border-left: 3px solid var(--accent);
		border-radius: 6px; padding: 6px 8px; color: var(--fg-muted);
		font-size: 11px; line-height: 1.4;
	}
	.legacy code { color: var(--fg); font-size: 11px; }
	.riepilogo { margin: 0; color: var(--fg); font-size: 11px; }
	.muted, .status { margin: 7px 0 0; color: var(--fg-muted); font-size: 11px; }
	.status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	@media (max-width: 480px) {
		label { grid-template-columns: 1fr; gap: 3px; }
		label > span { padding-top: 0; }
	}
</style>
