<script lang="ts">
	/**
	 * The topic's "Strumenti" section. Since clodia-platform#620 the room
	 * authorises whole MCPs and decides each one's resources (allow / ask /
	 * deny per row), for every participant alike: per-agent exceptions were
	 * dropped (owner's decision, 26 Oct 2026 — too complex for the UI). Before
	 * #620 — and still, against a gateway that does not send `mcp_catalogue` —
	 * the per-verb form of #609, epic #604 R5: the MCP and connector verbs
	 * this room enables for every participant. `topic.*` is in every room for
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
		type ConnectorActionState,
		type McpEffect,
		type McpInfo,
		type McpToolAction,
		type Toolbox,
		type ToolboxAction
	} from '$lib/api/client';
	import McpPicker from '$lib/components/McpPicker.svelte';
	import McpMailboxes from '$lib/components/McpMailboxes.svelte';
	import McpResources from '$lib/components/McpResources.svelte';
	import ToolboxPicker from '$lib/components/ToolboxPicker.svelte';
	import ConnectorIcon from '$lib/components/ConnectorIcon.svelte';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	export let tier: string;
	export let name: string;
	/** Owner or admin. */
	export let canEdit = false;

	/** The connectors' topic actions (`azioniDiTopic`): linking a Telegram chat,
	 *  a Drive folder… They used to be buttons in the sidebar; since 26 Oct 2026
	 *  they live in the card of their MCP. The dialog and its logic stay in the
	 *  topic page: this panel only shows the buttons and hands the click back. */
	type Azione = {
		connettore: string; namespace?: string; azione: string; chiave: string;
		etichetta: string; nome: string; icona: string; binding: string;
		campi: { options?: unknown }[];
	};
	export let azioni: Azione[] = [];
	/** The state of the actions that bind a CHANNEL (connected or not). */
	export let statiCanale: Record<string, ConnectorActionState> = {};
	export let azioneBusy = false;

	const dispatch = createEventDispatcher<{ count: number; azione: Azione }>();

	// A mailbox is linked from the Email card (McpMailboxes): not repeated here.
	const isMailbox = (a: Azione) => a.campi.some((f) => f.options === 'mailboxes');
	function mcpOf(a: Azione): string {
		const ns = a.namespace || '';
		const hit = Object.values(box?.mcp_catalogue ?? {}).find((m) => ns && m.namespaces.includes(ns));
		return hit ? hit.id : a.connettore;
	}
	$: linkActions = azioni.filter((a) => !isMailbox(a));
	// `box` in the dependencies: `mcpOf` reads the catalogue it carries.
	$: actionsFor = box && ((id: string) => linkActions.filter((a) => mcpOf(a) === id));
	$: unauthorisedActions = linkActions.filter((a) => !authorised.includes(mcpOf(a)));
	function actionTitle(a: Azione): string {
		const st = statiCanale[a.chiave];
		if (st?.connected) return `Collegato a ${st.bound} — clic per scollegare`;
		if (st?.suggestions?.length) return `Il bot è entrato in «${st.suggestions[0].label}» — clic per approvare`;
		return a.etichetta;
	}

	/** Linking implies authorising (owner, 26 Oct 2026): after a successful
	 *  link, the MCP of that connector is authorised in the room if it is not
	 *  yet. A failure leaves the link in place and says so. */
	export async function afterLink(connettore: string) {
		await load();
		const a = linkActions.find((x) => x.connettore === connettore);
		if (!a || !box?.mcp_catalogue) return;
		const id = mcpOf(a);
		const label = box.mcp_catalogue[id]?.label ?? id;
		if (!box.mcp_catalogue[id] || box.mcp?.[id]) return;
		try {
			await setChannelMcp(tier, name, { action: 'enable_mcp', mcp: id });
			toastSuccess(`${label} autorizzato nella stanza`);
		} catch (e) {
			toastError(`Collegato, ma ${label} non è stato autorizzato`, apiErrorDetail(e));
		}
		await load();
	}

	export function reload() {
		return load();
	}

	let box: Toolbox | null = null;
	let err = '';
	let busy = false;

	$: isGated = (v: string) => toolMayAsk(v, box?.gated ?? []);

	// ── The MCP form (clodia-platform#620) ─────────────────────────────────
	// A gateway that returns `mcp_catalogue` speaks MCPs: the room authorises
	// whole MCPs and decides their resources. Before
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
		if (!confirm(`Revocare ${m?.label ?? id}? Le sue risorse vengono rimosse.`)) return;
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

	async function act(action: ToolboxAction, verb: string): Promise<boolean> {
		if (busy) return false;
		busy = true;
		try {
			await setChannelTool(tier, name, action, verb);
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
							{#each actionsFor ? actionsFor(id) : [] as a (a.chiave)}
								<div class="link-row">
									{#if statiCanale[a.chiave]?.connected}
										<span class="muted">Collegato a <code>{statiCanale[a.chiave]?.bound}</code></span>
									{/if}
									{#if canEdit}
										<button type="button" class="link-btn"
											class:connected={statiCanale[a.chiave]?.connected}
											class:pending={!statiCanale[a.chiave]?.connected && (statiCanale[a.chiave]?.suggestions?.length ?? 0) > 0}
											disabled={azioneBusy} title={actionTitle(a)}
											on:click={() => dispatch('azione', a)}>
											{#if a.icona}<ConnectorIcon name={a.icona} size={12} />{/if}
											{statiCanale[a.chiave]?.connected ? 'Scollega' : a.etichetta}
										</button>
									{/if}
								</div>
							{/each}
							<McpResources mcp={m} rows={box.mcp?.[id]?.resources ?? []}
								linked={id === 'google' ? (box.linked_folders ?? []) : []} {canEdit} {busy}
								on:set={(e) => void mcpAct({ action: 'set_resource', mcp: id, uri: e.detail.uri, effect: e.detail.effect })}
								on:unset={(e) => void mcpAct({ action: 'unset_resource', mcp: id, uri: e.detail.uri })} />
							{#if id === 'email'}
								<McpMailboxes {tier} {name} {canEdit} />
							{/if}
							<details class="writes">
								<summary>Cosa scrive questa scelta</summary>
								<ul>
									<li><code>* · {m.namespaces.map((n) => `${n}.*`).join(', ')} · default</code></li>
									{#each box.mcp?.[id]?.resources ?? [] as r (r.uri)}
										<li><code>* · verbi su {r.uri.split(':')[0]} · {effectWord[r.effect]} {r.uri}</code></li>
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

	{#if canEdit && unauthorisedActions.length > 0}
		<!-- Linking an MCP not yet authorised: the link authorises it too. -->
		<div class="link-row">
			<span class="muted">Collega:</span>
			{#each unauthorisedActions as a (a.chiave)}
				<button type="button" class="link-btn"
					class:pending={(statiCanale[a.chiave]?.suggestions?.length ?? 0) > 0}
					disabled={azioneBusy} title="{actionTitle(a)} — autorizza anche {catalogue[mcpOf(a)]?.label ?? a.nome}"
					on:click={() => dispatch('azione', a)}>
					{#if a.icona}<ConnectorIcon name={a.icona} size={12} />{/if}
					{a.etichetta}
				</button>
			{/each}
		</div>
	{/if}

	{#if canEdit}
		<McpPicker {catalogue} {authorised} gated={box.gated ?? []} disabled={busy}
			on:pick={(e) => void authoriseMany(e.detail)} />
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
	.err { color: #dc2626; font-size: 11px; margin: 4px 0; }
	h4 { font-size: 11px; margin: 10px 0 2px; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
	.list li { display: flex; align-items: center; gap: 6px; font-size: 11px; min-width: 0; }
	.list code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.gated { color: #d97706; }
	.link-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
	.link-btn { font: inherit; font-size: 11px; padding: 2px 8px; cursor: pointer; display: inline-flex;
		align-items: center; gap: 4px; border: 1px solid var(--border); border-radius: 4px;
		background: transparent; color: inherit; }
	.link-btn:hover:not(:disabled) { border-color: var(--accent); }
	.link-btn.connected { border-color: #16a34a; }
	.link-btn.pending { border-color: #d97706; }
	.x {
		background: transparent; border: none; color: var(--fg-muted); cursor: pointer;
		font-size: 11px; padding: 0 2px; flex-shrink: 0;
	}
	.x:hover:not(:disabled) { color: #dc2626; }
</style>
