<script lang="ts">
	/**
	 * The toolbox OUTSIDE a room (clodia-platform#609 R5, decision 5 of the
	 * epic #604): the verbs enabled in a DM, or in a job not bound to a topic.
	 *
	 * There is no room to read them from, so it is an instance setting: anyone
	 * may see it — knowing what an agent reaches in a DM is not a secret — and
	 * an ADMIN changes it. The refusal for everyone else is the agent-server's
	 * (`/clodia/dm-tools`), not this button's: here the control is simply not
	 * offered.
	 *
	 * Same grouping and the same gate marking as the room's panel
	 * (`$lib/toolbox`): one derivation, so the two screens cannot disagree on
	 * what is enablable or on which verbs still ask for confirmation.
	 */
	import { onMount } from 'svelte';
	import { apiErrorDetail, getDmTools, setDmTool, type DmToolbox } from '$lib/api/client';
	import { gruppiToolbox, orfane } from '$lib/toolbox';
	import { toastError } from '$lib/stores/toasts';

	/** Admin: may enable and disable. */
	export let canEdit = false;

	let box: DmToolbox | null = null;
	let err = '';
	let busy = false;
	let aperto = '';

	$: gruppi = box ? gruppiToolbox(box.enablable, box.enabled, box.gated) : [];
	$: sconosciute = box ? orfane(box.enablable, box.enabled) : [];

	async function load() {
		err = '';
		try {
			box = await getDmTools();
		} catch (e) {
			err = apiErrorDetail(e);
		}
	}
	onMount(() => void load());

	async function accendi(verbo: string, on: boolean) {
		if (busy) return;
		busy = true;
		try {
			await setDmTool(verbo, on);
			await load();
		} catch (e) {
			toastError('Verbi fuori da una stanza', apiErrorDetail(e));
		} finally {
			busy = false;
		}
	}
</script>

<div class="card-h">
	<h2>Strumenti fuori da una stanza</h2>
	<span class="iso">DM · job</span>
</div>
<p class="note">
	I verbi abilitati dove non c'è un canale a deciderlo: una conversazione diretta, o un
	job non legato a un topic. Dentro una stanza decide la <strong>toolbox della stanza</strong>,
	e questa lista non si aggiunge. Abilitare non toglie il gate: un verbo marcato
	<span class="gate-badge">gate</span> continua a chiedere conferma.
</p>

{#if err}
	<p class="err">⚠ {err}</p>
{:else if !box}
	<p class="note">Caricamento…</p>
{:else}
	{#if sconosciute.length}
		<ul class="orphans">
			{#each sconosciute as v (v)}
				<li>
					<code>{v}</code>
					<span class="muted">backend non disponibile</span>
					{#if canEdit}
						<button type="button" class="link-btn" disabled={busy}
							on:click={() => void accendi(v, false)}>Togli</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if gruppi.length === 0}
		<p class="note">Nessun backend disponibile su questa istanza.</p>
	{/if}

	<ul class="ns-list">
		{#each gruppi as g (g.ns)}
			<li class="ns">
				<button type="button" class="ns-head" aria-expanded={aperto === g.ns}
					on:click={() => (aperto = aperto === g.ns ? '' : g.ns)}>
					<span class="caret" class:open={aperto === g.ns}>▸</span>
					<span class="ns-name">{g.ns}</span>
					{#if g.tuttiAccesi}
						<span class="ns-count on">tutti</span>
					{:else if g.accesi}
						<span class="ns-count on">{g.accesi}</span>
					{:else}
						<span class="ns-count">—</span>
					{/if}
				</button>
				{#if aperto === g.ns}
					<ul class="verbs">
						<li>
							<label>
								<input type="checkbox" checked={g.tuttiAccesi} disabled={!canEdit || busy}
									on:change={(e) => void accendi(g.tutti, e.currentTarget.checked)} />
								<code>{g.tutti}</code>
								<span class="muted">tutti i verbi del backend</span>
								{#if g.tuttiHannoGate}<span class="gate-badge">gate</span>{/if}
							</label>
						</li>
						{#if g.verbi.length === 0}
							<li class="muted">
								Questo backend non elenca i propri verbi da qui: si abilita solo per intero.
							</li>
						{/if}
						{#each g.verbi as v (v.verbo)}
							<li>
								<label>
									<input type="checkbox" checked={v.acceso}
										disabled={!canEdit || busy || v.coperto}
										on:change={(e) => void accendi(v.verbo, e.currentTarget.checked)} />
									<code class:covered={v.coperto}>{v.verbo}</code>
									{#if v.coperto}<span class="muted">da {g.tutti}</span>{/if}
									{#if v.gated}<span class="gate-badge" title="richiede conferma">gate</span>{/if}
								</label>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.card-h {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.card-h h2 {
		margin: 0;
		font-size: 16px;
	}
	.iso {
		font-size: 11px;
		color: var(--fg-muted);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 2px 8px;
	}
	.note {
		font-size: 12.5px;
		color: var(--fg-muted);
		line-height: 1.5;
	}
	.err {
		color: var(--danger, #b4232a);
		font-size: 12.5px;
	}
	.muted {
		color: var(--fg-muted);
		font-size: 12px;
	}
	.gate-badge {
		display: inline-block;
		margin-left: 6px;
		padding: 0 5px;
		border: 1px solid var(--border);
		border-radius: 8px;
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-muted);
	}
	.ns-list,
	.verbs,
	.orphans {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.orphans li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 0;
	}
	.ns {
		border-bottom: 1px solid var(--border);
	}
	.ns-head {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 0;
		background: none;
		border: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.caret {
		display: inline-block;
		transition: transform 0.12s ease;
		color: var(--fg-muted);
		font-size: 10px;
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.ns-name {
		flex: 1;
		font-weight: 500;
	}
	.ns-count {
		color: var(--fg-muted);
		font-size: 11.5px;
	}
	.ns-count.on {
		color: var(--accent, #2f6f4f);
	}
	.verbs {
		padding: 2px 0 10px 18px;
	}
	.verbs label {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
		font-size: 12.5px;
		cursor: pointer;
	}
	.verbs code.covered {
		color: var(--fg-muted);
	}
	.link-btn {
		background: none;
		border: 0;
		padding: 0;
		color: var(--accent, #2f6f4f);
		font: inherit;
		font-size: 12px;
		cursor: pointer;
		text-decoration: underline;
	}
	code {
		font-size: 12px;
	}
</style>
