<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { renderMarkdown } from '$lib/markdown';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import { authToken, restoreSession, session, validateSession } from '$lib/auth/session';
	import { helpdeskRequest } from '$lib/stores/helpdesk';
	import {
		createChannel, getChannelMessages, postChannelMessage, resetChannelContext,
		type ChannelMessage
	} from '$lib/api/client';

	// Widget chat flottante (stile customer-care) verso un agente su un topic
	// dedicato — non fa uscire dalla pagina corrente.
	export let agent = 'wainston';
	export let tier = 'SEAL-1';
	export let name = 'helpdesk';
	export let title = 'Assistenza';
	export let initialMessage = '';
	export let launcherLabel = 'help - parla con wainston';
	// Topic da cui l'utente sta chiamando l'agente (se è su una pagina topic):
	// glielo comunichiamo così può ispezionarlo (runtime.inspect_topic, entro clearance).
	export let contextTier = '';
	export let contextName = '';

	let open = false;
	let started = false;
	let messages: ChannelMessage[] = [];
	let draft = '';
	let sending = false;
	let err = '';
	let poll: ReturnType<typeof setInterval> | null = null;
	let streamEl: HTMLDivElement;

	const _CH_RE = /<!--\s*choices(-multi)?\s*=(.*?)-->/i;
	// Marker di NAVIGAZIONE (janitor): <!-- goto=/tools --> oppure
	// <!-- goto=/tools|Integrazioni --> → bottone "Vai a …" che porta l'utente
	// alla pagina giusta senza uscire dal widget.
	const _GOTO_RE = /<!--\s*goto\s*=(.*?)-->/gi;
	// Qualunque commento HTML (incluso il marker di contesto ctx) è solo per
	// l'agente: non va mostrato nella bolla.
	const _COMMENT_RE = /<!--[\s\S]*?-->/g;
	const me = () => $session?.principal ?? '';
	function stripChoices(t: string) {
		return (t || '').replace(_COMMENT_RE, '').trim();
	}
	// Contesto-topic: lo iniettiamo UNA volta per (apertura, topic) come commento
	// nascosto in testa al primo messaggio → l'agente sa da dove lo chiami e può
	// ispezionare il topic entro la sua clearance. Il commento è invisibile in UI.
	let _ctxSent = '';
	function ctxPrefix(): string {
		const key = contextTier && contextName ? `${contextTier}/${contextName}` : '';
		if (key && _ctxSent !== key) {
			_ctxSent = key;
			return `<!-- L'utente ti sta scrivendo dal topic ${contextTier}/${contextName}. ` +
				`Se utile per assisterlo, ispezionalo con ` +
				`runtime.inspect_topic(tier="${contextTier}", name="${contextName}"): ` +
				`vedrai metadati, agenti e ultimi messaggi entro la tua clearance. -->\n`;
		}
		return '';
	}
	function choices(t: string): string[] {
		const m = (t || '').match(_CH_RE);
		return m ? m[2].split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [];
	}
	// Solo route interne (sicurezza: niente URL esterni / javascript:).
	const _ROUTE_RE = /^\/[a-zA-Z0-9/_-]*$/;
	function gotoTargets(t: string): { route: string; label: string }[] {
		const out: { route: string; label: string }[] = [];
		for (const m of (t || '').matchAll(_GOTO_RE)) {
			const [route, label] = m[1].split('|').map((s) => s.trim());
			if (route && _ROUTE_RE.test(route)) out.push({ route, label: label || route });
		}
		return out;
	}
	function errText(e: unknown): string {
		return e instanceof Error ? e.message : String(e);
	}

	async function ensureLoggedIn() {
		if (!authToken()) await restoreSession();
		if (!authToken() || !(await validateSession())) {
			throw new Error(`Login richiesto: accedi di nuovo per parlare con ${agent}.`);
		}
	}

	async function ensureTopic() {
		await ensureLoggedIn();
		// contact_agent = l'agent del widget → è lui a rispondere nel canale di help
		await createChannel({ name, tier, title, type: 'infra', contact_agent: agent });
	}
	async function refresh() {
		try { messages = await getChannelMessages(tier, name); } catch (e) { err = errText(e); }
	}
	async function scrollDown() { await tick(); if (streamEl) streamEl.scrollTop = streamEl.scrollHeight; }

	async function toggle() {
		open = !open;
		if (open && !started) {
			try {
				await ensureStarted();
				if (initialMessage && messages.length === 0) {
					await postChannelMessage(tier, name, ctxPrefix() + initialMessage);
					await refresh();
				}
				await scrollDown();
			} catch (e) { err = errText(e); }
		}
	}

	async function ensureStarted() {
		if (started) return;
		started = true;
		await ensureTopic();
		await refresh();
		poll = setInterval(async () => { await refresh(); }, 4000);
	}

	// Apertura pilotata da una pagina (store helpdesk): apre il widget e posta il
	// messaggio preparato come richiesta dell'utente — anche se c'è già cronologia
	// (a differenza dell'initialMessage, che si posta solo a canale vuoto).
	async function openWith(message: string) {
		open = true;
		try {
			await ensureStarted();
			if (message) {
				await postChannelMessage(tier, name, ctxPrefix() + message);
				await refresh();
			}
			await scrollDown();
		} catch (e) { err = errText(e); }
	}

	const _unsub = helpdeskRequest.subscribe((req) => {
		if (req) { void openWith(req.message); helpdeskRequest.set(null); }
	});

	async function send(text?: string) {
		const body = (text ?? draft).trim();
		if (!body || sending) return;
		sending = true; draft = '';
		try {
			await ensureLoggedIn();
			await postChannelMessage(tier, name, ctxPrefix() + body);
			await refresh(); await scrollDown();
		} catch (e) { err = errText(e); draft = body; }
		finally { sending = false; }
	}

	// Azzera il contesto della chat con l'agente (nuova sessione da zero): la
	// history resta visibile ma il prossimo turno riparte pulito. Ri-inietteremo
	// il contesto-topic al primo messaggio successivo.
	let resetting = false;
	async function resetCtx() {
		if (resetting) return;
		resetting = true;
		try {
			await ensureLoggedIn();
			await resetChannelContext(tier, name);
			_ctxSent = '';
			await refresh();
		} catch (e) { err = errText(e); }
		finally { resetting = false; }
	}

	onDestroy(() => { _unsub(); if (poll) clearInterval(poll); });
	$: lastId = messages.length ? messages[messages.length - 1].id : null;
	// "Sta elaborando": in attesa di risposta dell'agente = l'ultimo messaggio è
	// dell'utente (o l'invio è in corso). Mostra l'indicatore typing finché
	// l'agente non risponde.
	$: awaitingReply = started && messages.length > 0 && messages[messages.length - 1].author === me();
	$: thinking = sending || awaitingReply;
	$: lastId, scrollDown();
	$: thinking, scrollDown();
