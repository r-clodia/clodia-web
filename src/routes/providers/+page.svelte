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
	}

	// Metadati di presentazione per id (engine + blurb + DPA). Lo stato (connesso,
	// mechanism reale) arriva dal backend; questo è solo display.
	const META: Record<string, { engine: string; blurb: string; dpa: string }> = {
		'anthropic-api': {
			engine: 'Claude (claude-agent-sdk)',
			blurb: 'Anthropic via API, fatturazione a consumo. DPA commerciale (zero-retention/no-training): adatto ai dati confidenziali.',
			dpa: 'DPA commerciale'
		},
		'claude-pro-max': {
			engine: 'Claude (claude-agent-sdk)',
			blurb: 'Abbonamento Claude Pro/Max via login OAuth: costo fisso, niente consumo API. DPA consumer — non adatto di default ai dati confidenziali.',
			dpa: 'DPA consumer'
		},
		'openai-api': {
			engine: 'Codex (codex exec)',
			blurb: 'OpenAI via API, a consumo. DPA commerciale: adatto ai dati confidenziali.',
			dpa: 'DPA commerciale'
		},
		codex: {
			engine: 'Codex (codex exec)',
			blurb: 'Abbonamento ChatGPT (codex login): costo fisso. DPA consumer — non adatto di default ai dati confidenziali.',
			dpa: 'DPA consumer'
		},
		'aws-region-eu': {
			engine: 'Claude via AWS Bedrock',
			blurb: 'Claude via Amazon Bedrock, region EU (eu-west-1, Irlanda). DPA+SCC, no-training, no-retention, data residency EU: il miglior profilo tra i provider a controllo US.',
			dpa: 'DPA commerciale · EU'
		}
	};

	// Fallback statico se il backend non risponde: bedrock EU (SEAL-2) prima, poi API→abbonamento.
	const ORDER = ['aws-region-eu', 'anthropic-api', 'claude-pro-max', 'openai-api', 'codex'];
	function staticCard(id: string): Provider {
		const m = META[id];
		return {
			id,
			name: prettyName(id),
			engine: m?.engine ?? '',
			blurb: m?.blurb ?? '',
			mechanism: id.endsWith('-api') || id === 'aws-region-eu' ? 'apikey' : 'subscription',
			dpa: m?.dpa ?? '',
			connected: false
		};
	}
	function prettyName(id: string): string {
		return (
			{ 'anthropic-api': 'Anthropic API', 'claude-pro-max': 'Claude Pro/Max',
			  'openai-api': 'OpenAI API', codex: 'Codex / ChatGPT',
			  'aws-region-eu': 'AWS Bedrock (EU)' }[id] ?? id
		);
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
					paused: l.paused ?? false
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
	let oauthCode = ''; // stringa `code#state` incollata dopo l'autorizzazione
	let authUrl = ''; // authorize URL del provider (aperto in una tab)
	let busy = false;
	let modalError = '';

	function openConnect(p: Provider) {
		modalProvider = p;
		// La card ha un solo meccanismo → vai dritto allo step giusto.
		step = p.mechanism === 'subscription' ? 'oauth' : 'key';
		apiKey = '';
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
		if (!apiKey.trim()) {
			modalError = 'Inserisci la API key.';
			return;
		}
		busy = true;
		modalError = '';
		try {
			await setProviderKey(modalProvider.id, apiKey.trim());
			toastSuccess(`${modalProvider.name} connesso`, 'API key');
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
				<span class="tag" class:tag-dpa={p.dpa.includes('commerciale')}>{p.dpa}</span>
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
					<span>API key {modalProvider.name}</span>
					<input type="password" bind:value={apiKey} placeholder="sk-…" autocomplete="off" />
				</label>
				<p class="muted-note">La chiave viene salvata nel keystore di clodia-logic, mai esposta al modello.</p>
			{/if}

			{#if modalError}<div class="modal-err">{modalError}</div>{/if}

			<div class="modal-foot">
				<button type="button" class="btn" on:click={closeModal} disabled={busy}>Annulla</button>
				{#if step === 'key'}
					<button type="button" class="btn primary" on:click={submitApiKey} disabled={busy}>
						{busy ? 'Salvo…' : 'Salva API key'}
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
	.field input { padding: 9px 11px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font-size: 13px; }
	.muted-note { margin: 0; font-size: 11.5px; color: var(--fg-muted); font-style: italic; }
	.modal-err { font-size: 12px; color: var(--danger); font-family: var(--mono); word-break: break-word; }
	.modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
