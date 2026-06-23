<script lang="ts">
	/**
	 * Job form modal — used both for "Crea job" and "Modifica job".
	 *
	 * Mode is controlled by the `mode` prop:
	 *   - `create` → calls `createJob(body)` on submit, body has all required fields
	 *   - `edit`   → calls `updateJob(id, partial)` with the diff vs. the
	 *                initial values (so the PATCH only carries what changed)
	 *
	 * Fields (mirror agent-server JobCreate / JobUpdate schema):
	 *   - name       string, 1–200 chars (required)
	 *   - cron_expr  string, standard 5-field cron (required)
	 *   - prompt     string, ≥1 char (required) — what the scheduler enqueues
	 *   - enabled    boolean (defaults true server-side)
	 *
	 * Single state machine: `submitting` blocks the Submit button (no double
	 * fire), the dialog itself is non-dismissable while submitting. Errors
	 * surface inline below the form + as a toast (toast is the persistent
	 * confirmation in case the user closes the form before reading).
	 */
	import { createEventDispatcher } from 'svelte';
	import Modal from './Modal.svelte';
	import {
		ApiError,
		createJob,
		getAgents,
		parseSchedule,
		updateJob
	} from '$lib/api/client';
	import type { Agent, Job, JobCreate, JobUpdate } from '$lib/api/types';
	import { toastSuccess, toastError } from '$lib/stores/toasts';

	export let open: boolean = false;
	export let mode: 'create' | 'edit' = 'create';
	/** When `mode === 'edit'`, the existing job — pre-fills the form. */
	export let initial: Job | null = null;

	const dispatch = createEventDispatcher<{
		close: void;
		saved: { mode: 'create' | 'edit'; job?: Job };
	}>();

	// Form state ---------------------------------------------------------
	let name = '';
	let cronExpr = '';
	let prompt = '';
	let agent = 'clodia';
	let enabled = true;

	// Periodicità in linguaggio naturale → cron (preview live via backend).
	let scheduleText = '';
	let schedulePreview: { cron: string; description: string } | null = null;
	let scheduleErr = '';
	let showAdvancedCron = false;
	let parseTimer: ReturnType<typeof setTimeout> | null = null;

	function onScheduleInput() {
		schedulePreview = null;
		scheduleErr = '';
		if (parseTimer) clearTimeout(parseTimer);
		const text = scheduleText.trim();
		if (!text) return;
		parseTimer = setTimeout(async () => {
			try {
				const r = await parseSchedule(text);
				schedulePreview = { cron: r.cron_expr, description: r.description };
				cronExpr = r.cron_expr; // il cron risolto alimenta il submit
			} catch (e) {
				scheduleErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
			}
		}, 350);
	}

	// Agent (kind) che lo scheduler spawnerà al fire — popolato da GET /api/agents.
	let agents: ReadonlyArray<Agent> = [];
	let agentsLoading = false;

	let submitting = false;
	let error: string | null = null;

	// Capture the initial snapshot so we can compute a diff for PATCH.
	let initialSnapshot: {
		name: string;
		cronExpr: string;
		prompt: string;
		agent: string;
		enabled: boolean;
	} = {
		name: '',
		cronExpr: '',
		prompt: '',
		agent: 'clodia',
		enabled: true
	};

	// Re-seed when the dialog opens (and only then — avoids stomping mid-edit
	// state if the parent re-passes the same `initial` reference).
	let lastOpen = false;
	$: if (open && !lastOpen) {
		lastOpen = true;
		seed();
		void loadAgents();
	} else if (!open && lastOpen) {
		lastOpen = false;
	}

	async function loadAgents() {
		agentsLoading = true;
		try {
			agents = await getAgents();
		} catch {
			// Niente registry raggiungibile: il selettore resta col solo valore
			// corrente (clodia o quello del job), l'utente può comunque salvare.
			agents = [];
		} finally {
			agentsLoading = false;
		}
	}

	function seed() {
		scheduleText = '';
		schedulePreview = null;
		scheduleErr = '';
		if (mode === 'edit' && initial) {
			name = initial.nome ?? '';
			// `Job.schedule` is the cron expression in the list response shape.
			cronExpr = (initial as Job & { cron_expr?: string }).cron_expr ?? initial.schedule ?? '';
			prompt = (initial as Job & { prompt?: string }).prompt ?? '';
			agent = initial.agent ?? 'clodia';
			enabled = (initial as Job & { enabled?: boolean }).enabled !== false;
			showAdvancedCron = true; // in edit mostriamo il cron esistente
		} else {
			name = '';
			cronExpr = '0 9 * * *'; // default coerente con "ogni giorno alle 9"
			scheduleText = 'ogni giorno alle 9';
			prompt = '';
			agent = 'clodia';
			enabled = true;
			showAdvancedCron = false;
			onScheduleInput(); // popola la preview del default
		}
		initialSnapshot = { name, cronExpr, prompt, agent, enabled };
		submitting = false;
		error = null;
	}

	function close() {
		if (submitting) return;
		dispatch('close');
	}

	$: nameValid = name.trim().length > 0 && name.length <= 200;
	$: cronValid = cronExpr.trim().length > 0 && cronExpr.length <= 200;
	$: promptValid = prompt.trim().length > 0;
	// Enforcement: un agent col provider scollegato non è disponibile per i job.
	// `provider_connected === false` → opzione disabilitata + submit bloccato.
	$: selectedAgentDisconnected = agents.some(
		(a) => a.name === agent && a.provider_connected === false
	);
	// Se l'utente ha scritto una periodicità in parole non ancora valida (e non sta
	// usando il cron avanzato), blocca il submit per non inviare un cron stantio.
	$: scheduleBlocks = !!scheduleText.trim() && !schedulePreview && !showAdvancedCron;
	$: canSubmit =
		!submitting && nameValid && cronValid && promptValid &&
		!selectedAgentDisconnected && !scheduleBlocks;
	$: hasChanges =
		name !== initialSnapshot.name ||
		cronExpr !== initialSnapshot.cronExpr ||
		prompt !== initialSnapshot.prompt ||
		agent !== initialSnapshot.agent ||
		enabled !== initialSnapshot.enabled;

	// Opzioni del selettore: oggetti {name, connected}. Mostra l'agent corrente
	// anche se non è nella lista del registry (es. job storico, registry non caricato).
	$: agentOptions = (
		agents.some((a) => a.name === agent)
			? agents
			: [{ name: agent, provider_connected: true } as Agent, ...agents]
	).map((a) => ({ name: a.name, connected: a.provider_connected !== false }));

	function buildPatchDiff(): JobUpdate {
		// JobUpdate declares its fields `readonly`; build a plain mutable
		// record first, then return it widened to JobUpdate. This keeps the
		// public contract immutable while letting us add keys conditionally.
		const diff: Record<string, unknown> = {};
		if (name !== initialSnapshot.name) diff.name = name.trim();
		if (cronExpr !== initialSnapshot.cronExpr) diff.cron_expr = cronExpr.trim();
		if (prompt !== initialSnapshot.prompt) diff.prompt = prompt;
		if (agent !== initialSnapshot.agent) diff.agent = agent;
		if (enabled !== initialSnapshot.enabled) diff.enabled = enabled;
		return diff as JobUpdate;
	}

	async function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		submitting = true;
		error = null;
		try {
			if (mode === 'create') {
				const body: JobCreate = {
					name: name.trim(),
					cron_expr: cronExpr.trim(),
					prompt,
					agent,
					enabled
				};
				const job = await createJob(body);
				toastSuccess(`Job "${body.name}" creato`, 'POST /clodia/jobs → 200');
				dispatch('saved', { mode: 'create', job });
				dispatch('close');
			} else if (mode === 'edit' && initial) {
				if (!hasChanges) {
					// Nothing to send — close silently.
					dispatch('close');
					return;
				}
				const patch = buildPatchDiff();
				const job = await updateJob(initial.id, patch);
				toastSuccess(`Job "${name || initial.nome || initial.id}" aggiornato`);
				dispatch('saved', { mode: 'edit', job });
				dispatch('close');
			}
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			if (err instanceof ApiError) error = `HTTP ${err.status} — ${err.message}`;
			toastError(mode === 'create' ? 'Creazione job fallita' : 'Modifica job fallita', error);
		} finally {
			submitting = false;
		}
	}
