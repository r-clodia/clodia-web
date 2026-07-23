<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { activeTopic, markSeen, topicKey } from '$lib/stores/unread';
	import { page } from '$app/stores';
	import { session } from '$lib/auth/session';
	import { onEventStream, startEventStream } from '$lib/stores/events-stream';
	import { renderMarkdown } from '$lib/markdown';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import ArtifactCanvas from '$lib/components/ArtifactCanvas.svelte';
	import {
		ApiError,
		getAgents,
		getChannel,
		getChannelMessages,
		postChannelMessage,
		resetChannelContext,
		interruptChannel,
		topicRemote,
		type RemoteStatus,
		setChannelParticipant,
		decideJobProposal,
		getChannelEligibility,
		getChannelFiles,
		uploadChannelFile,
		downloadTopicZip,
		channelFileUrl,
		signedChannelFileUrl,
		type ChannelInfo,
		type ChannelMessage,
		type ChannelFile
	} from '$lib/api/client';
	import type { TierWarning } from '$lib/api/types';

	$: params = $page.params as Record<string, string>;
	$: tier = params.tier ?? '';
	$: name = params.name ?? '';

	// Non-letti: mentre guardo questo topic è "attivo" (i suoi messaggi non contano
	// come non-letti) e azzero il suo badge. Alla chiusura libero il topic attivo.
	$: if (tier && name) {
		activeTopic.set(topicKey(tier, name));
		markSeen(tier, name);
	}
	onDestroy(() => activeTopic.set(null));

	let info: ChannelInfo | null = null;
	let messages: ChannelMessage[] = [];
	let files: ChannelFile[] = [];
	// Browser file navigabile: subpath corrente relativo a files/ ('' = radice).
	let filePath = '';
	let filesLoading = false;
	let zipping = false;
	async function downloadZip() {
		if (zipping) return;
		zipping = true;
		try {
			await downloadTopicZip(tier, name);
		} catch (e) {
			loadErr = e instanceof Error ? e.message : String(e);
		} finally {
			zipping = false;
		}
	}
	$: crumbs = filePath ? filePath.split('/') : [];

	// --- Remote (git/drive): storage sempre locale + sync opzionale ----------
	let remoteStatus: RemoteStatus | null = null;
	let remoteBusy = false;
	$: remoteMeta = (info?.meta as Record<string, any> | undefined)?.remote ?? null;
	// Nome umano del remote (cartella Drive / repo git): dal backend
	// (config.name, gateway ≥0.90) con fallback client-side sul basename
	// dell'URL git per i topic non ancora backfillati.
	$: remoteName = (() => {
		const r = remoteMeta;
		if (!r) return null;
		const c = r.config || {};
		if (c.name) return String(c.name);
		if (r.type === 'git' && c.url) {
			const tail = String(c.url).replace(/\/+$/, '').split('/').pop() || '';
			return tail.replace(/\.git$/, '') || null;
		}
		return null;
	})();
	function remoteUrl(): string | null {
		const r = remoteMeta;
		if (!r) return null;
		const c = r.config || {};
		if (r.type === 'drive' && c.folder) return `https://drive.google.com/drive/folders/${c.folder}`;
		if (r.type === 'git' && c.url) {
			const u = String(c.url);
			const m = u.match(/^git@([^:]+):(.+?)(?:\.git)?$/); // ssh → https
			if (m) return `https://${m[1]}/${m[2]}`;
			return u.replace(/\.git$/, '');
		}
		return null;
	}
	// Icone brand inline (equivalenti Font Awesome, self-hosted → nessun CDN):
	// GitHub (mark FA, monocromo currentColor), Google Drive (logo ufficiale
	// multicolor), git generico (branch).
	const SVG_GITHUB =
		'<svg viewBox="0 0 496 512" width="13" height="13" fill="currentColor" aria-hidden="true" style="vertical-align:-2px"><path d="M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244 8C106.1 8 0 113.3 0 251.2c0 110.2 69.9 204.4 167.8 237.5 12.4 2.3 16.6-5.4 16.6-11.9 0-6.2-.3-40.4-.3-61.4 0 0-67 14.4-81.1-28.5 0 0-10.9-27.8-26.6-34.9 0 0-21.9-15 1.5-14.7 0 0 23.8 1.9 36.9 24.7 20.9 36.9 55.9 26.3 69.5 20 2.1-15.2 8.3-25.7 15.2-32-53.5-5.9-107.5-13.6-107.5-105.4 0-26.2 7.2-39.4 22.4-56.1-2.5-6.2-10.6-31.7 2.5-64.9 20-6.2 66 24.5 66 24.5 19-5.3 39.4-8 59.6-8 20.2 0 40.6 2.7 59.6 8 0 0 46-30.8 66-24.5 13.1 33.2 5 58.7 2.5 64.9 15.2 16.7 24.5 29.9 24.5 56.1 0 91.9-56.3 99.7-109.8 105.4 8.8 7.6 16.3 22 16.3 44.4 0 32-.3 71.7-.3 79.5 0 6.5 4.3 14.2 16.7 11.9C428.2 455.5 496 361.3 496 251.2 496 113.3 383.5 8 244 8z"/></svg>';
	const SVG_DRIVE =
		'<svg viewBox="0 0 87.3 78" width="13" height="13" aria-hidden="true" style="vertical-align:-2px"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.152 28h27.448c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>';
	const SVG_GIT =
		'<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true" style="vertical-align:-2px"><path d="M6 3a3 3 0 0 0-1 5.83v6.34a3 3 0 1 0 2 0v-3.38c.53.32 1.15.51 1.83.55l3.02.17a3 3 0 1 0 .1-2l-3.01-.17A2 2 0 0 1 7 8.83V8.83A3 3 0 0 0 6 3z"/></svg>';
	function remoteIconSvg(): string {
		const r = remoteMeta;
		if (!r) return '';
		if (r.type === 'drive') return SVG_DRIVE;
		if (r.type === 'git') return (remoteUrl() || '').includes('github.com') ? SVG_GITHUB : SVG_GIT;
		return '';
	}
	async function loadRemoteStatus() {
		if (!remoteMeta) { remoteStatus = null; return; }
		try { remoteStatus = (await topicRemote(tier, name, 'status')) as RemoteStatus; } catch { /* ignore */ }
	}
	// --- Stato sync PER-FILE (gateway ≥0.92): rel → synced|modified|staged|unsynced.
	// Vocabolario git-like comune a git e drive; colora i nomi file e guida il (+).
	$: syncFiles = ((remoteStatus as unknown as { files?: Record<string, string> })?.files ?? {}) as Record<string, string>;
	const relOf = (path: string) => path.replace(/^files\//, '');
	function fileState(path: string): string | null {
		if (!remoteMeta) return null;
		return syncFiles[relOf(path)] ?? null;
	}
	const ADDABLE = ['unsynced', 'modified'];
	$: folderAddable = files
		.filter((f) => f.kind !== 'dir' && !f.remote && ADDABLE.includes(fileState(f.path) ?? ''))
		.map((f) => relOf(f.path));
	$: folderStaged = files
		.filter((f) => f.kind !== 'dir' && !f.remote && fileState(f.path) === 'staged')
		.map((f) => relOf(f.path));
	/** Unstage di uno o più file; null = tutto (una sola chiamata senza path). */
	async function unstageMany(paths: string[] | null) {
		if (remoteBusy || (paths !== null && !paths.length)) return;
		remoteBusy = true;
		loadErr = '';
		try {
			if (paths === null) await topicRemote(tier, name, 'unstage', {});
			else for (const p of paths) await topicRemote(tier, name, 'unstage', { path: p });
			await loadRemoteStatus();
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			remoteBusy = false;
		}
	}
	/** Staging di uno o più file (add): refresh del solo sync status, non dei file. */
	async function stageMany(paths: string[]) {
		if (!paths.length || remoteBusy) return;
		remoteBusy = true;
		loadErr = '';
		try {
			for (const p of paths) await topicRemote(tier, name, 'add', { path: p });
			await loadRemoteStatus();
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			remoteBusy = false;
		}
	}
	// Gruppi della sezione "Sync status" (equivalente del git status). I file
	// "solo locali" NON si listano qui (sarebbero centinaia sui topic grandi):
	// restano visibili in blu nella vista file, dove si aggiungono con ⊕.
	$: syncGroups = ([
		{ state: 'staged', label: 'Staged — da pushare' },
		{ state: 'modified', label: 'Modificati' }
	] as const)
		.map((g) => ({
			...g,
			paths: Object.entries(syncFiles).filter(([, v]) => v === g.state).map(([k]) => k).sort()
		}))
		.filter((g) => g.paths.length > 0);
	// Report dell'ultimo pull/push (protocollo .remoteinclude/.remoteignore):
	// conteggi per stato synced/conflict/skipped_by_*/error.
	let lastSyncReport: { action: string; counts: Record<string, number> } | null = null;
	const SYNC_REPORT_LABELS: Record<string, string> = {
		synced: 'sincronizzati',
		conflict: 'conflitti',
		skipped_by_include: 'fuori include',
		skipped_by_ignore: 'ignorati',
		skipped_by_hard_deny: 'protetti',
		error: 'errori'
	};
	async function doRemote(action: string, params: Record<string, unknown> = {}) {
		remoteBusy = true; loadErr = '';
		try {
			const res = (await topicRemote(tier, name, action, params)) as Record<string, unknown>;
			const rep = (res?.report ?? null) as { counts?: Record<string, number> } | null;
			if ((action === 'pull' || action === 'push' || action === 'commit') && rep?.counts) {
				lastSyncReport = { action, counts: rep.counts };
			}
			await refreshInfo(); // meta.remote può cambiare (enable/disable)
			await loadRemoteStatus();
			await loadFiles();
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			remoteBusy = false;
		}
	}
	// Solo gli stati con conteggio > 0, per il riepilogo compatto.
	$: syncReportEntries = lastSyncReport
		? Object.entries(lastSyncReport.counts).filter(([, n]) => n > 0)
		: [];
	// Form inline nella sidebar (non un popup effimero): l'input dell'URL/cartella
	// resta visibile e navigabile finché non si conferma o si annulla.
	let remoteForm: 'git' | 'drive' | null = null;
	let remoteInput = '';
	function openRemoteForm(kind: 'git' | 'drive') { remoteForm = kind; remoteInput = ''; }
	function cancelRemoteForm() { remoteForm = null; remoteInput = ''; }
	function submitRemoteForm() {
		const v = remoteInput.trim();
		const payload = remoteForm === 'git'
			? { type: 'git', config: v ? { url: v } : {} }
			: { type: 'drive', config: v ? { folder: v } : {} };
		remoteForm = null; remoteInput = '';
		void doRemote('enable', payload);
	}
	// Timeline dei recap (TLDR storici): il recap sotto al titolo è cliccabile.
	let showRecap = false;
	function fmtRecapDate(ts: string): string {
		try {
			return new Date(ts).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
		} catch { return ts; }
	}
	function sameFiles(a: ChannelFile[], b: ChannelFile[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i].kind !== b[i].kind || a[i].name !== b[i].name || a[i].path !== b[i].path) return false;
		}
		return true;
	}
	// silent=true (poll di background): niente spinner/dim e riassegna `files`
	// SOLO se la lista è davvero cambiata → la sidebar non flickera ad ogni giro.
	async function loadFiles(silent = false) {
		if (!silent) filesLoading = true;
		try {
			const next = await getChannelFiles(tier, name, filePath);
			if (!sameFiles(next, files)) files = next;
		} catch {
			/* ignore */
		} finally {
			if (!silent) filesLoading = false;
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
	let initialLoading = true;
	// Idoneità degli AeI al tier del topic: name → {eligible, warn}. I non idonei
	// (clearance/provider sotto il tier) spariscono dalla lista partecipanti e dal
	// dropdown invito; i super sotto tier restano ma con ⚠️.
	let eligibility: Record<string, { eligible: boolean; warn: boolean }> = {};
	async function loadEligibility(t: string, n: string) {
		try {
			const r = await getChannelEligibility(t, n);
			const m: Record<string, { eligible: boolean; warn: boolean }> = {};
			for (const a of r.agents) m[a.name] = { eligible: a.eligible, warn: a.warn };
			eligibility = m;
		} catch {
			/* ignore: in assenza di dati non filtriamo nulla */
		}
	}
	let tierWarning: TierWarning | null = null;
	let draft = '';
	let sending = false;
	let stopping = false;
	let resetting = false;
	let newParticipant = '';
	let stream: HTMLElement;
	let poll: ReturnType<typeof setInterval> | null = null;
	let loadedKey = '';
	let fileInput: HTMLInputElement;
	let composer: HTMLTextAreaElement;
	let expandedComposer: HTMLTextAreaElement;
	let composerExpanded = false;

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
	// Responder con turno attivo secondo il BACKEND (pollato via getChannel): così
	// riaprendo il topic a metà turno l'indicatore c'è comunque, anche se gli eventi
	// SSE che costruiscono il box "ragionamento" sono già passati.
	let workingResponders: string[] = [];
	$: activeWorking = Array.from(new Set([...typing, ...workingResponders]));
	$: typingLabel =
		activeWorking.length === 0
			? ''
			: `${activeWorking.join(' e ')} ${activeWorking.length === 1 ? 'sta scrivendo' : 'stanno scrivendo'}…`;

	// --- Routing: quale agente risponde e perché (evento routing_decision) ---
	type RoutingCand = { name: string; score: number; super?: boolean };
	type RoutingTrace = {
		chosen: string;
		reason: string;
		mode: string;
		threshold?: number;
		margin?: number;
		candidates?: RoutingCand[];
	};
	let lastRouting: RoutingTrace | null = null;
	let routingOpen = false;
	const routingReason: Record<string, string> = {
		tagged: 'richiesto esplicitamente con @menzione',
		relevance: 'dominio più pertinente al messaggio (embedding)',
		'fallback-rank': 'nessuno abbastanza pertinente → fallback per rango',
		rank: 'per rango (routing per rilevanza disattivato)'
	};

	// --- Ragionamento / attività live del turno del risponditore -----------
	// Il backend emette thinking_chunk / message_chunk / tool_use sul bus, con
	// chat_id = `chan:{tier}:{name}:{agent}`. Li accumuliamo in un pannello
	// "Ragionamento" comprimibile (di default chiuso): sui task lunghi mostra
	// che l'agente sta effettivamente lavorando, invece di sembrare bloccato.
	type LiveAgentState = { think: string; reply: string; tools: string[] };
	let liveAgents: Record<string, LiveAgentState> = {};
	// Box "Ragionamento": default CHIUSO, ma l'header resta SEMPRE visibile mentre
	// l'agente lavora (turno attivo) → l'utente sa che c'è e può espanderlo.
	let thinkOpen = false;
	function toggleThink() {
		thinkOpen = !thinkOpen;
	}
	const chatBelongs = (cid: unknown) =>
		typeof cid === 'string' && cid.startsWith(`chan:${tier}:${name}:`);
	function agentFromChatId(cid: unknown): string | null {
		return chatBelongs(cid) ? String(cid).split(':').at(-1) ?? null : null;
	}
	function liveFor(agent: string): LiveAgentState {
		return liveAgents[agent] ?? { think: '', reply: '', tools: [] };
	}
	function updateLive(agent: string, patch: Partial<LiveAgentState>) {
		liveAgents = { ...liveAgents, [agent]: { ...liveFor(agent), ...patch } };
	}
	function resetLive(agent?: string) {
		if (!agent) {
			liveAgents = {};
			return;
		}
		const next = { ...liveAgents };
		delete next[agent];
		liveAgents = next;
	}
	$: liveEntries = Object.entries(liveAgents).filter(([, l]) => l.think || l.reply || l.tools.length);
	$: hasLive = liveEntries.length > 0;
	function visibleMessages(items: ChannelMessage[]): ChannelMessage[] {
		const resetIdx = items.findLastIndex((m) => m.kind === 'system' && m.text === '__CLODIA_CONTEXT_RESET__');
		return resetIdx >= 0 ? items.slice(resetIdx + 1) : items.filter((m) => m.kind !== 'system');
	}
	$: shownMessages = visibleMessages(messages);

	/** Reply: cita il messaggio (anteprima in corsivo) e tagga l'autore. */
	let replyingTo: { author: string; snippet: string } | null = null;
	/** Anteprima-citazione di un messaggio, dal testo PULITO (senza marcatore
	 *  choices e senza eventuale quote già presente). */
	function replySnippet(m: ChannelMessage): { author: string; snippet: string } {
		const clean = stripChoices(splitQuote(m.text || '').body);
		const flat = clean.replace(/\s+/g, ' ').trim();
		const snippet = flat.length > 140 ? flat.slice(0, 140) + '…' : flat || '(allegato)';
		return { author: m.author, snippet };
	}
	function replyTo(m: ChannelMessage) {
		replyingTo = replySnippet(m);
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
	// Marker di INVITO SQUADRA: un coordinatore (Clodia) propone chi invitare —
	//   <!-- invite=aitiero,minerva,clodia -->
	// La UI lo rende come checkbox (deselezionabili) + bottone "Invita la squadra".
	// L'invito lo esegue l'OWNER (setChannelParticipant è owner-only): la proposta
	// dell'agente non aggiunge nessuno finché non clicchi.
	const _INV_RE = /<!--\s*invite\s*=(.*?)-->/i;
	function msgInvite(text: string): string[] | null {
		const m = (text || '').match(_INV_RE);
		if (!m) return null;
		const items = m[1].split(/[,;|]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
		return items.length ? Array.from(new Set(items)) : null;
	}
	// Marker PROPOSTA DI JOB: un agente propone un job schedulato →
	//   <!-- job-proposal=12 -->
	// popup di conferma SINCRONO in chat (l'owner è presente): Approva/Annulla.
	// L'approvazione la esegue l'owner autenticato (endpoint admin), niente link.
	const _JOB_RE = /<!--\s*job-proposal\s*=\s*(\d+)\s*-->/i;
	function msgJobProposal(text: string): number | null {
		const m = (text || '').match(_JOB_RE);
		return m ? Number(m[1]) : null;
	}
	let jobDeciding = false;
	let jobDecided: Record<number, string> = {};
	async function decideJob(id: number, choice: string) {
		if (jobDeciding) return;
		jobDeciding = true;
		try {
			const r = await decideJobProposal(id, choice);
			jobDecided = { ...jobDecided, [id]: r.outcome };
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			jobDeciding = false;
		}
	}
	function stripChoices(text: string): string {
		return (text || '').replace(_CH_RE, '').replace(_INV_RE, '').replace(_JOB_RE, '').trim();
	}
	// Agenti deselezionati nel widget di invito (default: tutti selezionati).
	let inviteSkip = new Set<string>();
	let inviting = false;
	function toggleInvite(a: string) {
		inviteSkip.has(a) ? inviteSkip.delete(a) : inviteSkip.add(a);
		inviteSkip = new Set(inviteSkip);
	}
	async function inviteTeam(items: string[]) {
		if (inviting) return;
		const chosen = items.filter((a) => !inviteSkip.has(a) && !participants.includes(a));
		if (!chosen.length) return;
		inviting = true;
		try {
			for (const a of chosen) {
				const r = await setChannelParticipant(tier, name, a, true);
				if (info) info = { ...info, meta: { ...info.meta, participants: r.participants } };
			}
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			inviting = false;
		}
	}
	// Trasforma i path di file del topic (files/… o dump/…) citati nel testo in
	// link markdown scaricabili, PRIMA del render → renderMarkdown li rende <a>.
	// Salta i CODE span (`…` / ```…```): un path lì dentro deve restare testo,
	// non diventare un link grezzo dentro <code> (gli LLM citano i path tra backtick).
	/** Fix sicurezza 7 lug 2026: i download passano da URL FIRMATI a scadenza.
	 *  I link diretti (senza firma) rispondono 401/403 dal backend. */
	async function openSignedFile(path: string) {
		try {
			const u = await signedChannelFileUrl(tier, name, path);
			window.open(u, '_blank', 'noopener');
		} catch (e) {
			console.error('download non autorizzato', e);
		}
	}
	/** Delegazione: intercetta i link file renderizzati nel markdown dei
	 *  messaggi (linkifyFiles) e li apre con URL firmato. */
	function handleStreamClick(e: MouseEvent) {
		const a = (e.target as HTMLElement)?.closest?.('a') as HTMLAnchorElement | null;
		if (!a?.href) return;
		const m = a.href.match(/\/topics\/[^/]+\/[^/]+\/download\?path=([^&]+)/);
		if (!m) return;
		e.preventDefault();
		void openSignedFile(decodeURIComponent(m[1]));
	}
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
	// Click su una pill → la scelta viene inviata come REPLY al messaggio che ha
	// proposto le pill (quote in corsivo) e taggando il suo autore, così in una
	// chat multi-agente la risposta torna all'agente che ha chiesto e il flusso
	// della conversazione resta leggibile.
	async function pickChoice(c: string, m: ChannelMessage) {
		if (sending) return;
		replyingTo = replySnippet(m);
		draft = `@${m.author} ${c}`;
		await send();
	}
	// selezione multipla (vale per l'ultimo messaggio con choices-multi)
	let multiSel = new Set<string>();
	function toggleMulti(c: string) {
		multiSel.has(c) ? multiSel.delete(c) : multiSel.add(c);
		multiSel = new Set(multiSel); // reattività
	}
	async function confirmMulti(m: ChannelMessage) {
		if (!multiSel.size || sending) return;
		replyingTo = replySnippet(m);
		draft = `@${m.author} ${Array.from(multiSel).join(', ')}`;
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
	// Partecipanti mostrati: nascondi i non idonei al tier (eligible=false). I super
	// sotto tier restano (eligible=true) e li marchiamo con ⚠️ via eligibility[p].warn.
	$: shownParticipants = participants.filter((p) => eligibility[p]?.eligible ?? true);

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

	async function submitFromExpanded() {
		await send();
		if (!draft.trim()) composerExpanded = false;
	}

	function openExpandedComposer() {
		composerExpanded = true;
		mentionQuery = null;
		void tick().then(() => {
			expandedComposer?.focus();
			expandedComposer?.setSelectionRange(draft.length, draft.length);
		});
	}

	function closeExpandedComposer() {
		composerExpanded = false;
		void tick().then(() => composer?.focus());
	}

	async function onCompactComposerKeydown(e: KeyboardEvent) {
		if (mentionQuery !== null && mentionMatches.length) {
			if (e.key === 'ArrowDown') { e.preventDefault(); mentionIdx = (mentionIdx + 1) % mentionMatches.length; return; }
			if (e.key === 'ArrowUp') { e.preventDefault(); mentionIdx = (mentionIdx - 1 + mentionMatches.length) % mentionMatches.length; return; }
			if (e.key === 'Tab') { e.preventDefault(); applyMention(mentionMatches[mentionIdx]); return; }
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyMention(mentionMatches[mentionIdx]); return; }
			if (e.key === 'Escape') { e.preventDefault(); mentionQuery = null; return; }
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			await send();
		}
	}

	async function onExpandedComposerKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeExpandedComposer();
			return;
		}
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			await submitFromExpanded();
		}
	}

	async function loadAll(t: string, n: string) {
		loadErr = '';
		initialLoading = true;
		info = null;
		messages = [];
		files = [];
		typing = []; // reset indicatore al cambio canale
		lastRouting = null;
		workingResponders = [];
		resetLive(); // blocchi live (thinking/tools/reply) del canale precedente
		replyingTo = null; // niente reply-quote trascinata da un altro canale
		thinkOpen = false;
		filePath = ''; // riparti dalla radice dei file
		try {
			[info, messages, files] = await Promise.all([
				getChannel(t, n),
				getChannelMessages(t, n),
				getChannelFiles(t, n)
			]);
			// turno in corso al caricamento (re-mount a metà turno) → mostra l'indicatore
			workingResponders = info?.active_responders ?? [];
			// Prima si renderizza lo stream (initialLoading=false), POI si scrolla:
			// altrimenti scrollDown gira mentre lo stream è dietro {#if initialLoading}
			// (elemento inesistente) → la chat resta sul messaggio più vecchio.
			initialLoading = false;
			await tick();
			scrollDown();
			void loadEligibility(t, n);
			void loadRemoteStatus();
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			initialLoading = false;
		}
	}

	// Refresh periodico di partecipanti + file (così add/remove di file o membri
	// fatti da altri attori o dagli agenti si riflettono senza ricaricare).
	async function refreshInfo() {
		try {
			info = await getChannel(tier, name);
			// tiene vivo l'indicatore "sta lavorando" durante turni lunghi/silenziosi
			// (es. tool-call senza chunk SSE) e lo spegne quando il turno finisce.
			workingResponders = info?.active_responders ?? [];
			void loadEligibility(tier, name); // i provider possono cambiare stato
		} catch {
			/* ignore */
		}
	}
	async function refreshLive() {
		await Promise.all([refreshMessages(), loadFiles(true), refreshInfo()]);
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
				if (last.kind === 'ai') resetLive(last.author);
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
		stopping = false;
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
			const res = await postChannelMessage(tier, name, text);
			tierWarning = res?.warning ?? null;
			await refreshMessages();
			await tick();
			scrollDown();
		} catch (e) {
			// Se l'utente ha premuto Stop, la POST fallisce (turno cancellato): non è
			// un errore da mostrare, e non ripristino il testo.
			if (!stopping) {
				loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
				draft = text; // ripristina il testo se l'invio fallisce
			}
		} finally {
			sending = false;
			stopping = false;
		}
	}

	async function stopTurn() {
		stopping = true;
		try {
			await interruptChannel(tier, name);
		} catch {
			/* ignora: l'importante è riprendere il controllo dell'input */
		}
		sending = false;
		typing = [];
		resetLive();
		await refreshMessages();
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
	// Non proporre agent il cui tier è insufficiente per il topic (eligible=false).
	// Gli agent senza record di idoneità (es. umani) restano proponibili.
	$: inviteMatches = newParticipant.trim()
		? allAgents
				.filter(
					(a) =>
						a.toLowerCase().includes(newParticipant.trim().toLowerCase()) &&
						a !== info?.meta?.owner &&
						!participants.includes(a) &&
						(eligibility[a]?.eligible ?? true)
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
		const files = (e.target as HTMLInputElement).files;
		if (files) for (const f of Array.from(files)) await uploadFile(f);
		(e.target as HTMLInputElement).value = ''; // permette di ricaricare lo stesso file
	}

	// Paste di una o più immagini dalla clipboard → carica come file del topic.
	function pasteStamp(): string {
		const d = new Date();
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
	}
	async function onPasteFiles(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;
		const imgs: File[] = [];
		for (const it of Array.from(items)) {
			if (it.kind === 'file' && it.type.startsWith('image/')) {
				const raw = it.getAsFile();
				if (!raw) continue;
				const ext = (it.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
				// La clipboard dà nomi generici ("image.png") o nessuno → nome con timestamp.
				const named = raw.name && raw.name !== 'image.png'
					? raw
					: new File([raw], `incolla-${pasteStamp()}.${ext}`, { type: it.type });
				imgs.push(named);
			}
		}
		if (imgs.length) {
			e.preventDefault();
			for (const f of imgs) await uploadFile(f);
		}
	}

	// Apre un artefatto HTML in una finestra "chromeless" (popup) con anteprima live.
	function openArtifact(path: string) {
		const url = `/preview/${encodeURIComponent(tier)}/${encodeURIComponent(name)}?path=${encodeURIComponent(path)}`;
		window.open(url, `artifact-${tier}-${name}-${path}`, 'popup,width=1024,height=720');
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

	// --- Resize della colonna destra (.side) ---------------------------------
	// Larghezza persistita in localStorage; trascinabile con un divisore.
	const SIDE_WIDTH_KEY = 'clodia.topicSideWidth';
	const SIDE_MIN = 200;
	const SIDE_MAX = 620;
	let sideWidth = 220;
	let resizingSide = false;
	let resizeStartX = 0;
	let resizeStartW = 220;

	function clampSideWidth(w: number): number {
		return Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.round(w)));
	}
	function onSideResizeStart(e: PointerEvent) {
		resizingSide = true;
		resizeStartX = e.clientX;
		resizeStartW = sideWidth;
		(e.target as HTMLElement).setPointerCapture?.(e.pointerId);
		e.preventDefault();
	}
	function onSideResizeMove(e: PointerEvent) {
		if (!resizingSide) return;
		// La .side è a destra: trascinando il divisore verso SINISTRA si allarga.
		sideWidth = clampSideWidth(resizeStartW + (resizeStartX - e.clientX));
	}
	function onSideResizeEnd() {
		if (!resizingSide) return;
		resizingSide = false;
		try { localStorage.setItem(SIDE_WIDTH_KEY, String(sideWidth)); } catch {}
	}

	let stopStream: (() => void) | null = null;
	let offEvt: (() => void) | null = null;
	onMount(() => {
		try {
			const raw = localStorage.getItem(SIDE_WIDTH_KEY);
			if (raw) sideWidth = clampSideWidth(Number(raw) || sideWidth);
		} catch {}
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
			if (ev.type === 'channel_message') {
				if (p.tier !== tier || p.name !== name) return;
				void refreshMessages().then(() => tick().then(scrollDown));
				return;
			}
			if (ev.type === 'routing_decision') {
				if (p.tier !== tier || p.name !== name) return;
				lastRouting = p as unknown as RoutingTrace;
				void tick().then(scrollDown);
				return;
			}
			// eventi del turno del risponditore di QUESTO canale
			const liveAgent = agentFromChatId(p.chat_id);
			if (!liveAgent) return;
			if (ev.type === 'thinking_chunk') {
				const current = liveFor(liveAgent);
				updateLive(liveAgent, { think: current.think + String(p.delta ?? '') });
			} else if (ev.type === 'message_chunk') {
				if (p.role === 'assistant') {
					const current = liveFor(liveAgent);
					updateLive(liveAgent, { reply: current.reply + String(p.delta ?? '') });
				}
			} else if (ev.type === 'tool_use') {
				const tool = String(p.tool ?? '');
				const inp = p.input_summary ? `: ${String(p.input_summary)}` : '';
				const current = liveFor(liveAgent);
				updateLive(liveAgent, { tools: [...current.tools, `🔧 ${tool}${inp}`].slice(-8) });
			} else if (ev.type === 'task_progress') {
				// progresso di un SUBAGENT (tool Task): senza questo la chat sembra
				// ferma mentre il subagent lavora (es. un download).
				const tool = p.last_tool_name ? ` · ${String(p.last_tool_name)}` : '';
				const desc = p.description ? `: ${String(p.description)}` : '';
				const current = liveFor(liveAgent);
				updateLive(liveAgent, { tools: [...current.tools, `🤖 subagent${tool}${desc}`.slice(0, 120)].slice(-8) });
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

<svelte:window on:pointermove={onSideResizeMove} on:pointerup={onSideResizeEnd} />

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
		{#if info?.tldr}
			{@const history = info?.recap_history ?? []}
			<button type="button" class="tldr tldr-btn" on:click={() => (showRecap = !showRecap)}
				aria-expanded={showRecap} title="Mostra la storia dei recap">
				<span class="tldr-text">{info.tldr}</span>
				{#if history.length > 1}<span class="tldr-count">{history.length} ▾</span>{/if}
			</button>
			{#if showRecap}
				<ol class="recap-timeline">
					{#each history as r, i}
						<li class:current={i === 0}>
							<time datetime={r.ts}>{fmtRecapDate(r.ts)}</time>
							<span class="recap-text">{r.tldr}</span>
						</li>
					{:else}
						<li class="muted">Nessuno storico ancora.</li>
					{/each}
				</ol>
			{/if}
		{/if}
	</header>

	{#if loadErr}<div class="err">{loadErr}</div>{/if}

	{#if tierWarning}
		<div class="tier-warn-overlay" role="dialog" aria-modal="true">
			<div class="tier-warn">
				<div class="tw-head">
					<span class="tw-icon">⚠️</span>
					<strong>Provider sotto il tier del topic</strong>
				</div>
				<p class="tw-msg">{tierWarning.message}</p>
				<ul class="tw-sugg">
					{#each tierWarning.suggestions as s}<li>{s}</li>{/each}
				</ul>
				<div class="tw-meta">
					tier <code>{tierWarning.tier}</code> · provider
					<code>{tierWarning.provider ?? 'n/d'}</code>
					({tierWarning.provider_seal ?? 'SEAL n/d'})
				</div>
				<div class="tw-actions">
					<a class="tw-btn" href="/providers">Vai ai Provider</a>
					<button class="tw-btn ghost" on:click={() => (tierWarning = null)}>Ho capito</button>
				</div>
			</div>
		</div>
	{/if}

	{#if initialLoading}
		<div class="initial-loading" role="status" aria-live="polite" aria-busy="true">
			<span class="initial-spinner" aria-hidden="true"></span>
			<div>
				<strong>Caricamento topic…</strong>
				<span>Recupero messaggi della chat e lista file.</span>
			</div>
		</div>
	{:else}
	<div class="body">
		<main class="stream-wrap">
			<div class="stream" bind:this={stream} on:click={handleStreamClick} role="presentation">
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
											<button type="button" class="pill" on:click={() => pickChoice(c, m)}>{c}</button>
										{/if}
									{/each}
									{#if ch.multi}
										<button type="button" class="pill pill-confirm" disabled={multiSel.size === 0}
											on:click={() => confirmMulti(m)}>✓ Conferma</button>
									{/if}
								</div>
							{/if}
							{@const inv = msgInvite(m.text)}
							{#if inv}
								{@const pending = inv.filter((a) => !participants.includes(a))}
								<div class="invite-team">
									<div class="invite-agents">
										{#each inv as a}
											{#if participants.includes(a)}
												<span class="invite-chip in">✓ {a}</span>
											{:else}
												<button type="button" class="invite-chip" class:off={inviteSkip.has(a)}
													title={inviteSkip.has(a) ? 'escluso — clic per includere' : 'incluso — clic per escludere'}
													on:click={() => toggleInvite(a)}>
													{inviteSkip.has(a) ? '☐' : '☑'} {a}
												</button>
											{/if}
										{/each}
									</div>
									{#if isOwner}
										<button type="button" class="invite-go" disabled={inviting || !pending.some((a) => !inviteSkip.has(a))}
											on:click={() => inviteTeam(inv)}>
											{inviting ? 'Invito…' : '＋ Invita la squadra'}
										</button>
									{:else}
										<span class="invite-note">solo l'owner può invitare</span>
									{/if}
								</div>
							{/if}
							{@const jp = msgJobProposal(m.text)}
							{#if jp !== null}
								<div class="jobprop">
									{#if jobDecided[jp]}
										<span class="jobprop-done">Job {jobDecided[jp]}.</span>
									{:else if isOwner}
										<span class="jobprop-q">⏰ Approvi questo job schedulato?</span>
										<button type="button" class="jobprop-ok" disabled={jobDeciding}
											on:click={() => decideJob(jp, 'Approva')}>{jobDeciding ? '…' : '✓ Approva'}</button>
										<button type="button" class="jobprop-no" disabled={jobDeciding}
											on:click={() => decideJob(jp, 'Annulla')}>Annulla</button>
									{:else}
										<span class="invite-note">solo l'owner può approvare un job</span>
									{/if}
								</div>
							{/if}
						{/if}
						{#if m.attachments?.length}
							<div class="atts">
								{#each m.attachments as a}
									<a class="att" href="#download" on:click|preventDefault={() => openSignedFile(`files/${a}`)}>📎 {a}</a>
								{/each}
							</div>
						{/if}
					</div>
				{:else}
					<p class="empty">Nessun messaggio. Scrivi qualcosa per iniziare.</p>
				{/each}
			</div>
			{#if lastRouting}
				<div class="routing" class:open={routingOpen}>
					<button type="button" class="routing-head" on:click={() => (routingOpen = !routingOpen)}
						aria-expanded={routingOpen}>
						<span class="caret" class:open={routingOpen}>▸</span>
						<span class="routing-title">🧭 Routing → <b>{lastRouting.chosen}</b></span>
						<span class="routing-why">{routingReason[lastRouting.reason] ?? lastRouting.reason}</span>
						<span class="think-hint">{routingOpen ? 'comprimi' : 'dettagli'}</span>
					</button>
					{#if routingOpen}
						<div class="routing-body">
							{#if lastRouting.candidates && lastRouting.candidates.length}
								<div class="routing-meta">
									Punteggi di pertinenza (soglia {lastRouting.threshold ?? '—'}, margine {lastRouting.margin ?? '—'}):
								</div>
								<ul class="routing-scores">
									{#each lastRouting.candidates as c}
										<li class:winner={c.name === lastRouting.chosen}>
											<span class="rs-name">{c.name}{#if c.super}<span class="rs-tag">super</span>{/if}</span>
											<span class="rs-bar"><span class="rs-fill" style="width:{Math.min(100, Math.round(c.score * 100))}%"></span></span>
											<span class="rs-val">{c.score.toFixed(3)}</span>
										</li>
									{/each}
								</ul>
							{:else}
								<div class="routing-meta">Nessun punteggio disponibile (tag esplicito o embedder non raggiungibile).</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
			{#if typingLabel}
				<div class="typing" aria-live="polite">
					<span class="typing-dots"><span></span><span></span><span></span></span>
					{typingLabel}
				</div>
			{/if}
			{#if hasLive || typingLabel}
				<!-- Ragionamento: collassabile (default chiuso), header SEMPRE visibile
				     mentre l'agente lavora — anche prima che arrivi il primo thinking. -->
				{#each liveEntries as [agent, live] (agent)}
					<div class="think" class:open={thinkOpen}>
						<button type="button" class="think-head" on:click={toggleThink}
							aria-expanded={thinkOpen}>
							<span class="caret" class:open={thinkOpen}>▸</span>
							<span class="think-title">Ragionamento · {agent}</span>
							<span class="think-live">● live</span>
							<span class="think-hint">{thinkOpen ? 'comprimi' : 'espandi'}</span>
						</button>
						{#if thinkOpen}
							<div class="think-body"><pre class="think-text">{live.think || '…'}</pre></div>
						{/if}
					</div>
					<!-- Tool e subagent in uso: SEMPRE visibili (anche col thinking collassato) -->
					{#if live.tools.length}
						<ul class="live-tools">
							{#each live.tools as t}<li>{t}</li>{/each}
						</ul>
					{/if}
					<!-- Risposta in streaming: sempre visibile -->
					{#if live.reply}
						<div class="think-reply md">{@html renderMarkdown(stripChoices(live.reply))}</div>
					{/if}
				{/each}
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
				<input type="file" multiple bind:this={fileInput} on:change={onUpload} hidden />
				<button type="button" class="clip" title="Allega file" on:click={() => fileInput?.click()}>📎</button>
				<button type="button" class="expand-input" title="Apri editor ampio" aria-label="Apri editor ampio"
					on:click={openExpandedComposer}>↗</button>
				<textarea bind:this={composer} bind:value={draft} rows="2"
					placeholder="Scrivi nel canale… (@nome per rivolgerti a un partecipante; ⌘/Ctrl+V per incollare immagini)"
					on:input={updateMention}
					on:click={updateMention}
					on:paste={onPasteFiles}
					on:keydown={onCompactComposerKeydown}></textarea>
				{#if hasLive || typing.length}
					<button type="button" class="stop-btn" on:click={stopTurn} title="Interrompi le risposte in corso">
						■ Stop
					</button>
				{/if}
				<button type="button" on:click={send} disabled={!draft.trim() || sending}>
					{sending ? 'Invio…' : 'Invia'}
				</button>
			</div>
		</main>

		<div
			class="side-resizer"
			class:active={resizingSide}
			role="separator"
			aria-orientation="vertical"
			aria-label="Ridimensiona pannello laterale"
			title="Trascina per ridimensionare"
			on:pointerdown={onSideResizeStart}
		></div>

		<aside class="side" style="flex: 0 0 {sideWidth}px; width: {sideWidth}px;">
			<ArtifactCanvas {tier} {name} />
			<section>
				<h3>Partecipanti</h3>
				<ul class="parts">
					{#each shownParticipants as p}
						<li>
							<span class="part-id">
								<AgentAvatar name={p} size={22} />
								<span class="part-name">{p}{#if p === info?.meta?.owner} <em>(owner)</em>{/if}</span>
								{#if eligibility[p]?.warn}
									<span class="part-warn" title="Provider sotto il tier del topic: attiva un provider con SEAL ≥ tier">⚠️</span>
								{/if}
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
				<h3 class="sec-head">
					<span>File</span>
					<button type="button" class="zip-all" disabled={zipping}
						title="Scarica uno ZIP con tutti i file del topic"
						on:click={downloadZip}>{zipping ? '⏳ zip…' : '⬇ zip'}</button>
					{#if remoteMeta}{@const ru = remoteUrl()}
						{#if ru}
							<a class="remote-goto" href={ru} target="_blank" rel="noopener"
								title={`Apri il remote (${remoteMeta.type})${remoteName ? ` — ${remoteName}` : ''}`}>{@html remoteIconSvg()} {remoteName || `apri ${remoteMeta.type}`}</a>
						{/if}
					{/if}
				</h3>
				<nav class="crumbs" aria-label="Percorso file">
					<button type="button" class="crumb" on:click={() => gotoCrumb(-1)}>/</button>
					{#each crumbs as seg, i}
						<span class="crumb-sep">/</span>
						<button type="button" class="crumb" on:click={() => gotoCrumb(i)}>{seg}</button>
					{/each}
					{#if filesLoading}<span class="files-spinner" aria-label="Caricamento…" title="Caricamento…"></span>{/if}
					{#if remoteMeta && folderAddable.length}
						<button type="button" class="sync-add stage-all" disabled={remoteBusy}
							title={`Metti in sync tutti i file di questa cartella (${folderAddable.length})`}
							on:click={() => stageMany(folderAddable)}>⊕ tutti</button>
					{/if}
					{#if remoteMeta && folderStaged.length}
						<button type="button" class="sync-add stage-all" class:solo-unstage={!folderAddable.length} disabled={remoteBusy}
							title={`Togli dallo staging tutti i file di questa cartella (${folderStaged.length})`}
							on:click={() => unstageMany(folderStaged)}>⊖ tutti</button>
					{/if}
				</nav>
			<ul class="files" class:loading={filesLoading} aria-busy={filesLoading}>
					{#each files as f}
						{@const st = f.kind !== 'dir' ? fileState(f.path) : null}
						<li>
							{#if f.kind === 'dir'}
								<button type="button" class="dir" on:click={() => openDir(f)} disabled={filesLoading}>📂 {f.name}</button>
							{:else if f.remote}
								<a href={f.url} target="_blank" rel="noopener" class="remote st-{st ?? 'none'}" title="Documento Google — apri e modifica su Drive">📄 {f.name}</a>
							{:else}
								<a href="#download" class="st-{st ?? 'none'}"
									title={st ? `${f.name} — ${st}` : f.name}
									on:click|preventDefault={() => openSignedFile(f.path)}>{f.name}</a>
								{#if /\.html?$/i.test(f.name)}
									<button type="button" class="artifact-open" title="Apri anteprima live (finestra separata)"
										on:click={() => openArtifact(f.path)}>🔎</button>
								{/if}
							{/if}
							{#if remoteMeta && f.kind !== 'dir' && !f.remote && ADDABLE.includes(st ?? '')}
								<button type="button" class="sync-add"
									title={st === 'modified' ? 'Metti in staging la modifica' : 'Aggiungi al sync'}
									on:click={() => stageMany([relOf(f.path)])}
									disabled={remoteBusy}>⊕</button>
							{:else if remoteMeta && f.kind !== 'dir' && !f.remote && st === 'staged'}
								<button type="button" class="sync-add"
									title="Togli dallo staging"
									on:click={() => unstageMany([relOf(f.path)])}
									disabled={remoteBusy}>⊖</button>
							{/if}
						</li>
					{:else}
						<li class="muted">{filesLoading ? 'caricamento…' : 'cartella vuota'}</li>
					{/each}
				</ul>
				<p class="files-hint">Carica i file dall'input della chat: 📎, trascinamento o incolla (⌘/Ctrl+V) di immagini.</p>
			</section>

			{#if remoteMeta && syncGroups.length}
				<section class="sync-status" aria-label="Sync status">
					<h3>Sync status</h3>
					{#each syncGroups as g (g.state)}
						<div class="ss-group">
							<div class="ss-title st-{g.state}">
								<span class="ss-dot st-{g.state}"></span>{g.label}
								<span class="ss-n">{g.paths.length}</span>
								{#if g.state === 'staged'}
									<button type="button" class="sync-add" disabled={remoteBusy}
										title="Togli tutto dallo staging" on:click={() => unstageMany(null)}>⊖ tutti</button>
								{:else}
									<button type="button" class="sync-add" disabled={remoteBusy}
										title="Metti in sync tutti" on:click={() => stageMany(g.paths)}>⊕ tutti</button>
								{/if}
							</div>
							<ul class="ss-list">
								{#each g.paths as p (p)}
									<li>
										<span class="ss-path st-{g.state}" title={p}>{p}</span>
										{#if g.state === 'staged'}
											<button type="button" class="sync-add" disabled={remoteBusy}
												title="Togli dallo staging" on:click={() => unstageMany([p])}>⊖</button>
										{:else}
											<button type="button" class="sync-add" disabled={remoteBusy}
												title={g.state === 'modified' ? 'Metti in staging' : 'Aggiungi al sync'}
												on:click={() => stageMany([p])}>⊕</button>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</section>
			{/if}

			<section class="remote-panel">
				<h3>Remote</h3>
				{#if !remoteMeta}
					<p class="muted">Storage locale. Attiva un remote per sincronizzare i file.</p>
					{#if remoteForm}
						<form class="remote-form" on:submit|preventDefault={submitRemoteForm}>
							<input class="remote-url-input" type="text" bind:value={remoteInput}
								placeholder={remoteForm === 'git'
									? 'URL repo git (vuoto = solo commit locali)'
									: 'Link/ID cartella Drive (vuoto = nuova)'}
								autocomplete="off" spellcheck="false"
								on:keydown={(e) => e.key === 'Escape' && cancelRemoteForm()} />
							<div class="remote-actions">
								<button type="submit" disabled={remoteBusy}>collega {remoteForm}</button>
								<button type="button" on:click={cancelRemoteForm} disabled={remoteBusy}>annulla</button>
							</div>
						</form>
					{:else}
						<div class="remote-actions">
							<button type="button" on:click={() => openRemoteForm('git')} disabled={remoteBusy}>{@html SVG_GITHUB} git</button>
							<button type="button" on:click={() => openRemoteForm('drive')} disabled={remoteBusy}>{@html SVG_DRIVE} Drive</button>
						</div>
					{/if}
				{:else}
					<p class="remote-info">
						{@html remoteIconSvg()} <strong>{remoteMeta.type}</strong>{#if remoteName}
							<span class="remote-name" title={remoteName}>{remoteName}</span>{/if}
						{#if remoteStatus}
							{#if remoteStatus.type === 'git'}<span class="muted"> · {remoteStatus.dirty ?? 0} da committare</span>
							{:else}<span class="muted"> · {remoteStatus.synced ?? 0} in sync, {remoteStatus.pending ?? 0} da pushare</span>{/if}
						{/if}
						{#if remoteBusy}<span class="files-spinner" style="margin-left:6px"></span>{/if}
					</p>
					<div class="remote-actions">
						<button type="button" on:click={() => doRemote('pull')} disabled={remoteBusy}>⬇︎ pull</button>
						<button type="button"
							on:click={() => remoteMeta.type === 'git' ? doRemote('commit').then(() => doRemote('push')) : doRemote('push')}
							disabled={remoteBusy}>⬆︎ push</button>
						<button type="button" on:click={loadRemoteStatus} disabled={remoteBusy}>↻</button>
						<button type="button" class="danger"
							on:click={() => confirm('Disattivare il remote? I file locali restano.') && doRemote('disable')}
							disabled={remoteBusy}>disattiva</button>
					</div>
					{#if syncReportEntries.length}
						<div class="sync-report" aria-label="Esito ultimo sync">
							<span class="sr-action">{lastSyncReport?.action}:</span>
							{#each syncReportEntries as [state, n] (state)}
								<span class="sr-chip sr-{state}" title={SYNC_REPORT_LABELS[state] ?? state}>{n} {SYNC_REPORT_LABELS[state] ?? state}</span>
							{/each}
						</div>
					{/if}
					<p class="remote-filter-hint">
						Filtra la sync con <code>remoteinclude</code> / <code>remoteignore</code> nella root dei file (stile <code>.gitignore</code>).
					</p>
				{/if}
			</section>
		</aside>
	</div>
	{/if}
</div>

{#if composerExpanded}
	<div class="composer-modal-backdrop" role="button" tabindex="0"
		on:click={closeExpandedComposer}
		on:keydown={(e) => e.key === 'Escape' && closeExpandedComposer()}>
		<div class="composer-modal" role="dialog" aria-modal="true" aria-label="Editor messaggio ampio"
			tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
			<header class="composer-modal-head">
				<h2>Messaggio</h2>
				<button type="button" class="modal-close" aria-label="Chiudi editor" on:click={closeExpandedComposer}>×</button>
			</header>
			<textarea bind:this={expandedComposer} bind:value={draft}
				placeholder="Scrivi un messaggio lungo…"
				on:paste={onPasteFiles}
				on:keydown={onExpandedComposerKeydown}></textarea>
			<footer class="composer-modal-actions">
				<span>Enter va a capo · Ctrl/⌘+Enter invia</span>
				<button type="button" class="modal-send" on:click={submitFromExpanded} disabled={sending || !draft.trim()}>
					{sending ? 'Invio…' : 'Invia'}
				</button>
			</footer>
		</div>
	</div>
{/if}

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
	.tldr-btn { display: inline-flex; align-items: baseline; gap: 6px; max-width: 100%;
		background: none; border: none; padding: 0; text-align: left; cursor: pointer;
		font: inherit; color: var(--fg-muted); }
	.tldr-btn:hover { color: var(--accent); }
	.tldr-count { font-size: 11px; opacity: .8; white-space: nowrap; }
	.recap-timeline { list-style: none; margin: 8px 0 0; padding: 8px 0 4px 12px;
		border-left: 2px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
	.recap-timeline li { display: flex; flex-direction: column; gap: 1px; font-size: 12px; }
	.recap-timeline li.current .recap-text { color: var(--fg); font-weight: 600; }
	.recap-timeline time { font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: var(--fg-muted); }
	.recap-timeline .recap-text { color: var(--fg-muted); }
	.err { color: var(--danger); font-size: 12px; margin: 8px 0; }
	.zip-all {
		font-size: 11px; padding: 1px 8px; margin-left: 8px;
		border: 1px solid var(--border); border-radius: 5px;
		background: transparent; color: var(--fg-muted); cursor: pointer;
	}
	.zip-all:disabled { opacity: 0.6; cursor: default; }
	.tier-warn-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); padding: 16px; }
	.tier-warn { background: var(--card-bg); border: 1px solid var(--border); border-left: 4px solid var(--warn, #e0a800); border-radius: 12px; max-width: 460px; width: 100%; padding: 18px 20px; box-shadow: 0 12px 40px rgba(0,0,0,.35); }
	.tw-head { display: flex; align-items: center; gap: 8px; font-size: 15px; margin-bottom: 8px; }
	.tw-icon { font-size: 18px; }
	.tw-msg { font-size: 13px; color: var(--fg); margin: 0 0 10px; line-height: 1.45; }
	.tw-sugg { margin: 0 0 10px; padding-left: 18px; font-size: 13px; color: var(--fg-muted); line-height: 1.5; }
	.tw-meta { font-size: 12px; color: var(--fg-muted); margin-bottom: 14px; }
	.tw-meta code { background: rgba(127,127,127,.15); padding: 1px 5px; border-radius: 4px; }
	.tw-actions { display: flex; gap: 8px; justify-content: flex-end; }
	.tw-btn { font-size: 13px; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; text-decoration: none; }
	.tw-btn.ghost { background: transparent; color: var(--fg-muted); border-color: var(--border); }
	.tw-btn:hover { filter: brightness(1.08); }
	.initial-loading { flex: 1 1 auto; min-height: 280px; display: flex; align-items: center; justify-content: center; gap: 14px; color: var(--fg-muted); border: 1px solid var(--border); border-radius: 12px; background: var(--card-bg); margin-top: 12px; }
	.initial-loading strong { display: block; color: var(--fg); font-size: 14px; margin-bottom: 3px; }
	.initial-loading div span { display: block; font-size: 12px; }
	.initial-spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .75s linear infinite; flex: none; }
	@keyframes spin { to { transform: rotate(360deg); } }
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
	/* blocco Routing (quale agente risponde e perché) */
	.routing { margin: 4px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-subtle, rgba(127,127,127,.06)); font-size: 12px; }
	.routing-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; background: none; border: 0; cursor: pointer; color: var(--fg); text-align: left; }
	.routing-head .caret { transition: transform .15s; color: var(--fg-muted); }
	.routing-head .caret.open { transform: rotate(90deg); }
	.routing-title { font-weight: 500; }
	.routing-why { color: var(--fg-muted); flex: 1; font-style: italic; }
	.routing-head .think-hint { color: var(--fg-muted); font-size: 11px; }
	.routing-body { padding: 4px 12px 10px 12px; }
	.routing-meta { color: var(--fg-muted); margin-bottom: 6px; }
	.routing-scores { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.routing-scores li { display: grid; grid-template-columns: 120px 1fr 48px; align-items: center; gap: 8px; }
	.routing-scores li.winner .rs-name { font-weight: 600; color: var(--accent); }
	.rs-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rs-tag { margin-left: 4px; font-size: 9px; text-transform: uppercase; opacity: .6; }
	.rs-bar { height: 6px; border-radius: 3px; background: rgba(127,127,127,.18); overflow: hidden; }
	.rs-fill { display: block; height: 100%; background: var(--accent); opacity: .55; }
	.routing-scores li.winner .rs-fill { opacity: 1; }
	.rs-val { text-align: right; font-variant-numeric: tabular-nums; color: var(--fg-muted); }

	/* "sta scrivendo…" */
	.typing { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 12px; color: var(--fg-muted); font-style: italic; }
	.typing-dots { display: inline-flex; gap: 3px; }
	.typing-dots span { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); opacity: .4; animation: td 1s infinite; }
	.typing-dots span:nth-child(2) { animation-delay: .2s; }
	.typing-dots span:nth-child(3) { animation-delay: .4s; }
	@keyframes td { 0%,60%,100% { opacity: .25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }

	/* Pannello "Ragionamento" live (comprimibile, di default chiuso) */
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

	/* widget invito squadra (marker <!-- invite=... -->) */
	.invite-team { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 10px; background: rgba(127,127,127,.05); }
	.invite-agents { display: flex; flex-wrap: wrap; gap: 6px; }
	.invite-chip { background: transparent; border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 12px; padding: 3px 9px; border-radius: 999px; cursor: pointer; }
	.invite-chip.off { opacity: .45; text-decoration: line-through; }
	.invite-chip.in { border-color: var(--accent); color: var(--accent); cursor: default; opacity: .8; }
	.invite-go { margin-left: auto; background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font: inherit; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 999px; cursor: pointer; }
	.invite-go:disabled { opacity: .5; cursor: not-allowed; }
	.invite-note { margin-left: auto; font-size: 11px; color: var(--fg-muted); font-style: italic; }

	/* popup conferma proposta di job (marker <!-- job-proposal=id -->) */
	.jobprop { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 10px; background: rgba(127,127,127,.05); font-size: 12px; }
	.jobprop-q { flex: 1; }
	.jobprop-done { color: var(--fg-muted); font-style: italic; }
	.jobprop-ok { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font: inherit; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 999px; cursor: pointer; }
	.jobprop-ok:disabled { opacity: .5; cursor: not-allowed; }
	.jobprop-no { background: transparent; border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 999px; cursor: pointer; }
	.atts { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
	.att, .files a { font-size: 12px; color: var(--accent); text-decoration: none; }
	.empty { color: var(--fg-muted); font-size: 13px; text-align: center; margin-top: 24px; }
	.composer { position: relative; flex: none; display: flex; align-items: flex-end; gap: 8px; padding-top: 8px; border-radius: 8px; }
	.composer.drag { outline: 2px dashed var(--accent); outline-offset: 3px; }
	.drop-hint { position: absolute; inset: 8px 0 0; z-index: 25; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--accent) 12%, var(--card-bg)); border-radius: 8px; font-size: 13px; font-weight: 700; color: var(--accent); pointer-events: none; }
	.composer textarea { flex: 1 1 auto; background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 8px; resize: none; }
	.composer button { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font-weight: 700; padding: 0 16px; border-radius: 8px; cursor: pointer; }
	.composer button:disabled { opacity: .5; cursor: not-allowed; }
	.composer button.stop-btn { background: var(--danger); border-color: var(--danger); color: #fff; }
	.composer button.stop-btn:hover { filter: brightness(1.08); }
	.clip { background: transparent !important; border: 1px solid var(--border) !important; color: var(--fg) !important; font-size: 16px; padding: 0 12px !important; height: 38px; }
	.expand-input { background: transparent !important; border: 1px solid var(--border) !important; color: var(--fg-muted) !important; font-size: 15px; padding: 0 11px !important; height: 38px; min-width: 38px; }
	.expand-input:hover { border-color: var(--accent) !important; color: var(--accent) !important; background: rgba(255,107,61,.08) !important; }
	.composer-modal-backdrop { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.55); }
	.composer-modal { width: min(760px, 100%); max-height: min(720px, calc(100vh - 40px)); display: flex; flex-direction: column; gap: 12px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px; box-shadow: 0 18px 55px rgba(0,0,0,.45); }
	.composer-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	.composer-modal h2 { margin: 0; font-size: 16px; }
	.modal-close { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--fg-muted); font: inherit; font-size: 20px; cursor: pointer; }
	.modal-close:hover { color: var(--fg); border-color: var(--accent); }
	.composer-modal textarea { width: 100%; min-height: 320px; flex: 1 1 auto; resize: vertical; background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 14px; line-height: 1.5; padding: 12px; border-radius: 10px; }
	.composer-modal-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--fg-muted); font-size: 12px; }
	.modal-send { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font-weight: 700; padding: 8px 18px; border-radius: 8px; cursor: pointer; }
	.modal-send:disabled { opacity: .5; cursor: not-allowed; }
	.mention-pop { position: absolute; bottom: calc(100% + 4px); left: 0; z-index: 20; list-style: none; margin: 0; padding: 4px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.35); min-width: 180px; max-height: 220px; overflow-y: auto; }
	.mention-item { display: flex; align-items: center; gap: 7px; width: 100%; background: transparent; border: none; color: var(--fg); font: inherit; font-size: 12.5px; padding: 5px 8px; border-radius: 6px; cursor: pointer; text-align: left; }
	.mention-item.sel, .mention-item:hover { background: rgba(255, 107, 61, 0.12); }
	.files-hint { font-size: 11px; color: var(--fg-muted); margin: 8px 0 0; line-height: 1.4; }
	.sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
	.remote-goto { font-size: 11px; font-weight: 600; color: var(--accent); text-decoration: none;
		max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: bottom; }
	.remote-name { margin-left: 6px; font-size: 11.5px; color: var(--fg-muted); font-family: var(--mono);
		max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.remote-goto:hover { text-decoration: underline; }
	.sync-add { margin-left: 6px; background: transparent; border: none; color: var(--fg-muted); cursor: pointer; font-size: 13px; padding: 0 3px; border-radius: 5px; white-space: nowrap; }
	.sync-add:hover { color: var(--accent); background: rgba(255,107,61,.12); }
	.sync-add:disabled { opacity: .4; cursor: not-allowed; }
	.stage-all { margin-left: auto; font-size: 11px; }

	/* Codice colore stato sync (comune a git e drive, stile git status):
	   blu = solo locale · verde = in sync · arancio = modificato · teal = staged */
	.files a.st-unsynced, .ss-path.st-unsynced, .ss-title.st-unsynced { color: #60a5fa; }
	.files a.st-synced { color: #4ade80; }
	.files a.st-modified, .ss-path.st-modified, .ss-title.st-modified { color: #f59e0b; }
	.files a.st-staged, .ss-path.st-staged, .ss-title.st-staged { color: #2dd4bf; }
	.files a.st-none { color: var(--accent); }

	/* Sync status — l'equivalente del git status sotto la vista file */
	.sync-status { margin-top: 12px; }
	.sync-status h3 { margin: 0 0 6px; }
	.ss-group { margin: 0 0 8px; }
	.ss-title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700;
		text-transform: uppercase; letter-spacing: .05em; padding: 2px 0; }
	.ss-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: currentColor; }
	.ss-n { font-family: var(--mono); font-size: 10.5px; color: var(--fg-muted); }
	.ss-list { list-style: none; margin: 2px 0 0; padding: 0 0 0 14px; display: flex;
		flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto; }
	.ss-list li { display: flex; align-items: center; gap: 4px; min-width: 0; }
	.ss-path { font-size: 11.5px; font-family: var(--mono); overflow: hidden;
		text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1 1 auto; }
	.artifact-open { margin-left: 4px; background: transparent; border: none; color: var(--fg-muted); cursor: pointer; font-size: 13px; padding: 0 3px; border-radius: 5px; }
	.artifact-open:hover { color: var(--accent); background: rgba(255,107,61,.12); }
	.remote-panel { margin-top: 14px; }
	.sync-report { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 8px 0 0; }
	.sr-action { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--fg-muted); }
	.sr-chip { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; background: rgba(120,144,156,.16); color: var(--fg-muted); white-space: nowrap; }
	.sr-synced { background: rgba(74,222,128,.16); color: #4ade80; }
	.sr-conflict { background: rgba(239,68,68,.18); color: #ef4444; }
	.sr-error { background: rgba(239,68,68,.18); color: #ef4444; }
	.sr-skipped_by_hard_deny { background: rgba(245,158,11,.16); color: #f59e0b; }
	.remote-filter-hint { font-size: 10.5px; color: var(--fg-muted); margin: 8px 0 0; line-height: 1.5; }
	.remote-filter-hint code { font-size: 10px; }
	.remote-info { font-size: 12px; margin: 2px 0 8px; display: flex; align-items: center; }
	.remote-form { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; }
	.remote-url-input { width: 100%; box-sizing: border-box; font-size: 12px; padding: 5px 8px;
		border: 1px solid var(--border); background: transparent; color: var(--fg); border-radius: 7px; }
	.remote-url-input:focus { outline: none; border-color: var(--accent); }
	.remote-actions { display: flex; flex-wrap: wrap; gap: 6px; }
	.remote-actions button { font-size: 12px; padding: 4px 9px; border: 1px solid var(--border); background: transparent; color: var(--fg); border-radius: 7px; cursor: pointer; }
	.remote-actions button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
	.remote-actions button:disabled { opacity: .5; cursor: default; }
	.remote-actions button.danger:hover:not(:disabled) { border-color: var(--danger); color: var(--danger); }
	.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; margin-bottom: 6px; font-size: 11.5px; }
	.files-spinner { width: 12px; height: 12px; margin-left: 6px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: files-spin .7s linear infinite; flex: none; }
	@keyframes files-spin { to { transform: rotate(360deg); } }
	.files.loading { opacity: .55; pointer-events: none; }
	.crumb { background: transparent; border: none; color: var(--fg-muted); cursor: pointer; padding: 1px 3px; border-radius: 4px; font: inherit; font-size: 11.5px; }
	.crumb:hover { color: var(--accent); }
	.crumb-sep { color: var(--fg-muted); opacity: .6; }
	.dir { background: transparent; border: none; color: var(--fg); cursor: pointer; font: inherit; font-size: 12px; padding: 0; text-align: left; }
	.dir:hover { color: var(--accent); }
	/* Larghezza via inline style (resize); flex:0 0 evita che venga compressa.
	   height:100% + min-height:0 → occupa tutta l'altezza del .body e scrolla
	   internamente invece di allungare la pagina. */
	.side { flex: 0 0 220px; width: 220px; height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 18px; overflow-y: auto; }

	/* Divisore trascinabile tra chat e pannello destro. Sta nel gap del .body;
	   l'area cliccabile è più larga della barretta visibile (::before). */
	.side-resizer {
		flex: 0 0 6px;
		align-self: stretch;
		margin: 0 -5px; /* estende l'hit-area dentro il gap senza spostare i pannelli */
		cursor: col-resize;
		position: relative;
		touch-action: none;
	}
	.side-resizer::before {
		content: '';
		position: absolute;
		top: 0; bottom: 0; left: 50%;
		width: 2px;
		transform: translateX(-50%);
		background: var(--border);
		border-radius: 2px;
		transition: background 0.12s ease;
	}
	.side-resizer:hover::before,
	.side-resizer.active::before { background: var(--accent); width: 3px; }
	.side h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); margin: 0 0 6px; }
	.parts, .files { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
	.parts li { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 12.5px; }
	.part-id { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
	.part-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.part-warn { flex-shrink: 0; font-size: 12px; cursor: help; margin-left: 2px; }
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
