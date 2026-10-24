<script lang="ts">
	/**
	 * The room's "Strumenti" section (clodia-platform#609 R5, epic #604): the
	 * MCP/connector verbs this channel enables for EVERY participant, grouped
	 * by backend, plus the per-agent exceptions.
	 *
	 * Two sentences the panel has to say out loud, because they are the two
	 * things the owner gets wrong otherwise:
	 *
	 * - **enabled ≠ ungated** (decision 3 of the epic): a gated verb enabled
	 *   here still asks for confirmation. The marking comes from the gateway
	 *   (`gated` in the payload), never from a list written here.
	 * - **an exception subtracts from the ROOM, not from the seed**: an agent
	 *   that already has the verb in its own `tool_permissions` keeps it.
	 *   Reducing the seeds is #610.
	 *
	 * `topic.*` is not shown: it is the floor of every participant in every
	 * topic and this panel does not govern it.
	 */
	import { onMount } from 'svelte';
	import {
		apiErrorDetail,
		getChannelTools,
		setChannelTool,
		setChannelToolException,
		type RoomToolbox
	} from '$lib/api/client';
	import { copre, gruppiToolbox, orfane } from '$lib/toolbox';
	import { toastError } from '$lib/stores/toasts';

	export let tier: string;
	export let name: string;
	/** The channel's AI participants: an exception is per agent. */
	export let agents: string[] = [];
	/** Owner or admin: may enable, disable and except. */
	export let canEdit = false;

	let box: RoomToolbox | null = null;
	let err = '';
	let busy = false;
	/** Which group is open, and for which entry the exceptions are showing. */
	let aperto = '';
	let eccezioniDi = '';

	$: gruppi = box ? gruppiToolbox(box.enablable, box.enabled, box.gated) : [];
	$: sconosciute = box ? orfane(box.enablable, box.enabled) : [];
	$: conGate = new Set(box?.gated ?? []);
	$: eccezioniPerAgente = (a: string) => box?.except?.[a] ?? [];

	async function load() {
		err = '';
		try {
			box = await getChannelTools(tier, name);
		} catch (e) {
			err = apiErrorDetail(e);
		}
	}
	onMount(() => void load());

	async function run(fn: () => Promise<unknown>) {
		if (busy) return;
		busy = true;
		try {
			await fn();
			await load();
		} catch (e) {
			toastError('Strumenti del canale', apiErrorDetail(e));
		} finally {
			busy = false;
		}
	}

	const accendi = (verbo: string, on: boolean) =>
		run(() => setChannelTool(tier, name, verbo, on));

	const escludi = (agent: string, verbo: string, on: boolean) =>
		run(() => setChannelToolException(tier, name, agent, verbo, on));
</script>

<p class="muted intro">
	I verbi che questo canale abilita per <strong>ogni</strong> partecipante. Abilitare
	non toglie il gate: un verbo marcato <span class="gate-badge">gate</span> continua a
	chiedere conferma.
</p>

{#if err}
	<p class="tools-error" role="status">⚠ {err}</p>
{:else if !box}
	<p class="muted">Caricamento…</p>
{:else}
	{#if sconosciute.length}
		<!-- Enabled in the meta but no longer offered by the gateway (a connector
		     uninstalled, a backend unmounted): shown so it can be switched off,
		     instead of staying invisible and granted. -->
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
		<p class="muted">Nessun backend disponibile su questa istanza.</p>
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
						<li class="verb">
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
							<li class="verb">
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

	<h4 class="sub">Eccezioni per agente</h4>
	<p class="muted">
		«Tutti tranne X per questo verbo». L'eccezione toglie ciò che dà la <em>stanza</em>:
		un agente che ha il verbo nel proprio seed continua ad averlo.
	</p>
	{#if box.enabled.length === 0}
		<p class="muted">Nessun verbo abilitato: non c'è nulla da togliere.</p>
	{:else if agents.length === 0}
		<p class="muted">Nessun agente nel canale.</p>
	{:else}
		<ul class="exc">
			{#each box.enabled as v (v)}
				{@const esclusi = agents.filter((a) => copre(v, eccezioniPerAgente(a)))}
				<li>
					<button type="button" class="exc-head"
						on:click={() => (eccezioniDi = eccezioniDi === v ? '' : v)}>
						<code>{v}</code>
						{#if conGate.has(v)}<span class="gate-badge">gate</span>{/if}
						{#if esclusi.length}
							<span class="exc-count">{esclusi.length} escluso{esclusi.length > 1 ? 'i' : ''}</span>
						{/if}
					</button>
					{#if eccezioniDi === v}
						<ul class="agents">
							{#each agents as a (a)}
								{@const escluso = copre(v, eccezioniPerAgente(a))}
								<li>
									<span class="agent" title={a}>{a}</span>
									{#if canEdit}
										<button type="button" class="chip" class:off={escluso} disabled={busy}
											aria-pressed={escluso}
											on:click={() => void escludi(a, v, !escluso)}>
											{escluso ? 'escluso' : 'incluso'}
										</button>
									{:else}
										<span class="muted">{escluso ? 'escluso' : 'incluso'}</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.intro {
		margin: 0 0 10px;
		line-height: 1.5;
	}
	.muted {
		color: var(--fg-muted);
		font-size: 12px;
	}
	.tools-error {
		margin: 0 0 8px;
		color: var(--danger, #b4232a);
		font-size: 12.5px;
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
	.exc,
	.agents,
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
	.ns-head,
	.exc-head {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 5px 0;
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
		padding: 2px 0 8px 16px;
	}
	.verb label {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
		font-size: 12.5px;
		cursor: pointer;
	}
	.verb code.covered {
		color: var(--fg-muted);
	}
	.sub {
		margin: 14px 0 4px;
		font-size: 12.5px;
	}
	.exc-count {
		color: var(--fg-muted);
		font-size: 11.5px;
	}
	.agents {
		padding: 2px 0 8px 16px;
	}
	.agents li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 2px 0;
		font-size: 12.5px;
	}
	.agent {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip {
		padding: 1px 8px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: none;
		color: var(--fg-muted);
		font-size: 11.5px;
		cursor: pointer;
	}
	.chip.off {
		border-color: var(--danger, #b4232a);
		color: var(--danger, #b4232a);
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
