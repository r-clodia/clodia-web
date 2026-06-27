<script lang="ts">
	import { onMount } from 'svelte';
	import { getTools, getGmailAuth, gmailConnect, getWorkspaceAuth, workspaceConnect, connectOpenAI, connectTrello, connectGithub, registerMcp, unregisterMcp, getGoogleAppStatus, configureGoogleApp, getMailboxes, addMailbox, removeMailbox, ApiError } from '$lib/api/client';
	import { toastSuccess, toastError, toastInfo } from '$lib/stores/toasts';
	import ConnectorIcon from '$lib/components/ConnectorIcon.svelte';

	// Sezione Tools — l'owner connette qui i tool esterni del pacchetto base.
	// Gmail è cablato sul backend del gateway clodia-tools (wire diretto):
	//   GET  /tools                → stato connettori
	//   GET  /tools/gmail/auth      → URL di consenso Google + state
	//   POST /tools/gmail/connect   → exchange code → deposito nella vault
	// Il token finale è custodito nella vault del gateway, non in secrets/.
	// Drive/Calendar: in arrivo (stesso meccanismo, backend non ancora esposto).

	interface CardModel {
		id: string;
		name: string;
		blurb: string;
		scope: string;
		wired: boolean; // ha un backend di connessione
		connected: boolean;
		accounts: string[];
		provider?: string; // etichetta provider (google, openai, storage, …)
		kind?: 'gmail' | 'gworkspace' | 'openai' | 'trello' | 'mailbox' | 'github'; // flusso di connessione da usare
		mcp?: boolean; // backend MCP montato (Add-MCP)
		builtin?: boolean; // integrazione interna (es. storage topic local-fs)
		transport?: string;
	}

	// Connettori nativi cablati (sempre elencati, non state-dependent): Gmail e
	// Google Workspace (Drive · Docs · Calendar). Sono due consensi OAuth distinti.
	const BASE: CardModel[] = [
		{ id: 'gmail', name: 'Gmail', wired: true, connected: false, accounts: [],
		  provider: 'google', kind: 'gmail',
		  blurb: 'Lettura e invio email della casella dell’agency (Clodia) — IMAP/SMTP via OAuth.',
		  scope: 'https://mail.google.com/' },
		{ id: 'google-workspace', name: 'Google Workspace', wired: true, connected: false, accounts: [],
		  provider: 'google', kind: 'gworkspace',
		  blurb: 'Accesso nativo a Google Drive, Documenti e Calendar dell’owner (OAuth, token nel vault).',
		  scope: 'Drive · Docs · Calendar' },
		{ id: 'openai-images', name: 'Image generation', wired: true, connected: false, accounts: [],
		  provider: 'openai', kind: 'openai',
		  blurb: 'Generazione avatar/immagini via gpt-image-2 (PFP degli agenti). Key custodita nel vault.',
		  scope: 'api.openai.com/v1/images' },
		{ id: 'trello', name: 'Trello', wired: true, connected: false, accounts: [],
		  provider: 'trello', kind: 'trello',
		  blurb: 'Board/liste/card Trello (nostra implementazione, tool trello.*). Connetti con API key + token.',
		  scope: 'api.trello.com/1' },
		{ id: 'github', name: 'GitHub', wired: true, connected: false, accounts: [],
		  provider: 'github', kind: 'github',
		  blurb: 'Repo, issue, PR e code search via il server MCP ufficiale GitHub (tool github.*). Connetti con un Personal Access Token.',
		  scope: 'api.githubcopilot.com/mcp' },
		{ id: 'mailboxes', name: 'Caselle email (IMAP/SMTP)', wired: true, connected: false, accounts: [],
		  provider: 'email', kind: 'mailbox',
		  blurb: 'Connettore multi-casella: aggiungi/togli mailbox IMAP/SMTP (info@, IONOS, …). Delegabili per-agent.',
		  scope: 'IMAP/SMTP' }
	];

	let cards: CardModel[] = BASE.map((c) => ({ ...c }));
	let loading = true;
	let loadError = '';

	// ─── Modale di connessione OAuth Google (Gmail o Workspace) ───
	let modalOpen = false;
	let connectKind: 'gmail' | 'gworkspace' = 'gmail';
	$: connectLabel = connectKind === 'gworkspace' ? 'Google Workspace' : 'Gmail';
	let step: 'intro' | 'code' | 'app-config' = 'intro';
	let code = '';
	let clientJson = '';
	let authState = '';
	let redirectUri = '';
	let busy = false;
	let modalError = '';
	let showInfo = false;

	onMount(load);

	async function load() {
		loading = true;
		loadError = '';
		try {
			const { connectors } = await getTools();
			let boxes: string[] = [];
			try {
				boxes = await getMailboxes();
			} catch {
				boxes = [];
			}
			mailboxes = boxes;
			const base = BASE.map((c) => {
				if (c.id === 'mailboxes') {
					return { ...c, connected: boxes.length > 0, accounts: boxes };
				}
				const live = connectors.find((x) => x.id === c.id);
				return live ? { ...c, connected: live.connected, accounts: live.accounts } : { ...c };
			});
			// Storage dei topic (provider === 'storage') → card "built-in".
			const storage = connectors
				.filter((x) => x.provider === 'storage')
				.map((x) => ({
					id: x.id, name: x.label, wired: true, connected: x.connected, accounts: [],
					provider: 'storage', builtin: true,
					blurb: `Backend di storage dei topic (${x.backend ?? 'local-fs'}, versioning ${x.versioning ?? 'emulated'}). I topic vivono qui, dietro il gateway. Drive/Dropbox in arrivo.`,
					scope: x.backend ?? 'local-fs'
				}));
			// Backend MCP montati → card dinamiche (provider === 'mcp'), ESCLUSI gli id
			// già rappresentati da un connettore nativo (es. 'github': il backend MCP
			// è la sua implementazione, la card nativa è quella giusta) — evita la card
			// doppia e il bottone che cade nel fallback (modale gmail).
			const baseIds = new Set(BASE.map((c) => c.id));
			const mcp = connectors
				.filter((x) => x.provider === 'mcp' && !baseIds.has(x.id))
				.map((x) => ({
					id: x.id, name: x.label, wired: true, connected: true, accounts: [],
					mcp: true, transport: x.transport,
					blurb: `MCP server montato (${x.transport ?? 'stdio'}) — tool esposti agli agent via gateway.`,
					scope: 'mcp'
				}));
			cards = [...base, ...storage, ...mcp];
		} catch (err) {
			loadError = err instanceof ApiError ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	function openConnect(kind: 'gmail' | 'gworkspace' = 'gmail') {
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
				connectKind === 'gworkspace' ? await getWorkspaceAuth() : await getGmailAuth();
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
			const res = connectKind === 'gworkspace'
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

	// ─── Connessione OpenAI (Image generation) — paste della API key ───
	let keyOpen = false;
	let apiKey = '';
	let keyBusy = false;
	let keyError = '';

	function openKey() {
		apiKey = '';
		keyError = '';
		keyOpen = true;
	}
	function closeKey() {
		keyOpen = false;
		keyBusy = false;
	}
	async function submitKey() {
		if (!apiKey.trim()) {
			keyError = 'Incolla la API key (sk-…).';
			return;
		}
		keyBusy = true;
		keyError = '';
		try {
			await connectOpenAI(apiKey.trim());
			toastSuccess('Image generation connesso', 'OpenAI key nel vault');
			closeKey();
			await load();
		} catch (err) {
			keyError = err instanceof ApiError ? err.message : String(err);
		} finally {
			keyBusy = false;
		}
	}

	// ─── Connessione Trello — API key + token ───
	let trelloOpen = false;
	let trelloKey = '';
	let trelloToken = '';
	let trelloBusy = false;
	let trelloError = '';

	function openTrello() {
		trelloKey = '';
		trelloToken = '';
		trelloError = '';
		trelloOpen = true;
	}
	function closeTrello() {
		trelloOpen = false;
		trelloBusy = false;
	}
	async function submitTrello() {
		if (!trelloKey.trim() || !trelloToken.trim()) {
			trelloError = 'Servono sia la API key sia il token Trello.';
			return;
		}
		trelloBusy = true;
		trelloError = '';
		try {
			await connectTrello(trelloKey.trim(), trelloToken.trim());
			toastSuccess('Trello connesso', 'credenziali nel vault');
			closeTrello();
			await load();
		} catch (err) {
			trelloError = err instanceof ApiError ? err.message : String(err);
		} finally {
			trelloBusy = false;
		}
	}

	// ─── Connessione GitHub — Personal Access Token (paste-key) ───
	let githubOpen = false;
	let githubPat = '';
	let githubBusy = false;
	let githubError = '';

	function openGithub() {
		githubPat = '';
		githubError = '';
		githubOpen = true;
	}
	function closeGithub() {
		githubOpen = false;
		githubBusy = false;
	}
	async function submitGithub() {
		if (!githubPat.trim()) {
			githubError = 'Incolla il Personal Access Token GitHub.';
			return;
		}
		githubBusy = true;
		githubError = '';
		try {
			await connectGithub(githubPat.trim());
			toastSuccess('GitHub connesso', 'PAT nel vault, backend MCP registrato');
			closeGithub();
			await load();
		} catch (err) {
			githubError = err instanceof ApiError ? err.message : String(err);
		} finally {
			githubBusy = false;
		}
	}

	// ─── Caselle email (IMAP/SMTP) — connettore multi-mailbox ───
	let mailboxes: string[] = [];
	let mbOpen = false;
	let mbBusy = false;
	let mbError = '';
	let mbForm = { account: '', email: '', password: '', imap_server: '', imap_port: 993, smtp_server: '', smtp_port: 587, display_name: '' };

	function openMailboxes() {
		mbForm = { account: '', email: '', password: '', imap_server: '', imap_port: 993, smtp_server: '', smtp_port: 587, display_name: '' };
		mbError = '';
		mbOpen = true;
	}
	function closeMailboxes() {
		mbOpen = false;
		mbBusy = false;
	}
	async function submitMailbox() {
		const f = mbForm;
		if (!f.account.trim() || !f.email.trim() || !f.password || !f.imap_server.trim() || !f.smtp_server.trim()) {
			mbError = 'Compila account, email, password, IMAP e SMTP server.';
			return;
		}
		mbBusy = true;
		mbError = '';
		try {
			await addMailbox({
				account: f.account.trim().toLowerCase(), email: f.email.trim(), password: f.password,
				imap_server: f.imap_server.trim(), imap_port: Number(f.imap_port) || 993,
				smtp_server: f.smtp_server.trim(), smtp_port: Number(f.smtp_port) || 587,
				display_name: f.display_name.trim() || undefined
			});
			toastSuccess('Casella aggiunta', f.account.trim());
			mbForm = { account: '', email: '', password: '', imap_server: '', imap_port: 993, smtp_server: '', smtp_port: 587, display_name: '' };
			await load();
			mailboxes = await getMailboxes();
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
			mailboxes = await getMailboxes();
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

<header class="head">
	<div>
		<h1>Integrations</h1>
		<p class="hint">
			Connettori esterni dell’owner · token custoditi nella <strong>vault</strong> del gateway
		</p>
	</div>
	<div class="head-actions">
		<button type="button" class="btn primary" on:click={openMcp}>+ Add MCP server</button>
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
	{#each cards as c (c.id)}
		<div class="card" class:on={c.connected}>
			<div class="card-head">
				<span class="glyph" aria-hidden="true"><ConnectorIcon provider={c.provider} kind={c.kind} mcp={c.mcp} size={26} /></span>
				<div class="title">
					<div class="name">{c.name}</div>
					<div class="provider">{c.mcp ? (c.transport ?? 'mcp') : (c.provider ?? 'google')}</div>
				</div>
				<span class="pill" class:pill-on={c.connected}>
					{c.builtin ? 'Built-in' : c.mcp ? 'MCP montato' : c.connected ? 'Connesso' : c.wired ? 'Da connettere' : 'Presto'}
				</span>
			</div>

			<p class="blurb">{c.blurb}</p>
			<div class="scopes"><code class="scope">{c.scope}</code></div>

			<div class="card-foot">
				<span class="account">{c.connected && c.accounts.length ? c.accounts.join(', ') : '—'}</span>
				{#if c.builtin}
					<span class="builtin-note">interno · pluggable (P4: Drive/Dropbox)</span>
				{:else if c.mcp}
					<button type="button" class="btn ghost" on:click={() => removeMcp(c.id)}>Rimuovi</button>
				{:else if !c.wired}
					<button type="button" class="btn" disabled>Presto</button>
				{:else if c.kind === 'mailbox'}
					<button type="button" class="btn primary" on:click={openMailboxes}>Gestisci caselle</button>
				{:else if c.connected}
					<button type="button" class="btn ghost" on:click={() => c.kind === 'github' ? openGithub() : c.kind === 'trello' ? openTrello() : c.kind === 'openai' ? openKey() : openConnect(c.kind === 'gworkspace' ? 'gworkspace' : 'gmail')}>Riconnetti</button>
				{:else}
					<button type="button" class="btn primary" on:click={() => c.kind === 'github' ? openGithub() : c.kind === 'trello' ? openTrello() : c.kind === 'openai' ? openKey() : openConnect(c.kind === 'gworkspace' ? 'gworkspace' : 'gmail')}>Connetti</button>
				{/if}
			</div>
		</div>
	{/each}
</div>

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

{#if keyOpen}
	<div class="overlay" on:click|self={closeKey} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-label="Connetti Image generation">
			<div class="modal-head">
				<strong>Image generation (OpenAI)</strong>
				<button class="x" type="button" on:click={closeKey} aria-label="Chiudi">×</button>
			</div>
			<p class="note">
				Incolla una <strong>OpenAI API key</strong> (<code>sk-…</code>) con accesso alle Images
				API (gpt-image-2). Viene depositata nel <strong>vault</strong> del gateway, mai nel
				config né esposta agli agent. Serve a generare gli avatar (PFP) degli agenti.
			</p>
			<label class="field">
				<span>API key</span>
				<input type="password" bind:value={apiKey} placeholder="sk-…" autocomplete="off" spellcheck="false" />
			</label>
			{#if keyError}<div class="modal-err">{keyError}</div>{/if}
			<div class="modal-foot">
				<button type="button" class="btn" on:click={closeKey} disabled={keyBusy}>Annulla</button>
				<button type="button" class="btn primary" on:click={submitKey} disabled={keyBusy}>
					{keyBusy ? 'Connessione…' : 'Connetti'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if trelloOpen}
	<div class="overlay" on:click|self={closeTrello} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-label="Connetti Trello">
			<div class="modal-head">
				<strong>Connetti Trello</strong>
				<button class="x" type="button" on:click={closeTrello} aria-label="Chiudi">×</button>
			</div>
			<p class="note">
				Inserisci la <strong>API key</strong> e il <strong>token</strong> Trello
				(<code>trello.com/app-key</code>): la API key è in cima, il token lo generi col link
				"Token" nella stessa pagina. Vengono custoditi nel <strong>vault</strong>, mai esposti agli agent.
			</p>
			<label class="field">
				<span>API key</span>
				<input type="password" bind:value={trelloKey} placeholder="trello api key" autocomplete="off" spellcheck="false" />
			</label>
			<label class="field">
				<span>Token</span>
				<input type="password" bind:value={trelloToken} placeholder="trello token" autocomplete="off" spellcheck="false" />
			</label>
			{#if trelloError}<div class="modal-err">{trelloError}</div>{/if}
			<div class="modal-foot">
				<button type="button" class="btn" on:click={closeTrello} disabled={trelloBusy}>Annulla</button>
				<button type="button" class="btn primary" on:click={submitTrello} disabled={trelloBusy}>
					{trelloBusy ? 'Connessione…' : 'Connetti'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if githubOpen}
	<div class="overlay" on:click|self={closeGithub} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-label="Connetti GitHub">
			<div class="modal-head">
				<strong>Connetti GitHub</strong>
				<button class="x" type="button" on:click={closeGithub} aria-label="Chiudi">×</button>
			</div>
			<p class="note">
				Incolla un <strong>Personal Access Token</strong> GitHub
				(<code>github.com/settings/tokens</code>) con gli scope che vuoi concedere agli
				agent (es. <code>repo</code>). Viene custodito nel <strong>vault</strong>, mai
				esposto agli agent: i tool <code>github.*</code> passano dal server MCP ufficiale.
			</p>
			<label class="field">
				<span>Personal Access Token</span>
				<input type="password" bind:value={githubPat} placeholder="ghp_… / github_pat_…" autocomplete="off" spellcheck="false" />
			</label>
			{#if githubError}<div class="modal-err">{githubError}</div>{/if}
			<div class="modal-foot">
				<button type="button" class="btn" on:click={closeGithub} disabled={githubBusy}>Annulla</button>
				<button type="button" class="btn primary" on:click={submitGithub} disabled={githubBusy}>
					{githubBusy ? 'Connessione…' : 'Connetti'}
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
			{#if mailboxes.length}
				<ul class="mb-list">
					{#each mailboxes as m (m)}
						<li><span class="mb-name">✉︎ {m}</span>
							<button type="button" class="btn ghost sm" on:click={() => deleteMailbox(m)}>Rimuovi</button></li>
					{/each}
				</ul>
			{:else}
				<p class="note">Nessuna casella ancora. Aggiungine una qui sotto.</p>
			{/if}
			<p class="note">Aggiungi una casella IMAP/SMTP. Le credenziali vanno nel <strong>vault</strong> (mai esposte agli agent); delegabili poi per-agent dal profilo.</p>
			<div class="mb-grid">
				<label class="field"><span>Account (id)</span><input type="text" bind:value={mbForm.account} placeholder="studio" autocomplete="off" /></label>
				<label class="field"><span>Email</span><input type="text" bind:value={mbForm.email} placeholder="user@domain.com" autocomplete="off" /></label>
				<label class="field"><span>Password / app-password</span><input type="password" bind:value={mbForm.password} autocomplete="off" /></label>
				<label class="field"><span>Display name (opz.)</span><input type="text" bind:value={mbForm.display_name} autocomplete="off" /></label>
				<label class="field"><span>IMAP server</span><input type="text" bind:value={mbForm.imap_server} placeholder="imap.ionos.it" autocomplete="off" /></label>
				<label class="field"><span>IMAP porta</span><input type="number" bind:value={mbForm.imap_port} /></label>
				<label class="field"><span>SMTP server</span><input type="text" bind:value={mbForm.smtp_server} placeholder="smtp.ionos.it" autocomplete="off" /></label>
				<label class="field"><span>SMTP porta</span><input type="number" bind:value={mbForm.smtp_port} /></label>
			</div>
			{#if mbError}<div class="modal-err">{mbError}</div>{/if}
			<div class="modal-foot">
				<button type="button" class="btn" on:click={closeMailboxes} disabled={mbBusy}>Chiudi</button>
				<button type="button" class="btn primary" on:click={submitMailbox} disabled={mbBusy}>{mbBusy ? 'Aggiungo…' : 'Aggiungi casella'}</button>
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

<style>
	.head-actions { display: flex; gap: 8px; align-items: center; }
	.secrets { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 10px; }
	.secrets .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); }
	textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--fg); padding: 9px 11px; font-size: 12px; line-height: 1.5; resize: vertical; }
	.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
	.hint { margin: 4px 0 0; color: var(--fg-muted); font-size: 12px; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
	.card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
	.card.on { border-color: color-mix(in srgb, var(--success) 55%, var(--border)); }
	.card-head { display: flex; align-items: center; gap: 10px; }
	.glyph { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); color: var(--fg); flex: none; }
	.title { min-width: 0; flex: 1 1 auto; }
	.name { font-weight: 700; font-size: 14px; }
	.provider { color: var(--fg-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
	.pill { flex: none; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid var(--border); color: var(--fg-muted); }
	.pill-on { color: var(--success); border-color: color-mix(in srgb, var(--success) 55%, var(--border)); background: color-mix(in srgb, var(--success) 12%, transparent); }
	.blurb { margin: 0; color: var(--fg-muted); font-size: 12.5px; line-height: 1.45; }
	.scopes { display: flex; flex-wrap: wrap; gap: 6px; }
	.scope { font-family: var(--mono); font-size: 11px; color: var(--fg-muted); background: color-mix(in srgb, var(--fg-muted) 10%, transparent); border-radius: 5px; padding: 2px 6px; word-break: break-all; }
	.card-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; padding-top: 4px; }
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
	.mb-name { font-size: 13px; font-weight: 600; }
	.mb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0; }
	.btn.sm { font-size: 11px; padding: 3px 9px; }
</style>
