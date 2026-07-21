<script lang="ts">
	/**
	 * "+ Nuovo agente" — crea un seed user-defined (POST /api/agents).
	 *
	 * Allineato al nuovo schema del seed. Due tipi creabili:
	 *   - normal: worker eseguito da un motore (claude/codex/opencode) con modello
	 *     e costituzione (default platform-core).
	 *   - human:  principal umano (identità/clearance PKI), NON eseguito da un
	 *     motore → niente sdk/modello; costituzione = none (è l'autorità, non è
	 *     governato dalla costituzione di piattaforma).
	 *
	 * I super-agent (clodia, ophelia) sono NATIVI (seed nel repo) e non sono
	 * creabili da qui — il backend li rifiuta (409).
	 */
	import { createEventDispatcher } from 'svelte';
	import Modal from './Modal.svelte';
	import type { Agent } from '$lib/api/types';
	import { createAgent, generateAgentPfp, ApiError } from '$lib/api/client';
	import { toastSuccess, toastError, toastInfo } from '$lib/stores/toasts';

	export let open: boolean = false;
	/** Agenti esistenti, candidati come ancestor da cui ereditare le skill. */
	export let agents: ReadonlyArray<Agent> = [];
	const dispatch = createEventDispatcher<{ close: void; created: Agent }>();

	type AgentType = 'normal' | 'human';
	const MODEL_DEFAULTS: Record<string, string> = {
		claude: 'claude-haiku-4-5',
		codex: 'gpt-5-codex',
		opencode: ''
	};

	let type: AgentType = 'human';
	let name = '';
	let displayName = '';
	let description = '';
	let agentSdk: 'claude' | 'codex' | 'opencode' = 'claude';
	let model = MODEL_DEFAULTS.claude;
	let constitution = 'platform-core';
	let avatarColor = '#888888';
	let parents: string[] = [];
	// human: clearance privacy + pubkey opzionale incollata (certifica la chiave
	// di un utente che ha fatto "Request certificate"; se vuota, si genera qui).
	let clearance: 'SEAL-0' | 'SEAL-1' | 'SEAL-2' | 'SEAL-3' | 'SEAL-4' = 'SEAL-0';
	let humanPubkey = '';
	let submitting = false;
	let submitError: string | null = null;

	// Avatar (PFP) — generata da gpt-image-2 sul gateway. Due input alternativi:
	// un prompt testuale, oppure un'immagine caricata che viene ri-stilizzata.
	// In entrambi i casi il backend appende lo stile manga/ghibli.
	let pfpPrompt = '';
	let pfpDataUrl: string | null = null; // data URL dell'immagine caricata
	let pfpFileName = '';
	let phase: 'idle' | 'creating' | 'pfp' | 'recovery' = 'idle';

	// Admin Auth: per un agente HUMAN generiamo nel browser un keypair Ed25519;
	// la privkey non lascia il device, mandiamo la pubkey (la CA emette il cert).
	// Il RECOVERY (privkey pkcs8 base64) va salvato dall'utente: unica copia.
	let humanRecovery = '';

	async function genIdentity(): Promise<{ pubkeyPem: string; recovery: string }> {
		const kp = (await crypto.subtle.generateKey(
			{ name: 'Ed25519' },
			true,
			['sign', 'verify']
		)) as CryptoKeyPair;
		const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
		const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
		const b64 = (b: ArrayBuffer) => {
			const u = new Uint8Array(b);
			let s = '';
			for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
			return btoa(s);
		};
		const pem = (s: string, l: string) =>
			`-----BEGIN ${l}-----\n${s.match(/.{1,64}/g)?.join('\n') ?? s}\n-----END ${l}-----\n`;
		return { pubkeyPem: pem(b64(spki), 'PUBLIC KEY'), recovery: b64(pkcs8) };
	}

	function downloadRecovery() {
		const blob = new Blob(
			['CLODIA AGENCY — ADMIN RECOVERY KEY\n',
			 'Conserva OFFLINE e al sicuro: è l’unica copia della chiave privata\n',
			 'di questo admin. Serve per accedere da un nuovo dispositivo.\n\n',
			 humanRecovery, '\n'],
			{ type: 'text/plain' }
		);
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `clodia-${name.trim() || 'admin'}-recovery.txt`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function recoveryDone() {
		// L'istanza è ora reclamata (primo admin): ricarica per entrare dal flusso normale.
		location.reload();
	}

	function onPfpFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) {
			pfpDataUrl = null;
			pfpFileName = '';
			return;
		}
		pfpFileName = file.name;
		const reader = new FileReader();
		reader.onload = () => {
			pfpDataUrl = typeof reader.result === 'string' ? reader.result : null;
		};
		reader.readAsDataURL(file);
	}

	function clearPfpFile() {
		pfpDataUrl = null;
		pfpFileName = '';
	}

	function onSdkChange() {
		if (MODEL_DEFAULTS[agentSdk]) model = MODEL_DEFAULTS[agentSdk];
	}

	function toggleParent(n: string) {
		if (parents.includes(n)) parents = parents.filter((p) => p !== n);
		else if (parents.length < 2) parents = [...parents, n];
	}

	function reset() {
		type = 'human';
		name = '';
		displayName = '';
		description = '';
		agentSdk = 'claude';
		model = MODEL_DEFAULTS.claude;
		constitution = 'platform-core';
		avatarColor = '#888888';
		parents = [];
		clearance = 'SEAL-0';
		humanPubkey = '';
		submitting = false;
		submitError = null;
		pfpPrompt = '';
		pfpDataUrl = null;
		pfpFileName = '';
		phase = 'idle';
		humanRecovery = '';
	}

	function onClose() {
		if (submitting) return;
		dispatch('close');
		setTimeout(reset, 200);
	}

	$: nameValid = /^[a-z][a-z0-9_-]{1,30}$/.test(name);
	$: canSubmit = !submitting && nameValid && description.trim().length > 0;

	async function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		submitting = true;
		submitError = null;
		phase = 'creating';
		const spec: Record<string, unknown> = {
			name: name.trim(),
			description: description.trim(),
			type,
			avatar_color: avatarColor
		};
		if (displayName.trim()) spec.display_name = displayName.trim();
		if (type === 'normal') {
			spec.agent_sdk = agentSdk;
			spec.model = model.trim();
			spec.constitution = constitution;
			if (parents.length) spec.parents = parents;
		} else {
			// human = principal, non eseguito: nessuna costituzione di piattaforma
			spec.constitution = 'none';
			spec.clearance = clearance;
		}
		// human: due percorsi —
		//  (a) pubkey INCOLLATA (certifica la chiave di un utente che ha fatto
		//      "Request certificate"): nessuna generazione, nessun recovery da mostrare;
		//  (b) pubkey vuota: genera l'identità qui (es. crei tu un nuovo umano).
		let recovery = '';
		if (type === 'human') {
			const pasted = humanPubkey.trim();
			if (pasted) {
				if (!pasted.includes('BEGIN PUBLIC KEY')) {
					submitting = false;
					phase = 'idle';
					submitError = 'Pubkey non valida (attesa PEM "BEGIN PUBLIC KEY").';
					return;
				}
				spec.pubkey = pasted;
			} else {
				if (typeof crypto?.subtle?.generateKey !== 'function') {
					submitting = false;
					phase = 'idle';
					submitError = 'WebCrypto non disponibile in questo browser.';
					return;
				}
				try {
					const id = await genIdentity();
					spec.pubkey = id.pubkeyPem;
					recovery = id.recovery;
				} catch (err) {
					submitting = false;
					phase = 'idle';
					submitError = err instanceof Error ? err.message : String(err);
					return;
				}
			}
		}
		let created: Agent;
		try {
			created = await createAgent(spec as Partial<Agent>);
		} catch (err) {
			submitting = false;
			phase = 'idle';
			submitError =
				err instanceof ApiError || err instanceof Error ? err.message : String(err);
			toastError('Creazione agente fallita', submitError);
			return;
		}
		toastSuccess(
			`Agente "${spec.name}" creato`,
			type === 'human' ? 'human (principal)' : `${agentSdk} · ${model}`
		);
		// human: mostra il recovery (da salvare) invece di chiudere subito.
		if (type === 'human' && recovery) {
			humanRecovery = recovery;
			phase = 'recovery';
			submitting = false;
			dispatch('created', created);
			return;
		}
		// Avatar: se l'utente ha fornito un prompt o un'immagine, genera la PFP.
		// Errore NON fatale: l'agente è già creato, la pfp è opzionale.
		const wantsPfp = pfpPrompt.trim().length > 0 || !!pfpDataUrl;
		if (wantsPfp) {
			phase = 'pfp';
			try {
				await generateAgentPfp(created.name, {
					prompt: pfpPrompt.trim() || undefined,
					imageB64: pfpDataUrl || undefined
				});
				toastSuccess('Avatar generato', 'stile manga/ghibli via gpt-image-2');
			} catch (err) {
				const msg = err instanceof ApiError || err instanceof Error ? err.message : String(err);
				toastInfo('Avatar non generato', msg);
			}
		}
		submitting = false;
		phase = 'idle';
		dispatch('created', created);
		dispatch('close');
		setTimeout(reset, 200);
	}
