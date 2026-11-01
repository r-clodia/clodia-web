<script lang="ts">
	/**
	 * The room's trigger (clodia-platform#646): ONE form — when, then prompt,
	 * then agent. «When» is either «every N minutes» (onCron: interval +
	 * repetitions, #239) or «inbox» (onMessageReceived, #628: a message enters
	 * the channel through its own inbox or an authorised mailbox).
	 *
	 * The backend keeps two records (cron trigger, mail trigger); the room has
	 * at most one of them. Switching type saves the new one first and only then
	 * removes the old one, so a failed save never leaves the room without its
	 * trigger. The owner edits; participants see the inbox trigger (the cron
	 * read is owner-only).
	 */
	import { onMount } from 'svelte';
	import {
		deleteTopicCronTrigger,
		deleteTopicMailTrigger,
		getTopicCronTrigger,
		getTopicMailTrigger,
		putTopicCronTrigger,
		putTopicMailTrigger,
		type TopicCronTrigger,
		type TopicMailTrigger
	} from '$lib/api/client';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	export let tier: string;
	export let name: string;
	export let agents: string[] = [];
	export let canEdit = false;

	type Kind = 'cron' | 'inbox';

	/** Floor lato server (clodia-platform#46: ogni fire è un turno agentico).
	 *  Qui è replicato solo per dirlo PRIMA del round trip — la validazione che
	 *  conta resta quella del server, questa è cortesia. */
	const MIN_INTERVAL_MINUTES = 10;
	const TITLE = 'Trigger';
	const STATI: Record<string, string> = {
		ok: 'turno avviato',
		not_started: 'turno non avviato',
		rate_limited: 'limite di 12 turni/ora raggiunto: turno non avviato',
		agent_not_participant: "l'agente non partecipa più alla stanza: turno non avviato"
	};

	let cronTrigger: TopicCronTrigger | null = null;
	let mailTrigger: TopicMailTrigger | null = null;
	let kind: Kind = 'cron';
	let intervalMinutes: number | null = null;
	let repeatCount = 0;
	/** Il cron di un trigger creato prima del #239: sta ancora girando così, e
	 *  resta finché l'owner non salva. Vuoto = trigger già a intervallo. */
	let legacyCron = '';
	let prompt = '';
	let agent = '';
	let enabled = true;
	let loading = true;
	let busy = false;

	function apply(cron: TopicCronTrigger | null, mail: TopicMailTrigger | null) {
		cronTrigger = cron;
		mailTrigger = mail;
		kind = mail && !cron ? 'inbox' : 'cron';
		const isLegacy = !!cron && !cron.interval_minutes && !!cron.cron_expr;
		legacyCron = isLegacy ? cron!.cron_expr : '';
		// Su un legacy pre-compiliamo la cadenza SUGGERITA dal server (può essere
		// null: allora il campo resta vuoto e la sceglie l'owner) e "senza fine",
		// che è ciò che il cron faceva. Nessuno dei due è salvato finché non
		// preme Aggiorna: la sostituzione la decide lui, non l'apertura del form.
		intervalMinutes = cron?.interval_minutes ?? cron?.suggested_interval_minutes ?? null;
		repeatCount = isLegacy ? 0 : (cron?.repeat_count ?? 0);
		const current = cron ?? mail;
		prompt = current?.prompt ?? '';
		agent = current?.agent ?? '';
		enabled = mail?.enabled ?? true;
	}

	/** The record of the type shown in the form, if the room has one. */
	$: current = kind === 'cron' ? cronTrigger : mailTrigger;
	/** The record of the OTHER type: saving replaces it. */
	$: other = kind === 'cron' ? mailTrigger : cronTrigger;
	$: configured = cronTrigger !== null || mailTrigger !== null;

	/** Riepilogo in chiaro di ciò che si sta per salvare: due numeri si
	 *  scambiano senza accorgersene, una frase no. */
	$: riepilogo =
		intervalMinutes && intervalMinutes > 0
			? `Ripeti ogni ${intervalMinutes} minuti ` +
				(repeatCount > 0 ? `per ${repeatCount} volte` : 'senza fine')
			: '';

	/** Avanzamento di un trigger finito: `null` se non c'è niente da contare. */
	$: avanzamento =
		kind === 'cron' && cronTrigger && cronTrigger.interval_minutes && cronTrigger.repeat_count > 0
			? `${cronTrigger.fired_count} di ${cronTrigger.repeat_count} esecuzioni` +
				(cronTrigger.enabled ? '' : ' — completato')
			: null;

	async function load() {
		loading = true;
		try {
			const [cron, mail] = await Promise.all([
				canEdit ? getTopicCronTrigger(tier, name) : Promise.resolve({ trigger: null }),
				getTopicMailTrigger(tier, name)
			]);
			apply(cron.trigger, mail.trigger);
		} catch (error) {
			toastError(TITLE, error instanceof Error ? error.message : String(error));
		} finally {
			loading = false;
		}
	}

	async function save() {
		if (busy || !canEdit) return;
		const text = prompt.trim();
		const minuti = Number(intervalMinutes);
		const volte = Number(repeatCount ?? 0);
		if (kind === 'cron') {
			if (!Number.isInteger(minuti) || minuti < MIN_INTERVAL_MINUTES) {
				toastError(TITLE, `L'intervallo è un numero intero di minuti, almeno ${MIN_INTERVAL_MINUTES}`);
				return;
			}
			if (!Number.isInteger(volte) || volte < 0) {
				toastError(TITLE, 'Le ripetizioni sono un intero ≥ 0 (0 = senza fine)');
				return;
			}
		} else if (!agent) {
			toastError(TITLE, "Scegli l'agente che risponde ai messaggi in arrivo");
			return;
		}
		if (!text) {
			toastError(TITLE, 'Il prompt è obbligatorio');
			return;
		}
		if (other && !confirm('La stanza ha un solo trigger: quello attuale viene sostituito. Procedere?')) {
			return;
		}
		busy = true;
		try {
			const wasConfigured = configured;
			let cron = cronTrigger;
			let mail = mailTrigger;
			if (kind === 'cron') {
				cron = (
					await putTopicCronTrigger(tier, name, {
						interval_minutes: minuti,
						repeat_count: volte,
						prompt: text,
						agent: agent || null
					})
				).trigger;
				if (mail) {
					await deleteTopicMailTrigger(tier, name);
					mail = null;
				}
			} else {
				mail = (await putTopicMailTrigger(tier, name, { agent, prompt: text, enabled })).trigger;
				if (cron) {
					await deleteTopicCronTrigger(tier, name);
					cron = null;
				}
			}
			apply(cron, mail);
			toastSuccess(wasConfigured ? 'Trigger aggiornato' : 'Trigger attivato');
		} catch (error) {
			toastError(TITLE, error instanceof Error ? error.message : String(error));
			await load();
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!configured || busy || !canEdit || !confirm('Rimuovere il trigger di questa stanza?')) return;
		busy = true;
		try {
			if (cronTrigger) await deleteTopicCronTrigger(tier, name);
			if (mailTrigger) await deleteTopicMailTrigger(tier, name);
			apply(null, null);
			toastSuccess('Trigger rimosso');
		} catch (error) {
			toastError(TITLE, error instanceof Error ? error.message : String(error));
			await load();
		} finally {
			busy = false;
		}
	}

	onMount(load);
