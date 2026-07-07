<script lang="ts">
	import { page } from '$app/stores';
	import { apiGet, API_BASE_URL, ApiError, updateAgent, patchAgentSettings, getAdminState, getConnectors, grantConnector, generateAgentPfp, getAgentPfpStatus, getAgentProfile, setAgentProfile, grantAgentProfile, getAgents, listProfileFiles, uploadProfileFile, deleteProfileFile, downloadProfileFile, selectAgentProvider, type ProfileFile, type Connector, type AgentProfile } from '$lib/api/client';
	import { session } from '$lib/auth/session';
	import Modal from '$lib/components/Modal.svelte';
	import type {
		Agent,
		AgentActivityEvent,
		AgentActivityResponse
	} from '$lib/api/types';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import AgentName from '$lib/components/AgentName.svelte';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { toastSuccess, toastError } from '$lib/stores/toasts';

	$: name = $page.params.name ?? '';

	type Tab = 'definition' | 'logs' | 'memories' | 'system-prompt' | 'profile';
	let tab: Tab = 'definition';

	/** Formatta una data ISO in gg/mm/aaaa (per validità certificato PKI). */
	function fmtDate(iso?: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? iso
			: d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	// "Edit system prompt" form state. The agent-server does not expose a
	// PATCH endpoint for agents today; the form ships nonetheless so the
	// UI surface is ready. On submit the server replies with 405 / 404 and
	// we surface a clear "endpoint not exposed" guidance with copy-to-disk
	// instructions, mirroring how the daemons log viewer degrades.
	let editMode = false;
	let editBuffer = '';
	let editSubmitting = false;
	let editUnsupported = false;
	let editError: string | null = null;

	function enterEdit() {
		if (detail.kind !== 'ok') return;
		editBuffer = promptBody;
		editMode = true;
		editUnsupported = false;
		editError = null;
	}

	function cancelEdit() {
		if (editSubmitting) return;
		editMode = false;
		editError = null;
	}

	async function submitEdit() {
		if (detail.kind !== 'ok' || editSubmitting) return;
		editSubmitting = true;
		editError = null;
		editUnsupported = false;
		try {
			await updateAgent(name, { system_prompt: editBuffer } as Partial<Agent>);
			toastSuccess(`Prompt aggiornato per "${name}"`);
			editMode = false;
			await loadDetail(name);
		} catch (err) {
			if (err instanceof ApiError && (err.status === 405 || err.status === 404)) {
				editUnsupported = true;
			} else {
				editError = err instanceof Error ? err.message : String(err);
				toastError('Errore aggiornamento prompt', editError);
			}
		} finally {
			editSubmitting = false;
		}
	}

	type DetailState =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; agent: Agent }
		| { kind: 'error'; message: string; status?: number };

	type ActivityState =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; events: ReadonlyArray<AgentActivityEvent> }
		| { kind: 'error'; message: string; status?: number };

	type MemoryFile = { name: string; body: string };
	type MemoriesState =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; index: string | null; files: MemoryFile[] }
		| { kind: 'error'; message: string; status?: number };

	let detail: DetailState = { kind: 'idle' };
	let activity: ActivityState = { kind: 'idle' };
	let memories: MemoriesState = { kind: 'idle' };
	let promptBody = '';
	let promptError = '';

	// PFP: presenza + flusso "Genera avatar" (quando non disponibile).
	let hasPfp: boolean | null = null;
	let pfpModalOpen = false;
	let pfpPrompt = '';
	let pfpDataUrl: string | null = null;
	let pfpFileName = '';
	let pfpBusy = false;
	let pfpGenerating = false; // generazione in corso in BACKGROUND (modale chiuso)
	let pfpError = '';

	async function checkPfp(n: string) {
		hasPfp = null;
		try {
			const r = await fetch(`${API_BASE_URL}/api/agents/${encodeURIComponent(n)}/pfp`, {
				method: 'GET'
			});
			hasPfp = r.ok;
		} catch {
			hasPfp = false;
		}
	}

	function onPfpFile(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) {
			pfpDataUrl = null;
			pfpFileName = '';
			return;
		}
		pfpFileName = f.name;
		const reader = new FileReader();
		reader.onload = () => (pfpDataUrl = typeof reader.result === 'string' ? reader.result : null);
		reader.readAsDataURL(f);
	}

	function openPfp() {
		pfpPrompt = '';
		pfpDataUrl = null;
		pfpFileName = '';
		pfpError = '';
		pfpModalOpen = true;
	}

	async function submitPfp() {
		if (!pfpPrompt.trim() && !pfpDataUrl) {
			pfpError = 'Inserisci un prompt o carica un’immagine.';
			return;
		}
		pfpBusy = true;
		pfpError = '';
		try {
			await generateAgentPfp(name, {
				prompt: pfpPrompt.trim() || undefined,
				imageB64: pfpDataUrl || undefined
			});
		} catch (err) {
			// Errore già all'avvio (es. 409 OpenAI non attivo): resta nel modale.
			pfpBusy = false;
			pfpError = err instanceof ApiError || err instanceof Error ? err.message : String(err);
			return;
		}
		// Avviata: CHIUDO subito il modale e seguo lo stato in BACKGROUND, così la
		// UI resta pienamente utilizzabile durante i ~20s di generazione.
		pfpBusy = false;
		pfpModalOpen = false;
		pfpGenerating = true;
		toastSuccess('Generazione avatar avviata', 'puoi continuare a lavorare, ~20s');
		void pollPfp();
	}

	async function pollPfp() {
		for (let i = 0; i < 90; i++) {
			await new Promise((r) => setTimeout(r, 2000));
			let st;
			try {
				st = await getAgentPfpStatus(name);
			} catch {
				continue; // rete transitoria: riprova
			}
			if (st.state === 'done') {
				pfpGenerating = false;
				toastSuccess('Avatar pronto', 'stile manga/ghibli');
				location.reload(); // mostra la nuova pfp (bust cache)
				return;
			}
			if (st.state === 'error') {
				pfpGenerating = false;
				toastError('Generazione avatar fallita', st.error || 'errore');
				return;
			}
		}
		pfpGenerating = false;
		toastError('Timeout generazione avatar', 'riprova più tardi');
	}

	async function loadDetail(n: string) {
		detail = { kind: 'loading' };
		promptBody = '';
		promptError = '';
		memories = { kind: 'idle' };   // ricaricata pigramente all'apertura del tab
		try {
			const data = await apiGet<Agent>(`/api/agents/${encodeURIComponent(n)}`);
			detail = { kind: 'ok', agent: data };
			// Il body del prompt arriva da un endpoint dedicato (il GET /{name}
			// espone solo il nome file).
			try {
				const sp = await apiGet<{ body?: string }>(
					`/api/agents/${encodeURIComponent(n)}/system-prompt`
				);
				promptBody = sp?.body ?? '';
			} catch (e) {
				promptError = e instanceof Error ? e.message : String(e);
			}
		} catch (err) {
			detail = toErr(err) as DetailState;
		}
	}

	// --- Selezione manuale del provider (override operativo, anche sui super) ---
	let providerBusy = '';
	async function selectProvider(pid: string | null) {
		if (!agent) return;
		providerBusy = pid ?? '__auto__';
		try {
			await selectAgentProvider(agent.name, pid);
			toastSuccess(pid ? `Provider impostato: ${pid}` : 'Override rimosso (torna alla preferenza)');
			await loadDetail(agent.name);   // ricarica per riflettere effective/selected
		} catch (e) {
			toastError(e instanceof Error ? e.message : String(e));
		} finally {
			providerBusy = '';
		}
	}

	async function loadActivity(n: string) {
		activity = { kind: 'loading' };
		try {
			const data = await apiGet<AgentActivityResponse>(
				`/api/agents/${encodeURIComponent(n)}/activity`
			);
			const events = Array.isArray(data?.events) ? data.events : [];
			activity = { kind: 'ok', events };
		} catch (err) {
			activity = toErr(err) as ActivityState;
		}
	}

	async function loadMemories(n: string) {
		memories = { kind: 'loading' };
		try {
			const d = await apiGet<{ index: string | null; files: MemoryFile[] }>(
				`/api/agents/${encodeURIComponent(n)}/memories`
			);
			memories = {
				kind: 'ok',
				index: d?.index ?? null,
				files: Array.isArray(d?.files) ? d.files : []
			};
		} catch (err) {
			memories = toErr(err) as MemoriesState;
		}
	}

	function toErr(err: unknown): { kind: 'error'; message: string; status?: number } {
		if (err instanceof ApiError) return { kind: 'error', message: err.message, status: err.status };
		if (err instanceof Error) return { kind: 'error', message: err.message };
		return { kind: 'error', message: String(err) };
	}

	async function reloadAll() {
		if (!name) return;
		await Promise.all([loadDetail(name), loadActivity(name)]);
	}

	// React to route param changes (Svelte 5 / SvelteKit handles `name` reactively).
	$: if (name) {
		void loadDetail(name);
		void loadActivity(name);
		void checkPfp(name);
		if (isAdmin) void loadConnectors();
	}

	// --- Impostazioni agent (solo admin): meta + contatti + model/sdk ---
	let isAdmin = false;
	// --- Profilo dati personali (PII) ---
	$: isSelf = !!$session && $session.principal === name;
	$: canManageProfile = isAdmin || isSelf;
	let profile: AgentProfile | null = null;
	let profileErr = '';
	const PROFILE_FIELDS = ['email', 'pec', 'telefono', 'iban', 'codice_fiscale', 'domicilio'];
	let pf: Record<string, string> = {};
	let pfBusy = false;
	let granteeInput = '';
	let newFieldKey = '';
	let agentNames: string[] = [];
	$: customKeys = Object.keys(pf).filter((k) => !PROFILE_FIELDS.includes(k));
	function addCustomField() {
		const k = newFieldKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
		if (!k || k in pf) { newFieldKey = ''; return; }
		pf = { ...pf, [k]: '' };
		newFieldKey = '';
	}
	function removeField(k: string) {
		const { [k]: _drop, ...rest } = pf;
		pf = rest;
	}
	async function loadAgentNames() {
		try { agentNames = (await getAgents()).map((a) => a.name); } catch { agentNames = []; }
	}
	// --- allegati del profilo ---
	let pFiles: ProfileFile[] = [];
	let pfUploading = false;
	let pfFileInput: HTMLInputElement;
	async function loadProfileFiles() {
		try { pFiles = await listProfileFiles(name); } catch { pFiles = []; }
	}
	async function onProfileUpload(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) return;
		pfUploading = true;
		try {
			const b64 = await new Promise<string>((res, rej) => {
				const r = new FileReader();
				r.onload = () => res((r.result as string).split(',')[1] ?? '');
				r.onerror = rej; r.readAsDataURL(f);
			});
			await uploadProfileFile(name, f.name, b64);
			toastSuccess('File allegato', f.name);
			await loadProfileFiles();
		} catch (err) { toastError('Upload fallito', err instanceof ApiError ? err.message : String(err)); }
		finally { pfUploading = false; if (pfFileInput) pfFileInput.value = ''; }
	}
	async function removeProfileFile(fn: string) {
		try { await deleteProfileFile(name, fn); await loadProfileFiles(); }
		catch (err) { toastError('Eliminazione fallita', err instanceof ApiError ? err.message : String(err)); }
	}
	async function dlProfileFile(fn: string) {
		try { await downloadProfileFile(name, fn); }
		catch (err) { toastError('Download fallito', err instanceof ApiError ? err.message : String(err)); }
	}
	async function loadProfile() {
		profileErr = '';
		try {
			profile = await getAgentProfile(name);
			pf = { ...profile.fields };
			for (const k of PROFILE_FIELDS) if (!(k in pf)) pf[k] = '';
		} catch (e) {
			profile = null;
			profileErr = e instanceof ApiError ? e.message : String(e);
		}
	}
	async function saveProfile() {
		pfBusy = true;
		try {
			const fields: Record<string, string | null> = {};
			for (const k of Object.keys(pf)) fields[k] = pf[k]?.trim() ? pf[k].trim() : null;
			profile = await setAgentProfile(name, fields);
			pf = { ...profile.fields };
			for (const k of PROFILE_FIELDS) if (!(k in pf)) pf[k] = '';
			toastSuccess('Profilo salvato', 'dati personali aggiornati nel vault');
		} catch (e) { toastError('Salvataggio fallito', e instanceof ApiError ? e.message : String(e)); }
		finally { pfBusy = false; }
	}
	async function addGrant() {
		if (!granteeInput.trim()) return;
		try { profile = await grantAgentProfile(name, granteeInput.trim(), true); granteeInput = ''; toastSuccess('Accesso concesso', ''); }
		catch (e) { toastError('Grant fallito', e instanceof ApiError ? e.message : String(e)); }
	}
	async function removeGrant(g: string) {
		try { profile = await grantAgentProfile(name, g, false); toastSuccess('Accesso revocato', g); }
		catch (e) { toastError('Revoca fallita', e instanceof ApiError ? e.message : String(e)); }
	}
	$: if (tab === 'profile' && profile === null && name) { void loadProfile(); void loadAgentNames(); void loadProfileFiles(); }
	$: if (tab === 'memories' && memories.kind === 'idle' && name) void loadMemories(name);
	(async () => {
		try {
			const st = await getAdminState();
			isAdmin = !!$session && st.admins.includes($session.principal);
			if (isAdmin) void loadConnectors();
		} catch {
			isAdmin = false;
		}
	})();

	// Connettori email delegabili a questo agent (solo admin).
	let connectors: Connector[] = [];
	let connBusy = '';
	const isSuperAgent = (a: Agent | undefined) => a?.type === 'super';
	async function loadConnectors() {
		if (!name) return;
		try {
			connectors = await getConnectors(name);
		} catch {
			connectors = [];
		}
	}
	async function toggleConnector(account: string, granted: boolean) {
		if (connBusy) return;
		connBusy = account;
		try {
			await grantConnector(name, account, granted);
			await loadConnectors();
			toastSuccess(`${account}: ${granted ? 'abilitato' : 'disabilitato'} per ${name}`);
		} catch (e) {
			toastError('Grant fallito', e instanceof ApiError || e instanceof Error ? e.message : String(e));
		} finally {
			connBusy = '';
		}
	}

	let settingsOpen = false;
	let sSaving = false;
	let sErr = '';
	let sForm = {
		display_name: '', description: '', avatar_color: '', clearance: '',
		email: '', telegram: '', model: '', agent_sdk: '', mailbox_parent: ''
	};

	function openSettings() {
		if (detail.kind !== 'ok') return;
		const a = detail.agent;
		sForm = {
			display_name: a.display_name ?? '',
			description: a.description ?? '',
			avatar_color: a.avatar_color ?? '',
			clearance: a.clearance ?? '',
			email: a.email ?? '',
			telegram: a.telegram ?? '',
			model: a.model ?? '',
			agent_sdk: a.agent_sdk ?? '',
			mailbox_parent: a.mailbox_parent ?? ''
		};
		sErr = '';
		settingsOpen = true;
	}

	async function saveSettings() {
		if (sSaving) return;
		sSaving = true;
		sErr = '';
		try {
			// invia tutti i campi (stringa vuota = azzera lato server)
			await patchAgentSettings(name, { ...sForm });
			toastSuccess(`Impostazioni aggiornate per "${name}"`);
			settingsOpen = false;
			await loadDetail(name);
		} catch (e) {
			sErr = e instanceof ApiError || e instanceof Error ? e.message : String(e);
			toastError('Salvataggio fallito', sErr);
		} finally {
			sSaving = false;
		}
	}

	// Lo stato "running" era derivato dall'inbox-consumer (rimosso).
	const runState: 'idle' | 'running' | 'unknown' = 'idle';

	function fmtTs(ts: string | null | undefined): string {
		if (!ts) return '';
		try {
			const d = new Date(ts);
			if (Number.isNaN(d.getTime())) return ts;
			return d.toLocaleString(undefined, {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			});
		} catch {
			return ts;
		}
	}

	function summariseEvent(ev: AgentActivityEvent): string {
		const p = ev.payload || {};
		switch (ev.type) {
			case 'run_started':
				// nuovo (chat/canale): prompt + chi ha scritto; fallback al vecchio (colonia)
				if (p.prompt !== undefined)
					return `${p.principal ? `@${p.principal}: ` : ''}${p.prompt || '(vuoto)'}`;
				return `From ${p.from ?? '?'} (inbox ${p.inbox ?? '?'})${
					p.card_name ? ` — ${p.card_name}` : ''
				}`;
			case 'run_done':
				if (p.reply !== undefined) {
					const u = p.usage as { output_tokens?: number } | null | undefined;
					return `${p.reply || '(nessuna risposta)'}${
						u?.output_tokens ? ` · ${u.output_tokens} tok` : ''
					}`;
				}
				return `Duration ${p.duration_s ?? '?'}s · actions ${
					Array.isArray(p.actions) ? p.actions.length : '?'
				} · errors ${p.errors ?? 0}`;
			case 'error':
				return `${p.error ?? 'errore'}`;
			case 'message_sent':
				return `→ ${p.to ?? '?'}: ${p.text || ''}`;
			case 'handoff_comment':
				return `Comment posted (${p.length ?? '?'} chars)`;
			case 'handoff_attach':
				return `Attached file: ${p.file ?? '?'}`;
			case 'handoff_move':
				return `Moved to ${p.to_inbox ?? '?'} via ${p.via ?? '?'}`;
			case 'handoff_fork':
				return `Forked subtask to ${p.to_agent ?? '?'} (${p.sub_card_id ?? '?'})`;
			case 'handoff_archive':
				return `Archived${p.closed ? ' (closed)' : ''}`;
			default:
				return Object.keys(p).length ? JSON.stringify(p) : '';
		}
	}

	function eventTone(type: string): 'neutral' | 'good' | 'warn' | 'info' {
		if (type === 'run_started') return 'info';
		if (type === 'run_done') return 'good';
		if (type === 'message_sent') return 'info';
		if (type === 'error') return 'warn';
		if (type === 'handoff_move' || type === 'handoff_fork') return 'info';
		return 'neutral';
	}

	function lastN<T>(arr: ReadonlyArray<T>, n: number): T[] {
		return arr.slice(Math.max(0, arr.length - n));
	}

	$: agent = detail.kind === 'ok' ? detail.agent : null;
	// I principal UMANI non sono eseguiti: niente system prompt. Il tab Logs resta
	// (mostra le azioni dell'utente). Se eravamo sul tab system-prompt, torna a definition.
	$: isHuman = agent?.type === 'human';
	$: if (isHuman && tab === 'system-prompt') tab = 'definition';
	$: events = activity.kind === 'ok' ? activity.events : [];
	// Newest first
	$: eventsReversed = [...events].reverse();
