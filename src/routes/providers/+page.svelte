<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ApiError,
		getProviders,
		setProviderKey,
		providerLoginStart,
		providerLoginComplete,
		pauseProvider,
		resumeProvider,
		type ProviderSovereignty
	} from '$lib/api/client';
	import {
		connectFields,
		connectInitialValues,
		connectPayload,
		validateConnect
	} from '$lib/providerConnect.js';
	import { isAdmin } from '$lib/stores/capabilities';
	import { toastSuccess } from '$lib/stores/toasts';

	// ─────────────────────────────────────────────────────────────────────────
	// Sezione PROVIDERS — credenziali dei MOTORI DI INFERENZA.
	//
	// A differenza dei Tools (vault del gateway clodia-tools), i provider sono
	// consumati da clodia-logic (è lui che fa inferenza) → backend e storage su
	// clodia-logic, chiavi nel suo KEYSTORE (opzione B, spec
	// agent-identity-model-spec.md §6).
	//
	// SPLIT DPA/costi (21 giu 2026): i provider di inferenza sono 4 DISTINTI, ogni
	// card ha UN solo meccanismo. API = DPA commerciale (adatto ai dati
	// confidenziali); abbonamento = DPA consumer, costo fisso.
	//   anthropic-api / claude-pro-max / openai-api / codex
	//
	// Backend (clodia-logic, opzione B):
	//   GET  /api/providers                  → stato per-provider (+ mechanism)
	//   POST /api/providers/{id}/login/start → OAuth+PKCE: {auth_url} da aprire
	//   POST /api/providers/{id}/login/complete → exchange della stringa `code#state`
	//   POST /api/providers/{id}/key         → salva API key nel keystore
	//   DELETE /api/providers/{id}           → disconnetti
	// ─────────────────────────────────────────────────────────────────────────

	type Mechanism = 'subscription' | 'apikey';

	interface Provider {
		id: string;
		name: string;
		engine: string; // sdk/runtime
		blurb: string;
		mechanism: Mechanism; // meccanismo unico del provider
		dpa: string; // etichetta DPA (commerciale | consumer)
		connected: boolean;
		via?: Mechanism; // come è connesso
		seal?: string | null; // livello SEAL effettivo
		sovereignty?: ProviderSovereignty | null; // breakdown SOV + dimensioni + dpa_url
		paused?: boolean; // connesso ma escluso dalla selezione
		// Provider a ENDPOINT dichiarato dall'admin (#265): campi da chiedere al
		// collegamento e valori attualmente configurati (non segreti).
		configurable?: string[] | null;
		apikey_optional?: boolean | null;
		base_url?: string | null;
		model?: string | null;
	}

	// Metadati di presentazione per id (nome + engine + blurb + DPA + meccanismo).
	// Lo STATO (connesso, in pausa, SEAL) arriva dal backend; questo è display, e
	// serve prima che il backend risponda.
	//
	// Il `mechanism` sta qui e non in un'euristica sull'id (clodia-platform#281):
	// era dedotto da `id.endsWith('-api')`, che indovina su cinque provider e
	// sbaglia sugli altri tre del catalogo — `generic-openai` e `scaleway` sono
	// apikey e finivano classificati come abbonamento, cioè «Connetti» avrebbe
	// avviato un flusso OAuth che quei provider non hanno.
	const META: Record<
		string,
		{ name: string; engine: string; blurb: string; dpa: string; mechanism: Mechanism }
	> = {
		'anthropic-api': {
			name: 'Anthropic API',
			engine: 'Claude (claude-agent-sdk)',
			blurb: 'Anthropic via API, fatturazione a consumo. DPA commerciale (zero-retention/no-training): adatto ai dati confidenziali.',
			dpa: 'DPA commerciale',
			mechanism: 'apikey'
		},
		'claude-pro-max': {
			name: 'Claude Pro/Max',
			engine: 'Claude (claude-agent-sdk)',
			blurb: 'Abbonamento Claude Pro/Max via login OAuth: costo fisso, niente consumo API. DPA consumer — non adatto di default ai dati confidenziali.',
			dpa: 'DPA consumer',
			mechanism: 'subscription'
		},
		'claude-team': {
			name: 'Claude Team',
			engine: 'Claude (claude-agent-sdk)',
			blurb: 'Abbonamento business claude.ai (login con account Team): Commercial Terms, quindi DPA + no-training contrattuali — un gradino sopra Pro/Max. Inferenza US: non per i dati che richiedono residenza EU.',
			dpa: 'DPA commerciale · US',
			mechanism: 'subscription'
		},
		'openai-api': {
			name: 'OpenAI API',
			engine: 'Codex (codex exec)',
			blurb: 'OpenAI via API, a consumo. DPA commerciale: adatto ai dati confidenziali.',
			dpa: 'DPA commerciale',
			mechanism: 'apikey'
		},
		codex: {
			name: 'Codex / ChatGPT',
			engine: 'Codex (codex exec)',
			blurb: 'Abbonamento ChatGPT (codex login): costo fisso. DPA consumer — non adatto di default ai dati confidenziali.',
			dpa: 'DPA consumer',
			mechanism: 'subscription'
		},
		'aws-region-eu': {
			name: 'AWS Bedrock (EU)',
			engine: 'Claude via AWS Bedrock',
			blurb: 'Claude via Amazon Bedrock, region EU (eu-west-1, Irlanda). DPA+SCC, no-training, no-retention, data residency EU: il miglior profilo tra i provider a controllo US.',
			dpa: 'DPA commerciale · EU',
			mechanism: 'apikey'
		},
		scaleway: {
			name: 'Scaleway (EU sovereign)',
			engine: 'OpenCode (OpenAI-compatible)',
			blurb: 'Cloud sovrano EU (Scaleway SAS, Francia): modelli open (Mistral, Llama, …) serviti da datacenter fr-par/nl-ams, fuori dal CLOUD Act. Modelli diversi da GPT/Claude: cambiano le capacità.',
			dpa: 'DPA commerciale · EU',
			mechanism: 'apikey'
		},
		'generic-openai': {
			name: 'LLM generico (OpenAI-compatible)',
			engine: 'OpenCode (OpenAI-compatible)',
			blurb: "Endpoint dichiarato da te: ollama, LM Studio, vLLM o qualunque gateway OpenAI-compatible. La chiave è facoltativa; ciò che collega il provider è l'indirizzo. La piattaforma non può verificare chi ospita quell'host, quindi resta SEAL-0.",
			dpa: 'DPA ignoto',
			mechanism: 'apikey'
		}
	};

	// Fallback statico se il backend non risponde: i provider a endpoint restano
	// fuori (`generic-openai` senza il suo `configurable` non è collegabile, e
	// `scaleway` non è nel default per-SDK). Ordine: bedrock EU (SEAL-2) prima,
	// poi API → abbonamento.
	const ORDER = ['aws-region-eu', 'anthropic-api', 'claude-pro-max', 'openai-api', 'codex'];
	function staticCard(id: string): Provider {
		const m = META[id];
		return {
			id,
			name: prettyName(id),
			engine: m?.engine ?? '',
			blurb: m?.blurb ?? '',
			mechanism: m?.mechanism ?? 'apikey',
			dpa: m?.dpa ?? '',
			connected: false
		};
	}
	function prettyName(id: string): string {
		return META[id]?.name ?? id;
	}

	// "SEAL-2" → "2" per il breakdown compatto; "–" se assente.
	function sealN(s?: string | null): string {
		return s ? s.replace('SEAL-', '') : '–';
	}

	// Pausa/riattiva un provider: connesso ma escluso dalla selezione (gli agent
	// ripiegano sul prossimo attivo con SEAL più alto).
	async function togglePause(p: Provider) {
		try {
			if (p.paused) {
				await resumeProvider(p.id);
				toastSuccess(`${p.name} riattivato`);
			} else {
				await pauseProvider(p.id);
				toastSuccess(`${p.name} in pausa`, 'escluso dalla selezione');
			}
			await load();
		} catch (err) {
			// non bloccante: ricarica lo stato reale
			await load();
		}
	}

	let providers: Provider[] = ORDER.map(staticCard);
	let loading = false;

	onMount(load);

	async function load() {
		loading = true;
		try {
			const { providers: live } = await getProviders();
			providers = live.map((l) => {
				const m = META[l.id];
				return {
					id: l.id,
					name: l.name || prettyName(l.id),
					engine: m?.engine ?? (l.sdk ?? ''),
					blurb: m?.blurb ?? '',
					mechanism: (l.mechanism ?? (l.subscription === 'oauth' ? 'subscription' : 'apikey')) as Mechanism,
					dpa: m?.dpa ?? '',
					connected: l.connected,
					via: l.via ?? undefined,
					seal: l.seal ?? l.sovereignty?.seal ?? null,
					sovereignty: l.sovereignty ?? null,
					paused: l.paused ?? false,
					configurable: l.configurable ?? null,
					apikey_optional: l.apikey_optional ?? null,
					base_url: l.base_url ?? null,
					model: l.model ?? null
				};
			});
		} catch {
			// backend non raggiungibile: lascia lo stato statico
		} finally {
			loading = false;
		}
	}

	// ─── Modale di connessione (mono-meccanismo) ───
	let modalOpen = false;
	let modalProvider: Provider | null = null;
	let step: 'oauth' | 'key' = 'key';
	let apiKey = '';
	// Campi `configurable` del provider a endpoint (#265/#281): non sono segreti
	// e si ripresentano compilati su «Riconnetti» — `set_key` riscrive il bundle
	// intero, quindi riconnettersi senza endpoint cancellerebbe la configurazione
	// di un provider che stava funzionando (e il backend risponde 400).
	let baseUrl = '';
	let model = '';
	let oauthCode = ''; // stringa `code#state` incollata dopo l'autorizzazione
	let authUrl = ''; // authorize URL del provider (aperto in una tab)
	let busy = false;
	let modalError = '';

	// Il form del provider aperto: `api_key` c'è sempre (facoltativa o no), i
	// campi a endpoint solo se il provider li dichiara.
	$: campiForm = connectFields(modalProvider);
	$: campiConf = campiForm.filter((c) => c.name !== 'api_key');
	$: chiaveObbligatoria = campiForm.find((c) => c.name === 'api_key')?.required ?? true;

	function openConnect(p: Provider) {
		modalProvider = p;
		// La card ha un solo meccanismo → vai dritto allo step giusto.
		step = p.mechanism === 'subscription' ? 'oauth' : 'key';
		const iniziali = connectInitialValues(p);
		apiKey = iniziali.api_key;
		baseUrl = iniziali.base_url;
		model = iniziali.model;
		oauthCode = '';
		authUrl = '';
		modalError = '';
		modalOpen = true;
		// Per l'abbonamento avvia subito il flusso OAuth (apre la tab di consenso).
		if (p.mechanism === 'subscription') void startOauth();
	}
	function closeModal() {
		modalOpen = false;
		busy = false;
	}

	// Avvia il login-abbonamento OAuth+PKCE: chiede l'authorize URL al backend e
	// lo apre in una nuova tab. L'utente autorizza con l'abbonamento e copia la
	// stringa `code#state` mostrata dalla pagina di consenso.
	async function startOauth() {
		if (!modalProvider) return;
		busy = true;
		modalError = '';
		try {
			const { auth_url } = await providerLoginStart(modalProvider.id);
			authUrl = auth_url;
			step = 'oauth';
			window.open(auth_url, '_blank', 'noopener');
		} catch (err) {
			modalError = err instanceof ApiError ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function submitOauthCode() {
		if (!modalProvider) return;
		if (!oauthCode.trim()) {
			modalError = 'Incolla il codice di autorizzazione (code#state).';
			return;
		}
		busy = true;
		modalError = '';
		try {
			await providerLoginComplete(modalProvider.id, oauthCode.trim());
			toastSuccess(`${modalProvider.name} connesso`, 'abbonamento');
			closeModal();
			await load();
		} catch (err) {
			modalError = err instanceof ApiError ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function submitApiKey() {
		if (!modalProvider) return;
		const valori = { api_key: apiKey, base_url: baseUrl, model };
		// Quali campi sono obbligatori dipende dal provider: su un endpoint locale
		// la chiave non serve e l'obbligatorio è l'indirizzo. La regola sta in
		// providerConnect.js perché è la stessa del backend, e lì si può provare.
		const errore = validateConnect(modalProvider, valori);
		if (errore) {
			modalError = errore;
			return;
		}
		busy = true;
		modalError = '';
		try {
			await setProviderKey(modalProvider.id, connectPayload(modalProvider, valori));
			toastSuccess(`${modalProvider.name} connesso`, campiConf.length ? 'endpoint' : 'API key');
			closeModal();
			await load();
		} catch (err) {
			modalError = err instanceof ApiError ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

{#if !$isAdmin}
	<div class="status error" style="margin:2rem 0">Accesso riservato agli amministratori dell'istanza.</div>
{:else}
<header class="head">
	<div>
		<h1>Providers</h1>
		<p class="hint">
			Motori di inferenza · credenziali nel <strong>keystore</strong> di clodia-logic
		</p>
	</div>
	<button type="button" on:click={load} disabled={loading}>{loading ? 'Loading…' : 'Reload'}</button>
</header>

<div class="grid">
	{#each providers as p (p.id)}
		<div class="card" class:on={p.connected && !p.paused} class:paused={p.paused}>
			<div class="card-head">
				<span class="glyph" aria-hidden="true">{p.name.charAt(0)}</span>
				<div class="title">
					<div class="name">{p.name}</div>
					<div class="engine">{p.engine}</div>
				</div>
				<span class="pill" class:pill-on={p.connected && !p.paused} class:pill-paused={p.paused}>
					{p.paused ? '⏸ In pausa' : p.connected ? `Connesso · ${p.via === 'apikey' ? 'API key' : 'abbonamento'}` : 'Da connettere'}
				</span>
			</div>

			<p class="blurb">{p.blurb}</p>
			<div class="tags">
				<span class="tag">{p.mechanism === 'apikey' ? 'API · a consumo' : 'Abbonamento · costo fisso'}</span>
				<!-- Un provider che il catalogo del backend ha e META no (aggiunto lì e
				     non qui) non deve produrre una pastiglia vuota accanto alle altre. -->
				{#if p.dpa}<span class="tag" class:tag-dpa={p.dpa.includes('commerciale')}>{p.dpa}</span>{/if}
			</div>

			{#if p.seal || p.sovereignty}
				{@const a = p.sovereignty?.assessment ?? {}}
				{@const dim = p.sovereignty?.dimensions ?? {}}
				<div class="sov">
					<div class="sov-top">
						<span class="seal seal-{sealN(p.seal)}" title="SEAL effettivo = min(SOV-2, SOV-3, SOV-7)">{p.seal ?? 'n/d'}</span>
						<span class="sov-break">SOV-2 {sealN(a['SOV-2'])} · SOV-3 {sealN(a['SOV-3'])} · SOV-7 {sealN(a['SOV-7'])}</span>
					</div>
					<div class="sov-dims">
						{#if dim.data_residency}<span class="dim" title="data residency">📍 {String(dim.data_residency).toUpperCase()}</span>{/if}
						{#if dim.no_training}<span class="dim">no-training</span>{/if}
						{#if dim.retention}<span class="dim">retention: {dim.retention}</span>{/if}
						{#if dim.cloud_act_exposed}<span class="dim warn" title="esposizione CLOUD Act (provider sotto controllo US)">CLOUD Act</span>{/if}
						{#if dim.dpa_url}
							<a class="dim link" href={dim.dpa_url} target="_blank" rel="noopener">DPA ↗</a>
						{/if}
					</div>
				</div>
			{/if}

			<div class="card-foot">
				{#if p.connected}
					<button type="button" class="btn ghost" on:click={() => togglePause(p)}>{p.paused ? '▶ Riattiva' : '⏸ Pausa'}</button>
					<button type="button" class="btn ghost" on:click={() => openConnect(p)}>Riconnetti</button>
				{:else}
					<button type="button" class="btn primary" on:click={() => openConnect(p)}>Connetti</button>
				{/if}
			</div>
		</div>
	{/each}
</div>

<p class="footnote">
	Provider distinti per <strong>DPA</strong> e costi: <em>API</em> (a consumo, DPA
	commerciale → dati confidenziali) vs <em>abbonamento</em> (costo fisso, DPA
	consumer). L'agent dichiara una lista ordinata di provider compatibili: si usa
	il primo collegato. Credenziali nel vault del gateway, mai esposte al modello.
</p>

{#if modalOpen && modalProvider}
	<div class="overlay" on:click|self={closeModal} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-label={`Connetti ${modalProvider.name}`}>
			<div class="modal-head">
				<strong>Connetti {modalProvider.name}</strong>
				<button class="x" type="button" on:click={closeModal} aria-label="Chiudi">×</button>
			</div>

			{#if step === 'oauth'}
				<p class="note">
					Si è aperta una scheda per autorizzare <strong>{modalProvider.name}</strong>
					(abbonamento). Completata l’autorizzazione,
					<strong>copia il codice</strong> che ottieni e incollalo qui — può essere il
					codice mostrato a video, oppure (se il browser prova ad aprire una pagina
					<code>localhost</code> che non carica) l’intero <strong>URL</strong> dalla barra
					degli indirizzi.
				</p>
				<p class="note">
					Scheda non aperta?
					<a href={authUrl} target="_blank" rel="noopener">Apri l’autorizzazione</a>.
				</p>
				<label class="field">
					<span>Codice di autorizzazione (o URL di redirect)</span>
					<input type="text" bind:value={oauthCode} placeholder="abc123…#state  oppure  http://localhost:1455/…?code=…" autocomplete="off" />
				</label>
				<p class="muted-note">Lo scambio avviene su clodia-logic; il token resta nel keystore, mai esposto al modello.</p>
			{:else}
				<label class="field">
					<span>API key {modalProvider.name}{#if !chiaveObbligatoria} <em class="opt">— facoltativa</em>{/if}</span>
					<input type="password" bind:value={apiKey} placeholder="sk-…" autocomplete="off" />
				</label>
				{#if !chiaveObbligatoria}
					<p class="muted-note">Chiave non richiesta per endpoint locali (ollama, LM Studio): lascia vuoto se il tuo non ne chiede.</p>
				{/if}
				<!-- Campi a ENDPOINT (#265): l'indirizzo non è noto al repository, lo
				     dichiara l'admin qui. `base_url` è OBBLIGATORIO quando il provider
				     lo dichiara — è lui, non la chiave, a rendere collegabile questo
				     provider — e su «Riconnetti» arriva già compilato. -->
				{#each campiConf as campo (campo.name)}
					{#if campo.name === 'base_url'}
						<label class="field">
							<span>Endpoint OpenAI-compatible</span>
							<input type="text" bind:value={baseUrl} placeholder="host:port oppure http://host:port/v1" autocomplete="off" />
						</label>
					{:else if campo.name === 'model'}
						<label class="field">
							<span>Modello <em class="opt">— facoltativo</em></span>
							<input type="text" bind:value={model} placeholder="es. llama3.1:8b" autocomplete="off" />
						</label>
					{/if}
				{/each}
				{#if campiConf.length}
					<p class="muted-note">
						L'endpoint lo dichiari tu e la piattaforma non può verificarlo: questo provider
						resta <strong>SEAL-0</strong> e non è utilizzabile nei topic con riservatezza.
					</p>
				{/if}
				<p class="muted-note">La chiave viene salvata nel keystore di clodia-logic, mai esposta al modello.</p>
			{/if}

			{#if modalError}<div class="modal-err">{modalError}</div>{/if}

			<div class="modal-foot">
				<button type="button" class="btn" on:click={closeModal} disabled={busy}>Annulla</button>
				{#if step === 'key'}
					<button type="button" class="btn primary" on:click={submitApiKey} disabled={busy}>
						{busy ? 'Salvo…' : campiConf.length ? 'Collega endpoint' : 'Salva API key'}
					</button>
				{:else if step === 'oauth'}
					<button type="button" class="btn primary" on:click={submitOauthCode} disabled={busy}>
						{busy ? 'Connessione…' : 'Connetti'}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
{/if}

<style>
	.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
	.hint { margin: 4px 0 0; color: var(--fg-muted); font-size: 12px; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
	.card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
	.card.on { border-color: color-mix(in srgb, var(--success) 55%, var(--border)); }
	.card.paused { opacity: 0.62; border-style: dashed; }
	.card-head { display: flex; align-items: center; gap: 10px; }
	.glyph { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 8px; background: var(--accent); color: var(--accent-fg); font-weight: 800; font-size: 16px; flex: none; }
	.title { min-width: 0; flex: 1 1 auto; }
	.name { font-weight: 700; font-size: 14px; }
	.engine { color: var(--fg-muted); font-size: 11px; }
	.pill { flex: none; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid var(--border); color: var(--fg-muted); }
	.pill-on { color: var(--success); border-color: color-mix(in srgb, var(--success) 55%, var(--border)); background: color-mix(in srgb, var(--success) 12%, transparent); }
	.pill-paused { color: #e3b341; border-color: color-mix(in srgb, #e3b341 55%, var(--border)); background: color-mix(in srgb, #e3b341 12%, transparent); }
	.blurb { margin: 0; color: var(--fg-muted); font-size: 12.5px; line-height: 1.45; }
	.tags { display: flex; flex-wrap: wrap; gap: 6px; }
	.tag { font-size: 11px; color: var(--fg-muted); background: color-mix(in srgb, var(--fg-muted) 10%, transparent); border-radius: 5px; padding: 2px 7px; }
	.tag-dpa { color: var(--success); background: color-mix(in srgb, var(--success) 12%, transparent); }
	/* Blocco sovranità: SEAL + breakdown SOV + dimensioni (DPA link, residency…) */
	.sov { display: flex; flex-direction: column; gap: 6px; padding: 8px 0 2px; border-top: 1px dashed var(--border); }
	.sov-top { display: flex; align-items: center; gap: 8px; }
	.seal { font-size: 11px; font-weight: 800; letter-spacing: .02em; padding: 2px 8px; border-radius: 999px;
		color: #1a1208; background: var(--fg-muted); }
	.seal-0, .seal-1 { background: #e0795a; }      /* US/consumer: arancio */
	.seal-2 { background: #e3b341; }                /* migliore tra US-controlled: ambra */
	.seal-3, .seal-4 { background: #4caf6a; color: #07140c; } /* sovrano EU: verde */
	.sov-break { font-size: 11px; color: var(--fg-muted); font-family: var(--mono, monospace); }
	.sov-dims { display: flex; flex-wrap: wrap; gap: 5px; }
	.dim { font-size: 10.5px; color: var(--fg-muted); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; }
	.dim.warn { color: #e0795a; border-color: color-mix(in srgb, #e0795a 40%, transparent); }
	.dim.link { color: var(--accent); text-decoration: none; }
	.dim.link:hover { text-decoration: underline; }
	.card-foot { display: flex; justify-content: flex-end; margin-top: auto; padding-top: 4px; }
	.btn { flex: none; padding: 8px 14px; border-radius: 6px; font-size: 12.5px; font-weight: 700; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--fg); transition: background .12s, color .12s, border-color .12s; }
	.btn:disabled { opacity: .55; cursor: not-allowed; }
	.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
	.btn.primary:hover:not(:disabled) { filter: brightness(1.05); }
	.btn.ghost:hover { border-color: var(--accent); color: var(--accent); }
	.footnote { margin-top: 22px; color: var(--fg-muted); font-size: 12px; }

	.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: center; z-index: 50; padding: 16px; }
	.modal { width: min(480px, 100%); background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
	.modal-head { display: flex; align-items: center; justify-content: space-between; }
	.x { background: transparent; border: none; color: var(--fg-muted); font-size: 22px; line-height: 1; cursor: pointer; }
	.note { margin: 0; font-size: 12.5px; color: var(--fg-muted); line-height: 1.5; }
	.field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--fg-muted); }
	.field .opt { font-style: normal; opacity: .7; }
	.field input { padding: 9px 11px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font-size: 13px; }
	.muted-note { margin: 0; font-size: 11.5px; color: var(--fg-muted); font-style: italic; }
	.modal-err { font-size: 12px; color: var(--danger); font-family: var(--mono); word-break: break-word; }
	.modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
