<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';
	import {
		getBackupStatus, configureBackup, runBackup, backupSnapshots, restoreTest,
		ApiError, type BackupStatus
	} from '$lib/api/client';
	import { mintPairingToken } from '$lib/auth/session';
	import { toastSuccess, toastError } from '$lib/stores/toasts';

	let status: BackupStatus | null = null;
	let loading = true;
	let err = '';

	// form
	let backend = 's3';
	let repository = '';
	let passphrase = '';
	let accessKey = '';
	let secretKey = '';
	let keepDaily = 7, keepWeekly = 4, keepMonthly = 6;
	let schedule = '0 3 * * *';
	let saving = false, running = false, testing = false;
	let pairingQr = '';
	let pairingPayload = '';
	let pairingError = '';

	// env per backend: S3-compatible (B2/S3/MinIO) → AWS_*; B2 nativo → B2_*
	$: repoPlaceholder =
		backend === 'b2' ? 'b2:bucket:path' :
		backend === 'sftp' ? 'sftp:user@host:/path' :
		's3:s3.eu-central-003.backblazeb2.com/bucket'; // S3-compatible EU

	async function load() {
		loading = true; err = '';
		try {
			status = await getBackupStatus();
			if (status.schedule) schedule = status.schedule;
			if (status.retention) { keepDaily = status.retention.daily; keepWeekly = status.retention.weekly; keepMonthly = status.retention.monthly; }
		} catch (e) { err = e instanceof ApiError ? e.message : String(e); }
		finally { loading = false; }
	}

	function envForBackend(): Record<string, string> {
		if (backend === 'b2') return { B2_ACCOUNT_ID: accessKey, B2_ACCOUNT_KEY: secretKey };
		if (backend === 'sftp') return {};
		return { AWS_ACCESS_KEY_ID: accessKey, AWS_SECRET_ACCESS_KEY: secretKey };
	}

	async function save() {
		if (!repository.trim() || !passphrase.trim()) { toastError('Dati mancanti', 'repository e passphrase obbligatori'); return; }
		saving = true;
		try {
			await configureBackup({
				backend, repository: repository.trim(), env: envForBackend(),
				passphrase: passphrase.trim(),
				retention: { daily: keepDaily, weekly: keepWeekly, monthly: keepMonthly }, schedule
			});
			toastSuccess('Backup configurato', 'credenziali nel vault, repository inizializzato');
			passphrase = ''; secretKey = '';
			await load();
		} catch (e) { toastError('Configurazione fallita', e instanceof ApiError ? e.message : String(e)); }
		finally { saving = false; }
	}

	async function doRun() {
		running = true;
		try { const r = await runBackup(); r.ok ? toastSuccess('Backup eseguito', 'snapshot creato + verifica integrità OK') : toastError('Backup con errori', `check_rc=${r.check_rc}`); await load(); }
		catch (e) { toastError('Backup fallito', e instanceof ApiError ? e.message : String(e)); }
		finally { running = false; }
	}

	async function doTest() {
		testing = true;
		try { const r = await restoreTest(); r.ok ? toastSuccess('Restore-test OK', `${r.restored_topics} topic ripristinati e verificati`) : toastError('Restore-test fallito', 'nessun file ripristinato'); }
		catch (e) { toastError('Restore-test fallito', e instanceof ApiError ? e.message : String(e)); }
		finally { testing = false; }
	}

	function b64url(str: string): string {
		const bytes = new TextEncoder().encode(str);
		let raw = '';
		for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
		return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}

	async function createPairing() {
		pairingError = '';
		// Token EFFIMERO dedicato (5 min), non la sessione 12h: il QR è bearer.
		let minted: { principal: string; token: string; exp: number };
		try {
			minted = await mintPairingToken(300);
		} catch (e) {
			pairingError = e instanceof Error ? e.message : String(e);
			return;
		}
		const payload = {
			type: 'clodia.pwa.pairing',
			version: 1,
			principal: minted.principal,
			token: minted.token,
			exp: minted.exp,
			issued_at: Math.floor(Date.now() / 1000)
		};
		pairingPayload = `clodia-pairing:${b64url(JSON.stringify(payload))}`;
		pairingQr = await QRCode.toDataURL(pairingPayload, {
			errorCorrectionLevel: 'M',
			margin: 1,
			width: 248,
			color: { dark: '#0b0f14', light: '#ffffff' }
		});
	}

	async function copyPairing() {
		if (!pairingPayload) return;
		await navigator.clipboard?.writeText(pairingPayload);
		toastSuccess('Pairing copiato', 'incollalo nella PWA sul dispositivo da collegare');
	}

	onMount(load);
</script>

<header class="head">
	<h1>Settings</h1>
	<p class="hint">Configurazione della piattaforma · credenziali custodite nella <strong>vault</strong></p>
</header>

