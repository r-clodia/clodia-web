<script lang="ts">
	/**
	 * The topic's "Strumenti" section (clodia-platform#609, epic #604 R5): the
	 * MCP and connector verbs this room enables for every participant, and the
	 * per-agent exceptions ("everyone but X"). `topic.*` is in every room for
	 * every participant and is not listed. Enabling a verb does not remove its
	 * gate: the gated ones are marked. The gateway decides call by call on the
	 * signed room; this panel only edits the declaration.
	 */
	import { createEventDispatcher, onMount } from 'svelte';
	import {
		apiErrorDetail,
		getChannelTools,
		setChannelTool,
		toolMayAsk,
		type Toolbox,
		type ToolboxAction
	} from '$lib/api/client';
	import ToolboxPicker from '$lib/components/ToolboxPicker.svelte';
	import { toastError } from '$lib/stores/toasts';

	export let tier: string;
	export let name: string;
	/** The channel's AI participants (exceptions are per agent). */
	export let agents: string[] = [];
	/** Owner or admin. */
	export let canEdit = false;

	const dispatch = createEventDispatcher<{ count: number }>();

	let box: Toolbox | null = null;
	let err = '';
	let busy = false;
	let excAgent = '';
	let excVerb = '';

	$: isGated = (v: string) => toolMayAsk(v, box?.gated ?? []);
	$: exceptions = Object.entries(box?.except ?? {}).sort(([a], [b]) => a.localeCompare(b));
	// What an exception may name: what the room gives (its entries, their
	// namespaces, the topic floor) or everything.
	$: exceptable = [
		'*',
		'topic.*',
		...new Set((box?.enabled ?? []).flatMap((e) => [e, `${e.split('.')[0]}.*`]))
	];

	async function load() {
		err = '';
		try {
			box = await getChannelTools(tier, name);
			dispatch('count', box.enabled.length);
		} catch (e) {
			err = apiErrorDetail(e);
		}
	}
	onMount(() => void load());

	async function act(action: ToolboxAction, verb: string, agent?: string): Promise<boolean> {
		if (busy) return false;
		busy = true;
		try {
			await setChannelTool(tier, name, action, verb, agent);
			await load();
			return true;
		} catch (e) {
			toastError('Strumenti del canale', apiErrorDetail(e));
			return false;
		} finally {
			busy = false;
		}
	}

	/** Several verbs at once from the picker: one call each, then one reload. */
	async function enableMany(verbs: string[]) {
		if (busy || verbs.length === 0) return;
		busy = true;
		const falliti: string[] = [];
		for (const v of verbs) {
			try {
				await setChannelTool(tier, name, 'enable', v);
			} catch (e) {
				falliti.push(`${v}: ${apiErrorDetail(e)}`);
			}
		}
		await load();
		busy = false;
		if (falliti.length) toastError('Strumenti del canale', falliti.join(' · '));
	}

	function addException() {
		if (!excAgent || !excVerb) return;
		void act('except', excVerb, excAgent).then((ok) => {
			if (ok) excVerb = '';
		});
	}
</script>

<p class="muted">
	Ogni partecipante può usare i verbi abilitati qui, in questo canale. <code>topic.*</code> è
	sempre incluso. Abilitare non toglie la conferma: ⚠ segna i verbi che possono chiederla.
</p>

{#if err}
	<p class="err" role="alert">{err}</p>
{:else if !box}
	<p class="muted">Caricamento…</p>
{:else}
	{#if box.enabled.length === 0}
		<p class="muted">Nessun verbo abilitato in questo canale.</p>
	{:else}
		<ul class="list">
			{#each box.enabled as v (v)}
				<li>
					<code title={v}>{v}</code>
					{#if isGated(v)}<span class="gated" role="img" aria-label="Può chiedere conferma" title="Può chiedere conferma (alcuni verbi, o fuori perimetro)">⚠</span>{/if}
					{#if canEdit}
						<button type="button" class="x" disabled={busy} aria-label="Disabilita {v}"
							on:click={() => void act('disable', v)}>✕</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if canEdit}
		<ToolboxPicker enablable={box.enablable} enabled={box.enabled} gated={box.gated ?? []}
			disabled={busy} on:pick={(e) => void enableMany(e.detail)} />
	{/if}

	<h4>Eccezioni</h4>
	{#if exceptions.length === 0}
		<p class="muted">Nessuna: ogni partecipante ha tutti i verbi del canale.</p>
	{:else}
		<ul class="list">
			{#each exceptions as [agent, verbs] (agent)}
				{#each verbs as v (v)}
					<li>
						<span class="agent" title={agent}>{agent}</span>
						<span class="muted">senza</span>
						<code title={v}>{v}</code>
						{#if canEdit}
							<button type="button" class="x" disabled={busy}
								aria-label="Togli l'eccezione {v} per {agent}"
								on:click={() => void act('unexcept', v, agent)}>✕</button>
						{/if}
					</li>
				{/each}
			{/each}
		</ul>
	{/if}
	{#if canEdit && agents.length > 0}
		<form class="exc" on:submit|preventDefault={addException}>
			<select bind:value={excAgent} disabled={busy} aria-label="Agente">
				<option value="">agente…</option>
				{#each agents as a (a)}<option value={a}>{a}</option>{/each}
			</select>
			<select bind:value={excVerb} disabled={busy || !excAgent} aria-label="Verbo da togliere">
				<option value="">verbo da togliere…</option>
				{#each exceptable as v (v)}<option value={v}>{v === '*' ? '* (tutto ciò che dà il canale)' : v}</option>{/each}
			</select>
			<button type="submit" class="link-btn" disabled={busy || !excAgent || !excVerb}>Togli</button>
		</form>
	{/if}
{/if}

<style>
	.muted { color: var(--fg-muted); font-size: 11px; margin: 4px 0; }
	.err { color: #dc2626; font-size: 11px; margin: 4px 0; }
	h4 { font-size: 11px; margin: 10px 0 2px; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
	.list li { display: flex; align-items: center; gap: 6px; font-size: 11px; min-width: 0; }
	.list code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.agent { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
	.gated { color: #d97706; }
	.x {
		background: transparent; border: none; color: var(--fg-muted); cursor: pointer;
		font-size: 11px; padding: 0 2px; flex-shrink: 0;
	}
	.x:hover:not(:disabled) { color: #dc2626; }
	.exc { display: flex; gap: 6px; margin-top: 6px; }
	.exc select {
		flex: 1; min-width: 0; font-size: 11px; padding: 2px 4px; border-radius: 4px;
		border: 1px solid var(--border); background: var(--bg); color: var(--fg);
	}
	.link-btn {
		font-size: 11px; background: transparent; border: 1px solid var(--border);
		border-radius: 4px; color: var(--fg); cursor: pointer; padding: 2px 8px; white-space: nowrap;
	}
	.link-btn:disabled { opacity: .5; cursor: default; }
</style>
