<script lang="ts">
	/**
	 * Helpdesk side widget (clodia-platform#702, epic #701).
	 *
	 * A side chat openable from every page, on the person's **DM with
	 * sysadmin** — not on a channel shared by everyone, as the widget removed on
	 * 25 Jul did (`helpdesk` topic): the conversation is the person's own scope,
	 * and what sysadmin does on their behalf is decided by them.
	 *
	 * Admin-only (owner decision, 19 Nov 2026): the layout mounts it under
	 * `$isAdmin`, and it checks again here, so moving the mount cannot widen it.
	 *
	 * Every message carries a hidden page reference (`$lib/pageContext`): the
	 * kind of page and the identifiers in its route — never the page contents.
	 *
	 * Gate cards raised in the DM are rendered with the same `GateCard` the
	 * topic page uses, and decided from here: the global GateApprovals popup
	 * leaves channel gates (`chat=chan:…`) to the inline card, so without it a
	 * confirmation asked in this DM would be visible only on the DM page.
	 */
	import { onDestroy, onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { renderMarkdown } from '$lib/markdown';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import AgentLiveBox from '$lib/components/AgentLiveBox.svelte';
	import GateCard from '$lib/components/GateCard.svelte';
	import GateGroupCard from '$lib/components/GateGroupCard.svelte';
	import AliasPills from '$lib/components/AliasPills.svelte';
	import { session } from '$lib/auth/session';
	import { isAdmin } from '$lib/stores/capabilities';
	import { onEventStream } from '$lib/stores/events-stream';
	import { HELPDESK_AGENT, currentRoom, helpdeskRequest, type HelpdeskRef } from '$lib/stores/helpdesk';
	import { toastSuccess } from '$lib/stores/toasts';
	import { pageRef, mergeRef, withPageContext } from '$lib/pageContext';
	import { leggiChoices } from '$lib/pillPersistenti';
	import { sinceLastReset } from '$lib/contextReset';
	import { etichettaTool, type PassoTool } from '$lib/toolLabel';
	import {
		decideBatch, gateBatch, gateBatchScelte, gateCardState, gateCardVisibile, gateGroups, parseGateMarker,
		recordDecision
	} from '$lib/gateCard';
	import {
		apiGet, apiPost, createOrOpenDm, getChannel, getChannelMessages, postChannelMessage,
		resetChannelContext, type ChannelMessage
	} from '$lib/api/client';

	const agent = HELPDESK_AGENT;
	const OPEN_KEY = 'clodia.helpdesk.open';
	const MAX_SHOWN = 80;

	let open = false;
	let dm: { tier: string; name: string } | null = null;
	let dmOwner = '';
	let messages: ChannelMessage[] = [];
	let draft = '';
	let sending = false;
	let resetting = false;
	let err = '';
	let streamEl: HTMLDivElement;
	let input: HTMLTextAreaElement;

	$: me = $session?.principal ?? '';

	// ── open / closed, remembered per browser ───────────────────────────────
	function readOpen(): boolean {
		try {
			return localStorage.getItem(OPEN_KEY) === '1';
		} catch {
			return false;
		}
	}
	function writeOpen(v: boolean) {
		try {
			localStorage.setItem(OPEN_KEY, v ? '1' : '0');
		} catch {
			/* storage off (private mode, quota): the state just isn't remembered */
		}
	}
	async function setOpen(v: boolean) {
		open = v;
		writeOpen(v);
		if (v) {
			await ensureStarted();
			await scrollDown();
			input?.focus();
		}
	}

	function errText(e: unknown): string {
		return e instanceof Error ? e.message : String(e);
	}

	// ── the DM ──────────────────────────────────────────────────────────────
	let starting: Promise<void> | null = null;
	function ensureStarted(): Promise<void> {
		if (dm) return Promise.resolve();
		if (starting) return starting;
		starting = (async () => {
			try {
				err = '';
				dm = await createOrOpenDm(agent);
				try {
					dmOwner = (await getChannel(dm.tier, dm.name)).meta?.owner ?? '';
				} catch {
					dmOwner = '';
				}
				await Promise.all([refresh(), refreshGateInfo()]);
			} catch (e) {
				err = errText(e);
				dm = null;
			} finally {
				starting = null;
			}
		})();
		return starting;
	}

	async function refresh() {
		if (!dm) return;
		try {
			const prev = messages.length;
			const next = await getChannelMessages(dm.tier, dm.name);
			messages = next;
			// A new AI message closes the live box of the turn that produced it.
			if (next.length > prev && next.slice(prev).some((m) => m.kind === 'ai')) live = {};
		} catch (e) {
			err = errText(e);
		}
	}

	/** The page reference of the current page, plus an explicit one if a
	 *  button asked for it. Identifiers only — see `$lib/pageContext`. */
	function currentRef(extra?: HelpdeskRef) {
		return mergeRef(pageRef($page.url.pathname, $currentRoom), extra);
	}

	async function send(text?: string, extra?: HelpdeskRef) {
		const body = (text ?? draft).trim();
		if (!body || sending) return;
		sending = true;
		if (text === undefined) draft = '';
		try {
			await ensureStarted();
			if (!dm) throw new Error(err || 'conversazione non disponibile');
			await postChannelMessage(dm.tier, dm.name, withPageContext(currentRef(extra), body));
			await refresh();
			await scrollDown();
		} catch (e) {
			err = errText(e);
			if (text === undefined) draft = body;
		} finally {
			sending = false;
		}
	}

	/** «Aiuto», «💬 Aiuto setup», «Finish setup»: open here and post the message. */
	const offRequest = helpdeskRequest.subscribe((req) => {
		if (!req) return;
		helpdeskRequest.set(null);
		if (!$isAdmin) return;
		void (async () => {
			await setOpen(true);
			if (req.message) await send(req.message, req.ref);
		})();
	});

	/** New conversation with sysadmin: the context is reset and the widget
	 *  shows only what comes after it. The DM keeps every message (its own
	 *  page, the audit): nothing is deleted. */
	async function resetCtx() {
		if (resetting || !dm) return;
		resetting = true;
		try {
			await resetChannelContext(dm.tier, dm.name);
			live = {};
			typing = [];
			// Empty at once; the marker read back by `refresh` keeps it so.
			messages = [...messages, { id: `reset-${Date.now()}`, kind: 'system',
				text: '__CLODIA_CONTEXT_RESET__' } as ChannelMessage];
			toastSuccess('Assistenza', 'Nuova conversazione: la chat del widget riparte da zero');
			await refresh();
		} catch (e) {
			err = errText(e);
		} finally {
			resetting = false;
		}
	}

	function openFull() {
		if (!dm) return;
		void goto(`/topics/${encodeURIComponent(dm.tier)}/${encodeURIComponent(dm.name)}`);
	}

	// ── rendering ───────────────────────────────────────────────────────────
	/** Every HTML comment is for the agent (markers, page reference):
	 *  `renderMarkdown` escapes HTML, so a comment left in would be printed. */
	const COMMENT_RE = /<!--[\s\S]*?-->/g;
	function visibleText(t: string): string {
		return (t || '').replace(COMMENT_RE, '').trim();
	}
	/** Navigation marker `<!-- goto=/tools|Integrazioni -->`: internal routes only. */
	const GOTO_RE = /<!--\s*goto\s*=(.*?)-->/gi;
	const ROUTE_OK = /^\/[a-zA-Z0-9/_-]*$/;
	function gotoTargets(t: string): { route: string; label: string }[] {
		const out: { route: string; label: string }[] = [];
		for (const m of (t || '').matchAll(GOTO_RE)) {
			const [route, label] = m[1].split('|').map((s) => s.trim());
			if (route && ROUTE_OK.test(route)) out.push({ route, label: label || route });
		}
		return out;
	}
	async function scrollDown() {
		await tick();
		if (streamEl) streamEl.scrollTop = streamEl.scrollHeight;
	}

	// Only the conversation after the last context reset (derived from the
	// messages, so it holds after a reload); the DM page shows everything.
	$: current = sinceLastReset(messages);
	$: shown = current.messages.slice(-MAX_SHOWN);
	$: lastId = shown.length ? shown[shown.length - 1].id : null;
	$: lastChoices = (() => {
		const last = shown[shown.length - 1];
		return last && last.author !== me ? leggiChoices(last.text) : null;
	})();

	// ── typing + live box (SSE) ─────────────────────────────────────────────
	let typing: string[] = [];
	const typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};
	function setTyping(who: string, on: boolean) {
		if (typingTimers[who]) {
			clearTimeout(typingTimers[who]);
			delete typingTimers[who];
		}
		if (on) {
			if (!typing.includes(who)) typing = [...typing, who];
			typingTimers[who] = setTimeout(() => (typing = typing.filter((a) => a !== who)), 90000);
		} else {
			typing = typing.filter((a) => a !== who);
		}
	}
	type Live = { think: string; tools: PassoTool[] };
	let live: Record<string, Live> = {};
	function liveOf(who: string): Live {
		return live[who] ?? { think: '', tools: [] };
	}
	function pushTool(who: string, step: PassoTool) {
		const prev = liveOf(who).tools;
		if (prev[prev.length - 1]?.esteso === step.esteso) return;
		live = { ...live, [who]: { ...liveOf(who), tools: [...prev, step].slice(-25) } };
	}
	function mine(p: Record<string, unknown>): boolean {
		return !!dm && p.tier === dm.tier && p.name === dm.name;
	}
	function liveAgent(cid: unknown): string | null {
		if (!dm || typeof cid !== 'string' || !cid.startsWith(`chan:${dm.tier}:${dm.name}:`)) return null;
		return cid.split(':').at(-1) || null;
	}
	$: typingLabel = typing.length
		? `${typing.join(' e ')} ${typing.length === 1 ? 'sta scrivendo' : 'stanno scrivendo'}…`
		: sending ? 'invio…' : '';

	// ── gate cards (same rules as the topic page, per MESSAGE id) ───────────
	type GateInfo = { crosses?: string; decided_by?: string; decider_name?: string; scope?: string;
	                  asker_role?: string; asker_note?: string; editable?: Record<string, unknown>;
	                  remember?: Record<string, string> };
	type Gate = { id: string; agent: string; instance: string; verb: string };
	let gateInfo: Record<string, GateInfo> = {};
	let gateAperti = new Set<string>();
	let gateInfoTs = 0;
	let gateDecided: Record<string, string> = {};
	let gateDeciding = false;
	async function refreshGateInfo() {
		try {
			const r = await apiGet<{ requests: Array<GateInfo & { agent: string; instance: string; verb: string }> }>(
				'/api/gate/pending');
			const m: Record<string, GateInfo> = {};
			const aperti = new Set<string>();
			for (const q of r?.requests ?? []) {
				const k = `${q.agent}|${q.instance || '-'}|${q.verb}`;
				aperti.add(k);
				m[k] = { crosses: q.crosses, decided_by: q.decided_by, decider_name: q.decider_name,
				         scope: q.scope, asker_role: q.asker_role, asker_note: q.asker_note,
				         editable: q.editable, remember: q.remember };
			}
			gateInfo = m;
			gateAperti = aperti;
			gateInfoTs = Date.now();
		} catch {
			// A list that did not arrive is not an empty list: the cards keep their buttons.
		}
	}
	$: isOwner = !!me && (!dmOwner || dmOwner === me);
	function canDecideGate(id: string): boolean {
		const info = gateInfo[id];
		if (!info?.decided_by) return isOwner;
		return info.decided_by.startsWith('owner:') ? isOwner : $isAdmin;
	}
	async function decideGate(
		msgId: string, g: Gate, approve: boolean,
		cell: { who: 'spawn' | 'seed' | 'all'; where?: 'chat' | 'global' } = { who: 'spawn' },
		corrections?: Record<string, unknown>
	) {
		if (gateDeciding) return;
		gateDeciding = true;
		try {
			const r = await apiPost<{ memory?: { remembered?: boolean; error?: string } }>(
				approve ? '/api/gate/approve' : '/api/gate/deny',
				{ agent: g.agent, instance: g.instance, verb: g.verb,
				  ...(approve ? { who: cell.who, ...(cell.where ? { where: cell.where } : {}) } : { remember: 'once' }),
				  ...(approve && corrections ? { arguments: corrections } : {}) });
			const mem = r?.memory;
			gateDecided = recordDecision(gateDecided, { id: msgId },
				!approve ? 'negato'
					: corrections ? 'approvato con modifiche'
					: cell.who === 'spawn' ? 'approvato'
					: mem && mem.remembered === false ? 'approvato (solo per stavolta)'
					: `approvato e ricordato per ${cell.who === 'seed' ? g.agent : 'tutti gli agenti'}`
						+ (cell.where === 'chat' ? ' in questa stanza' : ' in tutte le stanze'));
			if (mem && mem.remembered === false && mem.error) err = mem.error;
		} catch (e) {
			err = errText(e);
		} finally {
			gateDeciding = false;
		}
	}
	// Per shown message: marker, state, own visibility, and the grouping of
	// consecutive gate cards into one (clodia-platform#489) — the same rules as
	// the topic page. No batch bar above the composer any more.
	type GateRiga = { gate: Gate | null; stato: 'decisa' | 'chiusa' | 'da-decidere'; card: boolean };
	$: gateRighe = shown.map((m, i): GateRiga => {
		const gate = parseGateMarker(m.text);
		const stato = gate
			? gateCardState({ decisi: gateDecided, aperti: gateAperti, listaTs: gateInfoTs }, m, gate)
			: 'chiusa';
		return { gate, stato, card: gate !== null && gateCardVisibile(stato, i === shown.length - 1) };
	});
	$: gateGruppi = gateGroups(gateRighe.map((r) => ({ gate: r.gate !== null, card: r.card })));
	function righeGruppo(idx: number[]) {
		return idx.map((k) => {
			const g = gateRighe[k].gate!;
			const id = shown[k].id;
			return { key: id, g, stato: gateRighe[k].stato, decided: gateDecided[id],
			         canDecide: canDecideGate(g.id), info: gateInfo[g.id] };
		});
	}
	async function decideGateGroup(idx: number[], e: CustomEvent<{ approve: boolean; keys: string[] }>) {
		if (gateDeciding) return;
		gateDeciding = true;
		const { approve, keys } = e.detail;
		const blocco = gateBatch({ decisi: gateDecided, aperti: gateAperti, listaTs: gateInfoTs },
			idx.map((k) => ({ msg: shown[k], gate: gateRighe[k].gate! })), (g) => canDecideGate(g.id));
		const voci = gateBatchScelte(blocco, keys);
		try {
			const esito = await decideBatch(voci, new Set(voci.map((v) => v.id)), async (v) => {
				await apiPost(approve ? '/api/gate/approve' : '/api/gate/deny',
					{ agent: v.agent, instance: v.instance, verb: v.verb, remember: 'once' });
				for (const id of v.msgIds) {
					gateDecided = recordDecision(gateDecided, { id }, approve ? 'approvato (in blocco)' : 'negato (in blocco)');
				}
			});
			if (esito.falliti.length) {
				err = `${esito.falliti.length} non decise: ` +
					esito.falliti.map((f) => `${f.voce.agent} · ${f.voce.verb}: ${f.errore}`).join(' — ');
			}
			await refreshGateInfo();
		} finally {
			gateDeciding = false;
		}
	}

	// ── lifecycle ───────────────────────────────────────────────────────────
	let offEvt: (() => void) | null = null;
	// Safety net while open: the SSE stream can drop, the conversation must not freeze.
	let poll: ReturnType<typeof setInterval> | null = null;
	onMount(() => {
		offEvt = onEventStream((ev) => {
			const p = (ev.payload ?? {}) as Record<string, unknown>;
			if (ev.type === 'channel_typing') {
				if (mine(p)) setTyping(String(p.agent), p.state === 'start');
				return;
			}
			if (ev.type === 'channel_message') {
				if (mine(p)) void refresh().then(() => refreshGateInfo()).then(scrollDown);
				return;
			}
			const who = liveAgent(p.chat_id);
			if (!who) return;
			if (ev.type === 'thinking_chunk') {
				live = { ...live, [who]: { ...liveOf(who), think: liveOf(who).think + String(p.delta ?? '') } };
			} else if (ev.type === 'tool_use') {
				const e = etichettaTool(String(p.tool ?? ''), String(p.input_summary ?? ''));
				pushTool(who, { breve: `🔧 ${e.breve}`, esteso: `🔧 ${e.esteso}` });
			}
		});
		poll = setInterval(() => {
			if (open && dm) void refresh().then(() => refreshGateInfo());
		}, 15000);
		if (readOpen()) void setOpen(true);
	});
	onDestroy(() => {
		offRequest();
		offEvt?.();
		if (poll) clearInterval(poll);
		for (const t of Object.values(typingTimers)) clearTimeout(t);
	});

	$: lastId, typingLabel, open && scrollDown();
