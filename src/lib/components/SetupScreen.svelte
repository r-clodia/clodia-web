<script lang="ts">
	/**
	 * SetupScreen — primo avvio: l'istanza NON ha un superadmin.
	 *
	 * Non si rivela nulla dell'app: solo questo modulo per configurare il primo
	 * agente UMANO, che diventa il superadmin (unico human accanto a clodia e
	 * ophelia). Genera il keypair Ed25519 nel browser (privkey mai inviata),
	 * manda la pubkey (la CA emette il cert) e mostra la recovery da salvare.
	 */
	import { createAgent, ApiError } from '$lib/api/client';
	import type { Agent } from '$lib/api/types';

	let name = '';
	let displayName = '';
	let phase: 'form' | 'creating' | 'recovery' = 'form';
	let recovery = '';
	let error = '';

	function b64(b: ArrayBuffer): string {
		const u = new Uint8Array(b);
		let s = '';
		for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
		return btoa(s);
	}
	function pem(s: string, label: string): string {
		return `-----BEGIN ${label}-----\n${s.match(/.{1,64}/g)?.join('\n') ?? s}\n-----END ${label}-----\n`;
	}
	async function genIdentity(): Promise<{ pubkeyPem: string; recovery: string }> {
		const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
			'sign',
			'verify'
		])) as CryptoKeyPair;
		const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
		const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
		return { pubkeyPem: pem(b64(spki), 'PUBLIC KEY'), recovery: b64(pkcs8) };
	}

	async function submit() {
		error = '';
		const slug = name.trim().toLowerCase();
		if (!/^[a-z0-9_-]+$/.test(slug)) {
			error = 'Nome non valido: minuscole, cifre, - e _';
			return;
		}
		if (typeof crypto?.subtle?.generateKey !== 'function') {
			error = 'WebCrypto non disponibile: apri la webui su https o localhost.';
			return;
		}
		phase = 'creating';
		try {
			const id = await genIdentity();
			const spec: Record<string, unknown> = {
				name: slug,
				type: 'human',
				constitution: 'none',
				pubkey: id.pubkeyPem
			};
			if (displayName.trim()) spec.display_name = displayName.trim();
			await createAgent(spec as Partial<Agent>);
			recovery = id.recovery;
			phase = 'recovery';
		} catch (e) {
			error = e instanceof ApiError || e instanceof Error ? e.message : String(e);
			phase = 'form';
		}
	}

	function downloadRecovery() {
		const blob = new Blob(
			[
				'CLODIA AGENCY — RECOVERY KEY\n',
				'Conserva OFFLINE e al sicuro: è l’unica copia della chiave privata.\n',
				'Serve per accedere (login) da qualsiasi dispositivo.\n\n',
				recovery,
				'\n'
			],
			{ type: 'text/plain' }
		);
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `clodia-${name.trim() || 'admin'}-recovery.txt`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function done() {
		// Istanza ora reclamata: ricarica → comparirà la login.
		location.reload();
	}
</script>

<div class="screen">
	<div class="card">
		<div class="brand"><span class="mark">●</span> Clodia</div>
		{#if phase === 'recovery'}
			<h1>Salva la recovery key</h1>
			<p class="note">
				Questa è l'<strong>unica copia</strong> della tua chiave privata. Salvala offline:
				ti serve per accedere. Senza, perdi l'accesso e l'istanza va riconfigurata.
			</p>
			<textarea class="rec" readonly rows="5">{recovery}</textarea>
			<div class="row">
				<button type="button" class="btn-sec" on:click={downloadRecovery}>Scarica .txt</button>
				<button type="button" class="btn" on:click={done}>Ho salvato, continua</button>
			</div>
		{:else}
			<h1>Configura il superadmin</h1>
			<p class="note">
				L'istanza non è ancora configurata. Crea il primo agente <strong>umano</strong>: sarà
				il <strong>superadmin</strong> (unico human, accanto a clodia e ophelia). Il keypair è
				generato nel browser; la chiave privata non lascia il dispositivo.
			</p>
			<label class="field">
				<span>Nome (principal)</span>
				<input type="text" bind:value={name} placeholder="es. owner" autocomplete="off"
					disabled={phase === 'creating'} on:keydown={(e) => e.key === 'Enter' && submit()} />
				<span class="hint">minuscole, cifre, <code>-</code> e <code>_</code></span>
			</label>
			<label class="field">
				<span>Nome visualizzato (opzionale)</span>
				<input type="text" bind:value={displayName} placeholder="es. owner" autocomplete="off"
					disabled={phase === 'creating'} />
			</label>
			{#if error}<div class="err">{error}</div>{/if}
			<button type="button" class="btn" on:click={submit} disabled={phase === 'creating'}>
				{phase === 'creating' ? 'Creazione…' : 'Crea superadmin'}
			</button>
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
	.field input { background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 9px 11px; border-radius: 7px; }
	.hint { font-size: 11px; }
	.rec { background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font-family: var(--mono); font-size: 12px; padding: 9px 11px; border-radius: 7px; resize: vertical; }
	.err { color: var(--danger); font-size: 12px; }
	.row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
	.btn { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font: inherit; font-weight: 700; font-size: 14px; padding: 10px 14px; border-radius: 8px; cursor: pointer; }
	.btn:disabled { opacity: .6; cursor: not-allowed; }
	.btn-sec { background: transparent; border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 13px; padding: 10px 13px; border-radius: 8px; cursor: pointer; }
</style>
