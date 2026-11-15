<script lang="ts">
	/**
	 * "Crea db" (clodia-platform#688): a new, empty instance of a pack's
	 * datastore structure. Name validated live with the server's rule, tier
	 * required and limited to the tiers ≤ the person's clearance, optional
	 * overrides of the structure's purpose / PII / backup. Admin only — the
	 * caller shows the button only to admins, and the server checks it again
	 * (`POST /clodia/databases`, `action: create_instance`).
	 *
	 * On success the dialog stays open on a short confirmation with the link to
	 * the new instance's Databases page, and emits `created` so the caller
	 * refreshes its list.
	 */
	import { createEventDispatcher } from 'svelte';
	import {
		apiErrorDetail,
		createDatastoreInstance,
		createdInstanceId,
		type DatastoreStructure
	} from '$lib/api/client';
	import Modal from '$lib/components/Modal.svelte';
	import { datastoreHref, instanceNameProblem, tiersUpTo } from '$lib/databases.js';

	export let structure: DatastoreStructure | null = null;
	/** The person's clearance (`SEAL-n`, legacy `Pn` accepted); null = unknown. */
	export let clearance: string | null = null;

	const dispatch = createEventDispatcher<{ close: void; created: { id: string } }>();

	let name = '';
	let tier = '';
	let purpose = '';
	let pii: 'inherit' | 'yes' | 'no' = 'inherit';
	let backup: 'inherit' | 'yes' | 'no' = 'inherit';
	let busy = false;
	let err = '';
	let createdId = '';
	let openedFor = '';

	// Reset every time the dialog opens on a (new) structure.
	$: if (structure && structure.id !== openedFor) {
		openedFor = structure.id;
		name = '';
		tier = '';
		purpose = '';
		pii = 'inherit';
		backup = 'inherit';
		err = '';
		createdId = '';
	}
	$: if (!structure) openedFor = '';

	$: allowed = tiersUpTo(clearance);
	$: taken = (structure?.instances ?? []).map((i) => i.name);
	$: nameProblem = instanceNameProblem(name, taken);
	$: ready = !!structure && !nameProblem && !!tier && allowed.includes(tier) && !busy;

	function inheritedLabel(v: unknown): string {
		if (v === true) return 'sì';
		if (v === false) return 'no';
		if (v === null || v === undefined || v === '') return 'non dichiarato';
		return String(v);
	}

	function close() {
		if (busy) return;
		dispatch('close');
	}

	async function submit() {
		if (!ready || !structure) return;
		busy = true;
		err = '';
		try {
			const body: Parameters<typeof createDatastoreInstance>[0] = {
				structure: structure.id,
				name,
				tier
			};
			if (purpose.trim()) body.purpose = purpose.trim();
			if (pii !== 'inherit') body.pii = pii === 'yes';
			if (backup !== 'inherit') body.backup = backup === 'yes';
			const r = await createDatastoreInstance(body);
			createdId = createdInstanceId(r, structure.id, name);
			dispatch('created', { id: createdId });
		} catch (e) {
			err = apiErrorDetail(e);
		} finally {
			busy = false;
		}
	}
</script>