</script>

<header class="head">
	<div class="head-left">
		<a class="back" href="/agents">← All agents</a>
		<div class="title-row">
			{#if agent}
				<div class="avatar-wrap">
					<AgentAvatar
						name={agent.name}
						displayName={agent.display_name}
						color={agent.avatar_color}
						size={80}
					/>
					{#if pfpGenerating}
						<span class="gen-pfp busy" title="Generazione avatar in corso">✨ Genero…</span>
					{:else if hasPfp === false}
						<button type="button" class="gen-pfp" on:click={openPfp} title="Genera avatar">
							✨ Genera avatar
						</button>
					{/if}
				</div>
			{:else}
				<Skeleton width="48px" height="48px" radius="50%" />
			{/if}
			<div class="title-text">
				<h1>
					<AgentName name={agent?.display_name?.trim() || agent?.name || name} />
				</h1>
				<div class="sub">
					<code class="mono"><AgentName name={name} muted /></code>
					{#if agent?.model}
						<span class="dot-sep">·</span>
						<span class="mono">{agent.model}</span>
					{/if}
					<span class="dot-sep">·</span>
					<StatusDot state={runState} />
				</div>
			</div>
		</div>
	</div>
	<div class="head-actions">
		{#if isAdmin}
			<button type="button" class="edit-btn" on:click={openSettings} disabled={detail.kind !== 'ok'}>✎ Modifica</button>
		{/if}
		<button type="button" on:click={reloadAll} disabled={detail.kind === 'loading'}>
			{detail.kind === 'loading' ? 'Loading…' : 'Reload'}
		</button>
	</div>
</header>

<Modal open={settingsOpen} dismissable={!sSaving} maxWidth={620} on:close={() => (settingsOpen = false)}>
	<span slot="title">Modifica agent · {name}</span>
	<div class="settings-form">
		<div class="sf-grid">
			<label>Display name<input type="text" bind:value={sForm.display_name} /></label>
			<label>Avatar color<input type="text" bind:value={sForm.avatar_color} placeholder="#888888" /></label>
			<label class="sf-wide">Descrizione<input type="text" bind:value={sForm.description} /></label>
			<label>Model<input type="text" bind:value={sForm.model} placeholder="claude-opus-4-8" /></label>
			<label>SDK<select bind:value={sForm.agent_sdk}><option value="">(invariato)</option><option value="claude">claude</option><option value="codex">codex</option></select></label>
			<label>Clearance<select bind:value={sForm.clearance}><option value="">(nessuna)</option><option value="SEAL-0">SEAL-0</option><option value="SEAL-1">SEAL-1</option><option value="SEAL-2">SEAL-2</option><option value="SEAL-3">SEAL-3</option><option value="SEAL-4">SEAL-4</option></select></label>
			<label>Mailbox parent<input type="text" bind:value={sForm.mailbox_parent} placeholder="clodia | ophelia" /></label>
			<label>Email<input type="text" bind:value={sForm.email} placeholder="nome@dominio" /></label>
			<label>Telegram <span class="opt">(opz.)</span><input type="text" bind:value={sForm.telegram} placeholder="@handle o chat_id" /></label>
		</div>
		<p class="sf-hint">Lascia un campo vuoto per azzerarlo. L'email dei regular, se vuota, viene derivata (subaddress di Clodia/Ophelia).</p>
		{#if sErr}<div class="sf-err">{sErr}</div>{/if}
	</div>
	<svelte:fragment slot="actions">
		<button type="button" class="sf-sec" on:click={() => (settingsOpen = false)} disabled={sSaving}>Annulla</button>
		<button type="button" class="sf-pri" on:click={saveSettings} disabled={sSaving}>{sSaving ? 'Salvataggio…' : 'Salva'}</button>
	</svelte:fragment>
</Modal>

<div class="tabs" role="tablist" aria-label="Sections">
	<button
		role="tab"
		aria-selected={tab === 'definition'}
		class:active={tab === 'definition'}
		on:click={() => (tab = 'definition')}
		type="button"
	>
		Definition
	</button>
	<button
		role="tab"
		aria-selected={tab === 'logs'}
		class:active={tab === 'logs'}
		on:click={() => (tab = 'logs')}
		type="button"
	>
		Logs
		{#if events.length}
			<span class="badge">{events.length}</span>
		{/if}
	</button>
	<button
		role="tab"
		aria-selected={tab === 'memories'}
		class:active={tab === 'memories'}
		on:click={() => (tab = 'memories')}
		type="button"
	>
		Memories
		{#if memories.kind === 'ok' && memories.files.length}
			<span class="badge">{memories.files.length}</span>
		{/if}
	</button>
	{#if !isHuman}
		<button
			role="tab"
			aria-selected={tab === 'system-prompt'}
			class:active={tab === 'system-prompt'}
			on:click={() => (tab = 'system-prompt')}
			type="button"
		>
			System Prompt
		</button>
	{/if}
	<button
		role="tab"
		aria-selected={tab === 'profile'}
		class:active={tab === 'profile'}
		on:click={() => (tab = 'profile')}
		type="button"
	>
		Dati personali
	</button>
</div>

<!-- DEFINITION ----------------------------------------------------------- -->
{#if tab === 'definition'}
	<section class="panel">
		{#if detail.kind === 'loading' || detail.kind === 'idle'}
			<div class="grid-two">
				<div class="row"><Skeleton width="40%" height="12px" /></div>
				<div class="row"><Skeleton width="80%" height="12px" /></div>
				<div class="row"><Skeleton width="30%" height="12px" /></div>
				<div class="row"><Skeleton width="60%" height="12px" /></div>
			</div>
		{:else if detail.kind === 'error' && detail.status === 403}
			<div class="status">
				<strong>Non autorizzato</strong>
				<div class="error-hint">Puoi vedere i dettagli solo del tuo profilo. Per gli altri profili serve un amministratore.</div>
				<a class="retry" href="/agents">← Torna agli agenti</a>
			</div>
		{:else if detail.kind === 'error'}
			<div class="status error">
				<strong>Failed to load agent.</strong>
				<div class="error-msg">{detail.message}</div>
				<button type="button" class="retry" on:click={reloadAll}>Retry</button>
			</div>
		{:else if agent}
			<dl class="def">
				{#if agent.description}
					<dt>Description</dt>
					<dd>{agent.description}</dd>
				{/if}

				{#if agent.type}
					<dt>Tipo <span class="hint-inline">(KYA)</span></dt>
					<dd><code>{agent.type}</code></dd>
				{/if}

				{#if agent.contact_channels && (agent.contact_channels.email || agent.contact_channels.telegram)}
					<dt>Canali di contatto</dt>
					<dd>
						{#if agent.contact_channels.email}
							<div>✉️ <a href={`mailto:${agent.contact_channels.email}`}>{agent.contact_channels.email}</a></div>
						{/if}
						{#if agent.contact_channels.telegram}
							<div>✈️ {agent.contact_channels.telegram}</div>
						{:else if agent.type === 'normal'}
							<div class="muted-note">Telegram: nessuno (gli agent regular usano solo l'email subaddress)</div>
						{/if}
					</dd>
				{/if}

				<dt>Costituzione</dt>
				<dd>
					{#if agent.constitution}
						<code>{agent.constitution}</code>
					{:else}
						<span class="muted-note">nessuna</span>
					{/if}
				</dd>

				{#if agent.parents && agent.parents.length}
					<dt>Lineage <span class="hint-inline">(parents)</span></dt>
					<dd>
						<ul class="chips">
							{#each agent.parents as p}
								<li><code>{p}</code></li>
							{/each}
						</ul>
					</dd>
				{/if}

				<dt>Model</dt>
				<dd>{agent.model ? agent.model : '—'}</dd>

				{#if agent.agent_sdk !== undefined}
					<dt>Agent SDK</dt>
					<dd><code>{agent.agent_sdk ?? '—'}</code></dd>
				{/if}

				{#if agent.provider_options && agent.provider_options.length}
					<dt>Provider <span class="hint-inline">(motore di inferenza)</span></dt>
					<dd>
						<div class="prov-picker">
							{#each agent.provider_options as opt}
								<button
									type="button"
									class="prov-opt"
									class:effective={opt.effective}
									class:selected={opt.selected}
									class:off={!opt.connected || opt.paused}
									disabled={!isAdmin || providerBusy !== '' || !opt.connected || opt.paused}
									title={opt.paused ? 'in pausa' : (!opt.connected ? 'non collegato' : (isAdmin ? 'attiva questo provider' : ''))}
									on:click={() => selectProvider(opt.id)}
								>
									<span class="prov-name">{opt.id}</span>
									{#if opt.seal}<span class="prov-seal">{opt.seal}</span>{/if}
									{#if opt.default}<span class="prov-tag" title="default (preferenza)">★</span>{/if}
									{#if opt.effective}<span class="prov-tag on">in uso</span>
									{:else if !opt.connected}<span class="prov-tag muted">off</span>
									{:else if opt.paused}<span class="prov-tag muted">pausa</span>{/if}
								</button>
							{/each}
						</div>
						{#if isAdmin && agent.provider_override}
							<button type="button" class="prov-auto" disabled={providerBusy !== ''} on:click={() => selectProvider(null)}>
								↺ segui la preferenza (rimuovi override)
							</button>
						{:else if !agent.provider_connected}
							<p class="muted-note">Nessun provider attivo → agent disabilitato. Collega o riattiva un provider dalla sezione Providers.</p>
						{/if}
					</dd>
				{/if}

				<dt>Identità PKI</dt>
				<dd>
					{#if agent.identity}
						<div class="identity">
							<span class="id-badge" class:revoked={agent.identity.revoked}>
								{agent.identity.revoked ? 'REVOCATO' : 'valido'}
							</span>
							<code class="fp" title={agent.identity.cert_fingerprint_sha256}>
								{agent.identity.cert_fingerprint_sha256.slice(0, 16)}…
							</code>
							{#if agent.identity.not_after}
								<span class="id-validity">scade {fmtDate(agent.identity.not_after)}</span>
							{/if}
						</div>
					{:else}
						<span class="muted-note">nessun certificato emesso</span>
					{/if}
				</dd>

				<dt>Capabilities (catalog skill)</dt>
				<dd>
					{#if agent.capabilities && agent.capabilities.length}
						<ul class="chips">
							{#each agent.capabilities as c}
								<li><code>{c === '*' ? 'tutte (catalog)' : c}</code></li>
							{/each}
						</ul>
					{:else}—{/if}
				</dd>

				<dt>Rules (catalog rule, path-triggered)</dt>
				<dd>
					{#if agent.rules && agent.rules.length}
						<ul class="chips">
							{#each agent.rules as r}
								<li><code>{r === '*' ? 'tutte (catalog)' : r}</code></li>
							{/each}
						</ul>
					{:else}—{/if}
				</dd>

				{#if agent.tool_permissions}
					<dt>Tools</dt>
					<dd>
						{#if agent.tool_permissions.length}
							<ul class="chips">
								{#each agent.tool_permissions as t}
									<li><code>{t === '*' ? 'tutti (gateway)' : t}</code></li>
								{/each}
							</ul>
						{:else}—{/if}
					</dd>
				{/if}

				<dt>Sandbox</dt>
				<dd>
					{#if agent.sandbox}
						<div class="sandbox">
							{#if agent.sandbox.allow_read?.length}
								<div class="sandbox-sec">
									<span class="sk">allow_read</span>
									<ul class="paths">
										{#each agent.sandbox.allow_read as p}
											<li><code>{p}</code></li>
										{/each}
									</ul>
								</div>
							{/if}
							{#if agent.sandbox.deny_read?.length}
								<div class="sandbox-sec">
									<span class="sk deny">deny_read</span>
									<ul class="paths">
										{#each agent.sandbox.deny_read as p}
											<li><code>{p}</code></li>
										{/each}
									</ul>
								</div>
							{/if}
							{#if agent.sandbox.allow_write?.length}
								<div class="sandbox-sec">
									<span class="sk">allow_write</span>
									<ul class="paths">
										{#each agent.sandbox.allow_write as p}
											<li><code>{p}</code></li>
										{/each}
									</ul>
								</div>
							{/if}
							{#if agent.sandbox.allow_shell_cmds?.length}
								<div class="sandbox-sec">
									<span class="sk">allow_shell_cmds</span>
									<ul class="chips">
										{#each agent.sandbox.allow_shell_cmds as c}
											<li><code>{c}</code></li>
										{/each}
									</ul>
								</div>
							{/if}
							{#if agent.sandbox.deny_shell_patterns?.length}
								<div class="sandbox-sec">
									<span class="sk deny">deny_shell_patterns</span>
									<ul class="chips">
										{#each agent.sandbox.deny_shell_patterns as c}
											<li><code>{c}</code></li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
					{:else}—{/if}
				</dd>

			</dl>

			{#if isAdmin}
				<section class="connectors">
					<h3>Connettori <span class="hint-inline">(delega per-agent)</span></h3>
					{#if isSuperAgent(agent)}
						<p class="conn-note">È un super-agent: ha accesso a <strong>tutti</strong> i connettori.</p>
					{:else if connectors.length === 0}
						<p class="conn-note">Nessun connettore nel vault. Connetti email o Trello dalla sezione Integrazioni.</p>
					{:else}
						<ul class="conn-list">
							{#each connectors as c (c.id)}
								<li class="conn-row">
									<span class="conn-id">{c.type === 'trello' ? '📋 Trello' : `✉️ ${c.id}`}</span>
									<label class="conn-toggle">
										<input type="checkbox" checked={c.granted} disabled={connBusy === c.id}
											on:change={(e) => toggleConnector(c.id, (e.target as HTMLInputElement).checked)} />
										<span>{c.granted ? 'abilitato' : 'non abilitato'}</span>
									</label>
								</li>
							{/each}
						</ul>
						<p class="conn-note">Abilitare un connettore concede a <strong>{name}</strong> i relativi tool (email send/receive o trello.*). Clodia e Ophelia hanno tutto di default.</p>
					{/if}
				</section>
			{/if}

			<details class="raw">
				<summary>Raw payload</summary>
				<pre>{JSON.stringify(agent, null, 2)}</pre>
			</details>
		{/if}
	</section>
{/if}

<!-- LOGS ----------------------------------------------------------------- -->
{#if tab === 'logs'}
	<section class="panel">
		{#if activity.kind === 'loading' || activity.kind === 'idle'}
			<ul class="log-list">
				{#each Array(5) as _}
					<li class="log-row skel-row">
						<Skeleton width="120px" height="12px" />
						<Skeleton width="80px" height="12px" />
						<Skeleton width="55%" height="12px" />
					</li>
				{/each}
			</ul>
		{:else if activity.kind === 'error'}
			<div class="status error">
				<strong>Failed to load activity.</strong>
				<div class="error-msg">{activity.message}</div>
				<button type="button" class="retry" on:click={() => loadActivity(name)}>Retry</button>
			</div>
		{:else if events.length === 0}
			<div class="status">
				<strong>No activity yet.</strong>
				<p class="hint">Events for <code>{name}</code> will appear here as the agent runs.</p>
			</div>
		{:else}
			<div class="log-summary">
				<span><strong>{events.length}</strong> events</span>
				<span class="dot-sep">·</span>
				<span>showing newest first</span>
			</div>
			<ul class="log-list">
				{#each eventsReversed as ev (ev.ts + ev.type + (ev.card_id ?? ''))}
					<li class="log-row">
						<time class="ts mono" title={ev.ts}>{fmtTs(ev.ts)}</time>
						<span class="type tone-{eventTone(ev.type)}">{ev.type}</span>
						<span class="summary">{summariseEvent(ev)}</span>
						{#if ev.card_id}
							<code class="card-id" title="card id">{ev.card_id}</code>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<!-- MEMORIES ------------------------------------------------------------- -->
{#if tab === 'memories'}
	<section class="panel">
		{#if memories.kind === 'loading' || memories.kind === 'idle'}
			<div class="row"><Skeleton width="70%" height="12px" /></div>
			<div class="row"><Skeleton width="90%" height="12px" /></div>
		{:else if memories.kind === 'error'}
			<p class="err">{memories.message}</p>
		{:else}
			{#if memories.index}
				<article class="mem-block">
					<h3 class="mem-h">MEMORY.md <span class="mem-tag">indice</span></h3>
					<pre class="mem-body">{memories.index}</pre>
				</article>
			{/if}
			{#each memories.files as f (f.name)}
				<article class="mem-block">
					<h3 class="mem-h">{f.name}</h3>
					<pre class="mem-body">{f.body}</pre>
				</article>
			{/each}
			{#if !memories.index && memories.files.length === 0}
				<p class="muted">Nessuna memoria ancora. Le memorie dell'agente compaiono qui man mano che ne accumula.</p>
			{/if}
		{/if}
	</section>
{/if}

<!-- SYSTEM PROMPT -------------------------------------------------------- -->
{#if tab === 'system-prompt'}
	<section class="panel">
		{#if detail.kind === 'loading' || detail.kind === 'idle'}
			<Skeleton width="100%" height="240px" radius="8px" />
		{:else if detail.kind === 'error' && detail.status === 403}
			<div class="status">
				<strong>Non autorizzato</strong>
				<div class="error-hint">Il system prompt è visibile solo sul tuo profilo.</div>
			</div>
		{:else if detail.kind === 'error'}
			<div class="status error">
				<strong>Failed to load agent.</strong>
				<div class="error-msg">{detail.message}</div>
			</div>
		{:else if agent}
			<div class="prompt-head">
				<div>
					<div class="prompt-placeholder-head">File name</div>
					<code class="mono">{agent.system_prompt ?? '(none declared)'}</code>
					{#if agent.agent_dir}
						<div class="hint-path">
							<span class="dim">at</span>
							<code>{agent.agent_dir}/{agent.system_prompt ?? ''}</code>
						</div>
					{/if}
				</div>
				{#if !editMode}
					<button type="button" class="edit-btn" on:click={enterEdit}>
						Modifica prompt
					</button>
				{/if}
			</div>

			{#if editMode}
				<div class="editor">
					<label class="editor-label" for="prompt-textarea">
						System prompt (markdown / testo libero)
					</label>
					<textarea
						id="prompt-textarea"
						class="mono"
						bind:value={editBuffer}
						rows="18"
						spellcheck="false"
						disabled={editSubmitting}
					></textarea>
					<div class="editor-actions">
						<button
							type="button"
							class="cancel"
							on:click={cancelEdit}
							disabled={editSubmitting}
						>
							Annulla
						</button>
						<button
							type="button"
							class="save"
							on:click={submitEdit}
							disabled={editSubmitting || editBuffer === promptBody}
						>
							{#if editSubmitting}
								<span class="spinner" aria-hidden="true"></span>
								Salvo…
							{:else}
								Salva (PATCH)
							{/if}
						</button>
					</div>

					{#if editUnsupported}
						<div class="status warn">
							<strong>L'agent-server non espone ancora PATCH /api/agents/{name}.</strong>
							<p>
								Per ora aggiorna il file
								<code>{agent.agent_dir ?? '/clodia/agents/' + name}/{agent.system_prompt ?? 'system-prompt.md'}</code>
								sul disco e premi <strong>Reload registry</strong> nella lista
								agenti. Il body modificato è qui sotto, pronto per essere copiato:
							</p>
							<details class="copy">
								<summary>Mostra body candidato</summary>
								<pre class="mono">{editBuffer}</pre>
							</details>
						</div>
					{:else if editError}
						<div class="status error compact">
							<div class="error-msg">{editError}</div>
						</div>
					{/if}
				</div>
			{:else if promptError}
				<div class="status error compact">
					<div class="error-msg">{promptError}</div>
				</div>
			{:else}
				<pre class="mono prompt-body">{promptBody}</pre>
			{/if}
		{/if}
	</section>
{/if}

<!-- DATI PERSONALI (PII) ------------------------------------------------- -->
{#if tab === 'profile'}
	<section class="panel">
		{#if profileErr}
			<div class="status"><strong>Non disponibile</strong><div class="error-hint">{profileErr}</div></div>
		{:else}
			<p class="prof-note">
				Dati personali custoditi nel <strong>vault</strong> (mai nel registry pubblico).
				Visibili solo a te, agli admin e a chi concedi l'accesso.
				{#if !canManageProfile}<br/>Hai accesso in <strong>sola lettura</strong> a questo profilo.{/if}
			</p>
			<div class="prof-grid">
				{#each PROFILE_FIELDS as f}
					<label class="prof-field">
						<span>{f}</span>
						<input bind:value={pf[f]} disabled={!canManageProfile} autocomplete="off" placeholder={canManageProfile ? '' : '—'} />
					</label>
				{/each}
				{#each customKeys as k}
					<label class="prof-field">
						<span>{k}{#if canManageProfile}<button class="link-danger" type="button" on:click={() => removeField(k)}>×</button>{/if}</span>
						<input bind:value={pf[k]} disabled={!canManageProfile} autocomplete="off" />
					</label>
				{/each}
			</div>
			{#if canManageProfile}
				<div class="add-field">
					<input bind:value={newFieldKey} placeholder="nuovo campo (es. partita_iva)" autocomplete="off"
						on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomField(); } }} />
					<button class="edit-btn" type="button" on:click={addCustomField} disabled={!newFieldKey.trim()}>+ aggiungi campo</button>
				</div>
				<div class="prof-actions">
					<button class="edit-btn" on:click={saveProfile} disabled={pfBusy}>{pfBusy ? 'Salvo…' : 'Salva dati personali'}</button>
				</div>
				<div class="prof-grants">
					<h3>Chi può vedere questo profilo</h3>
					<p class="prof-note">Tu e gli admin sempre. Concedi l'accesso ad altri agent (tutto o niente).</p>
					{#if profile?.grants?.length}
						<ul class="grant-list">
							{#each profile.grants as g}
								<li><span>{g}</span><button class="link-danger" on:click={() => removeGrant(g)}>revoca</button></li>
							{/each}
						</ul>
					{:else}
						<p class="dim">Nessun accesso concesso.</p>
					{/if}
					<div class="grant-add">
						<input bind:value={granteeInput} placeholder="nome agent" autocomplete="off" list="agent-suggestions"
							on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addGrant(); } }} />
						<datalist id="agent-suggestions">
							{#each agentNames.filter((a) => a !== name && !(profile?.grants ?? []).includes(a)) as a}
								<option value={a}></option>
							{/each}
						</datalist>
						<button class="edit-btn" on:click={addGrant} disabled={!granteeInput.trim()}>Concedi</button>
					</div>
				</div>
			{/if}

			<div class="prof-grants">
				<h3>Allegati</h3>
				<p class="prof-note">File del profilo, consultabili dagli agent autorizzati.</p>
				{#if pFiles.length}
					<ul class="grant-list">
						{#each pFiles as f}
							<li>
								<button class="file-link" type="button" on:click={() => dlProfileFile(f.name)}>📎 {f.name}</button>
								<span class="dim">{(f.size / 1024).toFixed(0)} KB
									{#if canManageProfile}<button class="link-danger" on:click={() => removeProfileFile(f.name)}>elimina</button>{/if}
								</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="dim">Nessun allegato.</p>
				{/if}
				{#if canManageProfile}
					<div class="grant-add">
						<input type="file" bind:this={pfFileInput} on:change={onProfileUpload} disabled={pfUploading} />
						{#if pfUploading}<span class="dim">Carico…</span>{/if}
					</div>
				{/if}
			</div>
		{/if}
	</section>
{/if}

<Modal open={pfpModalOpen} dismissable={!pfpBusy} maxWidth={460} on:close={() => (pfpModalOpen = false)}>
	<h2 slot="title">Genera avatar</h2>
	<div class="pfp-form">
		<p class="pfp-note">
			L’avatar è generato da <code>gpt-image-2</code> in stile manga/ghibli. Descrivilo
			con un prompt <em>oppure</em> carica un’immagine da ri-stilizzare. Richiede
			l’integrazione <strong>Image generation (OpenAI)</strong> attiva.
		</p>
		<label class="pfp-field">
			<span>Prompt</span>
			<input type="text" bind:value={pfpPrompt} placeholder="es. volpe astuta con occhiali"
				maxlength="240" autocomplete="off" disabled={pfpBusy || !!pfpDataUrl} />
		</label>
		<div class="pfp-field">
			<span>…oppure immagine</span>
			<input type="file" accept="image/*" on:change={onPfpFile} disabled={pfpBusy} />
			{#if pfpFileName}<span class="pfp-file">{pfpFileName}</span>{/if}
		</div>
		{#if pfpError}<div class="pfp-err">{pfpError}</div>{/if}
	</div>
	<svelte:fragment slot="actions">
		<button type="button" class="btn-sec" on:click={() => (pfpModalOpen = false)} disabled={pfpBusy}>Annulla</button>
		<button type="button" class="btn-pri" on:click={submitPfp} disabled={pfpBusy}>
			{pfpBusy ? 'Genero…' : 'Genera'}
		</button>
	</svelte:fragment>
</Modal>

<style>
	.connectors { margin-top: 18px; border-top: 1px solid var(--border); padding-top: 14px; }
	.connectors h3 { font-size: 13px; margin: 0 0 8px; }
	.conn-note { font-size: 11.5px; color: var(--fg-muted); margin: 6px 0 0; line-height: 1.4; }
	.conn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.conn-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--card-bg); }
	.conn-id { font-size: 13px; font-weight: 600; }
	.conn-toggle { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--fg-muted); cursor: pointer; }
	.head-actions { display: flex; gap: 8px; align-items: center; }
	.edit-btn { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font: inherit; font-weight: 700; font-size: 12.5px; padding: 6px 12px; border-radius: 7px; cursor: pointer; }
	.edit-btn:disabled { opacity: .5; cursor: not-allowed; }
	.settings-form { display: flex; flex-direction: column; gap: 10px; }
	.sf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	.sf-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--fg-muted); }
	.sf-grid label.sf-wide { grid-column: 1 / -1; }
	.sf-grid input, .sf-grid select { background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 7px 9px; border-radius: 6px; }
	.opt { color: var(--fg-muted); font-weight: 400; }
	.sf-hint { font-size: 11px; color: var(--fg-muted); margin: 0; line-height: 1.4; }
	.sf-err { color: var(--danger, #e85d75); font-size: 12px; }
	.sf-sec { background: transparent; border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 7px 13px; border-radius: 6px; cursor: pointer; }
	.sf-pri { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font: inherit; font-weight: 700; font-size: 13px; padding: 7px 13px; border-radius: 6px; cursor: pointer; }
	.sf-sec:disabled, .sf-pri:disabled { opacity: .5; cursor: not-allowed; }
	.avatar-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
	.gen-pfp { font-size: 11px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--accent); background: transparent; color: var(--accent); cursor: pointer; white-space: nowrap; }
	.gen-pfp:hover { background: rgba(255, 107, 61, 0.12); }
	.pfp-form { display: flex; flex-direction: column; gap: 12px; }
	.pfp-note { font-size: 12.5px; color: var(--fg-muted); line-height: 1.5; margin: 0; }
	.pfp-field { display: flex; flex-direction: column; gap: 5px; }
	.pfp-field span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); font-weight: 600; }
	.pfp-field input[type='text'] { background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 6px; }
	.pfp-file { font-size: 11.5px; color: var(--fg-muted); font-family: var(--mono); }
	.pfp-err { color: var(--danger); font-size: 12px; }
	.btn-sec { background: transparent; border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 8px 13px; border-radius: 6px; cursor: pointer; }
	.btn-pri { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font: inherit; font-size: 13px; font-weight: 700; padding: 8px 13px; border-radius: 6px; cursor: pointer; }
	.btn-pri:disabled, .btn-sec:disabled { opacity: 0.5; cursor: not-allowed; }
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 18px;
	}
	.head-left {
		min-width: 0;
		flex: 1 1 auto;
	}
	.back {
		display: inline-block;
		margin-bottom: 10px;
		font-size: 12px;
		color: var(--fg-muted);
	}
	.back:hover {
		color: var(--fg);
	}
	.title-row {
		display: flex;
		gap: 14px;
		align-items: center;
	}
	.title-text {
		min-width: 0;
	}
	.title-text h1 {
		margin: 0;
	}
	.sub {
		margin-top: 4px;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		color: var(--fg-muted);
		font-size: 12px;
	}
	.mono {
		font-family: var(--mono);
	}
	.prompt-body {
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 62vh;
		overflow: auto;
		margin: 12px 0 0;
		padding: 14px 16px;
		font-size: 13px;
		line-height: 1.5;
		background: #16161c;
		border: 1px solid #2a2a32;
		border-radius: 8px;
	}
	.dot-sep {
		opacity: 0.5;
	}

	.tabs {
		display: flex;
		gap: 6px;
		border-bottom: 1px solid var(--border);
		margin-bottom: 18px;
	}
	.tabs button {
		border: none;
		background: transparent;
		color: var(--fg-muted);
		padding: 10px 14px;
		border-radius: 6px 6px 0 0;
		border-bottom: 2px solid transparent;
		font-size: 12px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
	}
	.tabs button:hover {
		color: var(--fg);
		background: rgba(255, 255, 255, 0.02);
	}
	.tabs button.active {
		color: var(--fg);
		border-bottom-color: var(--accent);
		font-weight: 700;
	}
	.badge {
		display: inline-block;
		margin-left: 6px;
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 10px;
		background: var(--border);
		color: var(--fg-muted);
		font-weight: 600;
		letter-spacing: 0;
	}

	.panel {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 20px 22px;
	}
	.mem-block { margin-bottom: 16px; }
	.mem-block:last-child { margin-bottom: 0; }
	.mem-h { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; margin: 0 0 6px; }
	.mem-tag { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--fg-muted); border: 1px solid var(--border); border-radius: 5px; padding: 1px 5px; }
	.mem-body { margin: 0; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }

	.def {
		display: grid;
		grid-template-columns: 200px 1fr;
		gap: 10px 22px;
		margin: 0;
	}
	.def dt {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--fg-muted);
		padding-top: 4px;
	}
	.def dd {
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
	}
	.hint-inline {
		font-size: 10px;
		opacity: 0.7;
		margin-left: 4px;
	}

	/* Identità PKI + success-rate + marcatori deprecati */
	.identity {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.id-badge {
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 10.5px;
		font-weight: 700;
		background: rgba(60, 170, 110, 0.16);
		color: #3caa6e;
	}
	.id-badge.revoked {
		background: rgba(232, 93, 117, 0.16);
		color: var(--danger);
	}
	.fp {
		font-family: var(--mono);
		font-size: 11.5px;
	}
	.id-validity {
		font-size: 11px;
		color: var(--fg-muted);
	}
	.rate {
		font-weight: 700;
		font-size: 14px;
	}
	.rate-detail {
		font-size: 11.5px;
		color: var(--fg-muted);
		margin-left: 6px;
	}
	.muted-note {
		color: var(--fg-muted);
		font-size: 12px;
		font-style: italic;
	}
	.prov-picker { display: flex; flex-wrap: wrap; gap: 6px; }
	.prov-opt {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 5px 10px; border: 1px solid var(--border); border-radius: 8px;
		background: transparent; color: var(--fg); font: inherit; font-size: 12px;
		cursor: pointer; transition: border-color .12s, background .12s;
	}
	.prov-opt:hover:not(:disabled) { border-color: var(--accent); }
	.prov-opt:disabled { cursor: default; }
	.prov-opt.effective { border-color: var(--accent); background: rgba(255,107,61,0.10); }
	.prov-opt.selected { box-shadow: inset 0 0 0 1px var(--accent); }
	.prov-opt.off { opacity: 0.5; }
	.prov-name { font-family: var(--mono, monospace); }
	.prov-seal { font-size: 9.5px; letter-spacing: 0.03em; color: var(--fg-muted); }
	.prov-tag { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-muted); }
	.prov-tag.on { color: var(--accent); font-weight: 700; }
	.prov-tag.muted { opacity: 0.7; }
	.prov-auto {
		margin-top: 6px; padding: 3px 8px; border: 1px solid var(--border);
		border-radius: 6px; background: transparent; color: var(--fg-muted);
		font: inherit; font-size: 11px; cursor: pointer;
	}
	.prov-auto:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
	.dep {
		font-size: 9.5px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--warn, #c79a2e);
		background: rgba(199, 154, 46, 0.14);
		padding: 1px 6px;
		border-radius: 4px;
		margin-left: 6px;
		font-weight: 700;
	}

	.chips {
		list-style: none;
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin: 0;
		padding: 0;
	}
	.chips li {
		display: inline-block;
	}
	.chips code {
		font-size: 11.5px;
	}

	.sandbox {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.sandbox-sec {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sk {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--success);
	}
	.sk.deny {
		color: var(--danger);
	}
	.paths {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.paths code {
		font-size: 11.5px;
	}

	.raw {
		margin-top: 18px;
		color: var(--fg-muted);
		font-size: 12px;
	}
	.raw summary {
		cursor: pointer;
		margin-bottom: 8px;
	}

	.log-summary {
		font-size: 12px;
		color: var(--fg-muted);
		margin-bottom: 10px;
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.log-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0;
		border-top: 1px solid var(--border);
	}
	.log-row {
		display: grid;
		grid-template-columns: 180px 130px 1fr auto;
		gap: 14px;
		padding: 9px 4px;
		align-items: baseline;
		border-bottom: 1px solid var(--border);
		font-size: 12.5px;
	}
	.log-row .ts {
		color: var(--fg-muted);
		font-size: 11.5px;
		white-space: nowrap;
	}
	.log-row .type {
		font-family: var(--mono);
		font-size: 11.5px;
		padding: 1px 6px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.04);
		color: var(--fg-muted);
		justify-self: start;
	}
	.log-row .type.tone-good {
		color: var(--success);
		background: rgba(92, 184, 138, 0.1);
	}
	.log-row .type.tone-info {
		color: #6fb6ff;
		background: rgba(111, 182, 255, 0.1);
	}
	.log-row .summary {
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.log-row .card-id {
		font-size: 10.5px;
		opacity: 0.6;
	}
	.skel-row {
		grid-template-columns: 180px 130px 1fr;
	}

	.status {
		padding: 14px 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.02);
	}
	.status.error {
		border-color: rgba(232, 93, 117, 0.6);
		background: rgba(232, 93, 117, 0.08);
	}
	.status.note {
		border-color: rgba(217, 119, 6, 0.55);
		background: rgba(217, 119, 6, 0.08);
	}
	.error-msg {
		margin-top: 6px;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--danger);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.retry {
		margin-top: 10px;
	}
	.status p {
		margin: 8px 0 0;
		font-size: 12.5px;
	}
	.status .hint {
		color: var(--fg-muted);
	}

	.prompt-placeholder {
		margin-top: 14px;
	}
	.prompt-placeholder-head {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--fg-muted);
		margin-bottom: 6px;
	}
	.prompt-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 14px;
	}
	.hint-path {
		font-size: 11px;
		color: var(--fg-muted);
		margin-top: 4px;
	}
	.hint-path .dim {
		opacity: 0.7;
	}
	.edit-btn {
		background: transparent;
		font-size: 12px;
		padding: 7px 14px;
	}
	.edit-btn:hover {
		background: rgba(255, 107, 61, 0.08);
		border-color: var(--accent);
		color: var(--accent);
	}
	.editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 12px;
	}
	.editor-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--fg-muted);
	}
	.editor textarea {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid var(--border);
		color: var(--fg);
		font: inherit;
		font-size: 12.5px;
		line-height: 1.6;
		padding: 12px;
		border-radius: 6px;
		outline: none;
		resize: vertical;
		min-height: 360px;
	}
	.editor textarea:focus {
		border-color: var(--accent);
	}
	.editor-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
	.editor-actions .cancel {
		background: transparent;
	}
	.editor-actions .save {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-fg);
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.editor-actions .save:hover:not(:disabled) {
		background: #ff7e55;
	}
	.editor-actions .save:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.spinner {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.status.warn {
		border-color: rgba(217, 119, 6, 0.55);
		background: rgba(217, 119, 6, 0.08);
		padding: 14px 16px;
	}
	.status.warn p {
		margin: 8px 0 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.status.compact {
		padding: 8px 12px;
	}
	.copy {
		margin-top: 10px;
	}
	.copy summary {
		cursor: pointer;
		font-size: 11.5px;
		color: var(--fg-muted);
	}
	.copy pre {
		margin: 8px 0 0;
		padding: 10px;
		background: #050609;
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 11.5px;
		overflow-x: auto;
		white-space: pre-wrap;
		max-height: 280px;
		overflow-y: auto;
	}

	@media (max-width: 720px) {
		.def {
			grid-template-columns: 1fr;
			gap: 4px 0;
		}
		.def dd {
			margin-bottom: 12px;
		}
		.log-row {
			grid-template-columns: 1fr;
			gap: 4px;
		}
	}

	.prof-note { font-size: 12.5px; color: var(--fg-muted); line-height: 1.5; margin: 0 0 14px; }
	.prof-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	@media (max-width: 560px) { .prof-grid { grid-template-columns: 1fr; } }
	.prof-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--fg-muted); }
	.prof-field input { background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 7px; }
	.prof-actions { margin-top: 14px; }
	.prof-grants { margin-top: 22px; border-top: 1px solid var(--border); padding-top: 16px; }
	.prof-grants h3 { margin: 0 0 4px; font-size: 14px; }
	.grant-list { list-style: none; margin: 8px 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.grant-list li { display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 13px; }
	.link-danger { background: transparent; border: none; color: #e85d75; cursor: pointer; font-size: 12px; }
	.add-field { display: flex; gap: 8px; margin: 14px 0; }
	.add-field input { flex: 1 1 auto; background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 7px; }
	.grant-add { display: flex; gap: 8px; margin-top: 8px; }
	.grant-add input { flex: 1 1 auto; background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 7px; }
	.dim { color: var(--fg-muted); font-size: 12.5px; }
	.file-link { background: transparent; border: none; color: var(--accent); cursor: pointer; font: inherit; font-size: 13px; padding: 0; }

</style>
