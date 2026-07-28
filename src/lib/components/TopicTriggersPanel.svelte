<script lang="ts">
	import { onMount } from 'svelte';
	import HooksPanel from '$lib/components/HooksPanel.svelte';
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

	let trigger: TopicCronTrigger | null = null;
	let cronExpr = '';
	let prompt = '';
	let agent = '';
	let loading = true;
	let busy = false;

	function applyTrigger(value: TopicCronTrigger | null) {
		trigger = value;
		cronExpr = value?.cron_expr ?? '';
		prompt = value?.prompt ?? '';
		agent = value?.agent ?? '';
	}

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
		const cron = cronExpr.trim();
		const text = prompt.trim();
		if (!cron || !text) {
			toastError('Trigger cron', 'Periodicità e prompt sono obbligatori');
			return;
		}
		busy = true;
		try {
			const wasConfigured = trigger !== null;
			const result = await putTopicCronTrigger(tier, name, {
				cron_expr: cron,
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
	<section class="trigger-kind">
		<HooksPanel {tier} {name} showHeading={false} />
	</section>

	<section class="trigger-kind cron">
		<header>
			<span>Cron</span>
			<button type="button" class="info" aria-label="Informazioni sul trigger cron">
				<span aria-hidden="true">ⓘ</span>
				<span class="tooltip" role="tooltip">
					Posta periodicamente il prompt nel topic. Se scegli un agente, il messaggio
					lo menziona direttamente; altrimenti usa il routing normale.
				</span>
			</button>
		</header>

		{#if loading}
			<p class="muted">Carico…</p>
		{:else}
			<form on:submit|preventDefault={save}>
				<label>
					<span>Periodicità</span>
					<input
						type="text"
						bind:value={cronExpr}
						placeholder="*/30 * * * *"
						autocomplete="off"
						spellcheck="false"
						disabled={busy}
					/>
				</label>
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
						{busy ? '…' : trigger ? 'Aggiorna' : 'Attiva cron'}
					</button>
					{#if trigger}
						<button class="remove" type="button" on:click={remove} disabled={busy}>
							Rimuovi
						</button>
					{/if}
				</div>
			</form>
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
	.trigger-kind + .trigger-kind { border-top: 1px solid var(--border); padding-top: 10px; }
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
	.muted, .status { margin: 7px 0 0; color: var(--fg-muted); font-size: 11px; }
	.status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	@media (max-width: 480px) {
		label { grid-template-columns: 1fr; gap: 3px; }
		label > span { padding-top: 0; }
	}
</style>
