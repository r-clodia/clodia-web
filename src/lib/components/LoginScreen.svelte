<script lang="ts">
	import { login } from '$lib/auth/session';
	import { requestCert } from '$lib/api/client';

	type Mode = 'login' | 'register';
	let mode: Mode = 'login';

	// --- login (masterkey) ---
	let recovery = '';
	let busy = false;
	let error = '';

	async function submitLogin() {
		error = '';
		if (!recovery.trim()) {
			error = 'Incolla la tua masterkey (recovery key)';
			return;
		}
		busy = true;
		try {
			await login(recovery);
			recovery = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	// --- register (genera chiavi + richiedi certificato) ---
	let regName = '';
	let regContact = '';
	let genRecovery = '';
	let genPubkey = '';
	let regPhase: 'idle' | 'keys' | 'sent' = 'idle';
	let regSent: string[] = [];

	function b64(b: ArrayBuffer): string {
		const u = new Uint8Array(b);
		let s = '';
		for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
		return btoa(s);
	}
	function pem(s: string, label: string): string {
		return `-----BEGIN ${label}-----\n${s.match(/.{1,64}/g)?.join('\n') ?? s}\n-----END ${label}-----\n`;
	}

	async function genKeys() {
		error = '';
		if (typeof crypto?.subtle?.generateKey !== 'function') {
			error = 'WebCrypto non disponibile: apri la webui su https o localhost.';
			return;
		}
		busy = true;
		try {
			const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
				'sign',
				'verify'
			])) as CryptoKeyPair;
			const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
			const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
			genPubkey = pem(b64(spki), 'PUBLIC KEY');
			genRecovery = b64(pkcs8);
			regPhase = 'keys';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	function downloadRecovery() {
		const blob = new Blob(
			[
				'CLODIA AGENCY — RECOVERY KEY\n',
				'Conserva OFFLINE e al sicuro: è l’unica copia della chiave privata.\n',
				'Serve per accedere (login) una volta approvato dall’admin.\n\n',
				genRecovery,
				'\n'
			],
			{ type: 'text/plain' }
		);
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `clodia-${regName.trim() || 'utente'}-recovery.txt`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function sendRequest() {
		error = '';
		if (!regName.trim()) {
			error = 'Inserisci un nome';
			return;
		}
		busy = true;
		try {
			const res = await requestCert({
				pubkey: genPubkey,
				name: regName.trim(),
				contact: regContact.trim() || undefined
			});
			regSent = res.notified ?? [];
			regPhase = 'sent';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="screen">
	<div class="card">
		<div class="brand"><span class="mark">●</span> Clodia</div>

		{#if mode === 'login'}
			<h1>Accedi</h1>
			<p class="note">
				Incolla la tua <strong>masterkey</strong> (recovery key): il server riconosce il tuo
				profilo dalla firma. La chiave resta sul tuo dispositivo, non viene inviata.
			</p>
			<label class="field">
				<span>Masterkey</span>
				<textarea bind:value={recovery} rows="5"
					placeholder="incolla la masterkey/recovery (anche l'intero file va bene)"
					disabled={busy}></textarea>
			</label>
			{#if error}<div class="err">{error}</div>{/if}
			<button type="button" class="btn" on:click={submitLogin} disabled={busy}>
				{busy ? 'Accesso…' : 'Accedi'}
			</button>
			<p class="hint">
				Non sei registrato?
				<button type="button" class="link" on:click={() => { mode = 'register'; error = ''; }}>
					Genera le tue chiavi e richiedi l’accesso
				</button>
			</p>

		{:else if regPhase === 'sent'}
			<h1>Richiesta inviata</h1>
			<p class="note">
				La tua richiesta è stata inoltrata all’amministratore{regSent.length
					? ` (${regSent.join(', ')})`
					: ''}. Quando avrà emesso il tuo certificato potrai accedere con la
				<strong>masterkey</strong> che hai salvato.
			</p>
			{#if !regSent.length}
				<div class="err">Nessun canale di notifica configurato: avvisa l’admin manualmente.</div>
			{/if}
			<button type="button" class="btn" on:click={() => { mode = 'login'; regPhase = 'idle'; }}>
				Torna all’accesso
			</button>

		{:else}
			<h1>Richiedi l’accesso</h1>
			{#if regPhase === 'idle'}
				<p class="note">
					Genera una coppia di chiavi nel tuo browser. La chiave privata (recovery)
					<strong>resta sul tuo dispositivo</strong>: salvala. La chiave pubblica viene
					inviata all’admin che, approvando, emette il tuo certificato.
				</p>
				{#if error}<div class="err">{error}</div>{/if}
				<button type="button" class="btn" on:click={genKeys} disabled={busy}>
					{busy ? 'Genero…' : 'Genera coppia di chiavi'}
				</button>
			{:else}
				<p class="note">
					⚠️ <strong>Salva la recovery key</strong>: è l’unica copia della tua chiave privata.
				</p>
				<textarea class="rec" readonly rows="4">{genRecovery}</textarea>
				<button type="button" class="btn-sec" on:click={downloadRecovery}>Scarica recovery .txt</button>
				<label class="field">
					<span>Nome</span>
					<input type="text" bind:value={regName} placeholder="es. Giovanni" disabled={busy} />
				</label>
				<label class="field">
					<span>Contatto (opzionale)</span>
					<input type="text" bind:value={regContact} placeholder="email o telegram per l’admin" disabled={busy} />
				</label>
				{#if error}<div class="err">{error}</div>{/if}
				<button type="button" class="btn" on:click={sendRequest} disabled={busy}>
					{busy ? 'Invio…' : 'Request certificate'}
				</button>
			{/if}
			<p class="hint">
				<button type="button" class="link" on:click={() => { mode = 'login'; error = ''; }}>
					← Ho già un profilo, accedi
				</button>
			</p>
		{/if}
	</div>
</div>

<style>
	.screen { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--bg); }
	.card { width: min(460px, 100%); background: var(--card-bg); border: 1px solid var(--border); border-radius: 14px; padding: 26px; display: flex; flex-direction: column; gap: 12px; }
	.brand { font-weight: 800; font-size: 15px; color: var(--fg-muted); }
	.brand .mark { color: var(--accent); }
	h1 { margin: 2px 0 0; font-size: 22px; }
	.note { margin: 0; font-size: 12.5px; color: var(--fg-muted); line-height: 1.5; }
	.field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--fg-muted); }
	.field input, .field textarea { background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 9px 11px; border-radius: 7px; }
	.field textarea, .rec { font-family: var(--mono); font-size: 12px; }
	.rec { background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); padding: 9px 11px; border-radius: 7px; resize: vertical; }
	.err { color: var(--danger); font-size: 12px; }
	.btn { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font: inherit; font-weight: 700; font-size: 14px; padding: 10px 14px; border-radius: 8px; cursor: pointer; }
	.btn:disabled { opacity: .6; cursor: not-allowed; }
	.btn-sec { background: transparent; border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 9px 13px; border-radius: 8px; cursor: pointer; }
	.hint { margin: 4px 0 0; font-size: 11.5px; color: var(--fg-muted); line-height: 1.5; }
	.link { background: none; border: none; color: var(--accent); font: inherit; font-size: inherit; padding: 0; cursor: pointer; text-decoration: underline; }
</style>