</script>

{#if open}
	<div class="cw-panel">
		<header class="cw-head">
			<AgentAvatar name={agent} size={22} />
			<span class="cw-title">{title}</span>
			<button class="cw-reset" on:click={resetCtx} disabled={resetting || !started}
				title="Azzera il contesto della conversazione (riparte pulita)" aria-label="Azzera contesto">
				{resetting ? '…' : '⟳'}
			</button>
			<button class="cw-x" on:click={toggle} aria-label="Chiudi">×</button>
		</header>
		<div class="cw-stream" bind:this={streamEl}>
			{#if err}<div class="cw-err">{err}</div>{/if}
			{#each messages as m (m.id)}
				<div class="cw-msg" class:mine={m.author === me()}>
					<div class="cw-author">{m.author}</div>
					<div class="cw-body">{@html renderMarkdown(stripChoices(m.text))}</div>
					{#if choices(m.text).length && m.id === lastId}
						<div class="cw-pills">
							{#each choices(m.text) as c}
								<button class="cw-pill" on:click={() => send(c)} disabled={sending}>{c}</button>
							{/each}
						</div>
					{/if}
					{#if gotoTargets(m.text).length}
						<div class="cw-pills">
							{#each gotoTargets(m.text) as g}
								<button class="cw-goto" on:click={() => goto(g.route)} title={g.route}>→ {g.label}</button>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<p class="cw-empty">Avvio la conversazione…</p>
			{/each}
			{#if thinking}
				<div class="cw-msg cw-typing" aria-live="polite" aria-label="{agent} sta scrivendo">
					<div class="cw-author">{agent}</div>
					<div class="cw-dots"><span></span><span></span><span></span></div>
				</div>
			{/if}
		</div>
		<div class="cw-composer">
			<textarea bind:value={draft} rows="1" placeholder="Scrivi a {agent}…"
				on:keydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
			<button class="cw-send" on:click={() => send()} disabled={sending || !draft.trim()}>➤</button>
		</div>
	</div>
{/if}

<button
	class="cw-launcher"
	class:open
	on:click={toggle}
	aria-label={open ? 'Chiudi help Wainston' : launcherLabel}
	aria-expanded={open}
>
	<span class="cw-launcher-icon" aria-hidden="true">{open ? '×' : '💬'}</span>
	<span class="cw-launcher-text">{open ? 'Chiudi' : launcherLabel}</span>
</button>

<style>
	.cw-launcher {
		position: fixed; right: 20px; bottom: 20px; z-index: 60;
		background: var(--accent); color: #1a1208; border: none; border-radius: 999px;
		display: inline-flex; align-items: center; justify-content: center; gap: 8px;
		width: 44px; height: 44px; padding: 0 13px; overflow: hidden; white-space: nowrap;
		font-weight: 700; font-size: 13px; cursor: pointer;
		box-shadow: 0 8px 24px rgba(0,0,0,.35);
		transition: width .16s ease, background .12s ease, color .12s ease;
	}
	.cw-launcher:hover,
	.cw-launcher:focus-visible {
		width: 198px;
	}
	.cw-launcher.open {
		width: 96px;
		background: var(--card-bg);
		color: var(--fg);
		border: 1px solid var(--border);
	}
	.cw-launcher-icon { flex: 0 0 auto; font-size: 18px; line-height: 1; }
	.cw-launcher-text {
		flex: 0 0 auto;
		opacity: 0;
		max-width: 0;
		overflow: hidden;
		transition: opacity .12s ease, max-width .16s ease;
	}
	.cw-launcher:hover .cw-launcher-text,
	.cw-launcher:focus-visible .cw-launcher-text,
	.cw-launcher.open .cw-launcher-text {
		opacity: 1;
		max-width: 160px;
	}
	.cw-panel {
		position: fixed; right: 20px; bottom: 74px; z-index: 60;
		width: min(380px, calc(100vw - 40px)); height: min(540px, calc(100vh - 120px));
		display: flex; flex-direction: column; background: var(--bg);
		border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
		box-shadow: 0 18px 50px rgba(0,0,0,.45);
	}
	.cw-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 12px;
		background: var(--card-bg); border-bottom: 1px solid var(--border); }
	.cw-title { font-weight: 700; font-size: 14px; flex: 1 1 auto; }
	.cw-reset { background: transparent; border: none; color: var(--fg-muted); font-size: 16px; cursor: pointer; line-height: 1; padding: 0 2px; }
	.cw-reset:hover:not(:disabled) { color: var(--fg); }
	.cw-reset:disabled { opacity: .4; cursor: default; }
	.cw-x { background: transparent; border: none; color: var(--fg-muted); font-size: 20px; cursor: pointer; line-height: 1; }
	.cw-stream { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
	.cw-err { color: #e85d75; font-size: 12px; }
	.cw-empty { color: var(--fg-muted); font-size: 13px; text-align: center; margin-top: 20px; }
	.cw-msg { max-width: 88%; background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 7px 10px; align-self: flex-start; }
	.cw-msg.mine { align-self: flex-end; background: rgba(255,107,61,.10); border-color: rgba(255,107,61,.3); }
	.cw-author { font-size: 11px; font-weight: 700; color: var(--fg-muted); margin-bottom: 2px; }
	.cw-body { font-size: 13.5px; line-height: 1.5; }
	.cw-body :global(p) { margin: 0 0 .4em; }
	.cw-body :global(p:last-child) { margin-bottom: 0; }
	.cw-body :global(table) { font-size: 12px; border-collapse: collapse; }
	.cw-body :global(td), .cw-body :global(th) { border: 1px solid var(--border); padding: 2px 6px; }
	.cw-body :global(code) { background: rgba(0,0,0,.25); padding: 0 4px; border-radius: 3px; }
	.cw-typing { align-self: flex-start; padding: 8px 12px; }
	.cw-dots { display: inline-flex; gap: 4px; align-items: center; height: 12px; }
	.cw-dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-muted); opacity: .4; animation: cw-bounce 1s infinite ease-in-out; }
	.cw-dots span:nth-child(2) { animation-delay: .15s; }
	.cw-dots span:nth-child(3) { animation-delay: .3s; }
	@keyframes cw-bounce { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
	.cw-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
	.cw-pill { background: transparent; border: 1px solid rgba(255,107,61,.5); color: var(--fg); font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
	.cw-goto { background: var(--accent); border: none; color: #1a1208; font-weight: 700; font-size: 12px; padding: 5px 12px; border-radius: 8px; cursor: pointer; }
	.cw-goto:hover { filter: brightness(1.05); }
	.cw-composer { flex: 0 0 auto; display: flex; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--border); }
	.cw-composer textarea { flex: 1 1 auto; background: rgba(0,0,0,.25); border: 1px solid var(--border); color: var(--fg); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; resize: none; max-height: 100px; }
	.cw-send { background: var(--accent); border: none; color: #1a1208; font-weight: 700; width: 38px; border-radius: 10px; cursor: pointer; }
	.cw-send:disabled { opacity: .5; }
</style>
