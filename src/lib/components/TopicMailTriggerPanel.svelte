<script lang="ts">
	/**
	 * Channel trigger «incoming mail» (clodia-platform#628): when the mail
	 * courier delivers mail into this room — a linked mailbox or the room's own
	 * address — ONE turn of the chosen agent starts, with the owner's prompt and
	 * the list of the mail just delivered. At most 12 an hour per room.
	 * The owner edits; participants see it.
	 */
	import { onMount } from 'svelte';
	import {
		deleteTopicMailTrigger,
		getTopicMailTrigger,
		putTopicMailTrigger,
		type TopicMailTrigger
	} from '$lib/api/client';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	export let tier: string;
	export let name: string;
	export let agents: string[] = [];
	export let canEdit = false;

	const TITLE = 'Trigger posta in arrivo';
	const STATI: Record<string, string> = {
		ok: 'turno avviato',
		not_started: 'turno non avviato',
		rate_limited: 'limite di 12 turni/ora raggiunto: turno non avviato',
		agent_not_participant: "l'agente non partecipa più alla stanza: turno non avviato"
	};

	let trigger: TopicMailTrigger | null = null;
	let agent = '';
	let prompt = '';
	let enabled = true;
	let loading = true;
	let busy = false;

	function apply(value: TopicMailTrigger | null) {
		trigger = value;
		agent = value?.agent ?? '';
		prompt = value?.prompt ?? '';
		enabled = value?.enabled ?? true;
	}

	async function load() {
		loading = true;
		try {
			apply((await getTopicMailTrigger(tier, name)).trigger);
		} catch (error) {
			toastError(TITLE, error instanceof Error ? error.message : String(error));
		} finally {
			loading = false;
		}
	}

	async function save() {
		if (busy || !canEdit) return;
		const text = prompt.trim();
		if (!agent) {
			toastError(TITLE, "Scegli l'agente che risponde alla posta");
			return;
		}
		if (!text) {
			toastError(TITLE, 'Il prompt è obbligatorio');
			return;
		}
		busy = true;
		try {
			const wasConfigured = trigger !== null;
			apply((await putTopicMailTrigger(tier, name, { agent, prompt: text, enabled })).trigger);
			toastSuccess(wasConfigured ? 'Trigger posta aggiornato' : 'Trigger posta attivato');
		} catch (error) {
			toastError(TITLE, error instanceof Error ? error.message : String(error));
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!trigger || busy || !canEdit) return;
		if (!confirm('Rimuovere il trigger «posta in arrivo» di questo topic?')) return;
		busy = true;
		try {
			await deleteTopicMailTrigger(tier, name);
			apply(null);
			toastSuccess('Trigger posta rimosso');
		} catch (error) {
			toastError(TITLE, error instanceof Error ? error.message : String(error));
		} finally {
			busy = false;
		}
	}

	onMount(load);
</script>

<section class="trigger-kind mail">
	<header>
		<span>Posta in arrivo</span>
		<button type="button" class="info" aria-label="Informazioni sul trigger posta in arrivo">
			<span aria-hidden="true">ⓘ</span>
			<span class="tooltip" role="tooltip">
				Parte un turno dell'agente scelto quando il corriere consegna mail in questa
				stanza: casella collegata o indirizzo di stanza. Un turno per giro di posta,
				massimo 12 all'ora. Le mail restano contenuto non fidato.
			</span>
		</button>
	</header>

	{#if loading}
		<p class="muted">Carico…</p>
	{:else if !canEdit}
		{#if trigger}
			<p class="readonly">
				{trigger.enabled ? 'Attivo' : 'Disattivato'}: @{trigger.agent} — «{trigger.prompt}»
			</p>
		{:else}
			<p class="muted">Nessun trigger sulla posta in arrivo.</p>
		{/if}
	{:else}
		<form on:submit|preventDefault={save}>
			<label>
				<span>Agente</span>
				<select bind:value={agent} disabled={busy}>
					<option value="" disabled>Scegli…</option>
					{#each agents as candidate}
						<option value={candidate}>{candidate}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>Prompt</span>
				<textarea
					bind:value={prompt}
					rows="3"
					placeholder="Es. Leggi la posta appena arrivata e proponi una risposta"
					disabled={busy}
				></textarea>
			</label>
			<label class="check">
				<span>Stato</span>
				<span class="riga">
					<input type="checkbox" bind:checked={enabled} disabled={busy} />
					<em>Attivo</em>
				</span>
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
	{/if}
	{#if trigger?.last_run_at}
		<p class="status" title={trigger.last_status ?? ''}>
			Ultimo: {new Date(trigger.last_run_at).toLocaleString()}
			{#if trigger.last_status}— {STATI[trigger.last_status] ?? trigger.last_status}{/if}
		</p>
	{/if}
</section>

<style>
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
	textarea, select {
		box-sizing: border-box; min-width: 0; width: 100%; border: 1px solid var(--border);
		border-radius: 6px; padding: 5px 7px; background: var(--bg); color: var(--fg);
		font: inherit; font-size: 11px;
	}
	textarea { resize: vertical; line-height: 1.35; }
	textarea:focus, select:focus { border-color: var(--accent); outline: none; }
	textarea:disabled, select:disabled { opacity: .55; }
	.riga { display: flex; align-items: center; gap: 6px; }
	.riga em { color: var(--fg-muted); font-size: 11px; font-style: normal; }
	.check input { width: auto; margin: 0; }
	.actions { display: flex; justify-content: flex-end; gap: 6px; }
	button { border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; background: transparent; color: var(--fg); font: inherit; font-size: 11px; cursor: pointer; }
	button.save { border-color: var(--accent); background: var(--accent); color: var(--accent-fg); font-weight: 700; }
	button.remove:hover { border-color: var(--danger); color: var(--danger); }
	button:disabled { cursor: default; opacity: .5; }
	.muted, .status, .readonly { margin: 7px 0 0; color: var(--fg-muted); font-size: 11px; line-height: 1.4; }
	.readonly { color: var(--fg); overflow-wrap: anywhere; }
	.status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	@media (max-width: 480px) {
		label { grid-template-columns: 1fr; gap: 3px; }
		label > span { padding-top: 0; }
	}
</style>