</script>

{#if $isAdmin}
	{#if open}
		<section class="cw-panel" aria-label="Assistenza — {agent}">
			<header class="cw-head">
				<AgentAvatar name={agent} size={22} />
				<span class="cw-title">Assistenza · {agent}</span>
				<button type="button" class="cw-icon" on:click={openFull} disabled={!dm}
					title="Apri la conversazione a tutta pagina" aria-label="Apri la conversazione">↗</button>
				<button type="button" class="cw-icon" on:click={resetCtx} disabled={resetting || !dm}
					title="Nuova conversazione: azzera il contesto e svuota la chat del widget (i messaggi restano nella DM)"
					aria-label="Nuova conversazione">{resetting ? '…' : '⟳'}</button>
				<button type="button" class="cw-icon cw-x" on:click={() => setOpen(false)}
					title="Chiudi" aria-label="Chiudi l'assistenza">×</button>
			</header>
			<div class="cw-stream" bind:this={streamEl}>
				{#if err}<div class="cw-err" role="alert">{err}</div>{/if}
				{#each shown as m, i (m.id)}
					{@const gate = gateRighe[i]?.gate ?? null}
					{@const gStato = gate ? gateRighe[i].stato : null}
					{@const gateVisibile = gateRighe[i]?.card ?? false}
					{@const gGruppo = gateGruppi[i] ?? { ruolo: null, righe: [] }}
					{@const body = visibleText(m.text)}
					<div class="cw-msg" class:mine={m.author === me} class:sys={m.kind === 'system'}>
						<div class="cw-author">{m.author}</div>
						{#if body}<div class="cw-body">{@html renderMarkdown(body)}</div>{/if}
						{#if gGruppo.ruolo === 'gruppo'}
							<GateGroupCard righe={righeGruppo(gGruppo.righe)} busy={gateDeciding}
								on:decide={(e) => decideGateGroup(gGruppo.righe, e)}>
								<svelte:fragment slot="detail" let:riga>
									<GateCard g={riga.g} stato={riga.stato} decided={riga.decided} info={gateInfo[riga.g.id]}
										canDecide={riga.canDecide} busy={gateDeciding} isAdmin={$isAdmin}
										on:decide={(e) => e.detail.approve
											? decideGate(riga.key, riga.g, true, e.detail.cell, e.detail.corrections)
											: decideGate(riga.key, riga.g, false)} />
								</svelte:fragment>
							</GateGroupCard>
						{:else if gateVisibile && gate && gStato && gGruppo.ruolo !== 'membro'}
							{@const g = gate}
							<GateCard {g} stato={gStato} decided={gateDecided[m.id]} info={gateInfo[g.id]}
								canDecide={canDecideGate(g.id)} busy={gateDeciding} isAdmin={$isAdmin}
								on:decide={(e) => e.detail.approve
									? decideGate(m.id, g, true, e.detail.cell, e.detail.corrections)
									: decideGate(m.id, g, false)} />
						{/if}
						{#if m.id === lastId && lastChoices}
							<div class="cw-pills">
								{#each lastChoices.items as c}
									<button type="button" class="cw-pill" on:click={() => send(c)} disabled={sending}>{c}</button>
								{/each}
							</div>
						{/if}
						{#if gotoTargets(m.text).length}
							<div class="cw-pills">
								{#each gotoTargets(m.text) as t}
									<button type="button" class="cw-goto" on:click={() => goto(t.route)} title={t.route}>→ {t.label}</button>
								{/each}
							</div>
						{/if}
					</div>
				{:else}
					{#if !err}<p class="cw-empty">{!dm ? 'Apro la conversazione…' : current.reset ? `Nuova conversazione. Scrivi a ${agent}: ti risponde qui.` : `Scrivi a ${agent}: ti risponde qui, senza lasciare la pagina.`}</p>{/if}
				{/each}
				{#each Object.entries(live) as [who, l] (who)}
					<AgentLiveBox agent={who} think={l.think} tools={l.tools} stoppable={false} />
				{/each}
				{#if typingLabel}
					<div class="cw-typing" aria-live="polite">
						<span class="cw-dots" aria-hidden="true"><span></span><span></span><span></span></span>
						{typingLabel}
					</div>
				{/if}
			</div>
			<div class="cw-composer">
				<!-- clodia-platform#723: alias pills inside the field, above the text. -->
				<div class="cw-field">
					<AliasPills target={input} />
					<textarea bind:this={input} bind:value={draft} rows="2" placeholder="Scrivi a {agent}…"
						aria-label="Messaggio per {agent}"
						on:keydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
				</div>
				<button type="button" class="cw-send" on:click={() => send()} disabled={sending || !draft.trim()}
					aria-label="Invia">➤</button>
			</div>
			<p class="cw-note">Il messaggio dice a {agent} su quale pagina sei (tipo e nome), mai cosa contiene.</p>
		</section>
	{:else}
		<button type="button" class="cw-tab" on:click={() => setOpen(true)}
			aria-label="Apri l'assistenza ({agent})" aria-expanded="false" title="Assistenza — {agent}">
			<span class="cw-tab-icon" aria-hidden="true">💬</span>
			<span class="cw-tab-text">Aiuto</span>
		</button>
	{/if}
{/if}

<style>
	/* Collapsed: a narrow tab on the right edge, half-way up — away from the
	   composer and its send button (bottom), the toasts (bottom-right), the gate
	   popup (top-right) and the sidebar (left). */
	.cw-tab {
		position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 60;
		display: flex; flex-direction: column; align-items: center; gap: 6px;
		padding: 10px 5px; border: 1px solid var(--border); border-right: none;
		border-radius: 10px 0 0 10px; background: var(--card-bg); color: var(--fg);
		font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
		box-shadow: 0 6px 18px rgba(0,0,0,.25);
	}
	.cw-tab:hover, .cw-tab:focus-visible { border-color: var(--accent); color: var(--accent); }
	.cw-tab-icon { font-size: 15px; line-height: 1; }
	.cw-tab-text { writing-mode: vertical-rl; transform: rotate(180deg); letter-spacing: .04em; }

	.cw-panel {
		position: fixed; right: 12px; top: 12px; bottom: 12px; z-index: 70;
		width: min(400px, calc(100vw - 24px));
		display: flex; flex-direction: column; background: var(--bg);
		border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
		box-shadow: 0 18px 50px rgba(0,0,0,.45);
	}
	/* Phone: the panel takes the screen while open (it has its own ×), and the
	   tab is the only thing left when closed. */
	@media (max-width: 640px) {
		.cw-panel { inset: 0; width: auto; border-radius: 0; border: none; }
		.cw-tab { padding: 8px 4px; }
	}
	.cw-head { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 10px 12px;
		background: var(--card-bg); border-bottom: 1px solid var(--border); }
	.cw-title { font-weight: 700; font-size: 14px; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.cw-icon { background: transparent; border: none; color: var(--fg-muted); font-size: 16px; cursor: pointer; line-height: 1; padding: 2px 5px; border-radius: 6px; }
	.cw-icon:hover:not(:disabled) { color: var(--fg); background: rgba(127,127,127,.12); }
	.cw-icon:disabled { opacity: .4; cursor: default; }
	.cw-x { font-size: 20px; }
	.cw-stream { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
	.cw-err { color: #e85d75; font-size: 12px; }
	.cw-empty { color: var(--fg-muted); font-size: 13px; text-align: center; margin-top: 20px; }
	.cw-msg { max-width: 92%; background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 7px 10px; align-self: flex-start; }
	.cw-msg.mine { align-self: flex-end; background: color-mix(in srgb, var(--accent) 10%, transparent); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
	.cw-msg.sys { align-self: center; background: transparent; font-size: 12px; color: var(--fg-muted); }
	.cw-author { font-size: 11px; font-weight: 700; color: var(--fg-muted); margin-bottom: 2px; }
	.cw-body { font-size: 13.5px; line-height: 1.5; overflow-wrap: anywhere; }
	.cw-body :global(p) { margin: 0 0 .4em; }
	.cw-body :global(p:last-child) { margin-bottom: 0; }
	.cw-body :global(pre) { overflow-x: auto; font-size: 12px; }
	.cw-body :global(table) { font-size: 12px; border-collapse: collapse; display: block; overflow-x: auto; }
	.cw-body :global(td), .cw-body :global(th) { border: 1px solid var(--border); padding: 2px 6px; }
	.cw-body :global(code) { background: rgba(127,127,127,.18); padding: 0 4px; border-radius: 3px; }
	.cw-typing { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--fg-muted); }
	.cw-dots { display: inline-flex; gap: 4px; align-items: center; height: 12px; }
	.cw-dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-muted); opacity: .4; animation: cw-bounce 1s infinite ease-in-out; }
	.cw-dots span:nth-child(2) { animation-delay: .15s; }
	.cw-dots span:nth-child(3) { animation-delay: .3s; }
	@keyframes cw-bounce { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
	.cw-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
	.cw-pill { background: transparent; border: 1px solid color-mix(in srgb, var(--accent) 50%, var(--border)); color: var(--fg); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
	.cw-goto { background: var(--accent); border: none; color: var(--accent-fg); font: inherit; font-weight: 700; font-size: 12px; padding: 5px 12px; border-radius: 8px; cursor: pointer; }
	.cw-composer { flex: 0 0 auto; display: flex; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--border); }
	.cw-field { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; background: rgba(127,127,127,.08); border: 1px solid var(--border); border-radius: 10px; }
	.cw-field:focus-within { border-color: var(--accent); }
	.cw-composer textarea { flex: 1 1 auto; background: transparent; border: none; outline: none; color: var(--fg); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; resize: none; max-height: 120px; }
	.cw-send { background: var(--accent); border: none; color: var(--accent-fg); font-weight: 700; width: 40px; border-radius: 10px; cursor: pointer; }
	.cw-send:disabled { opacity: .5; cursor: not-allowed; }
	.cw-note { margin: 0; padding: 0 12px 8px; font-size: 10.5px; color: var(--fg-muted); }
</style>
