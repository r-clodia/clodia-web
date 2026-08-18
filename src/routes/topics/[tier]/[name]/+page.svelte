<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { activeTopic, markSeen, ackMentions, topicKey } from '$lib/stores/unread';
	import { page } from '$app/stores';
	import { session } from '$lib/auth/session';
	import { isAdmin } from '$lib/stores/capabilities';
	import { onEventStream, startEventStream } from '$lib/stores/events-stream';
	import { renderMarkdown } from '$lib/markdown';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import ArtifactCanvas from '$lib/components/ArtifactCanvas.svelte';
	import TopicTriggersPanel from '$lib/components/TopicTriggersPanel.svelte';
	import TrifectaBadge from '$lib/components/TrifectaBadge.svelte';
	import TopicMark from '$lib/components/TopicMark.svelte';
	import { topicLogoUrl as logoObjectUrl, dimenticaLogo } from '$lib/topicLogo';
	import SpawnTree from '$lib/components/SpawnTree.svelte';
	import AgentLiveBox from '$lib/components/AgentLiveBox.svelte';
	import MultiSpawnBadge from '$lib/components/MultiSpawnBadge.svelte';
	import { seedName, setKnownSeeds } from '$lib/agents';
	import {
		ApiError,
		getAgents,
		getChannel,
		resetChannelTrifecta,
		getChannelMessages,
		getChannelMessagesAndPresence,
		type PresenceState,
		getChannelAliases,
		postChannelMessage,
		sendMessageFeedback,
		getFeedbackLessons,
		deleteFeedbackLesson,
		resetChannelContext,
		interruptChannel,
		topicRemote,
		type RemoteStatus,
		setChannelParticipant,
		decideJobProposal,
		apiGet,
		apiPost,
		getChannelEligibility,
		recordRoutingFeedback,
		resolveRoutingChoice,
		getChannelFiles,
		uploadChannelFile,
		downloadTopicZip,
		channelFileUrl,
		signedChannelFileUrl,
		setTopicPortable,
		setTopicTelegram,
		listTopicMcpClients,
		issueTopicMcpClient,
		setTopicLogo,
		clearTopicLogo,
		API_BASE_URL,
		type McpClientGrant,
		setTopicStatus,
		setTopicDeadline,
		TOPIC_STATUSES,
		type ChannelInfo,
		type ChannelMessage,
		type FeedbackLesson,
		type ChannelFile,
	} from '$lib/api/client';
	import { getTopicAgentsMd, saveTopicAgentsMd, type TopicAgentsMd } from '$lib/api/client';
	import { toastSuccess, toastError } from '$lib/stores/toasts';
	import { expandChannelAliases } from '$lib/channelAliases';
	import type { TierWarning } from '$lib/api/types';

	$: params = $page.params as Record<string, string>;
	$: tier = params.tier ?? '';
	$: name = params.name ?? '';

	// Visita (issue#83): spegne SOLO il pallino attività. Le mention si spengono
	// con l'ack esplicito quando la coda dei messaggi è renderizzata (vedi
	// _ackTail); i gate mai per lettura. Alla chiusura libero il topic attivo.
	$: if (tier && name) {
		activeTopic.set(topicKey(tier, name));
		markSeen(tier, name);
	}

	// Ack di lettura delle mention: SOLO quando l'ultimo messaggio è stato
	// davvero renderizzato e la vista è in fondo (non alla mera apertura).
	// `_ackedTs` evita di rimandare lo stesso ack a ogni evento di scroll.
	let _ackedTs = '';
	function _ackTail() {
		const last = messages[messages.length - 1];
		if (!last?.ts || !isNearBottom || last.ts === _ackedTs) return;
		_ackedTs = last.ts;
		ackMentions(tier, name, last.ts);
	}
	onDestroy(() => activeTopic.set(null));

	let info: ChannelInfo | null = null;
	let messages: ChannelMessage[] = [];
	let files: ChannelFile[] = [];
	let feedbackByMessage: Record<string, 'thumbs_up' | 'thumbs_down'> = {};
	let feedbackBusy = '';
	let feedbackLessons: FeedbackLesson[] = [];
	let feedbackLessonsKey = '';
	const BOTTOM_THRESHOLD_PX = 64;
	let isNearBottom = true;
	let showNewMessages = false;
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

	// --- Remote: git usa il sync; Drive è il filesystem live del topic. -------
	let remoteStatus: RemoteStatus | null = null;
	let remoteBusy = false;
	// Uno scope può avere più mount (voce 33). Il legacy `meta.remote` è un
	// oggetto singolo e si converte QUI, in lettura: i topic già collegati non
	// hanno ancora `mounts`, e un frontend che non li vedesse mostrerebbe
	// «storage locale» a un topic con Drive collegato — un errore che non si
	// annuncia, perché la schermata resta plausibile.
	$: topicMounts = (() => {
		const m = info?.meta as Record<string, any> | undefined;
		if (Array.isArray(m?.mounts)) return m!.mounts as Record<string, any>[];
		return m?.remote ? [{ name: m.remote.type ?? 'remote', ...m.remote }] : [];
	})();
	// Quale mount guarda il pannello. Il nome, non l'indice: dopo uno scollega
	// l'indice punta a un altro mount, e le azioni andrebbero sul mount sbagliato.
	let mountSel: string | null = null;
	$: if (topicMounts.length && !topicMounts.some((m) => m.name === mountSel)) {
		mountSel = topicMounts[0].name ?? null;
	}
	$: remoteMeta = topicMounts.find((m) => m.name === mountSel) ?? topicMounts[0] ?? null;
	$: isDriveRemote = remoteMeta?.type === 'drive';
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
		try { remoteStatus = (await topicRemote(tier, name, 'status', mountArg())) as RemoteStatus; } catch { /* ignore */ }
	}
	// --- Stato sync PER-FILE Git: rel → synced|modified|staged|unsynced. -------
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
			if (paths === null) await topicRemote(tier, name, 'unstage', mountArg());
			else for (const p of paths) await topicRemote(tier, name, 'unstage', { path: p, ...mountArg() });
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
			for (const p of paths) await topicRemote(tier, name, 'add', { path: p, ...mountArg() });
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
	// ── Rifiuto CONFERMABILE (clodia-platform, 4 ago 2026) ────────────────────
	// Il backend marca i casi in cui la decisione spetta all'owner e non al
	// sistema — collegare Drive su un topic che ha già file — con un 409 e un
	// campo strutturato. Qui diventa una conferma, non un errore: `loadErr`
	// mostrerebbe un messaggio rosso senza via d'uscita, mentre la via d'uscita
	// è precisamente l'informazione che serve.
	let confirmRemote: { message: string; field: string;
		action: string; params: Record<string, unknown> } | null = null;

	/** Il mount su cui agisce un verbo. Omesso quando non c'è: il backend
	 *  senza `mount` si comporta come prima, e mandare `undefined` sarebbe un
	 *  nome vuoto — che non è la stessa cosa di nessun nome. */
	function mountArg(): Record<string, string> {
		return remoteMeta?.name ? { mount: String(remoteMeta.name) } : {};
	}

	async function doRemote(action: string, params: Record<string, unknown> = {}) {
		remoteBusy = true; loadErr = '';
		try {
			// `enable` crea un mount NUOVO: passargli quello selezionato lo
			// sostituirebbe, che è il difetto per cui esiste questa modifica.
			const conMount = action === 'enable' ? params : { ...mountArg(), ...params };
			const res = (await topicRemote(tier, name, action, conMount)) as Record<string, unknown>;
			const rep = (res?.report ?? null) as { counts?: Record<string, number> } | null;
			if ((action === 'pull' || action === 'push' || action === 'commit') && rep?.counts) {
				lastSyncReport = { action, counts: rep.counts };
			}
			await refreshInfo(); // meta.remote può cambiare (enable/disable)
			await loadRemoteStatus();
			await loadFiles();
		} catch (e) {
			const c = e instanceof ApiError && e.status === 409 ? parseConfirmable(e.body) : null;
			if (c) {
				confirmRemote = { message: c.message, field: c.confirm_field,
					action, params };
			} else {
				loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
			}
		} finally {
			remoteBusy = false;
		}
	}
	/** Estrae il 409 strutturato. Il nome del campo di conferma arriva dal
	 *  backend (`confirm_field`) invece di essere scritto qui: così il giorno che
	 *  lo rinomina la conferma non smette di funzionare in silenzio. */
	function parseConfirmable(body: string):
			{ message: string; confirm_field: string } | null {
		try {
			const d = JSON.parse(body)?.detail;
			if (d && typeof d === 'object' && d.confirmable && d.confirm_field) {
				return { message: String(d.message ?? ''), confirm_field: String(d.confirm_field) };
			}
		} catch { /* corpo non JSON: non è una conferma */ }
		return null;
	}
	function acceptConfirmRemote() {
		const c = confirmRemote;
		confirmRemote = null;
		if (c) void doRemote(c.action, { ...c.params, [c.field]: true });
	}
	// Solo gli stati con conteggio > 0, per il riepilogo compatto.
	$: syncReportEntries = lastSyncReport
		? Object.entries(lastSyncReport.counts).filter(([, n]) => n > 0)
		: [];
	// Form inline nella sidebar (non un popup effimero): l'input dell'URL/cartella
	// resta visibile e navigabile finché non si conferma o si annulla.
	let remoteForm: 'git' | 'drive' | null = null;
	let remoteInput = '';
	// Credenziale del solo SCOPE, chiesta qui perché questo è l'unico momento in
	// cui chi la fornisce sa a quale repository serve. Vuota = si usa quella
	// della piattaforma, e il pannello lo dice a chiare lettere: un ripiego
	// silenzioso costruisce la convinzione di un isolamento che non c'è.
	let remoteCred = '';
	function openRemoteForm(kind: 'git' | 'drive') {
		remoteForm = kind; remoteInput = ''; remoteCred = ''; remoteMountName = '';
	}
	function cancelRemoteForm() {
		remoteForm = null; remoteInput = ''; remoteCred = ''; remoteMountName = '';
	}
	// Il nome del mount lo sceglie chi lo collega: è la CARTELLA DI PRIMO LIVELLO
	// che comparirà nell'albero — `comms/` — e con due cartelle Drive «drive» e
	// «drive-2» non direbbero quale è quale. Vuoto = il backend usa il tipo.
	// Riservati `local`, `files`, `remote`: il backend li rifiuta.
	let remoteMountName = '';
	function submitRemoteForm() {
		const v = remoteInput.trim();
		const cred = remoteCred.trim();
		const mn = remoteMountName.trim();
		const payload = remoteForm === 'git'
			? { type: 'git', config: v ? { url: v } : {}, ...(cred ? { credential: cred } : {}) }
			: { type: 'drive', config: v ? { folder: v } : {} };
		remoteForm = null; remoteInput = ''; remoteCred = ''; remoteMountName = '';
		void doRemote('enable', { ...payload, ...(mn ? { mount: mn } : {}) });
	}
	// Rotazione: cambiare o togliere la credenziale senza ricollegare il remote.
	// Senza questa via, una credenziale per topic diventa una credenziale che
	// nessuno rinnova — è il costo ricorrente di questo disegno.
	let rotating = false;
	let rotateCred = '';
	let credErr = '';
	async function rotateCredential() {
		credErr = '';
		const grezzo = rotateCred.trim();
		let payload: unknown = grezzo;
		if (isDriveRemote && grezzo) {
			// Per Drive la credenziale è un consenso OAuth, non una stringa: si
			// incolla il bundle. Il JSON si valida QUI perché un errore di
			// battitura è un errore dell'utente, non del gateway, e mandarlo
			// giù tornerebbe come "credenziale incompleta" senza dire dove.
			try {
				payload = JSON.parse(grezzo);
			} catch {
				credErr = 'Non è JSON valido: incolla il bundle OAuth completo.';
				return;
			}
			const b = payload as Record<string, unknown>;
			const manca = ['refresh_token', 'client_id', 'client_secret'].filter((k) => !b[k]);
			if (manca.length) {
				credErr = `Mancano: ${manca.join(', ')}.`;
				return;
			}
		}
		await doRemote('set_credential',
			{ credential: payload, kind: isDriveRemote ? 'drive' : 'git' });
		rotateCred = ''; rotating = false;
	}
	// Timeline dei recap (TLDR storici): il recap sotto al titolo è cliccabile.
	let showRecap = false;

	// --- Regole dello scope (AGENTS.md) ------------------------------------
	// Il testo che entra nel contesto di OGNI agente della stanza a OGNI turno.
	// Fino al 6 ago 2026 stava in files/, dove qualunque partecipante poteva
	// caricarlo; ora vive nel control-plane e si scrive solo con un verbo gated.
	// `authoritative=false` significa che quel topic non è ancora migrato e il
	// testo è ancora quello vecchio: va detto, perché lo stesso testo vale due
	// cose diverse a seconda di chi poteva scriverlo.
	let showRules = false;
	let rules: TopicAgentsMd | null = null;
	let rulesDraft = '';
	let rulesBusy = false;
	let rulesErr = '';
	let rulesLoadedFor = '';
	/** Le regole di QUESTO topic sono state lette davvero.
	 *
	 *  Da tenere distinto da «la bozza è vuota»: una bozza vuota può voler dire
	 *  «non ci sono regole» oppure «non sono riuscito a leggerle», e nel secondo
	 *  caso salvare le rimuove. La differenza sta solo qui. */
	$: rulesLoaded = rulesLoadedFor === `${tier}/${name}`;

	async function loadRules() {
		const key = `${tier}/${name}`;
		try {
			rules = await getTopicAgentsMd(tier, name);
			rulesDraft = rules.text ?? '';
			rulesLoadedFor = key;
			rulesErr = '';
		} catch (e) {
			rulesErr = e instanceof Error ? e.message : String(e);
		}
	}

	async function openRules() {
		showRules = !showRules;
		if (showRules && rulesLoadedFor !== `${tier}/${name}`) await loadRules();
	}

	async function saveRules() {
		if (rulesBusy) return;
		rulesBusy = true;
		rulesErr = '';
		try {
			await saveTopicAgentsMd(tier, name, rulesDraft, rules?.version ?? null);
			await loadRules();
			toastSuccess('Regole dello scope aggiornate');
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			// 409 = qualcun altro ha scritto: si rilegge e si rifonde, non si
			// ritenta uguale. Dirlo qui evita che l'utente prema di nuovo Salva
			// e sovrascriva senza saperlo.
			rulesErr = /409|conflitto/i.test(msg)
				? 'Qualcun altro ha modificato le regole nel frattempo. Ricarica, rileggi le sue modifiche e riapplica le tue.'
				: msg;
		} finally {
			rulesBusy = false;
		}
	}
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
	// Motivo per cui i file non sono elencabili (storage remoto giù, es. token
	// Drive scaduto). Prima di questo il catch ingoiava tutto e il pannello
	// mostrava una cartella vuota: indistinguibile da un topic senza file.
	let filesError = '';
	async function loadFiles(silent = false) {
		if (!silent) filesLoading = true;
		try {
			const next = await getChannelFiles(tier, name, filePath);
			if (!sameFiles(next, files)) files = next;
			filesError = '';
		} catch (e) {
			// 424 = storage del topic non disponibile: il backend ha già formulato
			// un motivo azionabile, lo mostriamo così com'è. Gli altri errori non
			// devono cancellare la lista già caricata.
			const msg = e instanceof ApiError || e instanceof Error ? e.message : String(e);
			filesError = msg;
			if (e instanceof ApiError && e.status === 424) files = [];
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
	type Elig = { eligible: boolean; warn: boolean; context: import('$lib/api/client').AgentContext | null };
	let eligibility: Record<string, Elig> = {};
	async function loadEligibility(t: string, n: string) {
		try {
			const r = await getChannelEligibility(t, n);
			const m: Record<string, Elig> = {};
			for (const a of r.agents) m[a.name] = { eligible: a.eligible, warn: a.warn, context: a.context };
			eligibility = m;
		} catch {
			/* ignore: in assenza di dati non filtriamo nulla */
		}
	}
	// Colore del "termometro" di contesto: verde <50%, arancione <80%, rosso oltre.
	function ctxColor(pct: number): string {
		return pct < 0.5 ? '#4ade80' : pct < 0.8 ? '#f59e0b' : '#ef4444';
	}
	let tierWarning: TierWarning | null = null;
	let draft = '';
	let channelAliases: Record<string, string> = {};
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
		chosen_agents?: string[];
		reason: string;
		mode: string;
		threshold?: number;
		margin?: number;
		candidates?: RoutingCand[];
		eligible?: string[];
	};
	let lastRouting: RoutingTrace | null = null;
	let routingOpen = false;
	let routingCorrected: string | null = null;
	let routingConfirmed = false;
	$: chosenAgents = lastRouting
		? (lastRouting.chosen_agents?.length ? lastRouting.chosen_agents : [lastRouting.chosen])
		: [];
	$: multiRouting = chosenAgents.length > 1;
	// agenti selezionabili per la correzione: gli idonei del topic diversi dallo scelto
	$: correctOptions = lastRouting
		? (lastRouting.eligible?.length
				? lastRouting.eligible
				: (lastRouting.candidates ?? []).map((c) => c.name)
			).filter((n) => !chosenAgents.includes(n))
		: [];
	async function correctRoute(agent: string) {
		if (!lastRouting || multiRouting || !agent || routingCorrected || routingConfirmed) return;
		routingCorrected = agent; // ottimistico
		try {
			await recordRoutingFeedback(tier, name, {
				kind: 'correction',
				correct_agent: agent,
				chosen: lastRouting.chosen
			});
		} catch {
			routingCorrected = null; // ripristina su errore
		}
	}
	async function confirmRoute() {
		if (!lastRouting || multiRouting || routingCorrected || routingConfirmed) return;
		routingConfirmed = true; // ottimistico
		try {
			await recordRoutingFeedback(tier, name, {
				kind: 'confirm',
				chosen: lastRouting.chosen
			});
		} catch {
			routingConfirmed = false;
		}
	}
	const routingReason: Record<string, string> = {
		tagged: 'richiesto esplicitamente con @menzione',
		relevance: 'dominio più pertinente al messaggio (embedding)',
		'multi-match fallback': 'più specialisti pertinenti coinvolti in parallelo',
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
	// Un box per agente (issue#105): ragionamento e tool stanno nello stesso
	// riquadro e l'apertura è per-box, dentro AgentLiveBox. Prima `thinkOpen`
	// era una variabile sola condivisa: espandere un agente li apriva tutti.
	const chatBelongs = (cid: unknown) =>
		typeof cid === 'string' && cid.startsWith(`chan:${tier}:${name}:`);
	// chat_id → nome dello SPAWN (`clodia-124`), dall'evento `spawn_label` che il
	// backend pubblica una volta per turno. Serve perché il `chat_id` porta
	// l'ordinale di CANALE (`chan:…:seed#2`) o il seed nudo, cioè un numero
	// relativo e riusabile o nessun numero: durante il turno si leggeva un nome e
	// a turno finito un altro, per la stessa istanza. Il progressivo di spawn è
	// l'identità vera (per seed, mai riusata) e va mostrato sempre.
	let spawnByChat: Record<string, string> = {};
	function agentFromChatId(cid: unknown): string | null {
		if (!chatBelongs(cid)) return null;
		const noto = spawnByChat[String(cid)];
		// Fallback sulla coda del chat_id finché lo `spawn_label` non è arrivato
		// (sessione nata prima che la pagina fosse aperta): un'etichetta meno
		// precisa è meglio di nessun box live.
		return noto || String(cid).split(':').at(-1) || null;
	}
	function liveFor(agent: string): LiveAgentState {
		return liveAgents[agent] ?? { think: '', reply: '', tools: [] };
	}
	function updateLive(agent: string, patch: Partial<LiveAgentState>) {
		const replyWillGrow = typeof patch.reply === 'string' && patch.reply !== liveFor(agent).reply;
		const shouldFollow = replyWillGrow && isNearBottom;
		liveAgents = { ...liveAgents, [agent]: { ...liveFor(agent), ...patch } };
		if (replyWillGrow) {
			void tick().then(() => {
				// La crescita della bubble segue solo chi era già in fondo. Se
				// l'utente sta rileggendo, non spostare la viewport sotto i suoi occhi.
				if (shouldFollow && isNearBottom) {
					scrollDown();
				} else if (!isNearBottom) {
					showNewMessages = true;
				}
			});
		}
	}
	// Sequenza dei tool del turno (issue#105): prima ogni chiamata SOSTITUIVA la
	// precedente, quindi il box mostrava solo l'ultimo step e il lavoro già fatto
	// spariva. Ora si accodano, con un tetto per non far crescere il DOM sui turni
	// lunghi; il duplicato consecutivo (stesso tool, stesso summary) non si ripete.
	const MAX_STEPS = 25;
	function pushStep(agent: string, step: string): string[] {
		const prev = liveFor(agent).tools;
		if (prev[prev.length - 1] === step) return prev;
		return [...prev, step].slice(-MAX_STEPS);
	}
	/** Autori-agente dei messaggi arrivati DOPO `sinceId` (compresi i non-ultimi).
	 *
	 *  `sinceId` assente (primo carico) → nessuno: al mount non c'è live da
	 *  chiudere, e trattare tutta la storia come "nuova" azzererebbe il live di un
	 *  turno in corso appena si riapre il topic — che è precisamente il caso per
	 *  cui `active_responders` esiste.
	 */
	function newAiAuthors(items: ChannelMessage[], sinceId?: string | null): string[] {
		if (!sinceId) return [];
		const at = items.findIndex((m) => m.id === sinceId);
		const fresh = at >= 0 ? items.slice(at + 1) : items;
		return Array.from(new Set(fresh.filter((m) => m.kind === 'ai').map((m) => m.author)));
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
	/** Azzera SOLO il testo in streaming, lasciando ragionamento e tool.
	 *
	 *  È ciò che serve quando una bolla si è appena PERSISTITA (clodia-platform#243):
	 *  il blocco di testo è diventato un messaggio vero, quindi la copia
	 *  provvisoria va via — ma il turno continua, e cancellare anche `think`/
	 *  `tools` spegnerebbe il box del ragionamento di un agente ancora al lavoro.
	 *
	 *  La fine del turno la dichiara `active_responders` (la cintura in
	 *  `refreshInfo`), che è la sola cosa che la sappia davvero: l'arrivo di un
	 *  messaggio NON è fine del turno, ed è esattamente l'equivoco che faceva
	 *  sparire le risposte parziali sotto gli occhi di chi leggeva.
	 */
	function resetLiveReply(agent: string) {
		const cur = liveAgents[agent];
		if (!cur || !cur.reply) return;
		liveAgents = { ...liveAgents, [agent]: { ...cur, reply: '' } };
	}
	$: liveEntries = Object.entries(liveAgents).filter(([, l]) => l.think || l.reply || l.tools.length);
	$: liveReplies = liveEntries.filter(([, l]) => l.reply);
	$: hasLive = liveEntries.length > 0;
	function visibleMessages(items: ChannelMessage[]): ChannelMessage[] {
		const resetIdx = items.findLastIndex((m) => m.kind === 'system' && m.text === '__CLODIA_CONTEXT_RESET__');
		const current = resetIdx >= 0 ? items.slice(resetIdx + 1) : items;
		return current.filter(
			(m) => !(m.kind === 'system' && m.text === '__CLODIA_CONTEXT_RESET__')
		);
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

	let copiedMessageId = '';
	let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
	async function copyMessageMarkdown(m: ChannelMessage) {
		try {
			await navigator.clipboard.writeText(m.text);
		} catch {
			// Fallback per browser/contesti che non espongono Clipboard API.
			const area = document.createElement('textarea');
			area.value = m.text;
			area.style.position = 'fixed';
			area.style.opacity = '0';
			document.body.appendChild(area);
			area.select();
			document.execCommand('copy');
			area.remove();
		}
		copiedMessageId = m.id;
		if (copyResetTimer) clearTimeout(copyResetTimer);
		copyResetTimer = setTimeout(() => {
			if (copiedMessageId === m.id) copiedMessageId = '';
			copyResetTimer = null;
		}, 1600);
	}

	async function rateMessage(m: ChannelMessage, rating: 'thumbs_up' | 'thumbs_down') {
		if (feedbackBusy) return;
		const question = rating === 'thumbs_up'
			? 'Cosa è stato utile in questa risposta?'
			: 'Cosa non ha funzionato in questa risposta?';
		const answer = window.prompt(
			`${question}\n\nDal tuo commento l’agente ricava una lezione astratta (un metodo da ripetere o evitare), depurata dai dati, riusata nei topic futuri. Il testo grezzo è conservato per audit: evita comunque dati riservati.`,
			''
		);
		if (answer === null) return;
		const comment = answer.trim();
		if (!comment) {
			loadErr = 'Inserisci un commento per registrare il feedback.';
			return;
		}
		feedbackBusy = m.id;
		try {
			await sendMessageFeedback(tier, name, m.id, rating, comment);
			feedbackByMessage = { ...feedbackByMessage, [m.id]: rating };
			if (isOwner) {
				feedbackLessons = await getFeedbackLessons(tier, name);
			}
		} catch (e) {
			loadErr = e instanceof Error ? e.message : String(e);
		} finally {
			feedbackBusy = '';
		}
	}

	async function loadFeedbackLessons() {
		try {
			feedbackLessons = await getFeedbackLessons(tier, name);
		} catch {
			feedbackLessons = [];
		}
	}

	async function removeFeedbackLesson(id: string) {
		try {
			await deleteFeedbackLesson(tier, name, id);
			feedbackLessons = feedbackLessons.filter((l) => l.id !== id);
		} catch (e) {
			loadErr = e instanceof Error ? e.message : String(e);
		}
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
	// Marker ROUTER: il backend ha trovato più agenti entro il margine e chiede
	// all'umano chi deve prendere il turno. Il click NON invia una chat normale:
	// risolve il routing e salva l'esempio supervisionato.
	const _ROUTE_RE = /<!--\s*routing-choices\s*=(.*?)-->/i;
	// Companion marker emitted next to the choices one: it binds the dialog to the
	// turn it is about (owner + source message id). The UI never reads it — the
	// backend does, when resolving the choice — but it MUST be stripped before
	// rendering, exactly like the others.
	const _ROUTEREQ_RE = /<!--\s*routing-request\s*=.*?-->/i;
	function msgRoutingChoices(text: string): string[] | null {
		const m = (text || '').match(_ROUTE_RE);
		if (!m) return null;
		const items = m[1].split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
		return items.length ? Array.from(new Set(items)) : null;
	}
	let routingChoiceBusy = false;
	let routingChoiceDone: Record<string, string> = {};
	async function chooseRoute(agent: string, m: ChannelMessage) {
		if (routingChoiceBusy) return;
		routingChoiceBusy = true;
		try {
			const res = await resolveRoutingChoice(tier, name, agent);
			routingChoiceDone = { ...routingChoiceDone, [m.id]: res.responder ?? agent };
			await refreshMessages();
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			routingChoiceBusy = false;
		}
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
	// Marker GATE (M-gate): un verbo gated innescato da un agente in questo canale →
	//   <!-- gate=agent|instance|verb -->
	// card Approva/Nega INLINE nella conversazione (come job-proposal), al posto
	// del popup staccato. L'id codifica agent|instance|verb per approve/deny.
	const _GATE_RE = /<!--\s*gate\s*=\s*([^>]+?)\s*-->/i;
	function msgGate(text: string): { id: string; agent: string; instance: string; verb: string } | null {
		const m = (text || '').match(_GATE_RE);
		if (!m) return null;
		const id = m[1].trim();
		const parts = id.split('|');
		if (parts.length < 3) return null;
		return { id, agent: parts[0], instance: parts[1], verb: parts.slice(2).join('|') };
	}
	// COSA attraversa il gate e CHI ha titolo a decidere: dal backend, dove la
	// regola vive una volta sola. Il marker nel messaggio porta solo
	// agent|instance|verb — non la classe — e senza questi campi la card inline
	// dovrebbe indovinare, cioè riscrivere la regola. Lo faceva già: dava per
	// scontato che decidesse l'owner, che è falso per i gate di SISTEMA sollevati
	// dentro una stanza, dove decide un admin. A un owner non-admin la card
	// offriva un bottone che il backend poi rifiuta.
	type GateInfo = { crosses?: string; decided_by?: string; decider_name?: string;
	                  scope?: string; asker_role?: string; asker_note?: string };
	let gateInfo: Record<string, GateInfo> = {};
	/** Gate ancora APERTI. Serve a distinguere «da decidere» da «già deciso»:
	 *  senza, dopo un ricarico un gate risolto tornava a mostrare i bottoni,
	 *  perché la memoria della decisione vive solo in questa pagina. Offrire di
	 *  decidere una cosa già decisa è peggio che non offrirlo: si preme, il
	 *  backend rifiuta, e sembra rotto ciò che ha funzionato. */
	let gateAperti = new Set<string>();
	let gateInfoCaricato = false;
	async function refreshGateInfo() {
		try {
			const r = await apiGet<{ requests: Array<GateInfo & { agent: string; instance: string; verb: string }> }>(
				'/api/gate/pending');
			const m: Record<string, GateInfo> = {};
			const aperti = new Set<string>();
			for (const q of r?.requests ?? []) {
				const k = `${q.agent}|${q.instance || '-'}|${q.verb}`;
				aperti.add(k);
				m[k] = { crosses: q.crosses, decided_by: q.decided_by,
				         decider_name: q.decider_name, scope: q.scope,
				         asker_role: q.asker_role, asker_note: q.asker_note };
			}
			gateInfo = m;
			gateAperti = aperti;
			gateInfoCaricato = true;
		} catch {
			// La card resta senza spiegazione, non sparisce — e soprattutto NON
			// si conclude che i gate siano chiusi: una lista che non è arrivata
			// non è una lista vuota.
		}
	}
	/** Vero se l'utente può decidere QUESTO gate. In dubbio (nessuna
	 *  informazione dal backend) si ricade sull'owner: è la regola per la grande
	 *  maggioranza dei gate di canale, e mostrare il bottone a chi non ha titolo
	 *  costa un rifiuto leggibile — nasconderlo a chi ce l'ha costa un blocco
	 *  senza spiegazione. */
	function canDecideGate(id: string): boolean {
		const info = gateInfo[id];
		if (!info?.decided_by) return isOwner;
		return info.decided_by.startsWith('owner:') ? isOwner : $isAdmin;
	}
	/** Un gate su una DESTINAZIONE (egress/ingress) si può ricordare; uno su
	 *  un'azione no. «Approva sempre l'invio di mail» non è una decisione che un
	 *  umano possa prendere guardando un dialog: non sa a chi. «Approva sempre
	 *  questo indirizzo» sì — ed è precisamente la differenza fra un gate che
	 *  informa e uno che si spegne per riflesso. */
	function isDestinationGate(verb: string): boolean {
		return /^(egress|ingress):/.test(verb || '');
	}
	let gateDeciding = false;
	let gateDecided: Record<string, string> = {};
	async function decideGate(
		g: { id: string; agent: string; instance: string; verb: string },
		approve: boolean,
		remember: 'once' | 'topic' | 'global' = 'once'
	) {
		if (gateDeciding) return;
		gateDeciding = true;
		try {
			const r = await apiPost<{ memory?: { remembered?: boolean; error?: string } }>(
				approve ? '/api/gate/approve' : '/api/gate/deny',
				{ agent: g.agent, instance: g.instance, verb: g.verb, remember });
			// Se il ricordo non è riuscito, l'approvazione resta valida ma vale
			// solo per stavolta: dirlo, altrimenti la stessa domanda torna domani
			// e sembra che il gate sia rotto.
			const mem = r?.memory;
			gateDecided = {
				...gateDecided,
				[g.id]: !approve ? 'negato'
					: remember === 'once' ? 'approvato'
					: mem && mem.remembered === false ? 'approvato (solo per stavolta)'
					: remember === 'topic' ? 'approvato e ricordato qui'
					: 'approvato ovunque'
			};
			if (mem && mem.remembered === false && mem.error) loadErr = mem.error;
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			gateDeciding = false;
		}
	}
	// Every widget marker must be listed here. `renderMarkdown` ESCAPES `<`, `>`
	// and `&` before setting innerHTML, so an HTML comment left in the text is not
	// invisible the way it would be in a browser-parsed document: it is printed
	// verbatim. A marker that drives a widget but is missing from this list shows
	// up twice — once as the widget, once as raw markup underneath it, which is
	// how the two routing markers were found.
	function stripChoices(text: string): string {
		return (text || '')
			.replace(_CH_RE, '')
			.replace(_INV_RE, '')
			.replace(_JOB_RE, '')
			.replace(_GATE_RE, '')
			.replace(_ROUTE_RE, '')
			.replace(_ROUTEREQ_RE, '')
			.trim();
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
		// La lente: finestra di anteprima, non navigazione. Lasciarla navigare
		// porterebbe fuori dalla conversazione che si stava leggendo, che è
		// esattamente il costo che questa affordance esiste per togliere.
		const pv = a.href.match(/\/preview\/[^/]+\/[^/]+\?path=([^&]+)/);
		if (pv) {
			e.preventDefault();
			openArtifact(decodeURIComponent(pv[1]));
			return;
		}
		const m = a.href.match(/\/topics\/[^/]+\/[^/]+\/download\?path=([^&]+)/);
		if (!m) return;
		e.preventDefault();
		void openSignedFile(decodeURIComponent(m[1]));
	}
	// Le radici che un path può avere in questo scope. `local` c'è sempre; ogni
	// mount è una cartella di primo livello col suo nome (`comms/`). `files` e
	// `dump` restano perché compaiono nei messaggi già inviati: un link che
	// smette di funzionare per un cambio di schema è una regressione per chi
	// rilegge una conversazione di ieri.
	$: fileRoots = Array.from(new Set([
		'local', 'files', 'dump',
		...topicMounts.filter((m) => m.type === 'drive')
			.map((m) => String(m.name || '').trim()).filter(Boolean)
	])).filter((r) => /^[\w.-]+$/.test(r));
	// I formati che la finestra di anteprima sa rendere. Gli altri restano
	// scaricabili: offrire una lente che apre una pagina illeggibile è peggio
	// che non offrirla.
	const PREVIEWABLE = /\.(md|markdown|mdown|mkd|html?|png|jpe?g)$/i;
	function linkifyFiles(text: string): string {
		const radici = fileRoots.join('|');
		const PATH = new RegExp(
			`(?<!\\]\\()(?<!\\[)(?<![\\w/])((?:${radici})\\/[\\w.\\-/]+\\.[A-Za-z0-9]{1,8})`, 'g');
		// Il link al file, più la lente quando c'è qualcosa da guardare. La lente è
		// un secondo link: `handleStreamClick` lo riconosce dal path `/preview/` e
		// apre la finestra invece di navigarci dentro.
		const repl = (_m: string, p: string) => {
			const dl = `[${p}](${channelFileUrl(tier, name, p)})`;
			if (!PREVIEWABLE.test(p)) return dl;
			const pv = `/preview/${encodeURIComponent(tier)}/${encodeURIComponent(name)}?path=${encodeURIComponent(p)}`;
			return `${dl} [🔎](${pv})`;
		};
		// 1) code span che contengono SOLO un path → diventano link (tolgo i backtick:
		//    gli LLM citano i path tra `…`, ma l'utente vuole il link cliccabile).
		let s = (text || '').replace(
			new RegExp(`\`((?:${radici})\\/[\\w.\\-/]+\\.[A-Za-z0-9]{1,8})\``, 'g'), repl);
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
	const topicStatusOptions = TOPIC_STATUSES;
	let metaBusy = false;
	let metaDeadlineDraft = '';
	$: metaStatus = normalizeTopicStatus(info?.meta?.status);
	$: if (info) metaDeadlineDraft = info.meta?.deadline ?? '';

	$: metaPortable = !!info?.meta?.portable;
	async function saveTopicPortable(next: boolean) {
		if (!isOwner || metaBusy || next === metaPortable) return;
		metaBusy = true;
		try {
			const r = await setTopicPortable(tier, name, next);
			if (info) info = { ...info, meta: { ...info.meta, portable: r.portable } };
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			metaBusy = false;
		}
	}

	// ── Gruppo Telegram collegato allo scope ────────────────────────────────
	// È un MOUNT come gli altri: sta in `meta.mounts` con `type: "telegram"`.
	// Non compare nell'albero dei file perché la vista monta solo i tipi che
	// sono davvero un filesystem — la stessa ragione per cui non c'è un mount
	// `git` fra le cartelle.
	$: tgMount = topicMounts.find((m) => m.type === 'telegram') ?? null;
	let tgOpen = false;
	let tgChatId = '';
	let tgMode: 'notify' | 'excerpt' = 'excerpt';
	/** Righe della mappa uid→utente. Una lista e non un oggetto: l'owner la
	 *  compila una riga per volta, e un oggetto costringerebbe a inventare una
	 *  chiave prima di avere il valore. */
	/** Righe della mappa. L'HANDLE è la colonna che conta: è quella che finisce
	 *  nel messaggio, ed è l'unica che una persona conosce di sé — l'uid
	 *  Telegram non lo espone a nessuno se non a un bot. L'uid resta come campo
	 *  facoltativo perché è l'identificatore stabile: un username si cambia. */
	let tgPeople: Array<{ handle: string; uid: string; principal: string }> = [];
	let tgErr = '';

	function openTelegramForm() {
		const c = tgMount?.config ?? {};
		tgChatId = String(c.chat_id ?? '');
		tgMode = (c.mode as 'notify' | 'excerpt') ?? 'excerpt';
		// La forma sul disco è duplice: `{chiave: "principal"}` (com'era, e come
		// l'ha compilata l'owner) oppure `{chiave: {principal, username}}`. Si
		// leggono entrambe, perché i mount già collegati hanno la prima.
		tgPeople = Object.entries(c.people ?? {}).map(([chiave, v]) => {
			const o = (typeof v === 'object' && v) ? (v as Record<string, string>) : null;
			return {
				handle: String(o?.username ?? (/^-?\d+$/.test(chiave) ? '' : chiave)).replace(/^@/, ''),
				uid: /^-?\d+$/.test(chiave) ? chiave : '',
				principal: String(o?.principal ?? v ?? '')
			};
		});
		if (!tgPeople.length) tgPeople = [{ handle: '', uid: '', principal: '' }];
		tgErr = '';
		tgOpen = true;
	}
	async function saveTelegram() {
		tgErr = '';
		const people: Record<string, { principal: string; username?: string }> = {};
		for (const r of tgPeople) {
			const h = r.handle.trim().replace(/^@/, '');
			const u = r.uid.trim();
			const n = r.principal.trim().toLowerCase();
			if (!n || (!h && !u)) continue;
			// La chiave è l'uid quando c'è — è stabile — altrimenti l'handle.
			people[u || h] = h ? { principal: n, username: h } : { principal: n };
		}
		if (!tgChatId.trim()) { tgErr = "Serve l'id del gruppo."; return; }
		if (!Object.keys(people).length) {
			// Lo dice anche il gateway, ma dirlo qui evita un giro: un
			// collegamento senza nessuno mappato non avviserebbe nessuno.
			tgErr = 'Mappa almeno una persona: senza, nessuno verrebbe avvisato.';
			return;
		}
		metaBusy = true;
		try {
			await setTopicTelegram(tier, name, { chat_id: tgChatId.trim(), mode: tgMode, people });
			await refreshInfo();
			tgOpen = false;
		} catch (e) {
			tgErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			metaBusy = false;
		}
	}
	async function unbindTelegram() {
		if (!confirm(`Scollegare il gruppo Telegram da «${info?.meta?.title ?? name}»? Le menzioni non verranno più riportate.`)) return;
		metaBusy = true;
		try {
			await setTopicTelegram(tier, name, { action: 'unbind', mount: tgMount?.name });
			await refreshInfo();
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			metaBusy = false;
		}
	}

	// ── Presenza degli umani in questa stanza ───────────────────────────────
	//
	// Quattro stati, perché le domande sono due e diverse: «mi sta leggendo
	// adesso?» e «è raggiungibile?». Un pallino solo le fonderebbe, e chi guarda
	// dedurrebbe la risposta sbagliata a una delle due — il caso peggiore è
	// scrivere a qualcuno credendolo davanti allo schermo perché è «online».
	//
	// Arriva col polling dei messaggi, non da una rotta propria: cambia con la
	// stessa cadenza, e una seconda chiamata ogni cinque secondi sarebbe il
	// doppio del traffico per un dato che viaggia già.
	let presenza: Record<string, PresenceState> = {};
	const PRESENZA_TITOLO: Record<PresenceState, string> = {
		here: 'sta guardando questa conversazione',
		elsewhere: 'è nella webui, in un altro canale',
		background: 'ha la webui aperta ma sta guardando altro',
		away: 'non è collegato'
	};

	// ── Immagine del topic ──────────────────────────────────────────────────
	// La vede chi partecipa, la cambia solo l'owner. Non è una decorazione: in
	// una lista di venti stanze l'immagine è ciò che si guarda per primo, quindi
	// cambiarla è un modo di far sembrare una stanza un'altra.
	let logoBusy = false;
	let logoErr = '';
	/** Cambia a ogni salvataggio per bucare la cache del browser: senza, dopo un
	 *  caricamento resterebbe visibile la vecchia immagine e sembrerebbe che il
	 *  salvataggio non abbia funzionato. */
	let logoRev = 0;
	/** Come per il segno: si SCARICA con l'autenticazione e si consegna un blob.
	 *  Un `<img src>` verso l'endpoint prenderebbe 401 e resterebbe rotto senza
	 *  dire niente — la sezione direbbe «impostata» mostrando il vuoto. */
	let topicLogoUrl = '';
	$: if (info?.meta?.logo) {
		const r = logoRev;
		logoObjectUrl(tier, name, r).then((u) => {
			if (r === logoRev) topicLogoUrl = u ?? '';
		});
	} else {
		topicLogoUrl = '';
	}

	async function caricaLogo(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) return;
		logoErr = '';
		logoBusy = true;
		try {
			const buf = new Uint8Array(await f.arrayBuffer());
			let bin = '';
			for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
			await setTopicLogo(tier, name, btoa(bin));
			// Prima si butta via la copia in cache, poi si cambia `rev`: senza,
			// resterebbe visibile l'immagine sostituita e sembrerebbe che il
			// salvataggio non abbia funzionato.
			dimenticaLogo(tier, name);
			logoRev++;
			await refreshInfo();
		} catch (err) {
			logoErr = err instanceof ApiError || err instanceof Error ? err.message : String(err);
		} finally {
			logoBusy = false;
			(e.target as HTMLInputElement).value = '';
		}
	}
	async function togliLogo() {
		logoBusy = true;
		logoErr = '';
		try {
			await clearTopicLogo(tier, name);
			dimenticaLogo(tier, name);
			logoRev++;
			await refreshInfo();
		} catch (err) {
			logoErr = err instanceof ApiError || err instanceof Error ? err.message : String(err);
		} finally {
			logoBusy = false;
		}
	}

	// ── Proxy ammessi in questa stanza ──────────────────────────────────────
	// Un proxy è un sistema terzo con un posto qui: parla e legge il canale,
	// nient'altro. Ammetterlo manda la conversazione a qualcuno fuori — è un atto
	// sulle mura, come montare una cartella Drive — quindi lo fa l'owner e il tier
	// governa.
	//
	// Qui non si consegna un segreto: il proxy ha la propria chiave e ottiene
	// token brevi firmando. Fino a #242 lo stesso modulo emetteva anche il
	// frammento di configurazione per il client MCP di una PERSONA: quella metà è
	// sparita, e con lei la credenziale da incollare a mano.
	let mcpGrants: McpClientGrant[] = [];
	let mcpOpen = false;
	let mcpPrincipal = '';
	let mcpProvider = '';
	let mcpTtl = 30;
	let mcpConsent = false;
	let mcpErr = '';
	/** Il contratto appena coniato: dove chiedere il token, cosa firmare, dove
	 *  parlare. Non è un segreto — non contiene nulla che valga da solo — ma vive
	 *  comunque solo qui in memoria: serve una volta, a chi configura il proxy. */
	let mcpFresh: { id: string; contract: string; expires: number;
	                verbs: string[] } | null = null;
	$: mcpTierAlto = ['SEAL-2', 'SEAL-3', 'SEAL-4'].includes(String(info?.meta?.tier ?? tier));

	async function loadMcpClients() {
		if (!isOwner) return;
		try {
			mcpGrants = (await listTopicMcpClients(tier, name)).grants ?? [];
		} catch {
			mcpGrants = [];
		}
	}
	function openMcpForm() {
		// Nessun default sul principal: il proxy lo scegli tra i partecipanti, e
		// non è mai «io» — chi apre il pannello è una persona.
		mcpPrincipal = proxyCandidates.length === 1 ? proxyCandidates[0] : '';
		mcpProvider = '';
		mcpTtl = 30;
		mcpConsent = false;
		mcpErr = '';
		mcpFresh = null;
		mcpOpen = true;
		loadMcpClients();
	}
	async function issueMcp() {
		mcpErr = '';
		if (!mcpPrincipal.trim()) { mcpErr = 'Quale proxy?'; return; }
		metaBusy = true;
		try {
			const r = await issueTopicMcpClient(tier, name, {
				principal: mcpPrincipal.trim().toLowerCase(),
				provider: mcpProvider.trim(),
				ttl_days: mcpTtl,
				tier_consent: mcpConsent,
				base_url: window.location.origin
			});
			// I verbi EFFETTIVI del grant appena coniato: non quelli che il pannello
			// suppone, quelli che il gateway ha scritto dentro. Un proxy ne porta
			// quattro — parla e legge il canale — e chi lo configura deve poterlo
			// leggere senza decodificare niente.
			//
			// `instructions` è il contratto; `config` resta come ripiego per un
			// gateway che non lo mandasse, e mostrare un pannello vuoto sarebbe
			// peggio che mostrare quello che ha risposto.
			mcpFresh = { id: r.id,
			             contract: JSON.stringify(r.instructions ?? r.config ?? {}, null, 2),
			             expires: r.expires ?? 0, verbs: r.verbs ?? [] };
			await loadMcpClients();
		} catch (e) {
			mcpErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			metaBusy = false;
		}
	}
	async function revokeMcp(g: McpClientGrant) {
		if (!confirm(`Revocare il grant di ${g.principal}? Smette di funzionare subito.`)) return;
		metaBusy = true;
		try {
			await issueTopicMcpClient(tier, name, { action: 'revoke', id: g.id });
			await loadMcpClients();
		} catch (e) {
			mcpErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			metaBusy = false;
		}
	}
	function giorniAllaScadenza(ts: number): string {
		const g = Math.ceil((ts * 1000 - Date.now()) / 86400000);
		return g <= 0 ? 'scaduto' : `${g} giorn${g === 1 ? 'o' : 'i'}`;
	}

	function normalizeTopicStatus(status?: string | null): string {
		const raw = String(status ?? 'active').trim().toLowerCase().replace(/[\s-]+/g, '_');
		if (!raw || raw === 'attivo' || raw === 'idle' || raw === 'urgent') return 'active';
		if (raw === 'await' || raw === 'waiting' || raw === 'awaiting' || raw === 'pending' || raw === 'in_attesa') return 'on-hold';
		if (raw === 'done' || raw === 'completed' || raw === 'completato') return 'done';
		if (raw === 'archived' || raw === 'archiviato') return 'archived';
		return raw.replace(/_/g, '-');
	}

	async function saveTopicStatus(status: string) {
		if (!isOwner || metaBusy || status === metaStatus) return;
		metaBusy = true;
		try {
			const r = await setTopicStatus(tier, name, status);
			if (info) info = { ...info, meta: { ...info.meta, status: r.status } };
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			metaBusy = false;
		}
	}

	async function saveTopicDeadline(deadline = metaDeadlineDraft) {
		if (!isOwner || metaBusy) return;
		const next = deadline.trim() || null;
		if (next === (info?.meta?.deadline ?? null)) return;
		metaBusy = true;
		try {
			const r = await setTopicDeadline(tier, name, next);
			if (info) info = { ...info, meta: { ...info.meta, deadline: r.deadline } };
			metaDeadlineDraft = r.deadline ?? '';
		} catch (e) {
			loadErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			metaBusy = false;
		}
	}

	$: if (isOwner && tier && name && feedbackLessonsKey !== `${tier}/${name}`) {
		feedbackLessonsKey = `${tier}/${name}`;
		void loadFeedbackLessons();
	}
	// Seed multi-spawn (issue#94): la CHIAVE presente = il seed materializza N
	// istanze; `max` è il cap dichiarato (`max_spawns`) per il tooltip "fino a
	// quante" (issue#210). Voce-oggetto e non booleano perché il valore va letto
	// anche quando è 0/assente, e un `null` in un `{#if}` sparirebbe.
	let multiSpawn: Record<string, { max: number | null }> = {};
	// I partecipanti sono una MAPPA nome→ruolo dal 7 ago 2026, ma un topic che
	// nessuno ha ancora toccato conserva la lista: si converte alla prima
	// modifica, quindi la UI deve saper leggere entrambe le forme.
	$: participantsRaw = info?.meta?.participants ?? [];
	$: participants = Array.isArray(participantsRaw)
		? participantsRaw
		: Object.keys(participantsRaw ?? {});
	$: roleOf = (p: string): string =>
		p === info?.meta?.owner
			? 'owner'
			: Array.isArray(participantsRaw)
				? 'contributor'
				: ((participantsRaw as Record<string, string>)?.[p] || 'contributor');
	let roleBusy = '';
	async function setRole(p: string, role: 'contributor' | 'reader') {
		if (roleBusy) return;
		roleBusy = p;
		try {
			await setChannelParticipant(tier, name, p, true, role);
			await refreshInfo();
			toastSuccess(`${p}: ${role}`);
		} catch (e) {
			toastError('Ruolo non cambiato', e instanceof Error ? e.message : String(e));
		} finally {
			roleBusy = '';
		}
	}
	// Partecipanti mostrati: nascondi i non idonei al tier (eligible=false). I super
	// sotto tier restano (eligible=true) e li marchiamo con ⚠️ via eligibility[p].warn.
	$: shownParticipants = participants.filter((p) => eligibility[p]?.eligible ?? true);
	// «Reset trifecta»: l'owner dichiara di rispondere lui del punteggio di questo
	// canale. Si ricarica dal server invece di aggiustare `info` a mano — il
	// punteggio lo calcola lui, e una copia locale divergerebbe al primo dettaglio
	// (la firma, il decadimento per cambio composizione).
	async function doResetTrifecta() {
		if (!tier || !name) return;
		try {
			await resetChannelTrifecta(tier, name);
			await loadAll(tier, name);
		} catch (e) {
			loadErr = `Reset trifecta non riuscito: ${(e as Error).message}`;
		}
	}
	// Istanze vive per partecipante (A13): un seed multi-spawn è un super-nodo e
	// ogni istanza ha la sua riga. Mostriamo le righe SOLO quando c'è davvero da
	// distinguere — con una sola istanza senza ordinale il seed basta, e una riga
	// in più direbbe soltanto quello che il nome già dice.
	$: instancesOf = (p: string) => {
		const righe = info?.participant_instances?.[p] ?? [];
		return righe.length && righe.some((r) => r.ordinal !== null) ? righe : [];
	};

	// Niente indicatore trifecta accanto ai partecipanti — di proposito.
	//
	// Prima c'era un «2/3», poi le tre scimmiette delle capacità. Entrambi
	// mettevano il soggetto sbagliato accanto al nome: da quando il punteggio
	// conta i bit accesi, la misura è del CANALE. La contaminazione è un evento
	// della stanza, l'uscita arbitraria dipende da una whitelist globale — e
	// nessuna delle due diventa una proprietà di chi è in elenco. Un simbolo per
	// agente invitava a leggere «questo agente è pericoloso» dove il fatto è
	// «questa stanza, ora, combina queste cose».
	//
	// Chi porta cosa resta leggibile dove ha senso: la pagina dell'agente elenca
	// i suoi verbi, che sono la fonte di quella capacità.
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
		_idleLastPoll = []; // la cintura non deve ereditare le assenze di un altro canale
		resetLive(); // blocchi live (thinking/tools/reply) del canale precedente
		replyingTo = null; // niente reply-quote trascinata da un altro canale
		filePath = ''; // riparti dalla radice dei file
		_ackedTs = ''; // l'ack delle mention è per-topic
		try {
			let _mp: { messages: typeof messages; presence: typeof presenza };
			[info, _mp, files] = await Promise.all([
				getChannel(t, n),
				getChannelMessagesAndPresence(t, n),
				getChannelFiles(t, n)
			]);
			messages = _mp.messages;
			presenza = _mp.presence;
			_lastMsgId = messages[messages.length - 1]?.id ?? '';
			// turno in corso al caricamento (re-mount a metà turno) → mostra l'indicatore
			workingResponders = info?.active_responders ?? [];
			// Prima si renderizza lo stream (initialLoading=false), POI si scrolla:
			// altrimenti scrollDown gira mentre lo stream è dietro {#if initialLoading}
			// (elemento inesistente) → la chat resta sul messaggio più vecchio.
			initialLoading = false;
			await tick();
			scrollDown();
			_ackTail();
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
	// Agenti visti NON al lavoro nel giro di poll precedente: serve alla cintura
	// di sicurezza sotto, che pretende due assenze consecutive.
	let _idleLastPoll: string[] = [];

	async function refreshInfo() {
		try {
			info = await getChannel(tier, name);
			// tiene vivo l'indicatore "sta lavorando" durante turni lunghi/silenziosi
			// (es. tool-call senza chunk SSE) e lo spegne quando il turno finisce.
			workingResponders = info?.active_responders ?? [];
			// CINTURA: una bolla live significa «turno in corso». Se un turno muore
			// senza postare nulla (errore, interruzione, watchdog), il messaggio
			// finale non arriva mai e la bolla — con il testo a metà — resterebbe
			// sullo schermo per sempre, indistinguibile da un agente appeso.
			//
			// `active_responders` è la verità sul turno (legge il task vivo lato
			// server). Si richiedono DUE assenze consecutive perché fra l'arrivo di un
			// chunk SSE e il poll successivo un turno appena nato può non essere
			// ancora in lista, e azzerare lì cancellerebbe una bolla legittima.
			const live = Object.keys(liveAgents);
			const idleNow = live.filter((a) => !workingResponders.includes(a));
			for (const a of idleNow) if (_idleLastPoll.includes(a)) resetLive(a);
			_idleLastPoll = idleNow;
			void loadEligibility(tier, name); // i provider possono cambiare stato
		} catch {
			/* ignore */
		}
	}
	async function refreshLive() {
		await Promise.all([
			refreshMessages(),
			loadFiles(true),
			refreshInfo(),
			refreshGateInfo(),
			isOwner ? loadFeedbackLessons() : Promise.resolve()
		]);
	}

	let _lastMsgId = '';
	async function refreshMessages() {
		try {
			const wasNearBottom = isNearBottom;
			const previousLastId = _lastMsgId;
			({ messages, presence: presenza } = await getChannelMessagesAndPresence(tier, name));
			// smetti di mostrare "scrivendo" ogni agente che ha appena postato — non
			// solo l'ultimo: con più agenti attivi, il penultimo restava "scrivendo"
			// fino allo scadere del timeout di 90s.
			const last = messages[messages.length - 1];
			for (const a of newAiAuthors(messages, previousLastId)) setTyping(a, false);
			if (last?.kind === 'ai') setTyping(last.author, false);
			// nuovo ultimo messaggio → azzera la selezione multipla delle pills
			if (last && last.id !== _lastMsgId) {
				_lastMsgId = last.id;
				multiSel = new Set();
			}
			// Una bolla si è persistita: la copia provvisoria va via, il turno NO.
			//
			// Qui c'era `resetLive(a)`, che cancellava tutto il live — testo,
			// ragionamento, barra dei tool — leggendo «è arrivato un messaggio di
			// quell'autore» come «il turno è finito». Con un turno che pubblica più
			// volte (bolle per blocco, o post via tool) quella lettura è FALSA, e
			// produceva il difetto segnalato da Davide il 18 ago: la risposta
			// parziale compariva, l'agente continuava a lavorare, e il testo
			// spariva da sotto gli occhi di chi stava leggendo.
			//
			// Ora si azzera solo `reply`, cioè la sola parte che il messaggio
			// appena arrivato ha reso permanente: la bolla provvisoria è sostituita
			// in posto da quella vera, con lo stesso testo, e il box del
			// ragionamento resta acceso finché l'agente lavora.
			//
			// Si guardano TUTTI i nuovi messaggi, non solo l'ultimo: in un canale
			// con catene di delega, che dopo A posti B è il caso normale, e con la
			// sola condizione sull'ultimo il live di A non veniva mai ripulito.
			//
			// La fine del turno resta a `active_responders` (cintura in
			// `refreshInfo`), unica fonte che la conosca.
			for (const a of newAiAuthors(messages, previousLastId)) resetLiveReply(a);
			if (last && previousLastId && last.id !== previousLastId) {
				await tick();
				if (wasNearBottom) {
					scrollDown();
					_ackTail();
				} else showNewMessages = true;
			}
		} catch {
			/* ignore poll errors */
		}
	}

	function updateScrollPosition() {
		if (!stream) return;
		isNearBottom =
			stream.scrollHeight - stream.scrollTop - stream.clientHeight <= BOTTOM_THRESHOLD_PX;
		if (isNearBottom) {
			showNewMessages = false;
			_ackTail();
		}
	}

	function scrollDown(smooth = false) {
		if (!stream) return;
		stream.scrollTo({ top: stream.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
		isNearBottom = true;
		showNewMessages = false;
	}

	async function send() {
		const body = expandChannelAliases(draft, channelAliases, Object.keys(eligibility)).trim();
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
	let aiAgents: string[] = [];
	let proxyAgents: string[] = [];
	$: triggerAgents = shownParticipants.filter((participant) => aiAgents.includes(participant));
	// I proxy che siedono QUI: gli unici principal per cui si conia un grant
	// (#242). Non un campo di testo libero — un nome scritto a mano che non è un
	// proxy lo rifiuta il server, e il rifiuto arriva dopo aver compilato tutto.
	$: proxyCandidates = shownParticipants.filter((participant) =>
		proxyAgents.includes(participant));
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

	async function uploadFile(f: File, provenance: 'trusted' | 'untrusted') {
		const buf = await f.arrayBuffer();
		let bin = '';
		const u = new Uint8Array(buf);
		for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
		try {
			await uploadChannelFile(tier, name, f.name, btoa(bin), provenance);
			await loadFiles();
		} catch (err) {
			loadErr = err instanceof ApiError || err instanceof Error ? err.message : String(err);
		}
	}

	// ── Provenienza all'upload (clodia-platform#104 §3) ────────────────────────
	// All'upload si chiede DA DOVE viene il file: è l'unico momento in cui
	// l'informazione esiste, e l'unico interlocutore che può risponderla è
	// l'utente. È una CLASSIFICAZIONE, non un'autorizzazione — non si chiede
	// «consenti/nega», perché un blocco insegnerebbe a rispondere «fidata» per
	// andare avanti, rendendo l'etichetta inutile.
	//
	// Si chiede UNA volta per lotto: cinque immagini incollate insieme vengono
	// dalla stessa fonte, e cinque dialog di fila sono la strada per farli
	// cliccare senza leggere.
	let pending: File[] = [];
	async function askProvenance(files: File[]) {
		if (!files.length) return;
		pending = files;
	}
	async function resolveProvenance(provenance: 'trusted' | 'untrusted' | null) {
		const files = pending;
		pending = [];
		if (!provenance) return; // annullato: non si carica niente
		for (const f of files) await uploadFile(f, provenance);
	}

	async function onUpload(e: Event) {
		const files = (e.target as HTMLInputElement).files;
		if (files) await askProvenance(Array.from(files));
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
			await askProvenance(imgs);
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
		await askProvenance(Array.from(fs));
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
		void getChannelAliases().then((aliases) => (channelAliases = aliases)).catch(() => {});
		try {
			const raw = localStorage.getItem(SIDE_WIDTH_KEY);
			if (raw) sideWidth = clampSideWidth(Number(raw) || sideWidth);
		} catch {}
		poll = setInterval(refreshLive, 5000);
		void refreshGateInfo();
		getAgents()
			.then((as) => {
				allAgents = as.map((a) => a.name);
				// I seed noti servono a `seedName` per tagliare `clodia-124` nel punto
				// giusto: i nomi dei seed contengono trattini, quindi senza questa
				// lista `security-engineer-1` non è distinguibile da un agente che si
				// chiama davvero così (stessa regola di `_split_ord` lato backend).
				setKnownSeeds(allAgents);
				aiAgents = as
					.filter((a) => a.type === 'bot' || a.type === 'normal' || a.type === 'super')
					.map((a) => a.name);
				proxyAgents = as.filter((a) => a.type === 'proxy').map((a) => a.name);
				multiSpawn = Object.fromEntries(
					as.filter((a) => a.multi_spawn)
						.map((a) => [a.name, { max: a.max_spawns ?? null }])
				);
			})
			.catch(() => {
				allAgents = [];
				aiAgents = [];
				proxyAgents = [];
				multiSpawn = {};
			});
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
				void refreshMessages();
				return;
			}
			if (ev.type === 'routing_decision') {
				if (p.tier !== tier || p.name !== name) return;
				lastRouting = p as unknown as RoutingTrace;
				routingCorrected = null; // nuova decisione → riapri la correzione
				routingConfirmed = false;
				return;
			}
			// Etichetta dello spawn per questo chat_id: arriva all'inizio del turno,
			// prima di qualunque chunk, così i box live nascono già col numero
			// giusto invece di essere rinominati a metà.
			if (ev.type === 'spawn_label') {
				if (!chatBelongs(p.chat_id)) return;
				const cid = String(p.chat_id);
				const spawn = String(p.spawn ?? '');
				const vecchio = spawnByChat[cid];
				if (!spawn || spawn === vecchio) return;
				spawnByChat = { ...spawnByChat, [cid]: spawn };
				// Se un box live era già nato col nome ricavato dal chat_id, va
				// spostato sotto il nome vero: lasciarlo dov'è produrrebbe DUE box
				// per la stessa istanza, uno che cresce e uno fermo.
				const provvisorio = vecchio || cid.split(':').at(-1) || '';
				if (provvisorio && provvisorio !== spawn && liveAgents[provvisorio]) {
					const next = { ...liveAgents, [spawn]: liveAgents[provvisorio] };
					delete next[provvisorio];
					liveAgents = next;
				}
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
				updateLive(liveAgent, { tools: pushStep(liveAgent, `🔧 ${tool}${inp}`) });
			} else if (ev.type === 'task_progress') {
				// progresso di un SUBAGENT (tool Task): senza questo la chat sembra
				// ferma mentre il subagent lavora (es. un download).
				const tool = p.last_tool_name ? ` · ${String(p.last_tool_name)}` : '';
				const desc = p.description ? `: ${String(p.description)}` : '';
				updateLive(liveAgent, { tools: pushStep(liveAgent, `🤖 subagent${tool}${desc}`.slice(0, 120)) });
			}
		});
	});
	onDestroy(() => {
		if (poll) clearInterval(poll);
		offEvt?.();
		stopStream?.();
		for (const t of Object.values(typingTimers)) clearTimeout(t);
		if (copyResetTimer) clearTimeout(copyResetTimer);
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
			<!-- Piccolo di proposito: la testata è già affollata (tier, badge,
			     reset del contesto), e il segno qui serve a confermare in quale
			     stanza si è — non a fare da copertina. `rev` lo fa rileggere dopo
			     un caricamento, altrimenti resterebbe visibile la vecchia
			     immagine e sembrerebbe che il salvataggio non abbia funzionato. -->
			<TopicMark {tier} {name} logo={info?.meta?.logo} title={info?.meta?.title}
				size={22} rev={logoRev} />
			<h1>#{info?.meta?.title || name}</h1>
			<span class="tier">{info?.tier || tier}</span>
			<TrifectaBadge profile={info?.trifecta} taint={info?.taint}
				canReset={isOwner}
				onReset={doResetTrifecta} />
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

		<button type="button" class="rules-btn" on:click={openRules} aria-expanded={showRules}
			title="Istruzioni che ogni agente della stanza legge a ogni turno">
			📋 Regole dello scope{#if rules?.text}<span class="rules-dot" aria-label="presenti"></span>{/if}
			<span class="rules-caret">{showRules ? '▴' : '▾'}</span>
		</button>
		{#if showRules}
			<div class="rules-panel">
				<p class="rules-note">
					Questo testo entra nel contesto di <strong>ogni agente della stanza a ogni turno</strong>.
					Non può ampliare i permessi di chi lo legge.
				</p>
				{#if rules && rules.text && !rules.authoritative}
					<p class="rules-legacy">
						⚠️ Questo topic non è ancora migrato: il testo arriva dalla vecchia posizione
						<code>files/AGENTS.md</code>, dove <strong>qualunque partecipante</strong> poteva
						scriverlo. Finché resta lì viene passato agli agenti come materiale di contesto
						<em>non fidato</em>. Salvando da qui diventa autorevole.
					</p>
				{/if}
				<textarea class="rules-ta" bind:value={rulesDraft} rows="10" spellcheck="false"
					placeholder="Es. «In questo topic si scrive in italiano. I documenti finali vanno in files/consegne/.»"
				></textarea>
				{#if rulesErr}<div class="err">{rulesErr}</div>{/if}
				<div class="rules-actions">
					<!-- Salva è INATTIVO finché le regole non sono state lette.
					     Se `loadRules()` fallisce, `rulesDraft` resta '' e salvare
					     vuoto RIMUOVE le istruzioni: si apriva il pannello, si
					     vedeva l'errore, si salvava, e il testo era perso. Il
					     gateway ora lo rifiuta col lock, ma la UI non deve
					     nemmeno offrire il gesto. -->
					<button type="button" class="btn primary" on:click={saveRules}
						disabled={rulesBusy || !rulesLoaded}>
						{rulesBusy ? 'Salvo…' : 'Salva regole'}
					</button>
					<button type="button" class="btn" on:click={loadRules} disabled={rulesBusy}>Ricarica</button>
					<span class="rules-hint">
						{#if !rulesLoaded}Regole non lette: ricarica prima di salvare, altrimenti si
							rischia di rimuovere un testo che non hai visto.
						{:else if rulesDraft.trim() === ''}Salvando vuoto le regole vengono rimosse (il
							testo resta recuperabile nel cestino del topic).
						{:else}Riservato agli admin.{/if}
					</span>
				</div>
			</div>
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
			<div class="timeline">
				<div class="stream" bind:this={stream} on:scroll={updateScrollPosition} on:click={handleStreamClick} role="presentation">
					{#each shownMessages as m, i (m.id)}
					<!-- `id="m-<id>"` è l'ancora che i link esterni citano — oggi la
					     notifica di menzione su Telegram. Senza, il link porterebbe al
					     topic e lascerebbe a cercare il messaggio: la meta ma non il
					     punto, che su un telefono è quasi lo stesso che niente. -->
					<div class="msg" id={`m-${m.id}`} class:ai={m.kind === 'ai'} class:system={m.kind === 'system'} class:mine={m.author === me}>
						<div class="msg-head">
							{#if m.kind === 'system'}
								<span class="system-icon" aria-hidden="true">ℹ</span>
								<span class="author">Sistema</span>
							{:else}
								<AgentAvatar name={m.author} size={22} />
								<span class="author">{m.author}</span>
								<!-- Perché lo stesso participant parla con due label diverse
								     (`nome#1`, `nome#2`): il badge sull'autore risponde dove la
								     domanda nasce, cioè nel messaggio (issue#210). -->
								{#if multiSpawn[seedName(m.author)]}
									<MultiSpawnBadge name={m.author} maxSpawns={multiSpawn[seedName(m.author)].max} />
								{/if}
							{/if}
							<time class="ts">{fmtTs(m.ts)}</time>
							{#if m.kind === 'ai'}
								<button type="button" class="copy-btn" class:copied={copiedMessageId === m.id}
									title={copiedMessageId === m.id ? 'Markdown copiato' : 'Copia markdown'}
									aria-label={copiedMessageId === m.id ? 'Markdown copiato' : 'Copia markdown'}
									on:click={() => copyMessageMarkdown(m)}>
									{copiedMessageId === m.id ? '✓' : '📋'}
								</button>
							{/if}
							{#if m.kind !== 'system'}
								<button type="button" class="reply-btn" title={`Rispondi a ${m.author}`}
									on:click={() => replyTo(m)}>↩</button>
							{/if}
						</div>
						{#if splitQuote(m.text).quote}
							<blockquote class="quote">{splitQuote(m.text).quote}</blockquote>
						{/if}
						<div class="text md">{@html renderMarkdown(linkifyFiles(stripChoices(splitQuote(m.text).body)))}</div>
						{#if m.kind === 'ai'}
							<div class="message-feedback" aria-label="Valuta la risposta">
								<button type="button" class:on={feedbackByMessage[m.id] === 'thumbs_up'}
									disabled={feedbackBusy === m.id}
									title="Risposta utile"
									on:click={() => rateMessage(m, 'thumbs_up')}>👍</button>
								<button type="button" class:on={feedbackByMessage[m.id] === 'thumbs_down'}
									disabled={feedbackBusy === m.id}
									title="Risposta da migliorare"
									on:click={() => rateMessage(m, 'thumbs_down')}>👎</button>
								{#if feedbackBusy === m.id}<span>salvataggio…</span>{/if}
							</div>
						{/if}
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
							{@const routeChoices = msgRoutingChoices(m.text)}
							{#if routeChoices}
								<div class="pills route-pills">
									{#if routingChoiceDone[m.id]}
										<span class="route-done">Instradato a <b>{routingChoiceDone[m.id]}</b>.</span>
									{:else}
										{#each routeChoices as agent}
											<button type="button" class="pill" disabled={routingChoiceBusy}
												on:click={() => chooseRoute(agent, m)}>{agent}</button>
										{/each}
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
							{@const g = msgGate(m.text)}
							{#if g !== null}
								<div class="jobprop">
									{#if gateDecided[g.id]}
										<!-- L'esito NON cancella la domanda: la richiesta resta
										     leggibile accanto alla risposta. Un «approvato» da solo
										     racconta che qualcuno ha premuto un bottone, non cosa ha
										     concesso — ed è precisamente ciò che serve rileggere mesi
										     dopo. Il testo del messaggio porta il motivo; qui restano
										     chi e cosa, che vengono dal marcatore e non dalla coda. -->
										<span class="jobprop-done">
											🛡️ <b>{g.agent}</b> · <code>{g.verb.startsWith('topic-access:') ? g.verb.slice('topic-access:'.length) : g.verb}</code>
											— {gateDecided[g.id]}
										</span>
									{:else if gateInfoCaricato && !gateAperti.has(g.id)}
										<!-- Già deciso, ma non da questa pagina (o prima di un
										     ricarico): la richiesta non è più in coda. Si dice, invece
										     di riproporre bottoni che il backend rifiuterebbe. -->
										<span class="jobprop-done">
											🛡️ <b>{g.agent}</b> · <code>{g.verb.startsWith('topic-access:') ? g.verb.slice('topic-access:'.length) : g.verb}</code>
											— già deciso
										</span>
									{:else if canDecideGate(g.id)}
										<span class="jobprop-q">🛡️ <b>{g.agent}</b> {g.verb.startsWith('topic-access:') ? 'vuole accedere al topic ' : 'vuole usare '}<code>{g.verb.startsWith('topic-access:') ? g.verb.slice('topic-access:'.length) : g.verb}</code> — approvi?</span>
										<button type="button" class="jobprop-ok" disabled={gateDeciding}
											on:click={() => decideGate(g, true)}>{gateDeciding ? '…' : '✓ Approva'}</button>
										{#if isDestinationGate(g.verb)}
											<!-- Solo per i gate su una DESTINAZIONE: «sempre» ha senso
											     su un indirizzo, non su un'azione. E le due portate hanno
											     titolari diversi — la stanza è dell'owner, l'istanza è
											     dell'admin — quindi il secondo bottone compare solo a chi
											     può usarlo: offrirlo a chi verrà rifiutato è insegnare a
											     ignorare i bottoni. -->
											<button type="button" class="jobprop-ok" disabled={gateDeciding}
												title="Aggiunge questa destinazione alla whitelist di questa stanza: non verrà più chiesto qui"
												on:click={() => decideGate(g, true, 'topic')}>✓ Sempre qui</button>
											{#if $isAdmin}
												<button type="button" class="jobprop-ok" disabled={gateDeciding}
													title="Aggiunge questa destinazione alla whitelist dell'INTERA istanza, tutte le stanze comprese"
													on:click={() => decideGate(g, true, 'global')}>✓ Ovunque</button>
											{/if}
										{/if}
										<button type="button" class="jobprop-no" disabled={gateDeciding}
											on:click={() => decideGate(g, false)}>Nega</button>
									{:else}
										<span class="invite-note">
											{#if gateInfo[g.id]?.decided_by === 'admin'}
												lo sblocca un admin della piattaforma
											{:else if gateInfo[g.id]?.decider_name}
												lo sblocca <b>{gateInfo[g.id].decider_name}</b>, owner di questo topic
											{:else}
												solo l'owner può approvare
											{/if}
										</span>
									{/if}
									{#if gateInfo[g.id]?.asker_note}
										<span class="gate-crosses">🔎 {gateInfo[g.id].asker_note}</span>
									{/if}
									{#if gateInfo[g.id]?.crosses}
										<!-- Cosa si attraversa: senza, la richiesta è solo il nome
										     di una funzione, e chi decide non sa cosa sta decidendo. -->
										<span class="gate-crosses">↦ attraversa {gateInfo[g.id].crosses}</span>
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
					{/each}
					{#each liveReplies as [agent, live] (agent)}
						<div class="msg ai live-message" aria-label={`Risposta in arrivo da ${agent}`} aria-busy="true">
							<div class="msg-head">
								<AgentAvatar name={agent} size={22} />
								<span class="author">{agent}</span>
								<span class="live-badge">
									<span class="streaming-dot" aria-hidden="true"></span>
									sta rispondendo
								</span>
							</div>
							<div class="text md" aria-live="polite" aria-atomic="false">
								{@html renderMarkdown(linkifyFiles(stripChoices(live.reply)))}
							</div>
						</div>
					{/each}
					{#if shownMessages.length === 0 && liveReplies.length === 0}
						<p class="empty">Nessun messaggio. Scrivi qualcosa per iniziare.</p>
					{/if}
				</div>
				{#if showNewMessages}
					<button type="button" class="new-messages" on:click={() => scrollDown(true)}
						aria-label="Vai al nuovo contenuto">
						↓ Nuovo contenuto
					</button>
				{/if}
			</div>
			{#if hasLive || typingLabel}
				{#if typingLabel}
					<div class="typing" aria-live="polite">
						<span class="typing-dots"><span></span><span></span><span></span></span>
						{typingLabel}
					</div>
				{/if}
				<!-- Un box per agente (issue#105): ragionamento e tool in sequenza nello
				     stesso riquadro, compatto di default, con expand/compact per i dettagli. -->
				{#each liveEntries as [agent, live] (agent)}
					<AgentLiveBox {agent} think={live.think} tools={live.tools} />
				{/each}
			{/if}
			{#if lastRouting}
				<div class="routing" class:open={routingOpen} class:fallback={lastRouting.reason === 'fallback-rank'}>
					<button type="button" class="routing-head" on:click={() => (routingOpen = !routingOpen)}
						aria-expanded={routingOpen}>
						<span class="caret" class:open={routingOpen}>▸</span>
						<span class="routing-title">🧭 Routing → <b>{lastRouting.chosen}</b></span>
						<span class="routing-why">{routingReason[lastRouting.reason] ?? lastRouting.reason}</span>
						<span class="routing-hint">{routingOpen ? 'comprimi' : multiRouting ? 'dettagli' : 'correggi'}</span>
					</button>
					{#if routingOpen}
						<div class="routing-body">
							{#if lastRouting.reason === 'fallback-rank' && !routingCorrected && !routingConfirmed}
								<p class="routing-feedback-prompt">
									Nessuno specialista ha superato la soglia. Indica chi avrebbe dovuto rispondere:
									il router userà la correzione per messaggi simili.
								</p>
							{/if}
							{#if lastRouting.candidates && lastRouting.candidates.length}
								<div class="routing-meta">
									Punteggi di pertinenza (soglia {lastRouting.threshold ?? '—'}, margine {lastRouting.margin ?? '—'}):
								</div>
								<ul class="routing-scores">
									{#each lastRouting.candidates as c}
										<li class:winner={chosenAgents.includes(c.name)}>
											<span class="rs-name">{c.name}{#if c.super}<span class="rs-tag">super</span>{/if}</span>
											<span class="rs-bar"><span class="rs-fill" style="width:{Math.min(100, Math.round(c.score * 100))}%"></span></span>
											<span class="rs-val">{c.score.toFixed(3)}</span>
										</li>
									{/each}
								</ul>
							{:else}
								<div class="routing-meta">Nessun punteggio disponibile (tag esplicito o embedder non raggiungibile).</div>
							{/if}
							{#if multiRouting}
								<div class="routing-meta">Richiesta distribuita tra {chosenAgents.join(', ')}.</div>
							{:else}
								<div class="routing-correct">
								{#if routingConfirmed}
									<span class="rc-done">✓ scelta confermata: <b>{lastRouting.chosen}</b></span>
								{:else if routingCorrected}
									<span class="rc-done">✓ imparato: i messaggi simili andranno a <b>{routingCorrected}</b></span>
								{:else}
									<button type="button" class="rc-chip rc-confirm" on:click={confirmRoute}>
										✓ Scelta corretta
									</button>
								{/if}
								{#if !routingConfirmed && !routingCorrected && correctOptions.length}
									<span class="rc-label">Avresti usato:</span>
									{#each correctOptions as a}
										<button type="button" class="rc-chip" on:click={() => correctRoute(a)}>{a}</button>
									{/each}
								{/if}
								</div>
							{/if}
						</div>
					{/if}
				</div>
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
				<details class="side-section topic-meta" open>
					<summary>
						<span>Meta</span>
						{#if info?.meta?.schema_version}<span class="section-status">v{info.meta.schema_version}</span>{/if}
					</summary>
					<label class="meta-field">
						<span>Stato</span>
						{#if isOwner}
							<select value={metaStatus} disabled={metaBusy}
								on:change={(e) => saveTopicStatus((e.currentTarget as HTMLSelectElement).value)}>
								{#each topicStatusOptions as s}
									<option value={s}>{s}</option>
								{/each}
							</select>
						{:else}
							<span class="meta-value">{metaStatus}</span>
						{/if}
					</label>
					<label class="meta-field">
						<span>Deadline</span>
						{#if isOwner}
							<div class="deadline-edit">
								<input type="date" bind:value={metaDeadlineDraft} disabled={metaBusy}
									on:change={() => saveTopicDeadline()} />
								{#if info?.meta?.deadline}
									<button type="button" title="Rimuovi deadline" disabled={metaBusy}
										on:click={() => saveTopicDeadline('')}>×</button>
								{/if}
							</div>
						{:else}
							<span class="meta-value">{info?.meta?.deadline ?? '—'}</span>
						{/if}
					</label>

					<label class="meta-field">
						<span>Portabile</span>
						{#if isOwner}
							<input type="checkbox" checked={metaPortable} disabled={metaBusy}
								on:change={(e) => saveTopicPortable((e.currentTarget as HTMLInputElement).checked)} />
						{:else}
							<span class="meta-value">{metaPortable ? 'sì' : 'no'}</span>
						{/if}
					</label>
					<p class="meta-note">
						{#if metaPortable}
							I <b>partecipanti</b> di questo topic ne leggono i contenuti anche
							da altre stanze, <b>fino al tier della stanza in cui si trovano</b>:
							in una stanza più bassa il contenuto non li segue.
						{:else}
							I contenuti restano leggibili solo qui. Renderlo portabile è un atto
							sui muri dello scope, non una preferenza.
						{/if}
					</p>

					<!-- summary.md e meta.json sono usciti dalla vista file il 7 ago 2026
					     (la radice dell'albero mostra i due mount e basta). Non dovevano
					     sparire: sono il control-plane del topic e vanno letti, solo non
					     navigati come se fossero dati. Qui, in sola lettura. -->
					<details class="meta-doc">
						<summary>summary.md<span class="meta-doc-size"
							>{(info?.summary?.length ?? 0).toLocaleString('it-IT')} car.</span></summary>
						{#if info?.summary}
							<pre class="meta-doc-body">{info.summary}</pre>
						{:else}
							<p class="meta-doc-empty">Nessun summary.</p>
						{/if}
					</details>
					<details class="meta-doc">
						<summary>meta.json</summary>
						<pre class="meta-doc-body">{JSON.stringify(info?.meta ?? {}, null, 2)}</pre>
					</details>
				</details>
				{#if isOwner}
					<details class="side-section">
						<summary>
							<span>Lessons</span>
							<span class="section-count">{feedbackLessons.length}</span>
						</summary>
						{#if feedbackLessons.length}
							<ul class="feedback-lessons">
							{#each feedbackLessons as lesson (lesson.id)}
								<li>
									<div class="lesson-head">
										<span>{lesson.rating === 'thumbs_up' ? '👍' : '👎'} {lesson.agent}</span>
										<button type="button" title="Cancella lesson"
											on:click={() => removeFeedbackLesson(lesson.id)}>×</button>
									</div>
									{#if lesson.status === 'pending'}
										<span class="muted">Elaborazione…</span>
									{:else if lesson.status === 'error'}
										<span class="lesson-error">Errore: {lesson.error ?? 'lesson non generata'}</span>
									{:else}
										<p>{lesson.lesson}</p>
									{/if}
									{#if lesson.comment}<small>“{lesson.comment}”</small>{/if}
								</li>
							{/each}
						</ul>
						{:else}
							<p class="muted">Nessuna lesson registrata.</p>
						{/if}
					</details>
				{/if}
				<details class="side-section" open>
					<summary>
						<span>Partecipanti</span>
						<span class="section-count">{shownParticipants.length}</span>
					</summary>
					<ul class="parts">
					{#each shownParticipants as p}
						{@const c = eligibility[p]?.context}
						<li>
							<span class="part-id">
								<AgentAvatar name={p} size={22} />
								<span class="part-col">
									<span class="part-name">{#if presenza[p]}<span
											class="presenza presenza-{presenza[p]}"
											title={PRESENZA_TITOLO[presenza[p]]}></span>{/if}{p}{#if multiSpawn[p]} <MultiSpawnBadge name={p} maxSpawns={multiSpawn[p].max} />{/if}{#if p === info?.meta?.owner} <em>(owner)</em>{/if}</span>
									{#if c}
										<span class="ctx-bar" title={`Contesto ${Math.round(c.pct * 100)}% — ${c.used.toLocaleString()}/${c.window.toLocaleString()} token`}>
											<span class="ctx-fill" style="width:{Math.min(100, c.pct * 100)}%; background:{ctxColor(c.pct)}"></span>
										</span>
									{/if}
								</span>
								{#if eligibility[p]?.warn}
									<span class="part-warn" title="Provider sotto il tier del topic: attiva un provider con SEAL ≥ tier">⚠️</span>
								{/if}
							</span>
							{#if instancesOf(p).length}
								<ul class="spawn-rows">
									{#each instancesOf(p) as inst}
										<li class="spawn-row" title={inst.state === 'working' ? 'turno in corso' : 'in attesa'}>
											<span class="spawn-dot" class:working={inst.state === 'working'}></span>
											<span class="spawn-ord">#{inst.ordinal}</span>
											<span class="spawn-state">{inst.state === 'working' ? 'al lavoro' : 'in attesa'}</span>
										</li>
									{/each}
								</ul>
							{/if}
							{#if isOwner && p !== info?.meta?.owner}
								<!-- Il ruolo lo decide l'owner, qui, accanto a chi riguarda.
								     Un contributor scrive nella stanza; un reader legge e
								     parla, e se chiede una mutazione diventa un gate
								     rivolto a te invece che un rifiuto. -->
								<select class="role-sel" value={roleOf(p)} disabled={roleBusy === p}
									title="contributor: può modificare · reader: legge e parla"
									on:change={(e) => setRole(p, (e.currentTarget as HTMLSelectElement).value as 'contributor' | 'reader')}>
									<option value="contributor">contributor</option>
									<option value="reader">reader</option>
								</select>
								<button class="x" type="button" on:click={() => removeParticipant(p)} aria-label="Rimuovi">×</button>
							{:else if p === info?.meta?.owner}
								<span class="role-fixed" title="La proprietà dello scope, non un grado di accesso">owner</span>
							{:else}
								<span class="role-fixed">{roleOf(p)}</span>
							{/if}
						</li>
					{/each}
				</ul>
				<SpawnTree {tier} {name} />
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
				</details>
				{#if isOwner}
					<details class="side-section trigger-section">
						<summary>Trigger</summary>
						{#key `${tier}/${name}`}
							<TopicTriggersPanel {tier} {name} agents={triggerAgents} />
						{/key}
					</details>
				{/if}
				<details class="side-section">
					<summary>
						<span>File</span>
						<span class="section-count">{files.length}</span>
					</summary>
					{#if remoteMeta}{@const ru = remoteUrl()}
						{#if ru}
							<div class="file-remote">
								<a class="remote-goto" href={ru} target="_blank" rel="noopener"
									title={`Apri il remote (${remoteMeta.type})${remoteName ? ` — ${remoteName}` : ''}`}>{@html remoteIconSvg()} {remoteName || `apri ${remoteMeta.type}`}</a>
							</div>
						{/if}
					{/if}
					<nav class="crumbs" aria-label="Percorso file">
					<button type="button" class="crumb" on:click={() => gotoCrumb(-1)}>/</button>
					{#each crumbs as seg, i}
						<span class="crumb-sep">/</span>
						<button type="button" class="crumb" on:click={() => gotoCrumb(i)}>{seg}</button>
					{/each}
					{#if filesLoading}<span class="files-spinner" aria-label="Caricamento…" title="Caricamento…"></span>{/if}
					{#if remoteMeta?.type === 'git' && folderAddable.length}
						<button type="button" class="sync-add stage-all" disabled={remoteBusy}
							title={`Metti in sync tutti i file di questa cartella (${folderAddable.length})`}
							on:click={() => stageMany(folderAddable)}>⊕ tutti</button>
					{/if}
					{#if remoteMeta?.type === 'git' && folderStaged.length}
						<button type="button" class="sync-add stage-all" class:solo-unstage={!folderAddable.length} disabled={remoteBusy}
							title={`Togli dallo staging tutti i file di questa cartella (${folderStaged.length})`}
							on:click={() => unstageMany(folderStaged)}>⊖ tutti</button>
					{/if}
				</nav>
			{#if filesError}
					<!-- Lo storage del topic è remoto e non risponde: dirlo, invece di
					     mostrare una cartella vuota che sembra un topic senza file. -->
					<p class="files-error" role="status">⚠ {filesError}</p>
				{/if}
				<ul class="files" class:loading={filesLoading} aria-busy={filesLoading}>
					{#each files as f}
						{@const st = f.kind !== 'dir' ? fileState(f.path) : null}
						<li>
							{#if f.kind === 'dir'}
								<button type="button" class="dir" on:click={() => openDir(f)} disabled={filesLoading}>📂 {f.name}</button>
								{#if f.url}
									<!-- Su un remote Drive la cartella si naviga qui dentro; aprirla su
									     Drive resta possibile, ma come scelta esplicita (#117). -->
									<a class="ext" href={f.url} target="_blank" rel="noopener"
										title="Apri questa cartella su Google Drive">↗</a>
								{/if}
							{:else if f.remote}
								<a href={f.url} target="_blank" rel="noopener" class="remote st-{st ?? 'none'}" title="Documento Google — apri e modifica su Drive">📄 {f.name}</a>
							{:else}
								<a href="#download" class="st-{st ?? 'none'}"
									title={st ? `${f.name} — ${st}` : f.name}
									on:click|preventDefault={() => openSignedFile(f.path)}>{f.name}</a>
								{#if f.provenance === 'untrusted' || f.provenance === 'unknown'}
									<!-- Etichetta visibile solo quando NON è verificata: marcare anche
									     i file fidati farebbe rumore su ogni riga e nessuno la
									     guarderebbe più. `unknown` = caricato prima della §3. -->
									<span class="prov-tag" class:unknown={f.provenance === 'unknown'}
										title={f.provenance === 'unknown'
											? 'Provenienza non registrata: file caricato prima che la classificazione esistesse'
											: 'Dichiarato come fonte esterna o non verificata'}>{f.provenance === 'unknown' ? '?' : '⚠'}</span>
								{/if}
								{#if /\.(html?|md|markdown|mdown|mkd)$/i.test(f.name)}
									<button type="button" class="artifact-open" title="Apri anteprima renderizzata (finestra separata)"
										on:click={() => openArtifact(f.path)}>🔎</button>
								{/if}
							{/if}
							{#if remoteMeta?.type === 'git' && f.kind !== 'dir' && !f.remote && ADDABLE.includes(st ?? '')}
								<button type="button" class="sync-add"
									title={st === 'modified' ? 'Metti in staging la modifica' : 'Aggiungi al sync'}
									on:click={() => stageMany([relOf(f.path)])}
									disabled={remoteBusy}>⊕</button>
							{:else if remoteMeta?.type === 'git' && f.kind !== 'dir' && !f.remote && st === 'staged'}
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
				</details>

				{#if remoteMeta?.type === 'git' && syncGroups.length}
					<details class="side-section sync-status">
						<summary>
							<span>Sync status</span>
							<span class="section-count">{syncGroups.reduce((total, group) => total + group.paths.length, 0)}</span>
						</summary>
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
					</details>
				{/if}

				<details class="side-section tg-panel">
					<summary>
						<span>Telegram</span>
						{#if tgMount}<span class="section-status">collegato</span>{/if}
					</summary>
					{#if !isOwner}
						<p class="muted">
							{#if tgMount}
								Le menzioni delle persone mappate vengono riportate su un gruppo
								Telegram. Il collegamento lo gestisce l'owner.
							{:else}
								Nessun gruppo collegato.
							{/if}
						</p>
					{:else if tgOpen}
						<form class="tg-form" on:submit|preventDefault={saveTelegram}>
							<input class="remote-url-input" type="text" bind:value={tgChatId}
								placeholder="id del gruppo (es. -1001234567890)"
								autocomplete="off" spellcheck="false" />
							<label class="tg-mode">
								<span>Cosa esce</span>
								<select bind:value={tgMode}>
									<option value="excerpt">la riga della menzione + link</option>
									<option value="notify">solo l'avviso + link</option>
								</select>
							</label>
							<p class="meta-note">
								{#if tgMode === 'excerpt'}
									Esce <b>la riga</b> in cui il nome compare, troncata, con il link
									alla conversazione. Non il resto del messaggio: nel gruppo ci sono
									persone che in questo topic non entrano.
								{:else}
									Esce solo il fatto — chi ti ha menzionato e dove — con il link.
									Nessun contenuto della stanza.
								{/if}
							</p>
							<div class="tg-people">
								<span class="tg-people-h">Chi è chi</span>
								{#each tgPeople as riga, i}
									<div class="tg-row">
										<input type="text" bind:value={riga.handle} placeholder="@handle Telegram"
											autocomplete="off" spellcheck="false" />
										<input type="text" bind:value={riga.principal} placeholder="utente su Clodia"
											autocomplete="off" spellcheck="false" />
										<button type="button" title="Togli questa riga"
											on:click={() => (tgPeople = tgPeople.filter((_, j) => j !== i))}>×</button>
									</div>
								{/each}
								<button type="button" class="link-btn"
									on:click={() => (tgPeople = [...tgPeople, { handle: '', uid: '', principal: '' }])}>+ persona</button>
								<p class="meta-note">
									Solo chi è in questa mappa viene avvisato. L'<b>handle</b> è quello
									che finisce nel messaggio: <code>@giovanni</code> nel canale diventa
									<code>@giocasu75</code> sul gruppo — scriverci il nome di Clodia non
									farebbe arrivare nessuna notifica a quella persona.
								</p>
							</div>
							{#if tgErr}<p class="cred-hint" role="alert">{tgErr}</p>{/if}
							<div class="remote-actions">
								<button type="submit" disabled={metaBusy}>{tgMount ? 'aggiorna' : 'collega'}</button>
								<button type="button" on:click={() => (tgOpen = false)} disabled={metaBusy}>annulla</button>
							</div>
						</form>
					{:else if tgMount}
						<p class="remote-info">
							💬 <code>{tgMount.config?.chat_id}</code>
							<span class="muted"> · {tgMount.config?.mode === 'notify' ? 'solo avviso' : 'con la riga'}</span>
						</p>
						<p class="meta-note">
							{Object.keys(tgMount.config?.people ?? {}).length} persone mappate:
							{Object.values(tgMount.config?.people ?? {})
								.map((v) => (typeof v === 'object' && v ? (v as Record<string, string>).principal : v))
								.join(', ')}
						</p>
						<div class="remote-actions">
							<button type="button" on:click={openTelegramForm} disabled={metaBusy}>modifica</button>
							<button type="button" class="danger" on:click={unbindTelegram} disabled={metaBusy}>scollega</button>
						</div>
					{:else}
						<p class="muted">
							Collega un gruppo Telegram: le menzioni delle persone mappate vengono
							riportate lì, con il link alla conversazione. Il bot deve già essere
							membro del gruppo.
						</p>
						<div class="remote-actions">
							<button type="button" on:click={openTelegramForm} disabled={metaBusy}>collega un gruppo</button>
						</div>
					{/if}
				</details>

				<details class="side-section logo-panel">
					<summary>
						<span>Immagine</span>
						{#if topicLogoUrl}<span class="section-status">impostata</span>{/if}
					</summary>
					{#if topicLogoUrl}
						<img class="topic-logo-big" src={topicLogoUrl} alt="" />
					{/if}
					{#if !isOwner}
						<p class="muted">
							{topicLogoUrl
								? "L'immagine con cui questo topic si presenta. La cambia l'owner."
								: 'Nessuna immagine. La imposta l\'owner.'}
						</p>
					{:else}
						<p class="meta-note">
							PNG, JPEG, GIF o WebP, fino a 512 KB. Niente SVG: può contenere
							script, e verrebbe eseguito nella pagina di chi apre il topic.
						</p>
						{#if logoErr}<p class="cred-hint" role="alert">{logoErr}</p>{/if}
						<div class="remote-actions">
							<label class="link-btn" class:disabled={logoBusy}>
								{topicLogoUrl ? 'sostituisci' : 'scegli un file'}
								<input type="file" accept="image/png,image/jpeg,image/gif,image/webp"
									on:change={caricaLogo} disabled={logoBusy} hidden />
							</label>
							{#if topicLogoUrl}
								<button type="button" class="danger" on:click={togliLogo}
									disabled={logoBusy}>togli</button>
							{/if}
						</div>
					{/if}
				</details>

				<details class="side-section mcp-panel" on:toggle={loadMcpClients}>
					<summary>
						<span>Proxy</span>
						{#if mcpGrants.length}<span class="section-status">{mcpGrants.length}</span>{/if}
					</summary>
					{#if !isOwner}
						<p class="muted">
							Un <b>proxy</b> è un sistema terzo con un posto in questa stanza: parla e
							legge il canale, nient'altro. Ammetterlo manda la conversazione fuori, e
							quella è una decisione dell'owner — è lui che li ammette e li vede.
						</p>
					{:else if mcpFresh}
						<p class="meta-note">
							Il <b>contratto</b> per chi gestisce il proxy: dove chiedere il token
							firmando con la propria chiave, e dove parlare. Non è un segreto — non
							c'è nulla qui che funzioni senza quella chiave — ma si legge una volta,
							quando si configura.
						</p>
						<pre class="mcp-config">{mcpFresh.contract}</pre>
						{#if mcpFresh.verbs.length}
							<p class="meta-note">
								Porta {mcpFresh.verbs.length} verbi: <code>{mcpFresh.verbs.join(', ')}</code>.
							</p>
						{/if}
						<p class="meta-note">Scade fra {giorniAllaScadenza(mcpFresh.expires)}.</p>
						<div class="remote-actions">
							<button type="button" on:click={() => navigator.clipboard?.writeText(mcpFresh?.contract ?? '')}>copia</button>
							<button type="button" on:click={() => { mcpFresh = null; mcpOpen = false; }}>ho finito</button>
						</div>
					{:else if mcpOpen}
						<form class="tg-form" on:submit|preventDefault={issueMcp}>
							{#if proxyCandidates.length}
								<label class="tg-mode">
									<span>Quale proxy</span>
									<select bind:value={mcpPrincipal}>
										<option value="">scegli…</option>
										{#each proxyCandidates as p}<option value={p}>{p}</option>{/each}
									</select>
								</label>
							{:else}
								<p class="muted">
									Nessun proxy tra i partecipanti di questa stanza. Un proxy si crea
									dalla pagina <a href="/agents">Agenti</a> — serve la sua chiave
									pubblica — e poi si invita qui come chiunque altro.
								</p>
							{/if}
							<p class="meta-note">
								Il grant porta i quattro verbi con cui <b>parla e legge il canale</b>:
								niente file, niente ricerca, niente scrittura. Un proxy che ha bisogno
								di contesto lo riceve in un messaggio.
							</p>
							<label class="tg-mode">
								<span>Quale sistema</span>
								<input class="remote-url-input" type="text" bind:value={mcpProvider}
									placeholder="es. sistema-crm" autocomplete="off" spellcheck="false" />
							</label>
							<p class="meta-note">
								Quello che il proxy legge <b>esce da qui</b>: il tier di questa stanza è
								un tetto anche su dove finisce. La dichiarazione resta scritta nel
								grant — serve a sapere, dopo, dove è andato ciò che è stato letto.
							</p>
							<label class="tg-mode">
								<span>Per quanto</span>
								<select bind:value={mcpTtl}>
									<option value={7}>7 giorni</option>
									<option value={30}>30 giorni</option>
									<option value={90}>90 giorni</option>
								</select>
							</label>
							{#if mcpTierAlto}
								<label class="mcp-consent">
									<input type="checkbox" bind:checked={mcpConsent} />
									<span>
										Questa stanza è {info?.meta?.tier ?? tier}: il sistema dichiarato
										non è verificabile e me ne assumo la dichiarazione.
									</span>
								</label>
							{/if}
							{#if mcpErr}<p class="cred-hint" role="alert">{mcpErr}</p>{/if}
							<div class="remote-actions">
								<button type="submit" disabled={metaBusy || !proxyCandidates.length}>ammetti</button>
								<button type="button" on:click={() => (mcpOpen = false)} disabled={metaBusy}>annulla</button>
							</div>
						</form>
					{:else}
						{#if mcpGrants.length}
							<ul class="mcp-list">
								{#each mcpGrants as g}
									<li class:expired={g.expired}>
										<span class="mcp-who">{g.principal}</span>
										{#if g.principal_kind !== 'proxy'}
											<!-- Residuo del pannello «Client MCP» (#242): non si conia più,
											     e resta in elenco solo perché per revocarlo va visto. -->
											<span class="muted" title="client MCP di una persona: non si conia più, si può solo revocare">· client MCP dismesso</span>
										{/if}
										<span class="muted">{g.provider || 'sistema non dichiarato'}</span>
										<span class="muted">· {g.expired ? 'scaduto' : giorniAllaScadenza(g.expires)}</span>
										<button type="button" class="link-btn danger"
											on:click={() => revokeMcp(g)} disabled={metaBusy}>revoca</button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="muted">
								Nessun proxy ammesso. Un sistema terzo che entra qui prende posto tra i
								partecipanti: parla, viene menzionato, e si vede quando non c'è.
							</p>
						{/if}
						{#if mcpErr}<p class="cred-hint" role="alert">{mcpErr}</p>{/if}
						<div class="remote-actions">
							<button type="button" on:click={openMcpForm} disabled={metaBusy}>ammetti un proxy</button>
						</div>
					{/if}
				</details>

				<details class="side-section remote-panel">
					<summary>
						<span>Remote</span>
						{#if topicMounts.length > 1}
							<span class="section-count">{topicMounts.length}</span>
						{:else if remoteMeta}<span class="section-status">{remoteMeta.type}</span>{/if}
					</summary>
					{#if topicMounts.length > 1}
						<!-- I mount di questo scope. Si sceglie quale guarda il pannello:
						     senza, si vedrebbe sempre il primo e gli altri sarebbero
						     collegati ma invisibili — cioè peggio che non averli. -->
						<div class="mount-chips">
							{#each topicMounts as m (m.name)}
								<button type="button" class="mount-chip" class:sel={m.name === mountSel}
									title={(m.config?.name ?? m.name) + ' · ' + m.type}
									on:click={() => (mountSel = m.name)}>{m.name}</button>
							{/each}
						</div>
					{/if}
					{#if !remoteMeta}
					<p class="muted">Storage locale. Attiva un remote per sincronizzare i file, o esporta uno ZIP.</p>
					{#if remoteForm}
						<form class="remote-form" on:submit|preventDefault={submitRemoteForm}>
							<input class="remote-url-input" type="text" bind:value={remoteInput}
								placeholder={remoteForm === 'git'
									? 'URL repo git (vuoto = solo commit locali)'
									: 'Link/ID cartella Drive (vuoto = nuova)'}
								autocomplete="off" spellcheck="false"
								on:keydown={(e) => e.key === 'Escape' && cancelRemoteForm()} />
							<input class="remote-url-input" type="text" bind:value={remoteMountName}
								placeholder="nome del mount, es. contratti (vuoto = {remoteForm})"
								autocomplete="off" spellcheck="false" />
							{#if remoteForm === 'git'}
								<input class="remote-url-input" type="password" bind:value={remoteCred}
									placeholder="token per QUESTO topic (vuoto = credenziale della piattaforma)"
									autocomplete="off" spellcheck="false" />
								<p class="cred-hint">
									Un token ristretto a questo repository limita il danno di una stanza
									compromessa a questo repository. Lasciandolo vuoto il topic userà la
									credenziale della piattaforma, che raggiunge <strong>tutti</strong> i
									repo per cui ha i permessi.
								</p>
							{/if}
							<div class="remote-actions">
								<button type="submit" disabled={remoteBusy}>collega {remoteForm}</button>
								<button type="button" on:click={cancelRemoteForm} disabled={remoteBusy}>annulla</button>
							</div>
						</form>
					{:else}
						<div class="remote-actions">
							<button type="button" on:click={() => openRemoteForm('git')} disabled={remoteBusy}>{@html SVG_GITHUB} git</button>
							<button type="button" on:click={() => openRemoteForm('drive')} disabled={remoteBusy}>{@html SVG_DRIVE} Drive</button>
							<button type="button" class="zip-all" disabled={zipping}
								title="Esporta: scarica uno ZIP con tutti i file del topic su questo dispositivo"
								on:click={downloadZip}>{zipping ? '⏳ zip…' : '⬇ zip'}</button>
						</div>
					{/if}
				{:else}
					<p class="remote-info">
						{@html remoteIconSvg()} <strong>{remoteMeta.type}</strong>{#if remoteName}
							<span class="remote-name" title={remoteName}>{remoteName}</span>{/if}
						{#if remoteStatus}
							{#if remoteStatus.type === 'git'}<span class="muted"> · {remoteStatus.dirty ?? 0} da committare</span>
							{:else}<span class="muted"> · live · last-write-wins</span>{/if}
						{/if}
						{#if remoteBusy}<span class="files-spinner" style="margin-left:6px"></span>{/if}
					</p>
					{#if remoteStatus?.credential_source}
						<!-- La provenienza della credenziale, sempre visibile. Il valore
						     non compare mai: si mostra CHI la fornisce, non qual è. -->
						<p class="remote-info">
							{#if remoteStatus.credential_source === 'mount'}
								<span class="cred-source scope">🔑 credenziale di questo mount</span>
							{:else if remoteStatus.credential_source === 'scope'}
								<span class="cred-source scope">🔑 credenziale di questo topic</span>
							{:else if remoteStatus.credential_source === 'platform'}
								<span class="cred-source platform">🔑 credenziale della piattaforma</span>
								{#if isDriveRemote}
									<!-- Su Drive il salto è più grande che su git: la credenziale
									     di piattaforma è un ACCOUNT Google intero. -->
									<span class="muted"> · è un account Google intero, non questa cartella</span>
								{:else}
									<span class="muted"> · raggiunge tutti i repo per cui ha i permessi</span>
								{/if}
							{:else}
								<span class="cred-source platform">🔑 nessuna credenziale</span>
							{/if}
							{#if isOwner}
								<button type="button" class="link-btn"
									on:click={() => (rotating = !rotating)}>cambia</button>
							{/if}
						</p>
						{#if rotating && isOwner}
							<div class="cred-rotate">
								{#if isDriveRemote}
									<textarea bind:value={rotateCred} rows="4" autocomplete="off"
										placeholder={'{"refresh_token": "…", "client_id": "…", "client_secret": "…"}'}
									></textarea>
								{:else}
									<input type="password" bind:value={rotateCred} autocomplete="off"
										placeholder="nuovo token (vuoto = torna a quella di piattaforma)" />
								{/if}
								<button type="button" on:click={rotateCredential} disabled={remoteBusy}>salva</button>
								<button type="button"
									on:click={() => { rotating = false; rotateCred = ''; credErr = ''; }}>annulla</button>
							</div>
							{#if credErr}<p class="cred-hint" role="alert">{credErr}</p>{/if}
						{/if}
					{/if}
					{#if remoteForm}
						<!-- Lo stesso form del primo collegamento: un mount in più non è
						     un'operazione diversa dal primo, e due form divergerebbero. -->
						<form class="remote-form" on:submit|preventDefault={submitRemoteForm}>
							<input class="remote-url-input" type="text" bind:value={remoteInput}
								placeholder={remoteForm === 'git'
									? 'URL repo git (vuoto = solo commit locali)'
									: 'Link/ID cartella Drive (vuoto = nuova)'}
								autocomplete="off" spellcheck="false"
								on:keydown={(e) => e.key === 'Escape' && cancelRemoteForm()} />
							<input class="remote-url-input" type="text" bind:value={remoteMountName}
								placeholder="nome del mount, es. contratti (vuoto = {remoteForm})"
								autocomplete="off" spellcheck="false" />
							{#if remoteForm === 'git'}
								<input class="remote-url-input" type="password" bind:value={remoteCred}
									placeholder="token per QUESTO mount (vuoto = credenziale della piattaforma)"
									autocomplete="off" spellcheck="false" />
							{/if}
							<div class="remote-actions">
								<button type="submit" disabled={remoteBusy}>collega {remoteForm}</button>
								<button type="button" on:click={cancelRemoteForm} disabled={remoteBusy}>annulla</button>
							</div>
						</form>
					{:else if isOwner}
						<!-- Solo l'owner monta e smonta (voce 33): il mount porta la sua
						     credenziale, e chi lo cambia sposta il perimetro dello scope.
						     L'export ZIP resta di tutti. -->
						<div class="remote-actions">
							<button type="button" class="link-btn" disabled={remoteBusy}
								on:click={() => openRemoteForm('git')}>+ git</button>
							<button type="button" class="link-btn" disabled={remoteBusy}
								on:click={() => openRemoteForm('drive')}>+ Drive</button>
						</div>
					{/if}
					<div class="remote-actions">
						{#if !isDriveRemote}
							<button type="button" on:click={() => doRemote('pull')} disabled={remoteBusy}>⬇︎ pull</button>
							<button type="button" on:click={() => doRemote('commit').then(() => doRemote('push'))}
								disabled={remoteBusy}>⬆︎ push</button>
						{:else if remoteUrl()}
							<a class="remote-open" href={remoteUrl() ?? '#'} target="_blank" rel="noopener">
								{@html SVG_DRIVE} apri
							</a>
						{/if}
						<button type="button" on:click={loadRemoteStatus} disabled={remoteBusy}>↻</button>
						<button type="button" class="zip-all" disabled={zipping}
							title="Esporta: scarica uno ZIP con tutti i file del topic su questo dispositivo"
							on:click={downloadZip}>{zipping ? '⏳ zip…' : '⬇ zip'}</button>
						<button type="button" class="danger"
							on:click={() => confirm(isDriveRemote
								? `Scollegare il mount '${remoteMeta.name}' (Drive)? I file remoti verranno copiati nel topic locale.`
								: `Scollegare il mount '${remoteMeta.name}'? I file locali restano.`) && doRemote('disable')}
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
					{#if isDriveRemote}
						<p class="remote-filter-hint">
							I file sono letti e salvati direttamente su Drive. Le scritture concorrenti usano last-write-wins.
						</p>
					{:else}
						<p class="remote-filter-hint">
							Filtra la sync con <code>remoteinclude</code> / <code>remoteignore</code> nella root dei file (stile <code>.gitignore</code>).
						</p>
					{/if}
					{/if}
				</details>
			</aside>
	</div>
	{/if}
</div>

{#if confirmRemote}
	<div class="prov-backdrop" role="button" tabindex="0"
		on:click={() => (confirmRemote = null)}
		on:keydown={(e) => e.key === 'Escape' && (confirmRemote = null)}>
		<div class="prov-modal" role="dialog" aria-modal="true"
			aria-label="Conferma collegamento remote"
			tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
			<h2>⚠️ Confermi il collegamento?</h2>
			<p class="prov-why">{confirmRemote.message}</p>
			<div class="prov-actions">
				<button type="button" class="prov-untrusted" on:click={() => (confirmRemote = null)}>
					Annulla
					<small>Il topic resta com’è</small>
				</button>
				<button type="button" class="prov-trusted" on:click={acceptConfirmRemote}>
					Collega il remote
					<small>Ho fatto una copia di ciò che mi serve</small>
				</button>
			</div>
		</div>
	</div>
{/if}

{#if pending.length}
	<!-- Provenienza all'upload (#104 §3). Due scelte simmetriche e nessun
	     "consenti/nega": è una classificazione. `untrusted` è la scelta a costo
	     basso — il file si legge comunque, contamina il canale, e l'uscita
	     successiva chiede conferma. -->
	<div class="prov-backdrop" role="button" tabindex="0"
		on:click={() => resolveProvenance(null)}
		on:keydown={(e) => e.key === 'Escape' && resolveProvenance(null)}>
		<div class="prov-modal" role="dialog" aria-modal="true" aria-label="Provenienza del file"
			tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
			<h2>Da dove viene {pending.length === 1 ? 'questo file' : `questi ${pending.length} file`}?</h2>
			<p class="prov-files">{pending.map((f) => f.name).join(' · ')}</p>
			<p class="prov-why">
				Serve a sapere se il contenuto è di terzi. Il file si legge in ogni caso:
				se la fonte non è verificata il canale risulta <em>contaminato</em>, e la
				prima uscita successiva (email, messaggio, push) chiederà una conferma.
			</p>
			<div class="prov-actions">
				<button type="button" class="prov-untrusted" on:click={() => resolveProvenance('untrusted')}>
					Fonte esterna o non verificata
					<small>Ricevuto da terzi, scaricato, non so cosa contiene</small>
				</button>
				<button type="button" class="prov-trusted" on:click={() => resolveProvenance('trusted')}>
					Fonte che conosco
					<small>L'ho scritto io o viene da una fonte di cui rispondo</small>
				</button>
			</div>
			<button type="button" class="prov-cancel" on:click={() => resolveProvenance(null)}>Annulla</button>
		</div>
	</div>
{/if}

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
	.stream-wrap { position: relative; flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
	.timeline { position: relative; flex: 1 1 auto; min-height: 0; display: flex; }
	.stream { flex: 1 1 auto; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px; }
	.new-messages {
		position: absolute;
		left: 50%;
		bottom: 10px;
		z-index: 24;
		transform: translateX(-50%);
		border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
		border-radius: 999px;
		padding: 7px 14px;
		background: var(--card-bg);
		color: var(--fg);
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		box-shadow: 0 6px 22px rgba(0,0,0,.35);
		cursor: pointer;
	}
	.new-messages:hover { border-color: var(--accent); color: var(--accent); }
	.msg { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; max-width: 80%; }
	/* Allineamento per AUTORE: i miei a destra, la controparte a sinistra
	   (vale per DM e canali di gruppo). Il bordo accent resta segnale per gli AI. */
	.msg.mine { align-self: flex-end; }
	.msg:not(.mine) { align-self: flex-start; }
	.msg.ai { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
	.msg.system {
		align-self: center;
		max-width: 92%;
		background: color-mix(in srgb, var(--accent) 7%, var(--card-bg));
		border-style: dashed;
		color: var(--muted);
	}
	.system-icon { font-size: 0.9rem; }
	.msg-head { display: flex; gap: 7px; align-items: center; }
	.message-feedback { display: flex; align-items: center; gap: 3px; margin-top: 5px; min-height: 24px; }
	.message-feedback button { border: 0; border-radius: 999px; padding: 2px 6px; background: transparent; opacity: .55; cursor: pointer; filter: grayscale(1); }
	.message-feedback button:hover, .message-feedback button.on { opacity: 1; filter: none; background: rgba(127,127,127,.12); }
	.message-feedback button:disabled { cursor: wait; }
	.message-feedback span { margin-left: 4px; color: var(--fg-muted); font-size: 10px; }
	.author { font-weight: 700; font-size: 12.5px; }
	.reply-btn, .copy-btn { background: transparent; border: none; color: var(--fg-muted); cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 4px; border-radius: 5px; opacity: 0; transition: opacity .12s ease, background .12s ease; }
	.copy-btn { margin-left: auto; }
	.msg:hover .reply-btn, .msg:hover .copy-btn, .copy-btn.copied { opacity: 1; }
	.reply-btn:hover, .copy-btn:hover { background: rgba(255,107,61,.12); color: var(--accent); }
	/* blocco Routing (quale agente risponde e perché) */
	.routing { margin: 4px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-subtle, rgba(127,127,127,.06)); font-size: 12px; }
	.routing.fallback { border-color: color-mix(in srgb, #f59e0b 65%, var(--border)); background: color-mix(in srgb, #f59e0b 7%, var(--card-bg)); }
	.routing-feedback-prompt { margin: 0 0 8px; padding: 7px 9px; border-radius: 6px; background: color-mix(in srgb, #f59e0b 12%, transparent); color: var(--fg); line-height: 1.4; }
	.routing-correct { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
	.rc-label { font-size: 11px; color: var(--fg-muted); }
	.rc-chip { font: inherit; font-size: 11px; padding: 3px 9px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--fg); cursor: pointer; }
	.rc-chip:hover { border-color: var(--accent); color: var(--accent); }
	.rc-confirm { border-color: color-mix(in srgb, #22c55e 60%, var(--border)); color: #22c55e; }
	.rc-done { font-size: 11px; color: #4ade80; }
	.routing-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; background: none; border: 0; cursor: pointer; color: var(--fg); text-align: left; }
	.routing-head .caret { transition: transform .15s; color: var(--fg-muted); }
	.routing-head .caret.open { transform: rotate(90deg); }
	.routing-title { font-weight: 500; }
	.routing-why { color: var(--fg-muted); flex: 1; font-style: italic; }
	.routing-hint { margin-left: auto; color: var(--fg-muted); font-size: 11px; opacity: .7; }
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

	/* La risposta live usa la stessa bubble AI della timeline e cresce naturalmente. */
	.live-message { flex: none; }
	.live-badge { display: inline-flex; align-items: center; gap: 5px; color: var(--fg-muted); font-size: 10px; font-weight: 600; }
	.streaming-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--accent); animation: stream-pulse 1.2s ease-in-out infinite; }
	@keyframes stream-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }

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
	.route-pills { padding-top: 6px; border-top: 1px dashed var(--border); }
	.route-done { font-size: 12px; color: var(--fg-muted); }

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
	.composer textarea { flex: 1 1 auto; min-width: 0; background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 8px; resize: none; }
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
	.prov-tag { font-size: 10px; margin-left: 4px; color: #d97706; cursor: help; }
	.prov-tag.unknown { color: var(--fg-muted); }
	.prov-backdrop { position: fixed; inset: 0; z-index: 75; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.55); }
	.prov-modal { width: min(520px, 100%); background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 18px; box-shadow: 0 18px 55px rgba(0,0,0,.45); }
	.prov-modal h2 { margin: 0 0 6px; font-size: 15px; }
	.prov-files { margin: 0 0 10px; font-size: 12px; color: var(--fg-muted); word-break: break-all; }
	.prov-why { margin: 0 0 14px; font-size: 12px; line-height: 1.5; color: var(--fg-muted); }
	.prov-actions { display: flex; flex-direction: column; gap: 8px; }
	/* Le due scelte hanno lo STESSO peso tipografico: enfatizzarne una la
	   trasformerebbe nel default da cliccare senza leggere, che è il modo di
	   rendere la classificazione inutile. */
	.prov-actions button { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 10px 12px; font: inherit; font-size: 13px; color: var(--fg); background: transparent; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; }
	.prov-actions button:hover { border-color: var(--accent); }
	.prov-actions small { font-size: 11px; color: var(--fg-muted); }
	.prov-cancel { margin: 12px 0 0; padding: 0; font: inherit; font-size: 12px; color: var(--fg-muted); background: none; border: none; cursor: pointer; }
	.prov-cancel:hover { color: var(--fg); }
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
	.sync-status { margin-top: 0; }
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
	.remote-panel { margin-top: 0; }
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
	.remote-actions button, .remote-open { font-size: 12px; padding: 4px 9px; border: 1px solid var(--border); background: transparent; color: var(--fg); border-radius: 7px; cursor: pointer; }
	.remote-open { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }
	.remote-actions button:hover:not(:disabled), .remote-open:hover { border-color: var(--accent); color: var(--accent); }
	.remote-actions button:disabled { opacity: .5; cursor: default; }
	.remote-actions button.danger:hover:not(:disabled) { border-color: var(--danger); color: var(--danger); }
	.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; margin-bottom: 6px; font-size: 11.5px; }
	.files-error {
		margin: 6px 0 8px;
		padding: 7px 9px;
		border: 1px solid var(--warn, #e0a800);
		border-radius: 4px;
		background: color-mix(in srgb, var(--warn, #e0a800) 8%, transparent);
		color: var(--fg);
		font-size: 12px;
		line-height: 1.45;
	}
	.files-spinner { width: 12px; height: 12px; margin-left: 6px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: files-spin .7s linear infinite; flex: none; }
	@keyframes files-spin { to { transform: rotate(360deg); } }
	.files.loading { opacity: .55; pointer-events: none; }
	.crumb { background: transparent; border: none; color: var(--fg-muted); cursor: pointer; padding: 1px 3px; border-radius: 4px; font: inherit; font-size: 11.5px; }
	.crumb:hover { color: var(--accent); }
	.crumb-sep { color: var(--fg-muted); opacity: .6; }
	.dir { background: transparent; border: none; color: var(--fg); cursor: pointer; font: inherit; font-size: 12px; padding: 0; text-align: left; }
	.dir:hover { color: var(--accent); }
	/* Link "apri su Drive" accanto a una cartella navigabile: discreto, non deve
	   competere col nome, che è l'azione primaria (navigare). */
	.ext { color: var(--muted); font-size: 11px; margin-left: 4px; text-decoration: none; }
	.ext:hover { color: var(--accent); }
	/* Larghezza via inline style (resize); flex:0 0 evita che venga compressa.
	   height:100% + min-height:0 → occupa tutta l'altezza del .body e scrolla
	   internamente invece di allungare la pagina. */
	.side { flex: 0 0 220px; width: 220px; height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
	.side-section { flex: none; min-width: 0; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
	.side-section > summary {
		min-height: 30px;
		padding: 6px 2px;
		color: var(--fg-muted);
		cursor: pointer;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: .06em;
		user-select: none;
	}
	.side-section > summary::marker { color: var(--fg-muted); }
	.side-section > summary:hover { color: var(--fg); }
	.side-section > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
	.side-section[open] > summary { margin-bottom: 6px; }
	.section-count, .section-status {
		float: right;
		margin-left: 6px;
		padding: 1px 6px;
		border-radius: 999px;
		background: rgba(127,127,127,.14);
		color: var(--fg-muted);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0;
		text-transform: none;
	}
	.file-remote { display: flex; justify-content: flex-end; min-width: 0; margin: -2px 0 6px; }
	.topic-meta { display: flex; flex-direction: column; gap: 8px; }
	.meta-field { display: grid; grid-template-columns: 58px minmax(0, 1fr); align-items: center; gap: 8px; margin: 6px 0; font-size: 12px; color: var(--fg-muted); }
	.meta-field > span:first-child { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
	.meta-field select,
	.meta-field input {
		width: 100%;
		min-width: 0;
		height: 28px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
		color: var(--fg);
		font: inherit;
		font-size: 12px;
		padding: 0 8px;
	}
	.meta-field select:disabled,
	.meta-field input:disabled { opacity: .55; }
	.meta-value { color: var(--fg); }
	.deadline-edit { display: flex; align-items: center; gap: 4px; min-width: 0; }
	.deadline-edit button {
		flex: none;
		width: 28px;
		height: 28px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: transparent;
		color: var(--fg-muted);
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
	}
	.deadline-edit button:hover:not(:disabled) { color: var(--fg); border-color: var(--accent); }

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
	.parts, .files { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
	.feedback-lessons { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 7px; }
	.feedback-lessons li { padding: 7px 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--card-bg); font-size: 11px; }
	.lesson-head { display: flex; justify-content: space-between; gap: 6px; font-weight: 700; }
	.lesson-head button { border: 0; background: transparent; color: var(--fg-muted); cursor: pointer; font-size: 15px; line-height: 1; }
	.feedback-lessons p { margin: 5px 0 0; line-height: 1.4; white-space: pre-wrap; }
	.feedback-lessons small { display: block; margin-top: 5px; color: var(--fg-muted); font-style: italic; }
	.lesson-error { color: var(--danger); }
	.parts li { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 12.5px; }
	.part-id { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
	.part-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.part-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* Presenza: quattro stati, quattro colori, e nessuno che si legge come un
	   guasto. Il grigio è PIENO e non un cerchio vuoto: un contorno senza
	   riempimento somiglia a qualcosa che non ha finito di caricare, e un
	   indicatore che sembra rotto viene ignorato anche quando dice il vero. */
	.presenza {
		display: inline-block; width: 7px; height: 7px; border-radius: 50%;
		margin-right: 5px; vertical-align: 1px; flex: none;
	}
	.presenza-here { background: #16a34a; }        /* qui, in primo piano */
	.presenza-elsewhere { background: #eab308; }   /* nella webui, altro canale */
	.presenza-background { background: #3b82f6; }  /* webui aperta, guarda altro */
	.presenza-away { background: var(--border); }  /* non collegato */
	/* Termometro di contesto: occupazione della finestra del modello dell'agente. */
	.ctx-bar { display: block; width: 84px; height: 3px; border-radius: 2px; background: var(--border); overflow: hidden; }
	.ctx-fill { display: block; height: 100%; border-radius: 2px; transition: width .3s ease, background .3s ease; }
	/* Super-nodo multi-spawn (A13): il seed, e sotto una riga per istanza con
	   ordinale e stato. Rientrate sotto l'avatar così si legge la gerarchia
	   senza bisogno di una linea di collegamento. */
	.spawn-rows {
		list-style: none;
		margin: 2px 0 4px 30px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.spawn-row {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		opacity: 0.75;
	}
	.spawn-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.35;
		flex: none;
	}
	/* `working` è l'unico stato che si accende: una riga che pulsa quando NON
	   sta lavorando renderebbe il segnale inutile proprio quando serve. */
	.spawn-dot.working {
		opacity: 1;
		background: #22c55e;
		animation: spawn-pulse 1.6s ease-in-out infinite;
	}
	@keyframes spawn-pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.35); }
	}
	.spawn-ord {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.spawn-state { opacity: 0.8; }

	.part-warn { flex-shrink: 0; font-size: 12px; cursor: help; margin-left: 2px; }
	/* Capacità dell'agente, non un punteggio: nessun bordo a pillola, che
	   leggerebbe come un valore. Sono icone accanto al nome. */
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

	/* Regole dello scope: distinte dai file del topic anche visivamente, perché
	   sono control-plane e non contenuto. */
	.rules-btn { display: inline-flex; align-items: center; gap: .4rem; background: none;
		border: 1px solid var(--border, #3a3a3a); border-radius: 6px; padding: .25rem .6rem;
		font: inherit; font-size: .82rem; color: inherit; cursor: pointer; opacity: .85; }
	.rules-btn:hover { opacity: 1; }
	.rules-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; }
	.rules-caret { opacity: .6; }
	.rules-panel { margin: .5rem 0 .25rem; padding: .7rem; border: 1px solid var(--border, #3a3a3a);
		border-radius: 8px; }
	.rules-note { margin: 0 0 .5rem; font-size: .8rem; opacity: .8; }
	.rules-legacy { margin: 0 0 .5rem; padding: .5rem .6rem; border-radius: 6px; font-size: .8rem;
		background: rgba(245, 158, 11, .12); border: 1px solid rgba(245, 158, 11, .4); }
	.rules-ta { width: 100%; box-sizing: border-box; font-family: ui-monospace, monospace;
		font-size: .82rem; padding: .5rem; border-radius: 6px;
		border: 1px solid var(--border, #3a3a3a); background: transparent; color: inherit; }
	.rules-actions { display: flex; align-items: center; gap: .5rem; margin-top: .5rem; flex-wrap: wrap; }
	.rules-hint { font-size: .76rem; opacity: .65; }

	/* Control-plane in sola lettura dentro Meta: si legge, non si naviga. */
	.meta-doc { margin-top: .5rem; }
	.meta-doc > summary { cursor: pointer; font-size: .78rem; opacity: .8;
		display: flex; justify-content: space-between; gap: .5rem; }
	.meta-doc > summary:hover { opacity: 1; }
	.meta-doc-size { opacity: .55; font-variant-numeric: tabular-nums; }
	.meta-doc-body { margin: .35rem 0 0; padding: .5rem; border-radius: 6px;
		border: 1px solid var(--border, #3a3a3a); background: transparent;
		font-family: ui-monospace, monospace; font-size: .72rem; line-height: 1.45;
		max-height: 16rem; overflow: auto; white-space: pre-wrap; word-break: break-word; }
	.meta-doc-empty { margin: .35rem 0 0; font-size: .76rem; opacity: .6; }

	/* Credenziale di scope: la provenienza si vede, il valore mai. */
	.cred-hint { margin: .3rem 0 0; font-size: .72rem; opacity: .7; line-height: 1.4; }
	.cred-source { display: inline-flex; align-items: center; gap: .3rem;
		font-size: .72rem; padding: .1rem .4rem; border-radius: 4px; }
	.cred-source.scope { background: rgba(34, 197, 94, .14); border: 1px solid rgba(34, 197, 94, .4); }
	.cred-source.platform { background: rgba(245, 158, 11, .12); border: 1px solid rgba(245, 158, 11, .4); }
	.cred-rotate { display: flex; gap: .4rem; margin-top: .4rem; flex-wrap: wrap; }
	.cred-rotate input, .cred-rotate textarea { flex: 1 1 10rem; min-width: 0;
		padding: .3rem .4rem;
		border-radius: 5px; border: 1px solid var(--border, #3a3a3a);
		background: transparent; color: inherit; font-size: .78rem; }
	/* Il bundle OAuth è JSON: monospazio, e larghezza piena — un consenso
	   incollato a metà è il modo più facile di sbagliarlo. */
	.cred-rotate textarea { flex-basis: 100%; font-family: ui-monospace, monospace;
		resize: vertical; }
	.link-btn { background: none; border: none; padding: 0 0 0 .4rem; font: inherit;
		font-size: .72rem; color: inherit; opacity: .7; cursor: pointer;
		text-decoration: underline; }
	.link-btn:hover { opacity: 1; }

	/* Nota esplicativa sotto un campo meta: dice cosa comporta la scelta. */
	.meta-note { font-size: 11px; opacity: .7; margin: 2px 0 8px; line-height: 1.4; }

	/* Il gruppo Telegram dello scope: mappa uid → utente, una riga per volta. */
	.tg-form { display: flex; flex-direction: column; gap: 6px; }

	/* Immagine del topic. */
	.topic-logo-big {
		display: block; max-width: 100%; max-height: 120px; margin: 4px 0 8px;
		border-radius: 8px; object-fit: contain;
	}
	.link-btn.disabled { opacity: 0.5; pointer-events: none; }

	/* Proxy: il contratto da consegnare a chi lo gestisce, e l'elenco di chi è
	   ammesso in questa stanza. */
	.mcp-config {
		margin: 6px 0; padding: 8px; border-radius: 6px;
		background: var(--surface-2, rgba(127, 127, 127, 0.12));
		font-size: 11px; line-height: 1.35; overflow-x: auto; white-space: pre;
		max-height: 220px; overflow-y: auto;
	}
	.mcp-list { list-style: none; margin: 4px 0; padding: 0; display: flex;
		flex-direction: column; gap: 4px; font-size: 12px; }
	.mcp-list li { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
	.mcp-list li.expired { opacity: 0.55; }
	.mcp-who { font-weight: 600; }
	.mcp-consent { display: flex; gap: 6px; align-items: flex-start;
		font-size: 12px; line-height: 1.35; }
	.tg-mode { display: flex; align-items: center; gap: 6px; font-size: 12px; }
	.tg-mode select { flex: 1; font: inherit; font-size: 12px; padding: 2px 4px;
		background: transparent; color: inherit;
		border: 1px solid var(--border, #3a3a3a); border-radius: 5px; }
	.tg-people { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
	.tg-people-h { font-size: 11px; opacity: .7; }
	.tg-row { display: flex; gap: 4px; }
	.tg-row input { flex: 1; min-width: 0; font: inherit; font-size: 12px;
		padding: 3px 5px; background: transparent; color: inherit;
		border: 1px solid var(--border, #3a3a3a); border-radius: 5px; }
	.tg-row button { border: none; background: none; color: inherit; opacity: .6;
		cursor: pointer; font-size: 14px; padding: 0 4px; }
	.tg-row button:hover { opacity: 1; }

	/* Cosa attraversa il gate: sotto la domanda, prima dei bottoni. */
	.gate-crosses { display: block; font-size: 11px; opacity: .75; margin-top: 4px; }

	/* I mount dello scope: si sceglie quale guarda il pannello. */
	.mount-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 8px; }
	.mount-chip {
		font-size: 11px; padding: 2px 8px; border-radius: 10px; cursor: pointer;
		border: 1px solid var(--border, #d0d0d0); background: transparent;
		color: inherit; opacity: 0.7;
	}
	.mount-chip.sel { opacity: 1; border-color: currentColor; font-weight: 600; }

	/* Ruolo nello scope: si vede sempre, si cambia solo se sei l'owner. */
	.role-sel { font-size: .7rem; padding: .1rem .2rem; border-radius: 4px;
		border: 1px solid var(--border, #3a3a3a); background: transparent;
		color: inherit; opacity: .75; }
	.role-sel:hover { opacity: 1; }
	.role-fixed { font-size: .7rem; opacity: .55; padding: 0 .3rem; }
</style>
