<script lang="ts">
	/**
	 * The topic's "Strumenti" section. Since clodia-platform#620 the room
	 * authorises whole MCPs, decides each one's resources (allow / ask / deny
	 * per row) and gives each agent a level per MCP (all / read / none). Before
	 * #620 — and still, against a gateway that does not send `mcp_catalogue` —
	 * the per-verb form of #609, epic #604 R5: the
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
		setChannelMcp,
		setChannelTool,
		toolMayAsk,
		type McpEffect,
		type McpInfo,
		type McpLevel,
		type McpToolAction,
		type Toolbox,
		type ToolboxAction
	} from '$lib/api/client';
	import McpPicker from '$lib/components/McpPicker.svelte';
	import McpResources from '$lib/components/McpResources.svelte';
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

	// ── The MCP form (clodia-platform#620) ─────────────────────────────────
	// A gateway that returns `mcp_catalogue` speaks MCPs: the room authorises
	// whole MCPs, decides their resources and gives each agent a level. Before
	// that (a gateway < 2.138.0 during the deploy) the per-verb panel below.
	$: byMcp = !!box?.mcp_catalogue;
	$: catalogue = box?.mcp_catalogue ?? {};
	$: authorised = Object.keys(box?.mcp ?? {})
		.filter((id) => catalogue[id])
		.sort((a, b) => catalogue[a].label.localeCompare(catalogue[b].label));
	// Single verbs enabled in the old form and not covered by an authorised
	// MCP: still in force, so still shown (and removable).
	$: coveredNs = new Set(authorised.flatMap((id) => catalogue[id].namespaces.map((n) => `${n}.*`)));
	$: legacyEnabled = (box?.enabled ?? []).filter((e) => !coveredNs.has(e));
	$: levelOf = (agent: string, id: string): McpLevel => box?.except_mcp?.[agent]?.[id] ?? 'all';
	// Old-form exceptions: those the levels do not explain.
	$: legacyExceptions = Object.entries(box?.except ?? {})
		.map(([agent, verbs]) => {
			const fromLevels = new Set<string>();
			for (const [id, lvl] of Object.entries(box?.except_mcp?.[agent] ?? {})) {
				const m = catalogue[id];
				if (!m) continue;
				if (lvl === 'none' || !m.enumerable) m.namespaces.forEach((n) => fromLevels.add(`${n}.*`));
				else m.write.forEach((v) => fromLevels.add(v));
			}
			return [agent, verbs.filter((v) => !fromLevels.has(v))] as [string, string[]];
		})
		.filter(([, v]) => v.length > 0)
		.sort(([a], [b]) => a.localeCompare(b));
	const mayAsk = (m: McpInfo) => m.namespaces.some((ns) => toolMayAsk(`${ns}.*`, box?.gated ?? []));
	const effectWord: Record<McpEffect, string> = { allow: 'allow', ask: 'ask', deny: 'deny' };

	async function mcpAct(body: McpToolAction): Promise<boolean> {
		if (busy) return false;
		busy = true;
		try {
			await setChannelMcp(tier, name, body);
			await load();
			return true;
		} catch (e) {
			toastError('Strumenti del canale', apiErrorDetail(e));
			return false;
		} finally {
			busy = false;
		}
	}

	async function authoriseMany(ids: string[]) {
		if (busy || ids.length === 0) return;
		busy = true;
		const falliti: string[] = [];
		for (const id of ids) {
			try {
				await setChannelMcp(tier, name, { action: 'enable_mcp', mcp: id });
			} catch (e) {
				falliti.push(`${catalogue[id]?.label ?? id}: ${apiErrorDetail(e)}`);
			}
		}
		await load();
		busy = false;
		if (falliti.length) toastError('Strumenti del canale', falliti.join(' · '));
	}

	function revoke(id: string) {
		const m = catalogue[id];
		if (!confirm(`Revocare ${m?.label ?? id}? Le sue risorse e le eccezioni su di esso vengono rimosse.`)) return;
		void mcpAct({ action: 'disable_mcp', mcp: id });
	}

	async function load() {
		err = '';
		try {
			box = await getChannelTools(tier, name);
			dispatch('count', box.mcp_catalogue
				? Object.keys(box.mcp ?? {}).length
				: box.enabled.length);
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

{#if err}
	<p class="err" role="alert">{err}</p>
{:else if !box}
	<p class="muted">Caricamento…</p>
{:else if byMcp}
	<p class="muted wrap">
		Ogni partecipante può usare gli MCP autorizzati qui, con tutti i loro verbi. Per ciascuno decidi
		le risorse che può toccare. <code>topic.*</code> è sempre incluso. ⚠ segna gli MCP con verbi che
		possono comunque chiedere conferma.
	</p>
	<ul class="list">
		<li class="floor"><code>topic.*</code><span class="muted">sempre incluso</span></li>
	</ul>
	{#if authorised.length === 0}
		<p class="muted">Nessun MCP autorizzato in questo canale.</p>
	{:else}
		<ul class="mcps">
			{#each authorised as id (id)}
				{@const m = catalogue[id]}
				<li class="mcp">
					<details>
						<summary>
							<span class="label" title={m.namespaces.join(', ')}>{m.label}</span>
							<span class="muted">{m.enumerable ? `${m.verbs.length} verbi` : 'verbi del backend'}</span>
							{#if m.write.length > 0}<span class="badge w">scrive</span>{/if}
							{#if m.verbs.length > m.write.length || !m.enumerable}<span class="badge">legge</span>{/if}
							{#if mayAsk(m)}<span class="gated" role="img" aria-label="Può chiedere conferma" title="Alcuni verbi possono chiedere conferma">⚠</span>{/if}
							{#if (box.mcp?.[id]?.resources ?? []).length > 0}
								<span class="muted">· {(box.mcp?.[id]?.resources ?? []).length} risorse</span>
							{/if}
							{#if canEdit}
								<button type="button" class="x" disabled={busy} aria-label="Revoca {m.label}"
									on:click|preventDefault|stopPropagation={() => revoke(id)}>✕</button>
							{/if}
						</summary>
						<div class="mcp-body">
							<McpResources mcp={m} rows={box.mcp?.[id]?.resources ?? []}
								linked={id === 'google' ? (box.linked_folders ?? []) : []} {canEdit} {busy}
								on:set={(e) => void mcpAct({ action: 'set_resource', mcp: id, uri: e.detail.uri, effect: e.detail.effect })}
								on:unset={(e) => void mcpAct({ action: 'unset_resource', mcp: id, uri: e.detail.uri })} />
							<details class="writes">
								<summary>Cosa scrive questa scelta</summary>
								<ul>
									<li><code>* · {m.namespaces.map((n) => `${n}.*`).join(', ')} · default</code></li>
									{#each box.mcp?.[id]?.resources ?? [] as r (r.uri)}
										<li><code>* · verbi su {r.uri.split(':')[0]} · {effectWord[r.effect]} {r.uri}</code></li>
									{/each}
									{#each agents.filter((a) => levelOf(a, id) !== 'all') as a (a)}
										<li><code>{a} · {levelOf(a, id) === 'none' || !m.enumerable ? 'tutti i verbi' : 'verbi che scrivono'} · deny</code></li>
									{/each}
								</ul>
							</details>
						</div>
					</details>
				</li>
			{/each}
		</ul>
	{/if}

	{#if legacyEnabled.length > 0}
		<h4>Verbi abilitati singolarmente</h4>
		<p class="muted wrap">Dal formato precedente: restano in vigore finché non li togli.</p>
		<ul class="list">
			{#each legacyEnabled as v (v)}
				<li>
					<code title={v}>{v}</code>
					{#if canEdit}
						<button type="button" class="x" disabled={busy} aria-label="Disabilita {v}"
							on:click={() => void act('disable', v)}>✕</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if canEdit}
		<McpPicker {catalogue} {authorised} gated={box.gated ?? []} disabled={busy}
			on:pick={(e) => void authoriseMany(e.detail)} />
	{/if}

	<h4>Eccezioni per agente</h4>
	{#if authorised.length === 0 || agents.length === 0}
		<p class="muted">Nessuna: servono un MCP autorizzato e almeno un agente nel canale.</p>
	{:else}
		<div class="grid-wrap">
			<table class="grid">
				<thead>
					<tr><th scope="col">Agente</th>
						{#each authorised as id (id)}<th scope="col" title={catalogue[id].label}>{catalogue[id].label}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each agents as a (a)}
						<tr>
							<th scope="row" title={a}>{a}</th>
							{#each authorised as id (id)}
								{@const lvl = levelOf(a, id)}
								<td>
									{#if canEdit}
										<select value={lvl} disabled={busy} aria-label="{a} su {catalogue[id].label}"
											on:change={(e) => void mcpAct({ action: 'except_mcp', mcp: id, agent: a, level: e.currentTarget.value as McpLevel })}>
											<option value="all">tutto</option>
											<option value="read" title={catalogue[id].enumerable ? '' : 'Verbi non enumerabili: toglie tutto'}>solo lettura</option>
											<option value="none">niente</option>
										</select>
									{:else}
										<span class:off={lvl !== 'all'}>{lvl === 'all' ? 'tutto' : lvl === 'read' ? 'solo lettura' : 'niente'}</span>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	{#if legacyExceptions.length > 0}
		<p class="muted wrap">Eccezioni sul singolo verbo, dal formato precedente:</p>
		<ul class="list">
			{#each legacyExceptions as [agent, verbs] (agent)}
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
{:else}
	<p class="muted">
		Ogni partecipante può usare i verbi abilitati qui, in questo canale. <code>topic.*</code> è
		sempre incluso. Abilitare non toglie la conferma: ⚠ segna i verbi che possono chiederla.
	</p>
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
	.wrap { white-space: normal; }
	.floor { gap: 8px; }
	.mcps { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.mcp { border: 1px solid var(--border); border-radius: 6px; padding: 4px 6px; }
	.mcp summary { display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; min-width: 0; }
	.mcp .label { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.mcp-body { padding: 4px 0 2px 4px; display: flex; flex-direction: column; gap: 4px; }
	.badge { font-size: 10px; border-radius: 3px; padding: 0 4px; border: 1px solid var(--border);
		color: var(--fg-muted); white-space: nowrap; }
	.badge.w { color: #b45309; border-color: #b45309; }
	.writes summary { font-size: 10px; color: var(--fg-muted); }
	.writes ul { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.writes code { font-size: 10px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.grid-wrap { overflow-x: auto; }
	.grid { border-collapse: collapse; font-size: 11px; width: 100%; }
	.grid th, .grid td { padding: 2px 4px; text-align: left; border-bottom: 1px solid var(--border); }
	.grid th { font-weight: 600; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.grid select {
		font-size: 11px; padding: 1px 2px; border-radius: 4px;
		border: 1px solid var(--border); background: var(--bg); color: var(--fg);
	}
	.off { color: #b45309; }
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