</script>

<Modal {open} dismissable={!submitting} maxWidth={560} on:close={onClose}>
	<h2 slot="title">{phase === 'recovery' ? 'Salva il recovery' : 'Nuovo agente'}</h2>

	{#if phase === 'recovery'}
		<div class="recovery-panel">
			<div class="ok-badge">✓ Admin creato</div>
			<p class="warn">
				<strong>Salva subito il recovery.</strong> È l’unica copia della chiave privata
				di questo admin: senza, non potrai accedere da un nuovo dispositivo.
			</p>
			<textarea readonly rows="5" class="recovery-text">{humanRecovery}</textarea>
		</div>
	{:else}
	<form on:submit={onSubmit} class="form" id="new-agent-form">
		<fieldset class="seg" disabled={submitting}>
			<legend class="legend">Onboarding utente</legend>
			<div class="seg-row">
				<label class="seg-opt active">
					<input type="radio" bind:group={type} value="human" checked />
					<span class="s-label">Human agent</span>
					<span class="s-desc">principal umano (identità PKI), non eseguito</span>
				</label>
			</div>
			<p class="hint-inline">
				Da qui si crea solo un <strong>utente umano</strong> (onboarding).
				Gli <strong>agenti AI</strong> si installano tramite un <strong>pack</strong>
				(sezione Packs → Importa): per un nuovo agente, crea un pack che contiene il seed.
				I super-agent (clodia, ophelia) sono nativi.
			</p>
		</fieldset>

		<div class="grid">
			<label class="field">
				<span class="label-row">
					<span class="lbl">Name <span class="req">*</span></span>
					<span class="hint-inline">slug, a-z 0-9 _ -</span>
				</span>
				<input type="text" bind:value={name} placeholder="my-agent" required maxlength="32" autocomplete="off" />
				{#if name && !nameValid}
					<span class="err-inline">Inizia con una lettera, 2–32 char, solo a-z 0-9 _ -</span>
				{/if}
			</label>

			<label class="field">
				<span class="lbl">Display name</span>
				<input type="text" bind:value={displayName} placeholder="My Agent" maxlength="64" autocomplete="off" />
			</label>
		</div>

		<label class="field">
			<span class="lbl">Description <span class="req">*</span></span>
			<input type="text" bind:value={description} placeholder="Cosa fa / chi è, in una riga." required maxlength="240" autocomplete="off" />
		</label>

		{#if type === 'normal'}
			<div class="grid">
				<label class="field">
					<span class="lbl">Motore (agent_sdk)</span>
					<select bind:value={agentSdk} on:change={onSdkChange}>
						<option value="claude">claude</option>
						<option value="codex">codex</option>
						<option value="opencode">opencode</option>
					</select>
				</label>
				<label class="field">
					<span class="lbl">Model</span>
					<input type="text" bind:value={model} placeholder="claude-haiku-4-5" />
				</label>
			</div>

			<label class="field">
				<span class="lbl">Costituzione</span>
				<select bind:value={constitution}>
					<option value="platform-core">platform-core (lite, 3 principi)</option>
					<option value="none">nessuna</option>
				</select>
				<span class="hint-inline">Fusa in testa al system prompt al materialize del seed.</span>
			</label>

			{#if agents.length}
				<div class="field">
					<span class="lbl">Ancestors <span class="hint-inline">(eredita le skill come attributi di specie · max 2)</span></span>
					<div class="ancestors">
						{#each agents as a (a.name)}
							<button
								type="button"
								class="anc"
								class:on={parents.includes(a.name)}
								disabled={!parents.includes(a.name) && parents.length >= 2}
								on:click={() => toggleParent(a.name)}
							>{a.display_name || a.name}</button>
						{/each}
					</div>
				</div>
			{/if}
		{:else}
			<!-- human: principal umano (member). Clearance + opzionale pubkey utente. -->
			<label class="field">
				<span class="lbl">Clearance privacy</span>
				<select bind:value={clearance}>
					<option value="SEAL-0">SEAL-0 · Public</option>
					<option value="SEAL-1">SEAL-1 · Internal</option>
					<option value="SEAL-2">SEAL-2 · Confidential</option>
					<option value="SEAL-3">SEAL-3 · Restricted</option>
					<option value="SEAL-4">SEAL-4 · Sovereign</option>
				</select>
				<span class="hint-inline">Vede un topic sse T.privacy ≤ clearance.</span>
			</label>
			<label class="field">
				<span class="lbl">Pubkey dell'utente <span class="hint-inline">(da "Request certificate"; vuoto = genera qui)</span></span>
				<textarea bind:value={humanPubkey} rows="3" placeholder="-----BEGIN PUBLIC KEY-----…" autocomplete="off"></textarea>
			</label>
		{/if}

		<fieldset class="seg" disabled={submitting}>
			<legend class="legend">Avatar</legend>

			<label class="field">
				<span class="lbl">Prompt avatar <span class="hint-inline">(generato in stile manga/ghibli)</span></span>
				<input
					type="text"
					bind:value={pfpPrompt}
					placeholder="es. volpe astuta con occhiali, sfondo tenue"
					maxlength="240"
					autocomplete="off"
					disabled={!!pfpDataUrl}
				/>
			</label>

			<div class="field">
				<span class="lbl">…oppure carica un'immagine <span class="hint-inline">(verrà ri-stilizzata)</span></span>
				<div class="upload-row">
					<input type="file" accept="image/*" on:change={onPfpFile} />
					{#if pfpFileName}
						<span class="file-name" title={pfpFileName}>{pfpFileName}</span>
						<button type="button" class="link-btn" on:click={clearPfpFile}>rimuovi</button>
					{/if}
				</div>
			</div>

			<p class="hint-inline">
				La PFP finale è sempre generata da <code>gpt-image-2</code> con stile
				<em>no fotorealistic, manga, studio ghibli</em>. Richiede l'integrazione
				<strong>Image generation (OpenAI)</strong> attiva. Se assente, l'agente è creato
				lo stesso con avatar a colore.
			</p>

			<label class="field">
				<span class="lbl">Colore di fallback</span>
				<div class="color-row">
					<input type="color" bind:value={avatarColor} aria-label="Avatar color picker" />
					<input type="text" bind:value={avatarColor} placeholder="#888888" maxlength="9" class="mono" />
				</div>
			</label>
		</fieldset>

		<p class="hint-inline">
			Lo scaffold (agent.yaml + system-prompt.md + memory/) è generato dal backend
			dallo schema. Identità PKI emessa al bootstrap. Il system prompt si edita poi
			in <code>agents/{name || '<name>'}/system-prompt.md</code>.
		</p>

		{#if submitError}
			<div class="status err" role="alert">
				<strong>Errore:</strong> <span class="err-msg">{submitError}</span>
			</div>
		{/if}
	</form>
	{/if}

	<svelte:fragment slot="actions">
		{#if phase === 'recovery'}
			<button type="button" class="btn-secondary" on:click={downloadRecovery}>⬇ Scarica recovery</button>
			<button type="button" class="btn-primary" on:click={recoveryDone}>Ho salvato, continua</button>
		{:else}
			<button type="button" class="btn-secondary" on:click={onClose} disabled={submitting}>Annulla</button>
			<button type="submit" form="new-agent-form" class="btn-primary" disabled={!canSubmit}>
				{#if phase === 'pfp'}<span class="spinner" aria-hidden="true"></span> Genero avatar…{:else if submitting}<span class="spinner" aria-hidden="true"></span> Creo…{:else}Crea agente{/if}
			</button>
		{/if}
	</svelte:fragment>
</Modal>

<style>
	.form { display: flex; flex-direction: column; gap: 14px; }
	.legend { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--fg-muted); padding: 0 4px; }
	fieldset { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px 14px; margin: 0; display: flex; flex-direction: column; gap: 10px; }
	.seg-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
	.seg-opt { position: relative; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; background: rgba(255, 255, 255, 0.015); transition: background 0.12s ease, border-color 0.12s ease; }
	.seg-opt:hover { background: rgba(255, 107, 61, 0.05); }
	.seg-opt.active { background: rgba(255, 107, 61, 0.12); border-color: var(--accent); }
	.seg-opt input { position: absolute; opacity: 0; pointer-events: none; }
	.s-label { font-weight: 700; font-size: 12.5px; }
	.s-desc { font-size: 11px; color: var(--fg-muted); line-height: 1.4; }
	.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	.field { display: flex; flex-direction: column; gap: 4px; }
	.label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
	.lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--fg-muted); font-weight: 600; }
	.req { color: var(--accent); font-weight: 700; }
	.hint-inline { font-size: 10.5px; color: var(--fg-muted); line-height: 1.45; }
	.hint-inline code { font-family: var(--mono); }
	.err-inline { font-size: 11px; color: var(--danger); }
	input[type='text'], input[type='color'], select { background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 6px; outline: none; }
	input[type='text']:focus, select:focus { border-color: var(--accent); }
	input[type='color'] { padding: 1px 2px; width: 42px; height: 32px; cursor: pointer; }
	.color-row { display: flex; gap: 6px; align-items: center; }
	.color-row input[type='text'] { flex: 1; }
	.upload-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
	.upload-row input[type='file'] { font-size: 12px; color: var(--fg-muted); max-width: 100%; }
	.file-name { font-size: 11.5px; color: var(--fg); font-family: var(--mono); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.link-btn { background: none; border: none; color: var(--accent); font-size: 11.5px; cursor: pointer; padding: 0; text-decoration: underline; }
	em { font-style: italic; }
	.mono { font-family: var(--mono); }
	.ancestors { display: flex; flex-wrap: wrap; gap: 6px; }
	.anc { font-size: 12px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--fg); cursor: pointer; transition: all 0.12s ease; }
	.anc:hover:not(:disabled) { border-color: var(--accent); }
	.anc.on { background: rgba(255, 107, 61, 0.14); border-color: var(--accent); color: var(--accent); font-weight: 700; }
	.anc:disabled { opacity: 0.4; cursor: not-allowed; }
	.status { padding: 10px 12px; border-radius: 8px; font-size: 12.5px; }
	.status.err { background: rgba(232, 93, 117, 0.1); border: 1px solid rgba(232, 93, 117, 0.5); color: var(--danger); }
	.status.err .err-msg { font-family: var(--mono); font-size: 11.5px; }
	.btn-secondary { background: transparent; }
	.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
	.btn-primary:hover:not(:disabled) { background: #ff7e55; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.spinner { width: 12px; height: 12px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.recovery-panel { display: flex; flex-direction: column; gap: 12px; }
	.ok-badge { color: #34d399; font-weight: 700; }
	.warn { font-size: 12.5px; line-height: 1.5; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 8px; padding: 10px 12px; margin: 0; }
	.recovery-text { font-family: var(--mono); font-size: 11px; width: 100%; resize: vertical; word-break: break-all; background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); border-radius: 6px; padding: 9px 11px; }
	@media (max-width: 560px) { .grid, .seg-row { grid-template-columns: 1fr; } }
</style>