<section class="card">
	<div class="card-h">
		<h2>Backup &amp; restore</h2>
		<span class="iso">ISO 27001 · A.8.13</span>
	</div>
	<p class="note">
		La datadir (vault, topic, DB, PKI) viene salvata su storage <strong>off-site</strong>,
		<strong>cifrata lato-client</strong> (il provider vede solo blob cifrati). Consigliato un
		bucket in <strong>regione UE</strong> per coerenza con la classificazione SEAL dei dati.
	</p>

	{#if loading}
		<p class="muted">Carico stato…</p>
	{:else if err}
		<div class="err">{err}</div>
	{:else}
		<div class="state {status?.configured ? 'ok' : 'off'}">
			{#if status?.configured}
				✓ Configurato · <strong>{status.backend}</strong> · {status.repository}
				{#if status.last_snapshot}<br/>ultimo snapshot: {new Date(status.last_snapshot.time).toLocaleString('it-IT')} ({status.last_snapshot.id}){:else}<br/><em>nessuno snapshot ancora</em>{/if}
			{:else}
				Backup non ancora configurato.
			{/if}
		</div>

		<div class="grid">
			<label>Backend
				<select bind:value={backend}>
					<option value="s3">S3-compatible (Backblaze B2 / S3 / MinIO)</option>
					<option value="b2">Backblaze B2 (nativo)</option>
					<option value="sftp">SFTP</option>
				</select>
			</label>
			<label>Repository <input bind:value={repository} placeholder={repoPlaceholder} autocomplete="off" /></label>
			{#if backend !== 'sftp'}
				<label>{backend === 'b2' ? 'Account ID' : 'Access Key ID'} <input bind:value={accessKey} autocomplete="off" /></label>
				<label>{backend === 'b2' ? 'Application Key' : 'Secret Access Key'} <input type="password" bind:value={secretKey} autocomplete="off" /></label>
			{/if}
			<label>Passphrase (cifratura) <input type="password" bind:value={passphrase} placeholder="non recuperabile — custodiscila" autocomplete="off" /></label>
			<label>Schedule (cron) <input bind:value={schedule} placeholder="0 3 * * *" autocomplete="off" /></label>
		</div>
		<div class="retention">
			Retention (GFS):
			<label>giorn. <input type="number" min="0" bind:value={keepDaily} /></label>
			<label>settim. <input type="number" min="0" bind:value={keepWeekly} /></label>
			<label>mensili <input type="number" min="0" bind:value={keepMonthly} /></label>
		</div>

		<div class="actions">
			<button class="btn primary" on:click={save} disabled={saving}>{saving ? 'Salvo…' : 'Salva configurazione'}</button>
			<button class="btn" on:click={doRun} disabled={running || !status?.configured}>{running ? 'Backup in corso…' : 'Backup ora'}</button>
			<button class="btn" on:click={doTest} disabled={testing || !status?.configured}>{testing ? 'Test…' : 'Restore-test'}</button>
		</div>
	{/if}
</section>

<section class="card pairing">
	<div class="card-h">
		<h2>Dispositivo PWA</h2>
		<span class="iso">session pairing</span>
	</div>
	<p class="note">
		Collega la PWA scansionando un QR da questo browser già autenticato. La PWA riceve un token a breve scadenza (5 min), non la masterkey: anche se il QR finisse in uno screenshot, scade in fretta.
	</p>
	{#if pairingError}<div class="err">{pairingError}</div>{/if}
	<div class="actions">
		<button class="btn primary" on:click={createPairing}>Genera QR</button>
		<button class="btn" on:click={copyPairing} disabled={!pairingPayload}>Copia pairing</button>
	</div>
	{#if pairingQr}
		<div class="qr-wrap">
			<img src={pairingQr} alt="QR pairing PWA Clodia" />
			<p class="muted">Scansiona dalla PWA. Scade insieme alla sessione web corrente.</p>
		</div>
	{/if}
</section>

<style>
	.head { padding: 4px 0 14px; }
	h1 { margin: 0; font-size: 22px; }
	.hint { margin: 4px 0 0; color: var(--fg-muted); font-size: 13px; }
	.card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 18px; max-width: 720px; }
	.card + .card { margin-top: 14px; }
	.card-h { display: flex; align-items: baseline; justify-content: space-between; }
	.card-h h2 { margin: 0; font-size: 16px; }
	.iso { font-size: 11px; color: var(--fg-muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; }
	.note { font-size: 12.5px; color: var(--fg-muted); line-height: 1.5; margin: 10px 0 14px; }
	.muted { color: var(--fg-muted); font-size: 13px; }
	.err { color: #e85d75; font-size: 12.5px; }
	.state { font-size: 12.5px; padding: 8px 10px; border-radius: 8px; margin-bottom: 14px; line-height: 1.5; }
	.state.ok { border: 1px solid rgba(70,211,154,.4); background: rgba(70,211,154,.08); }
	.state.off { border: 1px solid var(--border); color: var(--fg-muted); }
	.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	@media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
	label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--fg-muted); }
	input, select { background: rgba(0,0,0,.2); border: 1px solid var(--border); color: var(--fg); border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13px; }
	.retention { display: flex; align-items: center; gap: 12px; margin: 14px 0; font-size: 12px; color: var(--fg-muted); flex-wrap: wrap; }
	.retention label { flex-direction: row; align-items: center; gap: 6px; }
	.retention input { width: 64px; }
	.actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
	.btn { background: rgba(0,0,0,.2); border: 1px solid var(--border); color: var(--fg); border-radius: 8px; padding: 9px 14px; font: inherit; font-size: 13px; cursor: pointer; }
	.btn.primary { background: var(--accent); color: #1a1208; font-weight: 700; border-color: transparent; }
	.btn:disabled { opacity: .5; }
	.qr-wrap { display: flex; align-items: center; gap: 14px; margin-top: 14px; flex-wrap: wrap; }
	.qr-wrap img { width: 248px; height: 248px; border-radius: 8px; background: #fff; padding: 8px; }
</style>