<Modal open={structure !== null} dismissable={!busy} maxWidth={480} on:close={close}>
	<h2 slot="title">Crea db · <code>{structure?.id ?? ''}</code></h2>
	{#if createdId}
		<div class="ci-body">
			<p>Creato <code>{createdId}</code>: un database vuoto con lo schema della struttura.</p>
			<p class="ci-muted">
				Per usarlo, importalo in uno spazio (topic, DM o job) dalla sua pagina o dal pannello dati dello spazio.
			</p>
			<a class="ci-link" href={datastoreHref(createdId)}>Apri in Databases →</a>
		</div>
	{:else}
		<form class="ci-body" on:submit|preventDefault={submit}>
			{#if structure?.purpose}<p class="ci-muted">{structure.purpose}</p>{/if}
			<label class="ci-field">
				Nome
				<input type="text" bind:value={name} placeholder="es. uncommon" autocomplete="off"
					maxlength="41" aria-invalid={!!name && !!nameProblem} disabled={busy} />
				{#if name && nameProblem}
					<span class="ci-err">{nameProblem}</span>
				{:else if name}
					<span class="ci-muted">Sarà <code>{structure?.id}:{name}</code>.</span>
				{:else}
					<span class="ci-muted">Minuscole, cifre e «-», max 41 caratteri, iniziale lettera o cifra.</span>
				{/if}
			</label>
			<label class="ci-field">
				Tier
				<select bind:value={tier} required disabled={busy || allowed.length === 0}>
					<option value="" disabled>— scegli il tier —</option>
					{#each allowed as t (t)}<option value={t}>{t}</option>{/each}
				</select>
				{#if allowed.length === 0}
					<span class="ci-err">Clearance non determinabile: impossibile proporre un tier.</span>
				{:else}
					<span class="ci-muted">Obbligatorio; al massimo la tua clearance ({allowed[allowed.length - 1]}).</span>
				{/if}
			</label>
			<details class="ci-over">
				<summary>Sovrascrivi i valori della struttura (facoltativo)</summary>
				<label class="ci-field">
					Scopo
					<input type="text" bind:value={purpose} placeholder={structure?.purpose || 'come la struttura'} disabled={busy} />
				</label>
				<label class="ci-field">
					Dati personali (PII)
					<select bind:value={pii} disabled={busy}>
						<option value="inherit">come la struttura ({inheritedLabel(structure?.pii)})</option>
						<option value="yes">sì</option>
						<option value="no">no</option>
					</select>
				</label>
				<label class="ci-field">
					Backup
					<select bind:value={backup} disabled={busy}>
						<option value="inherit">come la struttura ({inheritedLabel(structure?.backup)})</option>
						<option value="yes">sì</option>
						<option value="no">no</option>
					</select>
				</label>
			</details>
			{#if err}<p class="ci-err" role="alert">{err}</p>{/if}
		</form>
	{/if}
	<div slot="actions" class="ci-actions">
		{#if createdId}
			<button type="button" class="ci-btn" on:click={close}>Chiudi</button>
		{:else}
			<button type="button" class="ci-btn" on:click={close} disabled={busy}>Annulla</button>
			<button type="button" class="ci-btn primary" on:click={submit} disabled={!ready}>
				{busy ? 'Creo…' : 'Crea db'}
			</button>
		{/if}
	</div>
</Modal>

<style>
	.ci-body { display: flex; flex-direction: column; gap: 10px; font-size: 13px; min-width: 0; }
	.ci-body p { margin: 0; }
	.ci-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
	.ci-field input, .ci-field select {
		font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid var(--border);
		border-radius: 6px; background: var(--bg); color: var(--fg);
	}
	.ci-field input[aria-invalid='true'] { border-color: var(--danger); }
	.ci-muted { color: var(--fg-muted); font-size: 11px; }
	.ci-err { color: var(--danger); font-size: 12px; }
	.ci-over { border: 1px dashed var(--border); border-radius: 8px; padding: 8px 10px; }
	.ci-over summary { cursor: pointer; font-size: 12px; color: var(--fg-muted); }
	.ci-over[open] { display: flex; flex-direction: column; gap: 8px; }
	.ci-link { align-self: flex-start; border: 1px solid var(--border); border-radius: 6px; padding: 5px 10px; font-size: 12px; }
	.ci-link:hover { border-color: var(--fg-muted); }
	.ci-actions { display: flex; justify-content: flex-end; gap: 8px; }
	.ci-btn { font-size: 13px; padding: 6px 12px; border-radius: 6px; cursor: pointer;
		border: 1px solid var(--border); background: transparent; color: var(--fg); }
	.ci-btn.primary { background: var(--accent, #ff6b3d); border-color: transparent; color: var(--accent-fg, #fff); font-weight: 600; }
	.ci-btn:disabled { opacity: 0.5; cursor: default; }
</style>
