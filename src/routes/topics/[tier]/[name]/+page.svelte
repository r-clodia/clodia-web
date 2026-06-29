<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { page } from '$app/stores';
	import { session } from '$lib/auth/session';
	import { onEventStream, startEventStream } from '$lib/stores/events-stream';
	import { renderMarkdown } from '$lib/markdown';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import {
		ApiError,
		getAgents,
		getChannel,
		getChannelMessages,
		postChannelMessage,
		resetChannelContext,
		setChannelParticipant,
		getChannelFiles,
		uploadChannelFile,
		channelFileUrl,
		type ChannelInfo,
		type ChannelMessage,
		type ChannelFile
	} from '$lib/api/client';

	$: params = $page.params as Record<string, string>;
	$: tier = params.tier ?? '';
	$: name = params.name ?? '';

	let info: ChannelInfo | null = null;
	let messages: ChannelMessage[] = [];
	let files: ChannelFile[] = [];
	// Browser file navigabile: subpath corrente relativo a files/ ('' = radice).
	let filePath = '';
	$: crumbs = filePath ? filePath.split('/') : [];
	async function loadFiles() {
		try {
			files = await getChannelFiles(tier, name, filePath);
		} catch {
			/* ignore */
		}
	}
	function openDir(entry: ChannelFile) {
		filePath = entry.path; // path già relativo alla root del topic
		void loadFiles();
	}
	function gotoCrumb(idx: number) {
		// idx = -1 → radice; altrimenti fino al segmento idx incluso
		filePath = idx < 0 ? '' : crumbs.slice(0, idx + 1).join('/');
		void loadFiles();
	}
	let loadErr = '';
	let draft = '';
	let sending = false;
	let resetting = false;
	let newParticipant = '';
	let stream: HTMLElement;
	let poll: ReturnType<typeof setInterval> | null = null;
	let loadedKey = '';
	let fileInput: HTMLInputElement;
	let composer: HTMLTextAreaElement;

	// "sta scrivendo…" — pilotato dagli eventi SSE channel_typing del backend.
	let typing: string[] = [];
	const typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};
	function setTyping(agent: string, on: boolean) {
		if (typingTimers[agent]) {
			clearTimeout(typingTimers[agent]);
			delete typingTimers[agent];
		}
		if (on) {
			if (!typing.includes(agent)) typing = [...typing, agent];
			// safety: auto-pulizia se lo 'stop' si perde
			typingTimers[agent] = setTimeout(() => (typing = typing.filter((a) => a !== agent)), 90000);
		} else {
			typing = typing.filter((a) => a !== agent);
			// NON azzerare qui il live: "typing off" scatta anche quando il main
			// agent è idle / in ATTESA dei subagent (che stanno ancora lavorando) →
			// azzerare farebbe sparire la barra task/tools mentre i subagent girano.
			// Il reset avviene all'arrivo del messaggio finale (refreshMessages).
		}
	}
	$: typingLabel =
		typing.length === 0
			? ''
			: `${typing.join(' e ')} ${typing.length === 1 ? 'sta scrivendo' : 'stanno scrivendo'}…`;

	// --- Ragionamento / attività live del turno del risponditore -----------
	// Il backend emette thinking_chunk / message_chunk / tool_use sul bus, con
	// chat_id = `chan:{tier}:{name}:{agent}`. Li accumuliamo in un pannello
	// "Ragionamento" comprimibile (di default aperto): sui task lunghi mostra
	// che l'agente sta effettivamente lavorando, invece di sembrare bloccato.
	let liveThink = '';
	let liveReply = '';
	let liveTools: string[] = [];
	let thinkOpen = true;
	const chatBelongs = (cid: unknown) =>
		typeof cid === 'string' && cid.startsWith(`chan:${tier}:${name}:`);
	function resetLive() {
		liveThink = '';
		liveReply = '';
		liveTools = [];
	}
	$: hasLive = !!(liveThink || liveReply || liveTools.length);
	function visibleMessages(items: ChannelMessage[]): ChannelMessage[] {
		const resetIdx = items.findLastIndex((m) => m.kind === 'system' && m.text === '__CLODIA_CONTEXT_RESET__');
		return resetIdx >= 0 ? items.slice(resetIdx + 1) : items.filter((m) => m.kind !== 'system');
	}
	$: shownMessages = visibleMessages(messages);

	/** Reply: cita il messaggio (anteprima in corsivo) e tagga l'autore. */
	let replyingTo: { author: string; snippet: string } | null = null;
	function replyTo(m: ChannelMessage) {
		const flat = (m.text || '').replace(/\s+/g, ' ').trim();
		const snippet = flat.length > 140 ? flat.slice(0, 140) + '…' : flat || '(allegato)';
		replyingTo = { author: m.author, snippet };
		const base = draft.trim();
		draft = base ? `${base} @${m.author} ` : `@${m.author} `;
		void tick().then(() => {
			composer?.focus();
			composer?.setSelectionRange(draft.length, draft.length);
		});
	}
	function cancelReply() {
		replyingTo = null;
	}

	// Pills di scelta: un agente può includere nel testo un marcatore invisibile
	//   singola:  <!-- choices=a,b,c -->        → click su una pill → invia subito
	//   multipla: <!-- choices-multi=a,b,c -->  → pill toggle + pill "✓ Conferma" (=enter)
	const _CH_RE = /<!--\s*choices(-multi)?\s*=(.*?)-->/i;
	function msgChoices(text: string): { multi: boolean; items: string[] } | null {
		const m = (text || '').match(_CH_RE);
		if (!m) return null;
		const items = m[2].split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
		return items.length ? { multi: !!m[1], items } : null;
	}
	function stripChoices(text: string): string {
		return (text || '').replace(_CH_RE, '').trim();
	}
	// Trasforma i path di file del topic (files/… o dump/…) citati nel testo in
	// link markdown scaricabili, PRIMA del render → renderMarkdown li rende <a>.
	// Salta i CODE span (`…` / ```…```): un path lì dentro deve restare testo,
	// non diventare un link grezzo dentro <code> (gli LLM citano i path tra backtick).
	function linkifyFiles(text: string): string {
		const PATH = /(?<!\]\()(?<!\[)(?<![\w/])((?:files|dump)\/[\w.\-/]+\.[A-Za-z0-9]{1,8})/g;
		const repl = (_m: string, p: string) => `[${p}](${channelFileUrl(tier, name, p)})`;
		// 1) code span che contengono SOLO un path → diventano link (tolgo i backtick:
		//    gli LLM citano i path tra `…`, ma l'utente vuole il link cliccabile).
		let s = (text || '').replace(/`((?:files|dump)\/[\w.\-/]+\.[A-Za-z0-9]{1,8})`/g, repl);
		// 2) path nudi, saltando i code span RIMASTI (codice vero, non solo-path).
		return s
			.split(/(```[\s\S]*?```|`[^`]*`)/g)
			.map((seg, i) => (i % 2 === 0 ? seg.replace(PATH, repl) : seg))
			.join('');
	}
	async function pickChoice(c: string) {
		if (sending) return;
		draft = c;
		await send();
	}
	// selezione multipla (vale per l'ultimo messaggio con choices-multi)
	let multiSel = new Set<string>();
	function toggleMulti(c: string) {
		multiSel.has(c) ? multiSel.delete(c) : multiSel.add(c);
		multiSel = new Set(multiSel); // reattività
	}
	async function confirmMulti() {
		if (!multiSel.size || sending) return;
		draft = Array.from(multiSel).join(', ');
		multiSel = new Set();
		await send();
	}

	/** Separa le righe-citazione iniziali (`> …`) dal corpo del messaggio,
	 *  così la UI può renderle in corsivo come quote. */
	function splitQuote(text: string): { quote: string; body: string } {
		const lines = (text || '').split('\n');
		const q: string[] = [];
		let i = 0;
		while (i < lines.length && lines[i].startsWith('> ')) {
			q.push(lines[i].slice(2));
			i++;
		}
		// salta una riga vuota di separazione
		if (i < lines.length && lines[i].trim() === '') i++;
		return { quote: q.join('\n'), body: lines.slice(i).join('\n') };
	}

	$: me = $session?.principal ?? null;
	$: isOwner = !!me && info?.meta?.owner === me;
	$: participants = info?.meta?.participants ?? [];

	// --- @mention autocomplete -----------------------------------------------
	// Estraggo il token @parziale in coda al testo (fino al cursore) e propongo
	// i partecipanti che combaciano. Click/Invio inserisce "@nome ".
	let mentionQuery: string | null = null;
	$: mentionMatches =
		mentionQuery === null
			? []
			: participants.filter(
					(p) => p !== me && p.toLowerCase().startsWith(mentionQuery!.toLowerCase())
				);
	let mentionIdx = 0;

	function updateMention() {
		const pos = composer?.selectionStart ?? draft.length;
		const upto = draft.slice(0, pos);
		const m = upto.match(/(?:^|\s)@([a-z0-9_-]*)$/i);
		mentionQuery = m ? m[1] : null;
		mentionIdx = 0;
	}

	function applyMention(p: string) {
		const pos = composer?.selectionStart ?? draft.length;
		const upto = draft.slice(0, pos);
		const rest = draft.slice(pos);
		const replaced = upto.replace(/@([a-z0-9_-]*)$/i, `@${p} `);
		draft = replaced + rest;
		mentionQuery = null;
		void tick().then(() => {
			composer?.focus();
			const c = replaced.length;
			composer?.setSelectionRange(c, c);
		});
	}

	async function loadAll(t: string, n: string) {
		loadErr = '';
		typing = []; // reset indicatore al cambio canale
		filePath = ''; // riparti dalla radice dei file
		try {
			[info, messages, files] = await Promise.all([
				getChannel(t, n),
				getChannelMessages(t, n),
				getChannelFiles(t, n)
			]);
			await tick();
			scrollDown();
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		}
	}

	// Refresh periodico di partecipanti + file (così add/remove di file o membri
	// fatti da altri attori o dagli agenti si riflettono senza ricaricare).
	async function refreshInfo() {
		try {
			info = await getChannel(tier, name);
		} catch {
			/* ignore */
		}
	}
	async function refreshLive() {
		await Promise.all([refreshMessages(), loadFiles(), refreshInfo()]);
	}

	let _lastMsgId = '';
	async function refreshMessages() {
		try {
			messages = await getChannelMessages(tier, name);
			// se l'ultimo messaggio è di un agente, smetti di mostrarlo "scrivendo"
			const last = messages[messages.length - 1];
			if (last?.kind === 'ai') setTyping(last.author, false);
			// nuovo ultimo messaggio → azzera la selezione multipla delle pills
			if (last && last.id !== _lastMsgId) {
				_lastMsgId = last.id;
				multiSel = new Set();
				// turno concluso: il messaggio finale dell'agente è arrivato →
				// solo ORA ripulisci il live (thinking + barra task/tools). Durante
				// l'attesa dei subagent il live resta visibile.
				if (last.kind === 'ai') resetLive();
			}
		} catch {
			/* ignore poll errors */
		}
	}

	function scrollDown() {
		if (stream) stream.scrollTop = stream.scrollHeight;
	}

	async function send() {
		const body = draft.trim();
		if (!body || sending) return;
		sending = true;
		resetLive(); // nuovo turno: pulisci il live del turno precedente
		// Se sto rispondendo a un messaggio, antepongo la citazione (riga `> …`)
		// così resta nel messaggio inviato e viene mostrata in corsivo.
		const text = replyingTo
			? `> ${replyingTo.author}: ${replyingTo.snippet}\n\n${body}`
			: body;
		replyingTo = null;
		// Svuota subito l'input (e chiudi l'eventuale @mention): la POST attende
		// anche il turno dell'agente, che può durare secondi — non lasciare il
		// testo nel box. Echo ottimistico del messaggio umano nello stream.
		draft = '';
		mentionQuery = null;
		const echo: ChannelMessage = {
			id: `local-${text.length}-${messages.length}`,
			author: me ?? 'tu',
			kind: 'human',
			text,
			ts: new Date().toISOString()
		} as ChannelMessage;
		messages = [...messages, echo];
		await tick();
		scrollDown();
		try {
			await postChannelMessage(tier, name, text);
			await refreshMessages();
			await tick();
			scrollDown();
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
			draft = text; // ripristina il testo se l'invio fallisce
		} finally {
			sending = false;
		}
	}

	async function resetContext() {
		if (resetting || sending) return;
		if (!confirm('Cancellare il contesto di questa chat e ripartire pristine?')) return;
		resetting = true;
		loadErr = '';
		try {
			await resetChannelContext(tier, name);
			resetLive();
			replyingTo = null;
			draft = '';
			await refreshMessages();
			await tick();
			scrollDown();
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			resetting = false;
		}
	}

	// Autocomplete invito: solo agent/utenti registrati (no partecipanti inesistenti).
	let allAgents: string[] = [];
	$: inviteMatches = newParticipant.trim()
		? allAgents
				.filter(
					(a) =>
						a.toLowerCase().includes(newParticipant.trim().toLowerCase()) &&
						a !== info?.meta?.owner &&
						!participants.includes(a)
				)
				.slice(0, 8)
		: [];

	async function addParticipant(who?: string) {
		const a = (who ?? newParticipant).trim().toLowerCase();
		if (!a) return;
		try {
			const r = await setChannelParticipant(tier, name, a, true);
			if (info) info = { ...info, meta: { ...info.meta, participants: r.participants } };
			newParticipant = '';
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		}
	}
	async function removeParticipant(a: string) {
		try {
			const r = await setChannelParticipant(tier, name, a, false);
			if (info) info = { ...info, meta: { ...info.meta, participants: r.participants } };
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		}
	}

	async function uploadFile(f: File) {
		const buf = await f.arrayBuffer();
		let bin = '';
		const u = new Uint8Array(buf);
		for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
		try {
			await uploadChannelFile(tier, name, f.name, btoa(bin));
			await loadFiles();
		} catch (err) {
			loadErr = err instanceof ApiError || err instanceof Error ? err.message : String(err);
		}
	}

	async function onUpload(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (f) await uploadFile(f);
		(e.target as HTMLInputElement).value = ''; // permette di ricaricare lo stesso file
	}

	// Drag-and-drop di file direttamente sull'input della chat.
	let dragOver = false;
	function onDragOver(e: DragEvent) {
		if (e.dataTransfer?.types?.includes('Files')) {
			e.preventDefault();
			dragOver = true;
		}
	}
	function onDragLeave() {
		dragOver = false;
	}
	async function onDrop(e: DragEvent) {
		const fs = e.dataTransfer?.files;
		if (!fs?.length) return;
		e.preventDefault();
		dragOver = false;
		for (const f of Array.from(fs)) await uploadFile(f);
	}

	$: if (tier && name && `${tier}/${name}` !== loadedKey) {
		loadedKey = `${tier}/${name}`;
		void loadAll(tier, name);
	}

	let stopStream: (() => void) | null = null;
	let offEvt: (() => void) | null = null;
	onMount(() => {
		poll = setInterval(refreshLive, 5000);
		getAgents()
			.then((as) => (allAgents = as.map((a) => a.name)))
			.catch(() => (allAgents = []));
		stopStream = startEventStream();
		offEvt = onEventStream((ev) => {
			const p = (ev.payload ?? {}) as Record<string, unknown>;
			if (ev.type === 'channel_typing') {
				if (p.tier !== tier || p.name !== name) return;
				setTyping(String(p.agent), p.state === 'start');
				return;
			}
			// eventi del turno del risponditore di QUESTO canale
			if (!chatBelongs(p.chat_id)) return;
			if (ev.type === 'thinking_chunk') {
				liveThink += String(p.delta ?? '');
			} else if (ev.type === 'message_chunk') {
				if (p.role === 'assistant') liveReply += String(p.delta ?? '');
			} else if (ev.type === 'tool_use') {
				const tool = String(p.tool ?? '');
				const inp = p.input_summary ? `: ${String(p.input_summary)}` : '';
				liveTools = [...liveTools, `🔧 ${tool}${inp}`].slice(-8);
			} else if (ev.type === 'task_progress') {
				// progresso di un SUBAGENT (tool Task): senza questo la chat sembra
				// ferma mentre il subagent lavora (es. un download).
				const tool = p.last_tool_name ? ` · ${String(p.last_tool_name)}` : '';
				const desc = p.description ? `: ${String(p.description)}` : '';
				liveTools = [...liveTools, `🤖 subagent${tool}${desc}`.slice(0, 120)].slice(-8);
			}
		});
	});
	onDestroy(() => {
		if (poll) clearInterval(poll);
		offEvt?.();
		stopStream?.();
		for (const t of Object.values(typingTimers)) clearTimeout(t);
	});

	function fmtTs(ts: string): string {
		try {
			return new Date(ts).toLocaleString('it-IT', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
		} catch {
			return ts;
		}
	}
</script>

<div class="channel">
	<header class="head">
		<a class="back" href="/topics">← Topics</a>
		<div class="title-row">
			<h1>#{info?.meta?.title || name}</h1>
			<span class="tier">{info?.tier || tier}</span>
			<button type="button" class="reset-context" on:click={resetContext} disabled={resetting || sending}>
				{resetting ? 'Reset…' : 'Reset contesto'}
			</button>
		</div>
		{#if info?.tldr}<p class="tldr">{info.tldr}</p>{/if}
	</header>

	{#if loadErr}<div class="err">{loadErr}</div>{/if}

	<div class="body">
		<main class="stream-wrap">
			<div class="stream" bind:this={stream}>
				{#each shownMessages as m, i (m.id)}
					<div class="msg" class:ai={m.kind === 'ai'} class:mine={m.author === me}>
						<div class="msg-head">
							<AgentAvatar name={m.author} size={22} />
							<span class="author">{m.author}</span>
							<time class="ts">{fmtTs(m.ts)}</time>
							<button type="button" class="reply-btn" title={`Rispondi a ${m.author}`}
								on:click={() => replyTo(m)}>↩</button>
						</div>
						{#if splitQuote(m.text).quote}
							<blockquote class="quote">{splitQuote(m.text).quote}</blockquote>
						{/if}
						<div class="text md">{@html renderMarkdown(linkifyFiles(stripChoices(splitQuote(m.text).body)))}</div>
						{#if i === shownMessages.length - 1}
							{@const ch = msgChoices(m.text)}
							{#if ch}
								<div class="pills">
									{#each ch.items as c}
										{#if ch.multi}
											<button type="button" class="pill" class:on={multiSel.has(c)}
												on:click={() => toggleMulti(c)}>{c}</button>
										{:else}
											<button type="button" class="pill" on:click={() => pickChoice(c)}>{c}</button>
										{/if}
									{/each}
									{#if ch.multi}
										<button type="button" class="pill pill-confirm" disabled={multiSel.size === 0}
											on:click={confirmMulti}>✓ Conferma</button>
									{/if}
								</div>
							{/if}
						{/if}
						{#if m.attachments?.length}
							<div class="atts">
								{#each m.attachments as a}
									<a class="att" href={channelFileUrl(tier, name, `files/${a}`)} target="_blank" rel="noopener">📎 {a}</a>
								{/each}
							</div>
						{/if}
					</div>
				{:else}
					<p class="empty">Nessun messaggio. Scrivi qualcosa per iniziare.</p>
				{/each}
			</div>
			{#if typingLabel || sending}
				<div class="typing" aria-live="polite">
					<span class="typing-dots"><span></span><span></span><span></span></span>
					{typingLabel || 'in attesa di risposta…'}
				</div>
			{/if}
			{#if hasLive}
				<!-- Ragionamento: collassabile, contiene SOLO il testo del thinking -->
				{#if liveThink}
					<div class="think" class:open={thinkOpen}>
						<button type="button" class="think-head" on:click={() => (thinkOpen = !thinkOpen)}
							aria-expanded={thinkOpen}>
							<span class="caret" class:open={thinkOpen}>▸</span>
							<span class="think-title">Ragionamento</span>
							{#if typingLabel}<span class="think-live">● live</span>{/if}
							<span class="think-hint">{thinkOpen ? 'comprimi' : 'espandi'}</span>
						</button>
						{#if thinkOpen}
							<div class="think-body"><pre class="think-text">{liveThink}</pre></div>
						{/if}
					</div>
				{/if}
				<!-- Tool e subagent in uso: SEMPRE visibili (anche col thinking collassato) -->
				{#if liveTools.length}
					<ul class="live-tools">
						{#each liveTools as t}<li>{t}</li>{/each}
					</ul>
				{/if}
				<!-- Risposta in streaming: sempre visibile -->
				{#if liveReply}
					<div class="think-reply md">{@html renderMarkdown(stripChoices(liveReply))}</div>
				{/if}
			{/if}
			<div class="composer" class:drag={dragOver}
				role="group"
				on:dragover={onDragOver} on:dragleave={onDragLeave} on:drop={onDrop}>
				{#if dragOver}<div class="drop-hint">Rilascia per allegare</div>{/if}
				{#if replyingTo}
					<div class="reply-bar">
						<span class="reply-to">↩ {replyingTo.author}</span>
						<span class="reply-snip"><em>{replyingTo.snippet}</em></span>
						<button type="button" class="reply-x" title="Annulla risposta" on:click={cancelReply}>×</button>
					</div>
				{/if}
				{#if mentionQuery !== null && mentionMatches.length}
					<ul class="mention-pop" role="listbox">
						{#each mentionMatches as p, i}
							<li>
								<button type="button" class="mention-item" class:sel={i === mentionIdx}
									on:click={() => applyMention(p)}>
									<AgentAvatar name={p} size={20} />
									<span>{p}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				<input type="file" bind:this={fileInput} on:change={onUpload} hidden />
				<button type="button" class="clip" title="Allega file" on:click={() => fileInput?.click()}>📎</button>
				<textarea bind:this={composer} bind:value={draft} rows="2"
					placeholder="Scrivi nel canale… (@nome per rivolgerti a un partecipante)"
					on:input={updateMention}
					on:click={updateMention}
					on:keydown={(e) => {
						if (mentionQuery !== null && mentionMatches.length) {
							if (e.key === 'ArrowDown') { e.preventDefault(); mentionIdx = (mentionIdx + 1) % mentionMatches.length; return; }
							if (e.key === 'ArrowUp') { e.preventDefault(); mentionIdx = (mentionIdx - 1 + mentionMatches.length) % mentionMatches.length; return; }
							if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyMention(mentionMatches[mentionIdx]); return; }
							if (e.key === 'Escape') { e.preventDefault(); mentionQuery = null; return; }
						}
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
					}}></textarea>
				<button type="button" on:click={send} disabled={sending || !draft.trim()}>
					{sending ? '…' : 'Invia'}
				</button>
			</div>
		</main>

		<aside class="side">
			<section>
				<h3>Partecipanti</h3>
				<ul class="parts">
					{#each participants as p}
						<li>
							<span class="part-id">
								<AgentAvatar name={p} size={22} />
								<span class="part-name">{p}{#if p === info?.meta?.owner} <em>(owner)</em>{/if}</span>
							</span>
							{#if isOwner && p !== info?.meta?.owner}
								<button class="x" type="button" on:click={() => removeParticipant(p)} aria-label="Rimuovi">×</button>
							{/if}
						</li>
					{/each}
				</ul>
				{#if isOwner}
					<div class="addp">
						<div class="addp-field">
							<input type="text" bind:value={newParticipant} placeholder="cerca agente/utente…"
								autocomplete="off"
								on:keydown={(e) => {
									if (e.key === 'Enter' && inviteMatches.length) { e.preventDefault(); addParticipant(inviteMatches[0]); }
								}} />
							{#if inviteMatches.length}
								<ul class="invite-pop" role="listbox">
									{#each inviteMatches as a}
										<li>
											<button type="button" class="invite-item" on:click={() => addParticipant(a)}>
												<AgentAvatar name={a} size={18} /> <span>{a}</span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					</div>
				{/if}
			</section>
			<section>
				<h3>File</h3>
				<nav class="crumbs" aria-label="Percorso file">
					<button type="button" class="crumb" on:click={() => gotoCrumb(-1)}>🏠 root</button>
					{#each crumbs as seg, i}
						<span class="crumb-sep">/</span>
						<button type="button" class="crumb" on:click={() => gotoCrumb(i)}>{seg}</button>
					{/each}
				</nav>
				<ul class="files">
					{#each files as f}
						<li>
							{#if f.kind === 'dir'}
								<button type="button" class="dir" on:click={() => openDir(f)}>📂 {f.name}</button>
							{:else}
								<a href={channelFileUrl(tier, name, f.path)} target="_blank" rel="noopener">📎 {f.name}</a>
							{/if}
						</li>
					{:else}
						<li class="muted">cartella vuota</li>
					{/each}
				</ul>
				<p class="files-hint">Carica i file dall'input della chat con 📎 o trascinandoli.</p>
			</section>
		</aside>
	</div>
</div>

<style>
	.channel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
	.head { flex: none; }
	.back { font-size: 12px; color: var(--fg-muted); text-decoration: none; }
	.title-row { display: flex; align-items: baseline; gap: 10px; }
	h1 { margin: 4px 0 0; font-size: 22px; }
	.tier { font-size: 11px; color: var(--fg-muted); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; }
	.reset-context { margin-left: auto; background: transparent; border: 1px solid var(--border); color: var(--fg-muted); border-radius: 7px; padding: 5px 10px; font: inherit; font-size: 12px; cursor: pointer; }
	.reset-context:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); background: rgba(255,107,61,.08); }
	.reset-context:disabled { opacity: .5; cursor: default; }
	.tldr { margin: 4px 0 0; color: var(--fg-muted); font-size: 12.5px; }
	.err { color: var(--danger); font-size: 12px; margin: 8px 0; }
	.body { display: flex; gap: 16px; flex: 1 1 auto; min-height: 0; margin-top: 12px; }
	.stream-wrap { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
	.stream { flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px; }
	.msg { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; max-width: 80%; }
	/* Allineamento per AUTORE: i miei a destra, la controparte a sinistra
	   (vale per DM e canali di gruppo). Il bordo accent resta segnale per gli AI. */
	.msg.mine { align-self: flex-end; }
	.msg:not(.mine) { align-self: flex-start; }
	.msg.ai { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
	.msg-head { display: flex; gap: 7px; align-items: center; }
	.author { font-weight: 700; font-size: 12.5px; }
	.reply-btn { margin-left: 4px; background: transparent; border: none; color: var(--fg-muted); cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 4px; border-radius: 5px; opacity: 0; transition: opacity .12s ease, background .12s ease; }
	.msg:hover .reply-btn { opacity: 1; }
	.reply-btn:hover { background: rgba(255,107,61,.12); color: var(--accent); }
	/* "sta scrivendo…" */
	.typing { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 12px; color: var(--fg-muted); font-style: italic; }
	.typing-dots { display: inline-flex; gap: 3px; }
	.typing-dots span { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); opacity: .4; animation: td 1s infinite; }
	.typing-dots span:nth-child(2) { animation-delay: .2s; }
	.typing-dots span:nth-child(3) { animation-delay: .4s; }
	@keyframes td { 0%,60%,100% { opacity: .25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }

	/* Pannello "Ragionamento" live (comprimibile, di default aperto) */
	.think { margin: 2px 8px 8px; border: 1px dashed var(--border); border-radius: 8px; background: rgba(255,255,255,.02); }
	.think.open { border-style: solid; }
	.think-head { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: transparent; border: none; color: var(--fg-muted); cursor: pointer; font: inherit; font-size: 11.5px; padding: 7px 10px; }
	.think-head:hover { color: var(--fg); }
	.think-head .caret { font-size: 10px; transition: transform .12s ease; }
	.think-head .caret.open { transform: rotate(90deg); }
	.think-title { font-weight: 700; letter-spacing: .03em; text-transform: uppercase; font-size: 10px; }
	.think-live { color: var(--accent); font-size: 10px; font-weight: 700; }
	.think-hint { margin-left: auto; font-size: 10px; opacity: .7; }
	.think-body { padding: 0 10px 10px; display: flex; flex-direction: column; gap: 8px; }
	.think-text { margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-family: var(--mono); font-size: 11.5px; line-height: 1.5; color: var(--fg-muted); }
	.think-tools { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
	.think-tools li { font-size: 11px; color: var(--fg-muted); font-family: var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	/* Barra tool/subagent sempre visibile (indipendente dal collapse del ragionamento) */
	.live-tools { margin: 6px 0 0; padding: 6px 10px; list-style: none; display: flex; flex-direction: column; gap: 2px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; }
	.live-tools li { font-size: 11px; color: var(--fg-muted); font-family: var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.think-reply { font-size: 13px; border-top: 1px solid var(--border); padding-top: 8px; }
	.ts { font-size: 10.5px; color: var(--fg-muted); }
	.text { font-size: 13.5px; margin-top: 2px; }
	/* markdown renderizzato nei messaggi */
	.text.md :global(p) { margin: 0 0 0.5em; }
	.text.md :global(p:last-child) { margin-bottom: 0; }
	.text.md :global(ul), .text.md :global(ol) { margin: 0.3em 0; padding-left: 1.3em; }
	.text.md :global(li) { margin: 0.15em 0; }
	.text.md :global(code) { background: rgba(255,255,255,0.08); padding: 0 4px; border-radius: 3px; font-size: 0.9em; }
	.text.md :global(pre) { background: rgba(0,0,0,0.3); padding: 8px 10px; border-radius: 6px; overflow-x: auto; margin: 0.4em 0; }
	.text.md :global(pre code) { background: none; padding: 0; }
	.text.md :global(a) { color: #6fb6ff; text-decoration: underline; }
	.text.md :global(strong) { color: var(--fg); font-weight: 700; }
	.text.md :global(h1), .text.md :global(h2), .text.md :global(h3) { font-size: 1.05em; margin: 0.3em 0; }
	.text.md :global(blockquote) { border-left: 3px solid var(--border); margin: 0.4em 0; padding-left: 8px; color: var(--fg-muted); }
	.text.md :global(table) { border-collapse: collapse; margin: 0.4em 0; }
	.text.md :global(td), .text.md :global(th) { border: 1px solid var(--border); padding: 2px 7px; font-size: 0.95em; }
	.quote { margin: 4px 0 2px; padding: 3px 0 3px 8px; border-left: 3px solid color-mix(in srgb, var(--accent) 50%, var(--border)); color: var(--fg-muted); font-style: italic; font-size: 12px; white-space: pre-wrap; }
	.reply-bar { position: absolute; bottom: calc(100% + 4px); left: 0; right: 0; z-index: 22; display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--card-bg); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 8px; font-size: 12px; }
	.reply-to { font-weight: 700; color: var(--accent); flex-shrink: 0; }
	.reply-snip { color: var(--fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; min-width: 0; }
	.reply-x { background: transparent; border: none; color: var(--fg-muted); font-size: 16px; cursor: pointer; flex-shrink: 0; line-height: 1; }
	.reply-x:hover { color: var(--accent); }
	.pills { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
	.pill { background: transparent; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); color: var(--fg); font: inherit; font-size: 12px; padding: 4px 11px; border-radius: 999px; cursor: pointer; transition: background .12s ease, border-color .12s ease; }
	.pill:hover:not(:disabled) { background: rgba(255,107,61,.1); border-color: var(--accent); }
	.pill.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 700; }
	.pill-confirm { border-style: dashed; font-weight: 700; }
	.pill:disabled { opacity: .5; cursor: not-allowed; }
	.atts { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
	.att, .files a { font-size: 12px; color: var(--accent); text-decoration: none; }
	.empty { color: var(--fg-muted); font-size: 13px; text-align: center; margin-top: 24px; }
	.composer { position: relative; flex: none; display: flex; align-items: flex-end; gap: 8px; padding-top: 8px; border-radius: 8px; }
	.composer.drag { outline: 2px dashed var(--accent); outline-offset: 3px; }
	.drop-hint { position: absolute; inset: 8px 0 0; z-index: 25; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--accent) 12%, var(--card-bg)); border-radius: 8px; font-size: 13px; font-weight: 700; color: var(--accent); pointer-events: none; }
	.composer textarea { flex: 1 1 auto; background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 8px; resize: none; }
	.composer button { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font-weight: 700; padding: 0 16px; border-radius: 8px; cursor: pointer; }
	.composer button:disabled { opacity: .5; cursor: not-allowed; }
	.clip { background: transparent !important; border: 1px solid var(--border) !important; color: var(--fg) !important; font-size: 16px; padding: 0 12px !important; height: 38px; }
	.mention-pop { position: absolute; bottom: calc(100% + 4px); left: 0; z-index: 20; list-style: none; margin: 0; padding: 4px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.35); min-width: 180px; max-height: 220px; overflow-y: auto; }
	.mention-item { display: flex; align-items: center; gap: 7px; width: 100%; background: transparent; border: none; color: var(--fg); font: inherit; font-size: 12.5px; padding: 5px 8px; border-radius: 6px; cursor: pointer; text-align: left; }
	.mention-item.sel, .mention-item:hover { background: rgba(255, 107, 61, 0.12); }
	.files-hint { font-size: 11px; color: var(--fg-muted); margin: 8px 0 0; line-height: 1.4; }
	.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; margin-bottom: 6px; font-size: 11.5px; }
	.crumb { background: transparent; border: none; color: var(--fg-muted); cursor: pointer; padding: 1px 3px; border-radius: 4px; font: inherit; font-size: 11.5px; }
	.crumb:hover { color: var(--accent); }
	.crumb-sep { color: var(--fg-muted); opacity: .6; }
	.dir { background: transparent; border: none; color: var(--fg); cursor: pointer; font: inherit; font-size: 12px; padding: 0; text-align: left; }
	.dir:hover { color: var(--accent); }
	.side { flex: none; width: 220px; display: flex; flex-direction: column; gap: 18px; overflow-y: auto; }
	.side h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); margin: 0 0 6px; }
	.parts, .files { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
	.parts li { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 12.5px; }
	.part-id { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
	.part-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.parts em { color: var(--fg-muted); font-style: normal; font-size: 11px; }
	.x { background: transparent; border: none; color: var(--fg-muted); cursor: pointer; font-size: 15px; }
	.addp { display: flex; gap: 6px; margin-top: 8px; }
	.addp-field { position: relative; flex: 1 1 auto; min-width: 0; }
	.addp-field input { width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 12px; padding: 5px 8px; border-radius: 6px; }
	.invite-pop { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20; list-style: none; margin: 0; padding: 4px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.35); max-height: 200px; overflow-y: auto; }
	.invite-item { display: flex; align-items: center; gap: 6px; width: 100%; background: transparent; border: none; color: var(--fg); font: inherit; font-size: 12px; padding: 5px 7px; border-radius: 6px; cursor: pointer; text-align: left; }
	.invite-item:hover { background: rgba(255, 107, 61, 0.12); }
	.addp button { font-size: 11.5px; border: 1px solid var(--border); border-radius: 6px; padding: 5px 9px; background: transparent; color: var(--fg); cursor: pointer; white-space: nowrap; }
	.muted { color: var(--fg-muted); font-size: 12px; }
</style>
