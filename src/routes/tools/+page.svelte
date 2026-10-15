<script lang="ts">
	import { onMount } from 'svelte';
	import { getTools, getConnectorRegistry, connectConnector, getGmailAuth, gmailConnect, getWorkspaceAuth, workspaceConnect, getGoogleAuth, googleConnect, registerMcp, unregisterMcp, startMcpOAuth, completeMcpOAuth, getGoogleAppStatus, configureGoogleApp, getMailboxes, addMailbox, removeMailbox, testConnector, ApiError } from '$lib/api/client';
	import type { ConnectorIssue, MailboxStatus, ConnectorRegistry } from '$lib/api/client';
	import { cardsDiTools, serviziDiPack } from '$lib/connettori';
	import { isAdmin } from '$lib/stores/capabilities';
	import { askWainston } from '$lib/stores/helpdesk';
	import { instanceProfile, ensureProfileLoaded } from '$lib/stores/instance';
	import { toastSuccess, toastError, toastInfo } from '$lib/stores/toasts';
	import ConnectorIcon from '$lib/components/ConnectorIcon.svelte';

	// Sezione Tools — l'owner connette qui i tool esterni del pacchetto base.
	// Gmail è cablato sul backend del gateway clodia-tools (wire diretto):
	//   GET  /tools                → stato connettori
	//   GET  /tools/gmail/auth      → URL di consenso Google + state
	//   POST /tools/gmail/connect   → exchange code → deposito nella vault
	// Il token finale è custodito nella vault del gateway, non in secrets/.
	// Drive/Calendar: in arrivo (stesso meccanismo, backend non ancora esposto).

	// Il modello di una card. Non lo costruisce più questa pagina: lo deriva
	// `$lib/connettori.js` dal registry dei connettori installati, unito allo
	// stato vivo di `GET /tools`. Qui resta solo la forma, perché il markup la
	// legge (clodia-platform#520).
	interface CardModel {
		id: string;
		name: string;
		blurb: string;
		scope: string;
		icon: string;
		wired: boolean; // ha un modo di collegarsi da qui
		connected: boolean;
		operational?: boolean;
		accounts: string[];
		issues?: ConnectorIssue[];
		provider?: string;
		bot_username?: string;
		mcp?: boolean; // backend MCP montato (Add-MCP)
		builtin?: boolean; // integrazione interna (es. storage topic local-fs)
		transport?: string;
		auth?: string; // 'oauth' per i backend MCP che vogliono un consenso (#532)
		authorized?: boolean;
		setupLabel: string;
		docsUrl: string;
		docsHref: string;
		/** La credenziale che il manifest dichiara: form (si incolla) o oauth. */
		credenziale: {
			id: string;
			label: string;
			kind: string;
			fields: { name: string; label: string; secret: boolean; required: boolean; placeholder: string }[];
		} | null;
		/** Insiemi di valori che questa pagina amministra (oggi: `mailboxes`). */
		gestisce: string[];
	}

	let cards: CardModel[] = [];
	let registry: ConnectorRegistry | null = null;
	// Edizione (Modular Distro): se il profilo dichiara i connettori nativi,
	// le card fuori lista non esistono (l'enforcement vero è nel gateway).
	$: allowedConnectors = $instanceProfile.integrations?.connectors ?? null;
	$: visibleCards = cards;
	// I servizi lungo-vivi dei pack (#515): il campo arriva con
	// clodia-tools#362 e finché non c'è la sezione semplicemente non compare.
	let servizi: ReturnType<typeof serviziDiPack> = [];
	let loading = true;
	let loadError = '';

	// ─── Modale di connessione OAuth Google (Gmail o Workspace) ───
	let modalOpen = false;
	let connectKind: 'gmail' | 'gworkspace' | 'google' = 'google';
	$: connectLabel = connectKind === 'google' ? 'Google' : connectKind === 'gworkspace' ? 'Google Workspace' : 'Gmail';
	let step: 'intro' | 'code' | 'app-config' = 'intro';
	let code = '';
	let clientJson = '';
	let authState = '';
	let redirectUri = '';
	let busy = false;
	let modalError = '';
	let showInfo = false;

	onMount(() => {
		void ensureProfileLoaded();
		void load();
	});

	let testResult: Record<string, { ok: boolean | null; detail: string }> = {};
	let testing: Record<string, boolean> = {};

	async function testConn(id: string) {
		testing = { ...testing, [id]: true };
		try {
			const r = await testConnector(id);
			testResult = { ...testResult, [id]: r };
			if (r.ok === true) toastSuccess(`${id}: ${r.detail}`);
			else if (r.ok === false) toastError(`${id}: ${r.detail}`);
			else toastInfo(`${id}: ${r.detail}`);
		} catch (e) {
			toastError(e instanceof ApiError ? e.message : String(e));
		} finally {
			testing = { ...testing, [id]: false };
		}
	}

	async function load() {
		loading = true;
		loadError = '';
		try {
			// Due domande diverse, due sorgenti: il registry dice COSA sono i
			// connettori installati (ed è l'unico posto dove esiste un
			// connettore arrivato con un pack), lo snapshot dice come stanno
			// adesso — account, guasti, e le cose che il gateway monta senza
			// manifest (backend MCP, storage dei topic).
			const tools = await getTools();
			try {
				registry = await getConnectorRegistry();
			} catch {
				// Un gateway più vecchio della rotta: si resta sulle card che
				// lo snapshot conosce, invece di non mostrare niente.
				registry = null;
			}
			servizi = serviziDiPack(tools);
			let boxes: string[] = [];
			let statuses: MailboxStatus[] = [];
			try {
				({ mailboxes: boxes, statuses } = await getMailboxes());
			} catch {
				boxes = [];
				statuses = [];
			}
			mailboxes = boxes;
			mailboxStatuses = statuses;
			cards = cardsDiTools(registry, tools.connectors, {
				ammessi: allowedConnectors ? [...allowedConnectors] : null
			}) as unknown as CardModel[];
		} catch (err) {
			loadError = err instanceof ApiError ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	function openConnect(kind: 'gmail' | 'gworkspace' | 'google' = 'google') {
		connectKind = kind;
		step = 'intro';
		code = '';
		authState = '';
		modalError = '';
		showInfo = false;
		modalOpen = true;
	}

	function closeModal() {
		modalOpen = false;
		busy = false;
	}

	async function startAuth() {
		busy = true;
		modalError = '';
		try {
			const { auth_url, state, redirect_uri } =
				connectKind === 'google' ? await getGoogleAuth() : connectKind === 'gworkspace' ? await getWorkspaceAuth() : await getGmailAuth();
			authState = state;
			redirectUri = redirect_uri;
			window.open(auth_url, '_blank', 'noopener');
			step = 'code';
		} catch (err) {
			// App OAuth Google non ancora configurata → step di configurazione.
			if (err instanceof ApiError && err.status === 409) {
				step = 'app-config';
			} else {
				modalError = err instanceof ApiError ? err.message : String(err);
			}
		} finally {
			busy = false;
		}
	}

	async function saveGoogleApp() {
		if (!clientJson.trim()) {
			modalError = 'Incolla il JSON del client OAuth scaricato da Google Cloud.';
			return;
		}
		busy = true;
		modalError = '';
		try {
			await configureGoogleApp({ client_json: clientJson.trim() });
			clientJson = '';
			step = 'intro';
			await startAuth(); // riprende il consenso ora che l'app è configurata
		} catch (err) {
			modalError = err instanceof ApiError ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function submitCode() {
		if (!code.trim()) {
			modalError = 'Incolla l’URL di redirect (o il code).';
			return;
		}
		busy = true;
		modalError = '';
		try {
			const body = { code: code.trim(), state: authState };
			const res = connectKind === 'google'
				? await googleConnect(body)
				: connectKind === 'gworkspace'
				? await workspaceConnect(body)
				: await gmailConnect(body);
			toastSuccess(`${connectLabel} connesso`, res.email);
			closeModal();
			await load();
		} catch (err) {
			modalError = err instanceof ApiError ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	// ─── La credenziale che il manifest dichiara (clodia-platform#520) ───
	//
	// Una sola modale per tutti i connettori che si collegano incollando
	// qualcosa. Prima ce n'erano tre identiche — OpenAI, GitHub, Telegram —
	// con tre funzioni, tre stati e tre messaggi, e un connettore in più voleva
	// la quarta. Ora i campi li dichiara il provider (`fields[]`) e questa
	// pagina non ne conosce i nomi: li raccoglie e li manda.
	//
	// Il deposito resta quello di prima: per un connettore del gateway la rotta
	// generica delega al suo handler nativo, che attorno alla scrittura fa
	// quello che il deposito generico non fa (GitHub monta il backend MCP,
	// Telegram valida il token con getMe e salva l'@username).
	let credOpen = false;
	let credCard: CardModel | null = null;
	let credValues: Record<string, string> = {};
	let credBusy = false;
	let credError = '';

	function openCredential(c: CardModel) {
		credCard = c;
		credValues = Object.fromEntries((c.credenziale?.fields ?? []).map((f) => [f.name, '']));
		credError = '';
		credOpen = true;
	}
	function closeCredential() {
		credOpen = false;
		credBusy = false;
	}
	async function submitCredential() {
		const c = credCard;
		const cred = c?.credenziale;
		if (!c || !cred) return;
		const mancante = cred.fields.find((f) => f.required && !(credValues[f.name] ?? '').trim());
		if (mancante) {
			credError = `Compila «${mancante.label || mancante.name}».`;
			return;
		}
		credBusy = true;
		credError = '';
		try {
			const valori = Object.fromEntries(
				Object.entries(credValues).map(([k, v]) => [k, v.trim()])
			);
			await connectConnector(c.id, cred.id, valori);
			toastSuccess(`${c.name} connesso`, 'credenziale nel vault del gateway');
			closeCredential();
			await load();
		} catch (err) {
			credError = err instanceof ApiError ? err.message : String(err);
		} finally {
			credBusy = false;
		}
	}

	/** Il gesto di «Connetti» per una card: lo decide ciò che la card dichiara,
	 *  non il suo nome. L'OAuth resta sul flusso Google esistente — #519 ha
	 *  lasciato `kind: oauth` fuori dalla rotta generica (consenso, stato fra le
	 *  due gambe, callback), quindi un flusso generico non esiste ancora. */
	/** La domanda che l'owner farebbe a Wainston per questo connettore. Prima
	 *  era una frase su Telegram, scritta qui e disponibile solo a Telegram. */
	function aiuto(c: CardModel) {
		return `Aiuto, sto configurando l'integrazione ${c.name}. Da dove parto?`;
	}

	function connetti(c: CardModel) {
		if (c.gestisce.includes('mailboxes')) return openMailboxes();
		if (c.credenziale?.kind === 'oauth') return openConnect('google');
		if (c.credenziale) return openCredential(c);
	}


	// ─── Chi può usare una casella ──────────────────────────────────────────
	//
	// Qui c'era la delega per-agent della casella (chip «concedi a…» per riga).
	// Rimossa con clodia-platform#410: le chiamate finivano su
	// `/api/connectors[/grant]`, che l'agent-server girava a una rotta del
	// gateway mai registrata, quindi ogni concessione era un 502 e la lista
	// restava comunque vuota per il `catch`. Non era una UI da riparare: dal
	// 18/09 una casella si autorizza PER SCOPE (whitelist `inbox:`/`outbox:`),
	// e il gesto vive nel connettore Mailbox del canale (#406) — dove si sa
	// anche a quale stanza serve, che è l'informazione che qui mancava.

	// ─── Caselle email (IMAP/SMTP) — connettore multi-mailbox ───
	let mailboxes: string[] = [];
	let mailboxStatuses: MailboxStatus[] = [];
	let mbOpen = false;
	let mbBusy = false;
	let mbError = '';
	let mbForm = { account: '', email: '', password: '', imap_server: '', imap_port: 993, smtp_server: '', smtp_port: 587, smtp_user: '', display_name: '' };

	function openMailboxes() {
		mbForm = { account: '', email: '', password: '', imap_server: '', imap_port: 993, smtp_server: '', smtp_port: 587, smtp_user: '', display_name: '' };
		mbError = '';
		mbOpen = true;
	}
	function closeMailboxes() {
		mbOpen = false;
		mbBusy = false;
	}
	async function submitMailbox() {
		const f = mbForm;
		if (!f.account.trim() || !f.email.trim() || !f.password || !f.smtp_server.trim()) {
			mbError = 'Compila account, email, password e SMTP server.';
			return;
		}
		mbBusy = true;
		mbError = '';
		try {
			await addMailbox({
				account: f.account.trim().toLowerCase(), email: f.email.trim(), password: f.password,
				// IMAP vuoto = casella di SOLO INVIO. Non si manda una stringa
				// vuota: il backend distingue «assente» da «vuoto», e mandare ''
				// creerebbe una casella che dichiara un IMAP inesistente.
				...(f.imap_server.trim()
					? { imap_server: f.imap_server.trim(), imap_port: Number(f.imap_port) || 993 }
					: {}),
				smtp_server: f.smtp_server.trim(), smtp_port: Number(f.smtp_port) || 587,
				// I relay (smtp2go, mailgun, …) autenticano con un utente dedicato:
				// senza questo campo la password giusta viene rifiutata, e sembra
				// sbagliata.
				smtp_user: f.smtp_user.trim() || undefined,
				display_name: f.display_name.trim() || undefined
			});
			toastSuccess('Casella aggiunta', f.account.trim());
			mbForm = { account: '', email: '', password: '', imap_server: '', imap_port: 993, smtp_server: '', smtp_port: 587, smtp_user: '', display_name: '' };
			await load();
			({ mailboxes, statuses: mailboxStatuses } = await getMailboxes());
		} catch (err) {
			mbError = err instanceof ApiError ? err.message : String(err);
		} finally {
			mbBusy = false;
		}
	}
	async function deleteMailbox(account: string) {
		try {
			await removeMailbox(account);
			toastInfo(`Casella ${account} rimossa`);
			await load();
			({ mailboxes, statuses: mailboxStatuses } = await getMailboxes());
		} catch (err) {
			toastError('Rimozione fallita', err instanceof ApiError ? err.message : String(err));
		}
	}

	// ─── Add MCP server ───
	let mcpOpen = false;
	let mcpJson = '';
	let secretValues: Record<string, string> = {};
	let mcpBusy = false;
	let mcpError = '';

	// Placeholder ${NAME} nel config (esclude ${VAULT:...}) → input segreto dedicato.
	$: placeholders = Array.from(
		new Set(
			[...mcpJson.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)]
				.map((m) => m[1])
				.filter((n) => !n.startsWith('VAULT'))
		)
	);

	function openMcp() {
		mcpJson = '';
		secretValues = {};
		mcpError = '';
		mcpOpen = true;
	}
	function closeMcp() {
		mcpOpen = false;
		mcpBusy = false;
	}

	async function submitMcp() {
		let parsed: unknown;
		try {
			parsed = JSON.parse(mcpJson);
		} catch {
			mcpError = 'JSON non valido.';
			return;
		}
		if (!parsed || typeof parsed !== 'object' || !(parsed as Record<string, unknown>).mcpServers) {
			mcpError = 'Manca l’oggetto "mcpServers" nel config.';
			return;
		}
		mcpBusy = true;
		mcpError = '';
		try {
			const secrets: Record<string, string> = {};
			for (const p of placeholders) if (secretValues[p]) secrets[p] = secretValues[p];
			const res = await registerMcp({ config: parsed, secrets });
			toastSuccess('MCP server registrato', (res.registered || []).join(', '));
			closeMcp();
			await load();
		} catch (err) {
			mcpError = err instanceof ApiError ? err.message : String(err);
		} finally {
			mcpBusy = false;
		}
	}

	// ─── Consenso OAuth di un server MCP montato (clodia-platform#532) ───
	// Il gateway non ha una URL pubblica su cui ricevere il redirect: la
	// persona autorizza, atterra sul loopback e incolla indietro la URL. È la
	// stessa strada del connettore Google, per la stessa ragione.
	let oauthOpen = false;
	let oauthServer = '';
	let oauthUrl = '';
	let oauthRedirect = '';
	let oauthState = '';
	let oauthCode = '';
	let oauthBusy = false;
	let oauthError = '';

	async function openMcpOAuth(name: string) {
		oauthServer = name;
		oauthUrl = '';
		oauthCode = '';
		oauthError = '';
		oauthOpen = true;
		oauthBusy = true;
		try {
			const res = await startMcpOAuth(name);
			oauthUrl = res.auth_url;
			oauthState = res.state;
			oauthRedirect = res.redirect_uri;
		} catch (err) {
			oauthError = err instanceof ApiError ? err.message : String(err);
		} finally {
			oauthBusy = false;
		}
	}

	function closeMcpOAuth() {
		oauthOpen = false;
		oauthBusy = false;
	}

	async function submitMcpOAuth() {
		oauthBusy = true;
		oauthError = '';
		try {
			const res = await completeMcpOAuth(oauthServer, { state: oauthState, code: oauthCode });
			toastSuccess('MCP server autorizzato', `${res.server}${res.detail ? ' — ' + res.detail : ''}`);
			closeMcpOAuth();
			await load();
		} catch (err) {
			oauthError = err instanceof ApiError ? err.message : String(err);
		} finally {
			oauthBusy = false;
		}
	}

	async function removeMcp(name: string) {
		try {
			await unregisterMcp(name);
			toastSuccess('MCP server rimosso', name);
			await load();
		} catch (err) {
			toastError('Rimozione fallita', err instanceof ApiError ? err.message : String(err));
		}
	}
</script>

{#if !$isAdmin}
	<div class="status error" style="margin:2rem 0">Accesso riservato agli amministratori dell'istanza.</div>
{:else}
<header class="head">
	<div>
		<h1>Integrations</h1>
		<p class="hint">
			Connettori esterni dell’owner · token custoditi nella <strong>vault</strong> del gateway
		</p>
	</div>
	<div class="head-actions">
		{#if $instanceProfile.features.integrations === 'full' || $instanceProfile.integrations?.allow_manual_mcp}
			<button type="button" class="btn primary" on:click={openMcp}>+ Add MCP server</button>
		{/if}
		<button type="button" on:click={load} disabled={loading}>{loading ? 'Loading…' : 'Reload'}</button>
	</div>
</header>

{#if loadError}
	<div class="status error">
		<strong>Stato connettori non disponibile.</strong>
		<div class="error-msg">{loadError}</div>
	</div>
{/if}

<div class="grid">
	{#each visibleCards as c (c.id)}
		<div class="card" class:on={c.connected && c.operational !== false} class:broken={c.operational === false && (c.connected || Boolean(c.issues?.length))}>
			<div class="card-head">
				<span class="glyph" aria-hidden="true"><ConnectorIcon name={c.icon} size={26} /></span>
				<div class="title">
					<div class="name">{c.name}</div>
					<div class="provider">{c.mcp ? (c.transport ?? 'mcp') : (c.provider ?? 'google')}</div>
				</div>
				<span class="pill" class:pill-on={c.connected && c.operational !== false} class:pill-broken={c.operational === false && (c.connected || Boolean(c.issues?.length))}>
					{c.builtin ? 'Built-in' : c.auth === 'oauth' && !c.authorized ? 'Da autorizzare' : c.mcp ? 'MCP montato' : c.operational === false && (c.connected || c.issues?.length) ? 'Non operativa' : c.connected ? 'Connesso' : c.wired ? 'Da connettere' : 'Presto'}
				</span>
			</div>

			<p class="blurb">{c.blurb}</p>
			<div class="scopes"><code class="scope">{c.scope}</code></div>
			{#if c.issues?.length}
				<div class="integration-issues">
					{#each c.issues as issue (issue.account)}
						<div><strong>{issue.account}</strong>: {issue.missing?.length ? `mancano ${issue.missing.join(', ')}` : (issue.error ?? 'configurazione non valida')}</div>
					{/each}
				</div>
			{/if}

			<div class="card-foot">
				<span class="account">{c.connected && c.accounts.length ? c.accounts.join(', ') : (c.bot_username ? '@' + c.bot_username : '—')}</span>
				{#if c.builtin}
					<span class="builtin-note">interno · pluggable</span>
				{:else if c.mcp}
					{#if testResult[c.id]}
						<span class="test-badge" class:ok={testResult[c.id].ok === true} class:ko={testResult[c.id].ok === false} title={testResult[c.id].detail}>
							{testResult[c.id].ok === true ? '✓' : testResult[c.id].ok === false ? '✕' : '—'}
						</span>
					{/if}
					<button type="button" class="btn ghost" on:click={() => testConn(c.id)} disabled={testing[c.id]}>{testing[c.id] ? '…' : 'Test'}</button>
					{#if c.auth === 'oauth'}
						<button type="button" class="btn" class:primary={!c.authorized} on:click={() => openMcpOAuth(c.id)}>
							{c.authorized ? 'Riautorizza' : 'Connetti'}
						</button>
					{/if}
					<button type="button" class="btn ghost" on:click={() => removeMcp(c.id)}>Rimuovi</button>
				{:else if !c.wired}
					<button type="button" class="btn" disabled>Presto</button>
				{:else if c.gestisce.includes('mailboxes')}
					<!-- Il pannello che amministra un INSIEME di valori del gateway.
					     La chiave è il nome dell'insieme (`mailboxes`), che è un elenco
					     chiuso suo: un altro connettore che puntasse un campo sullo
					     stesso insieme erediterebbe questo bottone senza collegarlo. -->
					<button type="button" class="btn primary" on:click={openMailboxes}>{c.setupLabel || 'Gestisci'}</button>
				{:else if c.connected}
					{#if testResult[c.id]}
						<span class="test-badge" class:ok={testResult[c.id].ok === true} class:ko={testResult[c.id].ok === false} title={testResult[c.id].detail}>
							{testResult[c.id].ok === true ? '✓' : testResult[c.id].ok === false ? '✕' : '—'}
						</span>
					{/if}
					<button type="button" class="btn ghost" on:click={() => testConn(c.id)} disabled={testing[c.id]}>{testing[c.id] ? '…' : 'Test'}</button>
					<button type="button" class="btn ghost" on:click={() => askWainston(aiuto(c))}>💬 Aiuto</button>
					<button type="button" class="btn ghost" on:click={() => connetti(c)}>Riconnetti</button>
				{:else}
					<button type="button" class="btn ghost" on:click={() => askWainston(aiuto(c))}>💬 Aiuto setup</button>
					<button type="button" class="btn primary" on:click={() => connetti(c)}>{c.setupLabel || 'Connetti'}</button>
				{/if}
			</div>
		</div>
	{/each}
</div>

{#if servizi.length}
	<!-- I processi lungo-vivi che i pack dichiarano (clodia-platform#515): un
	     connettore che ha bisogno di un processo è rotto quanto quel processo, e
	     finora non c'era modo di vederlo da fuori. La sezione compare solo se il
	     gateway manda il campo: con una versione precedente a clodia-tools#362
	     non c'è, e una pagina che si rompe su un campo che arriverà è peggio di
	     una sezione che non c'è ancora. -->
	<section class="servizi">
		<h2>Servizi dei pack</h2>
		<ul>
			{#each servizi as s (s.chiave)}
				<li class:srv-on={s.vivo} class:srv-ko={s.rotto}>
					<span class="srv-stato">{s.vivo ? '●' : s.rotto ? '▲' : '○'}</span>
					<code>{s.chiave}</code>
					<span class="srv-dett">
						{s.stato}{s.salute ? ` · ${s.salute}` : ''}{s.isolato ? ' · isolato' : ''}
						{#if s.tentativi > 0}· {s.tentativi} riavvii{/if}
					</span>
					{#if s.ultimoErrore}
						<div class="srv-err">{s.ultimoErrore}</div>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if modalOpen}
	<div class="overlay" on:click|self={closeModal} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-label="Connetti account Google">
			<div class="modal-head">
				<strong>Connetti {connectLabel}</strong>
				<button class="x" type="button" on:click={closeModal} aria-label="Chiudi">×</button>
			</div>

			{#if step === 'app-config'}
				<p class="note">
					Prima serve la <strong>app OAuth del tuo progetto Google Cloud</strong> (una
					sola volta). Crea un client OAuth tipo <em>Desktop</em>, scarica il JSON e
					incollalo qui: estraggo io <code>client_id</code>/<code>client_secret</code> e
					li custodisco nel vault (mai esposti).
				</p>
				<label class="field">
					<span>JSON del client OAuth (Google Cloud)</span>
					<textarea rows="6" bind:value={clientJson} placeholder={'{"installed":{"client_id":"…","client_secret":"…",…}}'} ></textarea>
				</label>
			{:else if step === 'intro'}
				<p class="note">
					Si aprirà la finestra Google con il <strong>selettore account</strong>: scegli
					tu quale account Google autorizzare, poi premi <em>Consenti</em>.
				</p>
					<p class="note tip">💡 <strong>Consigliato</strong> (non obbligatorio): usa un account Google <strong>dedicato</strong> all'agency, non il tuo personale — isoli dati e permessi e revochi l'accesso quando vuoi senza toccare la casella personale.</p>
			{:else}
				<p class="note">
					Dopo il consenso il browser va su <code>{redirectUri}/?code=…</code> (pagina di
					errore: <em>normale</em>). Copia l’<strong>intero URL</strong> dalla barra degli
					indirizzi e incollalo qui — estraggo io il <code>code</code>.
					<button class="info-btn" type="button" on:click={() => (showInfo = !showInfo)}>ⓘ</button>
				</p>
				{#if showInfo}
					<div class="info">
						<ol>
							<li>Nella scheda Google scegli/conferma l’account e premi <em>Consenti</em>.</li>
							<li>Il browser prova ad aprire <code>{redirectUri}</code> → “impossibile connettersi”: è atteso (nessun server lì).</li>
							<li>Copia l’<b>intero URL</b> dalla barra degli indirizzi (<code>…/?code=…&…</code>) e incollalo qui sotto.</li>
							<li>Premi <em>Connetti</em>.</li>
						</ol>
					</div>
				{/if}
				<label class="field">
					<span>URL di redirect</span>
					<input type="text" bind:value={code} placeholder="incolla l’intero URL (…/?code=…)" autocomplete="off" />
				</label>
			{/if}

			{#if modalError}<div class="modal-err">{modalError}</div>{/if}

			<div class="modal-foot">
				<button type="button" class="btn" on:click={closeModal} disabled={busy}>Annulla</button>
				{#if step === 'app-config'}
					<button type="button" class="btn primary" on:click={saveGoogleApp} disabled={busy}>
						{busy ? '…' : 'Salva e continua'}
					</button>
				{:else if step === 'intro'}
					<button type="button" class="btn primary" on:click={startAuth} disabled={busy}>
						{busy ? '…' : 'Apri autorizzazione Google'}
					</button>
				{:else}
					<button type="button" class="btn primary" on:click={submitCode} disabled={busy}>
						{busy ? 'Connessione…' : 'Connetti'}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if credOpen && credCard?.credenziale}
	<!-- La credenziale che il manifest DICHIARA (clodia-platform#520).
	     Una modale per tutti: prima ce n'erano tre identiche (OpenAI, GitHub,
	     Telegram) e la quarta la voleva il quarto connettore. I campi sono
	     quelli del provider, e questa pagina non ne conosce i nomi. -->
	<div class="overlay" on:click|self={closeCredential} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-label="Connetti {credCard.name}">
			<div class="modal-head">
				<strong>{credCard.setupLabel || `Connetti ${credCard.name}`}</strong>
				<button class="x" type="button" on:click={closeCredential} aria-label="Chiudi">×</button>
			</div>
			<p class="note">
				{credCard.blurb}
				La credenziale è custodita nel <strong>vault</strong> del gateway: non entra nel
				config, non la vedono gli agent, e non torna più indietro da nessuna risposta.
			</p>
			{#each credCard.credenziale.fields as f (f.name)}
				<label class="field">
					<span>{f.label || f.name}</span>
					{#if f.secret}
						<input type="password" bind:value={credValues[f.name]} placeholder={f.placeholder}
							autocomplete="off" spellcheck="false" />
					{:else}
						<input type="text" bind:value={credValues[f.name]} placeholder={f.placeholder}
							autocomplete="off" spellcheck="false" />
					{/if}
				</label>
			{/each}
			{#if credCard.docsHref}
				<p class="note"><a href={credCard.docsHref} target="_blank" rel="noopener noreferrer">Documentazione del connettore</a></p>
			{:else if credCard.docsUrl}
				<!-- Not https:// — shown as text, never as a link (review of #242). -->
				<p class="note">Documentazione del connettore: <code>{credCard.docsUrl}</code></p>
			{/if}
			{#if credError}<div class="modal-err">{credError}</div>{/if}
			<div class="modal-foot">
				<button type="button" class="btn" on:click={closeCredential} disabled={credBusy}>Annulla</button>
				<button type="button" class="btn primary" on:click={submitCredential} disabled={credBusy}>
					{credBusy ? 'Connessione…' : 'Connetti'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if mbOpen}
	<div class="overlay" on:click|self={closeMailboxes} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-label="Caselle email">
			<div class="modal-head">
				<strong>Caselle email (IMAP/SMTP)</strong>
				<button class="x" type="button" on:click={closeMailboxes} aria-label="Chiudi">×</button>
			</div>
			{#if mailboxStatuses.length}
				<ul class="mb-list">
					{#each mailboxStatuses as mailbox (mailbox.account)}
						<li class="mb-row">
							<span class="mb-name">✉︎ {mailbox.account}
								<small class:mb-broken={!mailbox.operational}>{mailbox.operational
									? (mailbox.send_only ? 'operativa · solo invio (nessun IMAP)' : 'operativa')
									: `non operativa${mailbox.missing?.length ? ` · mancano ${mailbox.missing.join(', ')}` : ''}`}</small>
							</span>
							<button type="button" class="btn ghost sm" on:click={() => deleteMailbox(mailbox.account)}>Rimuovi</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="note">Nessuna casella ancora. Aggiungine una qui sotto.</p>
			{/if}
			<p class="note">Aggiungi una casella IMAP/SMTP. Le credenziali vanno nel <strong>vault</strong> (mai esposte agli agent). Aggiungerla non basta: finché non la <strong>autorizzi su un canale</strong> — connettore <strong>Mailbox</strong> nella pagina dello scope — nessun agente di quel canale la vede in elenco.</p>
			<div class="mb-grid">
				<label class="field"><span>Account (id)</span><input type="text" bind:value={mbForm.account} placeholder="studio" autocomplete="off" /></label>
				<label class="field"><span>Email</span><input type="text" bind:value={mbForm.email} placeholder="user@domain.com" autocomplete="off" /></label>
				<label class="field"><span>Password / app-password</span><input type="password" bind:value={mbForm.password} autocomplete="off" /></label>
				<label class="field"><span>Display name (opz.)</span><input type="text" bind:value={mbForm.display_name} autocomplete="off" /></label>
				<label class="field"><span>IMAP server <small>(vuoto = solo invio)</small></span><input type="text" bind:value={mbForm.imap_server} placeholder="imap.ionos.it" autocomplete="off" /></label>
				<label class="field"><span>IMAP porta</span><input type="number" bind:value={mbForm.imap_port} /></label>
				<label class="field"><span>SMTP server</span><input type="text" bind:value={mbForm.smtp_server} placeholder="smtp.ionos.it" autocomplete="off" /></label>
				<label class="field"><span>SMTP porta</span><input type="number" bind:value={mbForm.smtp_port} /></label>
				<!-- I relay (smtp2go, mailgun, sendgrid, brevo) autenticano con un
				     utente DEDICATO, non con l'indirizzo: senza questo campo la
				     password giusta viene rifiutata e sembra sbagliata. Il backend
				     lo accettava da sempre; mancava solo qui, ed è per questo che
				     `team` non poteva funzionare. -->
				<label class="field"><span>Utente SMTP <small>(solo per i relay)</small></span><input type="text" bind:value={mbForm.smtp_user} placeholder="vuoto = usa l'indirizzo" autocomplete="off" /></label>
			</div>
			{#if mbError}<div class="modal-err">{mbError}</div>{/if}
			<div class="modal-foot">
				<button type="button" class="btn" on:click={closeMailboxes} disabled={mbBusy}>Chiudi</button>
				<button type="button" class="btn primary" on:click={submitMailbox} disabled={mbBusy}>{mbBusy ? 'Aggiungo…' : 'Aggiungi casella'}</button>
			</div>
		</div>
	</div>
{/if}

{#if oauthOpen}
	<div class="overlay" on:click|self={closeMcpOAuth} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-label="Autorizza MCP server">
			<div class="modal-head">
				<strong>Autorizza «{oauthServer}»</strong>
				<button class="x" type="button" on:click={closeMcpOAuth} aria-label="Chiudi">×</button>
			</div>
			<p class="note">
				Apri la URL di autorizzazione, accetta il consenso e <strong>incolla qui la URL</strong>
				su cui il browser è atterrato (<code>{oauthRedirect || '…'}</code>): è una pagina che
				non esiste, conta solo l’indirizzo. Il token finisce nel <strong>vault</strong> del
				gateway — mai nel config, mai in questa pagina.
			</p>
			{#if oauthUrl}
				<label class="field">
					<span>1 · URL di autorizzazione</span>
					<input type="text" readonly value={oauthUrl} class="mono" />
				</label>
				<p class="note">
					<a href={oauthUrl} target="_blank" rel="noreferrer noopener">Apri il consenso in una nuova scheda ↗</a>
				</p>
				<label class="field">
					<span>2 · URL di ritorno (o il solo <code>code</code>)</span>
					<input type="text" bind:value={oauthCode} spellcheck="false" autocomplete="off"
						placeholder={`${oauthRedirect || 'http://127.0.0.1:8000/oauth/mcp/callback'}?code=…&state=…`} />
				</label>
			{:else if oauthBusy}
				<p class="note">Chiedo l’autorizzazione al server MCP…</p>
			{/if}
			{#if oauthError}<div class="modal-err">{oauthError}</div>{/if}
			<div class="modal-foot">
				<button type="button" class="btn" on:click={closeMcpOAuth} disabled={oauthBusy}>Annulla</button>
				<button type="button" class="btn primary" on:click={submitMcpOAuth}
					disabled={oauthBusy || !oauthUrl || !oauthCode.trim()}>
					{oauthBusy ? 'Scambio…' : 'Completa'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if mcpOpen}
	<div class="overlay" on:click|self={closeMcp} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-label="Add MCP server">
			<div class="modal-head">
				<strong>Add MCP server</strong>
				<button class="x" type="button" on:click={closeMcp} aria-label="Chiudi">×</button>
			</div>
			<p class="note">
				Incolla il <code>mcp.json</code> del server (formato <code>{`{"mcpServers": {…}}`}</code>),
				stdio (<code>command/args/env</code>) o http (<code>url/headers</code>). Per i segreti usa
				un placeholder <code>{'${NAME}'}</code> nel config: comparirà un campo dedicato e il valore
				andrà nel <strong>vault</strong> (mai nel config salvato).
			</p>
			<p class="note">
				Se il server non usa un token ma un <strong>consenso OAuth</strong>, non c'è niente da
				incollare: aggiungi <code>{`"auth": {"type": "oauth"}`}</code> accanto a <code>url</code>,
				registra, poi premi <strong>Connetti</strong> sulla sua card.
			</p>
			<label class="field">
				<span>mcp.json</span>
				<textarea bind:value={mcpJson} rows="9" spellcheck="false" class="mono"
					placeholder={'{\n  "mcpServers": {\n    "github": {\n      "command": "npx",\n      "args": ["-y","@modelcontextprotocol/server-github"],\n      "env": { "GITHUB_TOKEN": "${GH_TOKEN}" }\n    }\n  }\n}'}></textarea>
			</label>
			{#if placeholders.length}
				<div class="secrets">
					<span class="lbl">Segreti (→ vault)</span>
					{#each placeholders as p (p)}
						<label class="field">
							<span>{p}</span>
							<input type="password" bind:value={secretValues[p]} placeholder={`valore per ${p}`} autocomplete="off" />
						</label>
					{/each}
				</div>
			{/if}
			{#if mcpError}<div class="modal-err">{mcpError}</div>{/if}
			<div class="modal-foot">
				<button type="button" class="btn" on:click={closeMcp} disabled={mcpBusy}>Annulla</button>
				<button type="button" class="btn primary" on:click={submitMcp} disabled={mcpBusy || !mcpJson.trim()}>
					{mcpBusy ? 'Registro…' : 'Registra'}
				</button>
			</div>
		</div>
	</div>
{/if}
{/if}

<style>
	/* Servizi dei pack (#515): stato, ultimo errore. Stessa grammatica visiva
	   delle card — verde se gira, triangolo se si è rotto. */
	.servizi { margin: 18px 0 0; }
	.servizi h2 { font-size: 14px; margin: 0 0 8px; }
	.servizi ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.servizi li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: 13px;
		border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; }
	.srv-on { border-color: #2e7d32; }
	.srv-ko { border-color: #d32f2f; }
	.srv-stato { font-size: 11px; }
	.srv-dett { opacity: .7; font-size: 12px; }
	.srv-err { flex-basis: 100%; font-size: 12px; color: #d32f2f; word-break: break-word; }

	.head-actions { display: flex; gap: 8px; align-items: center; }
	.secrets { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 10px; }
	.secrets .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); }
	textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--fg); padding: 9px 11px; font-size: 12px; line-height: 1.5; resize: vertical; }
	.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
	.hint { margin: 4px 0 0; color: var(--fg-muted); font-size: 12px; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
	.card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
	.card.on { border-color: color-mix(in srgb, var(--success) 55%, var(--border)); }
	.card.broken { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); }
	.card-head { display: flex; align-items: center; gap: 10px; }
	.glyph { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); color: var(--fg); flex: none; }
	.title { min-width: 0; flex: 1 1 auto; }
	.name { font-weight: 700; font-size: 14px; }
	.provider { color: var(--fg-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
	.pill { flex: none; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid var(--border); color: var(--fg-muted); }
	.pill-on { color: var(--success); border-color: color-mix(in srgb, var(--success) 55%, var(--border)); background: color-mix(in srgb, var(--success) 12%, transparent); }
	.pill-broken { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); background: color-mix(in srgb, var(--danger) 10%, transparent); }
	.blurb { margin: 0; color: var(--fg-muted); font-size: 12.5px; line-height: 1.45; }
	.scopes { display: flex; flex-wrap: wrap; gap: 6px; }
	.scope { font-family: var(--mono); font-size: 11px; color: var(--fg-muted); background: color-mix(in srgb, var(--fg-muted) 10%, transparent); border-radius: 5px; padding: 2px 6px; word-break: break-all; }
	.integration-issues { color: var(--danger); font-size: 11.5px; line-height: 1.45; overflow-wrap: anywhere; }
	.card-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; padding-top: 4px; }
	.test-badge { font-weight: 700; font-size: 13px; }
	.test-badge.ok { color: #34c759; }
	.test-badge.ko { color: #ef4444; }
	.account { font-family: var(--mono); font-size: 12px; color: var(--fg-muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.builtin-note { font-size: 11px; color: var(--fg-muted); font-style: italic; }
	.btn { flex: none; padding: 8px 14px; border-radius: 6px; font-size: 12.5px; font-weight: 700; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--fg); transition: background .12s, color .12s, border-color .12s; }
	.btn:disabled { opacity: .55; cursor: not-allowed; }
	.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
	.btn.primary:hover:not(:disabled) { filter: brightness(1.05); }
	.btn.ghost:hover { border-color: var(--accent); color: var(--accent); }
	.status { padding: 16px 18px; border: 1px solid var(--border); border-radius: 8px; background: var(--card-bg); margin-bottom: 14px; }
	.status.error { border-color: rgba(232, 93, 117, 0.6); background: rgba(232, 93, 117, 0.08); }
	.error-msg { margin-top: 8px; font-family: var(--mono); font-size: 12px; color: var(--danger); word-break: break-word; }

	.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: center; z-index: 50; padding: 16px; }
	.modal { width: min(460px, 100%); background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
	.modal-head { display: flex; align-items: center; justify-content: space-between; }
	.x { background: transparent; border: none; color: var(--fg-muted); font-size: 22px; line-height: 1; cursor: pointer; }
	.field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--fg-muted); }
	.field input { padding: 9px 11px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font-size: 13px; }
	.note { margin: 0; font-size: 12.5px; color: var(--fg-muted); line-height: 1.5; }
	.note.tip { margin-top: 10px; padding: 8px 10px; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 8px; background: color-mix(in srgb, var(--accent) 7%, transparent); color: var(--fg); }
	.note code { font-family: var(--mono); font-size: 11.5px; }
	.info-btn { background: transparent; border: 1px solid var(--border); border-radius: 999px; width: 20px; height: 20px; color: var(--fg-muted); cursor: pointer; font-size: 11px; padding: 0; }
	.info { background: color-mix(in srgb, var(--fg-muted) 8%, transparent); border-radius: 8px; padding: 10px 12px; font-size: 12px; color: var(--fg-muted); }
	.info ol { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
	.info code { font-family: var(--mono); font-size: 11px; }
	.modal-err { font-size: 12px; color: var(--danger); font-family: var(--mono); word-break: break-word; }
	.modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
	.mb-list { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.mb-list li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 7px; }
	.mb-name { display: flex; min-width: 0; flex-direction: column; gap: 2px; font-size: 13px; font-weight: 600; }
	.mb-name small { color: var(--success); font-size: 11px; font-weight: 500; overflow-wrap: anywhere; }
	.mb-name small.mb-broken { color: var(--danger); }
	.mb-row { flex-wrap: wrap; }
	.mb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0; }
	.btn.sm { font-size: 11px; padding: 3px 9px; }
</style>