</script>

<Modal {open} dismissable={!submitting} maxWidth={620} on:close={close}>
	<h2 slot="title">{mode === 'create' ? 'Nuovo job' : `Modifica job`}</h2>

	<form on:submit={onSubmit} class="form" id="job-form">
		<label class="field">
			<span class="label-row">
				<span class="lbl">Nome <span class="req">*</span></span>
				<span class="hint-inline">1–200 caratteri, libero</span>
			</span>
			<input
				type="text"
				bind:value={name}
				placeholder="Daily digest"
				required
				maxlength="200"
				autocomplete="off"
			/>
		</label>

		<label class="field">
			<span class="lbl">Periodicità <span class="req">*</span></span>
			<input
				type="text"
				bind:value={scheduleText}
				on:input={onScheduleInput}
				placeholder="es. ogni giorno alle 9 · ogni lunedì alle 18 · ogni 15 minuti"
				maxlength="200"
				autocomplete="off"
			/>
			{#if schedulePreview}
				<span class="sched-ok">→ {schedulePreview.description} · <code>{schedulePreview.cron}</code></span>
			{:else if scheduleErr}
				<span class="sched-err">{scheduleErr}</span>
			{:else}
				<span class="hint-inline">Scrivilo in parole; lo converto in pianificazione. Esempi: "tutti i giorni alle 8:30", "nei giorni feriali alle 7", "ogni mese il primo alle 9".</span>
			{/if}
			<button type="button" class="adv-toggle" on:click={() => (showAdvancedCron = !showAdvancedCron)}>
				{showAdvancedCron ? '▾' : '▸'} avanzata: cron
			</button>
		</label>

		{#if showAdvancedCron}
			<label class="field">
				<span class="label-row">
					<span class="lbl">Cron expression</span>
					<span class="hint-inline mono">m h dom mon dow</span>
				</span>
				<input
					type="text"
					bind:value={cronExpr}
					placeholder="0 9 * * *"
					maxlength="200"
					autocomplete="off"
					class="mono"
				/>
				<span class="hint-inline">
					Es. <code>0 9 * * *</code> = ogni giorno alle 09:00 ·
					<code>*/15 * * * *</code> = ogni 15 minuti
				</span>
			</label>
		{/if}

		<label class="field">
			<span class="lbl">Prompt <span class="req">*</span></span>
			<textarea
				bind:value={prompt}
				rows="6"
				placeholder="Cosa deve fare l'agente quando il job scatta…"
				required
				class="mono"
			></textarea>
		</label>

		<label class="field">
			<span class="label-row">
				<span class="lbl">Agent <span class="req">*</span></span>
				<span class="hint-inline">{agentsLoading ? 'carico…' : 'chi esegue il job al fire'}</span>
			</span>
			<select bind:value={agent}>
				{#each agentOptions as a}
					<option value={a.name} disabled={!a.connected}>
						{a.name}{a.connected ? '' : ' — provider non collegato'}
					</option>
				{/each}
			</select>
			{#if selectedAgentDisconnected}
				<span class="hint-inline warn">
					⚠ Provider non collegato: questo agent non è disponibile. Collegalo
					dalla sezione Providers.
				</span>
			{:else}
				<span class="hint-inline">
					Il job gira con tutte le skill / tool / MCP dell'agent scelto.
				</span>
			{/if}
		</label>

		<label class="field-row">
			<input type="checkbox" bind:checked={enabled} />
			<span class="lbl-row">Abilitato (lo scheduler lo eseguirà secondo cron)</span>
		</label>

		{#if error}
			<div class="status err" role="alert">
				<strong>Errore:</strong>
				<span class="err-msg">{error}</span>
			</div>
		{/if}
	</form>

	<svelte:fragment slot="actions">
		<button type="button" class="btn-secondary" on:click={close} disabled={submitting}>
			Annulla
		</button>
		<button
			type="submit"
			form="job-form"
			class="btn-primary"
			disabled={!canSubmit || (mode === 'edit' && !hasChanges)}
		>
			{#if submitting}
				<span class="spinner" aria-hidden="true"></span>
				Salvo…
			{:else if mode === 'create'}
				Crea job
			{:else}
				Salva modifiche
			{/if}
		</button>
	</svelte:fragment>
</Modal>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.label-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
	}

	.lbl {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--fg-muted);
		font-weight: 600;
	}

	.req {
		color: var(--accent);
		font-weight: 700;
	}

	.hint-inline {
		font-size: 10.5px;
		color: var(--fg-muted);
		line-height: 1.45;
	}
	.hint-inline.warn {
		color: #d6a85a;
	}
	.sched-ok {
		font-size: 11px;
		color: #4caf6a;
		line-height: 1.45;
	}
	.sched-ok code { font-family: var(--mono); background: rgba(255,255,255,0.06); padding: 0 4px; border-radius: 3px; }
	.sched-err {
		font-size: 11px;
		color: var(--danger, #e85d75);
		line-height: 1.45;
	}
	.adv-toggle {
		align-self: flex-start;
		background: transparent;
		border: none;
		color: var(--fg-muted);
		font: inherit;
		font-size: 11px;
		cursor: pointer;
		padding: 2px 0;
		margin-top: 2px;
	}
	.adv-toggle:hover { color: var(--accent); }
	.hint-inline.mono,
	.mono {
		font-family: var(--mono);
	}

	input[type='text'],
	textarea,
	select {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid var(--border);
		color: var(--fg);
		font: inherit;
		font-size: 13px;
		padding: 8px 10px;
		border-radius: 6px;
		outline: none;
	}
	input[type='text']:focus,
	textarea:focus,
	select:focus {
		border-color: var(--accent);
	}
	textarea {
		resize: vertical;
		min-height: 120px;
		font-size: 12.5px;
		line-height: 1.5;
	}

	.field-row {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		user-select: none;
	}
	.lbl-row {
		font-size: 12.5px;
		color: var(--fg);
	}
	.field-row input {
		accent-color: var(--accent);
		width: 16px;
		height: 16px;
	}

	.status {
		padding: 10px 12px;
		border-radius: 8px;
		font-size: 12.5px;
	}
	.status.err {
		background: rgba(232, 93, 117, 0.1);
		border: 1px solid rgba(232, 93, 117, 0.5);
		color: var(--danger);
	}
	.status.err .err-msg {
		font-family: var(--mono);
		font-size: 11.5px;
	}

	.btn-secondary {
		background: transparent;
	}

	.btn-primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-fg);
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.btn-primary:hover:not(:disabled) {
		background: #ff7e55;
	}
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