</script>

<section class="trigger-kind">
	{#if loading}
		<p class="muted">Carico…</p>
	{:else if !canEdit}
		{#if mailTrigger}
			<p class="readonly">
				Inbox — {mailTrigger.enabled ? 'attivo' : 'disattivato'}: @{mailTrigger.agent} — «{mailTrigger.prompt}»
			</p>
		{:else}
			<p class="muted">Nessun trigger sui messaggi in arrivo.</p>
		{/if}
	{:else}
		{#if legacyCron && kind === 'cron'}
			<p class="legacy">
				Questo trigger usa ancora un'espressione cron (<code>{legacyCron}</code>) e
				continua a funzionare così. Salvando la sostituisci con l'intervallo qui
				sotto{intervalMinutes
					? ', già impostato sulla cadenza equivalente'
					: ' — la cadenza di questo cron non ha un equivalente in minuti, scegline una'}.
			</p>
		{/if}
		<form on:submit|preventDefault={save}>
			<div class="riga-label">
				<span>Quando</span>
				<span class="scelta" role="radiogroup" aria-label="Tipo di trigger">
					<label class="opzione">
						<input type="radio" bind:group={kind} value="cron" disabled={busy} />
						Ogni N minuti
					</label>
					<label class="opzione">
						<input type="radio" bind:group={kind} value="inbox" disabled={busy} />
						Inbox
						<button type="button" class="info" aria-label="Informazioni sul trigger inbox">
							<span aria-hidden="true">ⓘ</span>
							<span class="tooltip" role="tooltip">
								Parte un turno dell'agente scelto quando un messaggio entra nel canale:
								dall'inbox di canale o da una casella di posta autorizzata. Un turno per
								giro di posta, massimo 12 all'ora. Le mail restano contenuto non fidato.
							</span>
						</button>
					</label>
				</span>
			</div>
			{#if kind === 'cron'}
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
						<em>minuti, per</em>
						<input
							type="number"
							bind:value={repeatCount}
							min="0"
							step="1"
							placeholder="4"
							autocomplete="off"
							disabled={busy}
							aria-label="Ripetizioni (0 = senza fine)"
						/>
						<em>volte</em>
					</span>
				</label>
				{#if riepilogo}
					<p class="riepilogo">{riepilogo} (min. {MIN_INTERVAL_MINUTES} minuti; 0 volte = senza fine)</p>
				{/if}
			{/if}
			<label>
				<span>Prompt</span>
				<textarea
					bind:value={prompt}
					rows="3"
					placeholder={kind === 'cron'
						? 'Messaggio da pubblicare nel canale'
						: 'Es. Leggi la posta appena arrivata e proponi una risposta'}
					disabled={busy}
				></textarea>
			</label>
			<label>
				<span>Agente</span>
				<select bind:value={agent} disabled={busy}>
					{#if kind === 'cron'}
						<option value="">Routing automatico</option>
					{:else}
						<option value="" disabled>Scegli…</option>
					{/if}
					{#each agents as candidate}
						<option value={candidate}>{candidate}</option>
					{/each}
				</select>
			</label>
			{#if kind === 'inbox'}
				<label class="check">
					<span>Stato</span>
					<span class="numero">
						<input type="checkbox" bind:checked={enabled} disabled={busy} />
						<em>Attivo</em>
					</span>
				</label>
			{/if}
			<div class="actions">
				<button class="save" type="submit" disabled={busy}>
					{busy ? '…' : current ? 'Aggiorna' : 'Attiva'}
				</button>
				{#if configured}
					<button class="remove" type="button" on:click={remove} disabled={busy}>
						Rimuovi
					</button>
				{/if}
			</div>
		</form>
		{#if avanzamento}
			<p class="status">{avanzamento}</p>
		{/if}
	{/if}
	{#if !loading && current?.last_run_at}
		<p class="status" title={current.last_status ?? ''}>
			Ultimo avvio {new Date(current.last_run_at).toLocaleString()}
			{#if kind === 'inbox' && current.last_status}— {STATI[current.last_status] ?? current.last_status}{/if}
		</p>
	{/if}
</section>

<style>
	.trigger-kind { min-width: 0; }
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
	label, .riga-label { display: grid; grid-template-columns: 74px minmax(0, 1fr); align-items: start; gap: 7px; font-size: 11px; color: var(--fg-muted); }
	label > span, .riga-label > span:first-child { padding-top: 5px; }
	.scelta { display: flex; flex-wrap: wrap; gap: 4px 12px; padding-top: 4px; }
	label.opzione { display: flex; align-items: center; gap: 5px; color: var(--fg); }
	label.opzione input { width: auto; margin: 0; }
	input, textarea, select {
		box-sizing: border-box; min-width: 0; width: 100%; border: 1px solid var(--border);
		border-radius: 6px; padding: 5px 7px; background: var(--bg); color: var(--fg);
		font: inherit; font-size: 11px;
	}
	textarea { resize: vertical; line-height: 1.35; }
	input:focus, textarea:focus, select:focus { border-color: var(--accent); outline: none; }
	input:disabled, textarea:disabled, select:disabled { opacity: .55; }
	.check input { width: auto; margin: 0; }
	.actions { display: flex; justify-content: flex-end; gap: 6px; }
	button { border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; background: transparent; color: var(--fg); font: inherit; font-size: 11px; cursor: pointer; }
	button.save { border-color: var(--accent); background: var(--accent); color: var(--accent-fg); font-weight: 700; }
	button.remove:hover { border-color: var(--danger); color: var(--danger); }
	button:disabled { cursor: default; opacity: .5; }
	.numero { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
	.numero input { width: 5.5em; flex: 0 0 auto; }
	.numero em { color: var(--fg-muted); font-size: 11px; font-style: normal; }
	.legacy {
		margin: 8px 0 0; border: 1px solid var(--border); border-left: 3px solid var(--accent);
		border-radius: 6px; padding: 6px 8px; color: var(--fg-muted);
		font-size: 11px; line-height: 1.4;
	}
	.legacy code { color: var(--fg); font-size: 11px; }
	.riepilogo { margin: 0; color: var(--fg); font-size: 11px; }
	.muted, .status, .readonly { margin: 7px 0 0; color: var(--fg-muted); font-size: 11px; line-height: 1.4; }
	.readonly { color: var(--fg); overflow-wrap: anywhere; }
	.status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	@media (max-width: 480px) {
		label, .riga-label { grid-template-columns: 1fr; gap: 3px; }
		label > span, .riga-label > span:first-child { padding-top: 0; }
	}
</style>
