/**
 * Session — login dell'utente UMANO in clodia-web (F2a).
 *
 * L'utente carica la propria recovery key (pkcs8 base64, mostrata al claim):
 * il browser deriva la privkey Ed25519 e firma un **session token ckt1**
 *   ckt1.<b64url(payload)>.<b64url(sig)>   payload={agent,execution_id,iat,exp,aud}
 * identico al formato del runner (pki.mint/verify_session_token). Il token va
 * nel localStorage e viene allegato come `Authorization: Bearer` alle API; il
 * backend lo verifica con la CA e ne ricava il **principal** (l'utente connesso),
 * propagato fino a `runtime.current_user`.
 *
 * La privkey NON viene persistita: si rifirma il token dalla recovery quando
 * serve. WebCrypto Ed25519 richiede secure context (https o localhost).
 */
import { writable, type Readable } from 'svelte/store';

const LS_KEY = 'clodia.session';
const AUD = 'keystore';
const PREFIX = 'ckt1';
const DEFAULT_TTL = 12 * 3600; // 12h

export interface Session {
	principal: string;
	token: string;
	exp: number; // epoch seconds
}

function load(): Session | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(LS_KEY);
		if (!raw) return null;
		const s = JSON.parse(raw) as Session;
		if (!s?.token || (s.exp && s.exp * 1000 < Date.now())) {
			localStorage.removeItem(LS_KEY);
			return null;
		}
		return s;
	} catch {
		return null;
	}
}

const _store = writable<Session | null>(load());
export const session: Readable<Session | null> = { subscribe: _store.subscribe };

function b64urlBytes(b: ArrayBuffer | Uint8Array): string {
	const u = b instanceof Uint8Array ? b : new Uint8Array(b);
	let s = '';
	for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str: string): string {
	return b64urlBytes(new TextEncoder().encode(str));
}
/** Estrae la chiave base64 anche se l'utente incolla l'intero file recovery
 *  (header + chiave) o se il copy-paste introduce a-capo/spazi/caratteri
 *  invisibili. Strategia: per ogni riga togli whitespace e invisibili, scarta
 *  header PEM e righe NON di pura base64 (contengono spazi/accenti/punteggiatura
 *  → eliminate), poi UNISCI le righe di base64 superstiti (gestisce il wrapping). */
function extractKeyB64(text: string): string {
	// Rimuove whitespace e caratteri invisibili (NBSP, zero-width, BOM) da copy-paste.
	const INVIS = /[\s\u00A0\u200B\u200C\u200D\uFEFF]+/g;
	const lines = text
		.split(/\r?\n/)
		.map((l) => l.replace(INVIS, ''))
		.filter((l) => l && !l.startsWith('-----') && /^[A-Za-z0-9+/_=-]+$/.test(l));
	const joined = lines.join('');
	// fallback: tutto su una riga → tieni solo caratteri base64/base64url
	return joined || text.replace(INVIS, '').replace(/[^A-Za-z0-9+/_=-]/g, '');
}

function bytesFromB64(b64: string): Uint8Array {
	const clean = b64.trim().replace(/-/g, '+').replace(/_/g, '/');
	const pad = clean + '='.repeat((4 - (clean.length % 4)) % 4);
	const s = atob(pad);
	const u = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
	return u;
}

/** Firma un session token ckt1 per `principal` con la recovery key (pkcs8 b64). */
export async function signToken(
	principal: string,
	recoveryB64: string,
	ttlSeconds = DEFAULT_TTL
): Promise<{ token: string; exp: number }> {
	if (!globalThis.crypto?.subtle) {
		throw new Error('WebCrypto non disponibile in questo browser (serve https o localhost)');
	}
	const pkcs8 = bytesFromB64(extractKeyB64(recoveryB64));
	const key = await crypto.subtle.importKey(
		'pkcs8', pkcs8 as unknown as BufferSource, { name: 'Ed25519' }, false, ['sign']);
	const now = Math.floor(Date.now() / 1000);
	const exp = now + ttlSeconds;
	const payload = { agent: principal, execution_id: '', iat: now, exp, aud: AUD };
	const body = b64urlStr(JSON.stringify(payload));
	const sig = await crypto.subtle.sign(
		{ name: 'Ed25519' }, key, new TextEncoder().encode(body) as unknown as BufferSource);
	return { token: `${PREFIX}.${body}.${b64urlBytes(sig)}`, exp };
}

/** Chiede al server CHI è il possessore di questa chiave (identificazione dalla
 *  firma: prova i cert dei principal umani). 401 se nessuno combacia. */
async function whoami(token: string): Promise<{ principal: string }> {
	const res = await fetch('/clodia/whoami', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token })
	});
	if (res.status === 401) {
		throw new Error('Chiave non riconosciuta: non corrisponde a nessun profilo.');
	}
	if (!res.ok) throw new Error(`Login non riuscita (HTTP ${res.status})`);
	return res.json();
}

/**
 * Login: l'utente fornisce SOLO la masterkey (recovery). Il client firma una
 * probe, il server identifica il principal dalla firma (nome + ruolo derivati
 * dal cert, non digitati), poi si firma il token di sessione vero col nome.
 * Una chiave non corrispondente a nessun cert viene rifiutata dal server.
 */
const LS_REMEMBER = 'clodia.remember'; // { principal, mk } se "ricordami" attivo

export async function login(recoveryB64: string, remember = false): Promise<void> {
	if (!recoveryB64.trim()) throw new Error('Incolla la tua masterkey (recovery key)');
	// 1) probe a breve scadenza per farsi identificare (nome ignoto = '')
	const probe = await signToken('', recoveryB64, 600);
	const { principal } = await whoami(probe.token);
	// 2) token di sessione definitivo col nome verificato dal server
	const { token, exp } = await signToken(principal, recoveryB64);
	const s: Session = { principal, token, exp };
	localStorage.setItem(LS_KEY, JSON.stringify(s));
	// "Ricordami su questo dispositivo": salva la masterkey per ri-firmare il token
	// alla scadenza senza richiederla (resta nel localStorage di questo browser).
	if (remember) localStorage.setItem(LS_REMEMBER, JSON.stringify({ principal, mk: recoveryB64 }));
	_store.set(s);
}

/** Al boot: se la sessione è scaduta/assente ma "ricordami" è attivo, ri-firma un
 *  token dalla masterkey salvata — così non viene richiesta a ogni apertura. */
export async function restoreSession(): Promise<boolean> {
	if (load()) return true;
	if (typeof localStorage === 'undefined') return false;
	let r: { principal?: string; mk?: string } | null = null;
	try { r = JSON.parse(localStorage.getItem(LS_REMEMBER) || 'null'); } catch { r = null; }
	if (!r?.mk || !r?.principal) return false;
	try {
		const { token, exp } = await signToken(r.principal, r.mk);
		const s: Session = { principal: r.principal, token, exp };
		localStorage.setItem(LS_KEY, JSON.stringify(s));
		_store.set(s);
		return true;
	} catch {
		return false;
	}
}

export function logout(): void {
	if (typeof localStorage !== 'undefined') {
		localStorage.removeItem(LS_KEY);
		localStorage.removeItem(LS_REMEMBER);
	}
	_store.set(null);
}

/** Secondi prima della scadenza entro cui ri-firmare proattivamente il token,
 *  così non scade mai a sessione aperta (evita richieste anonime silenziose). */
const REFRESH_SKEW = 30 * 60; // 30 min

/**
 * Mantiene fresco il session token. Da chiamare periodicamente e quando la
 * scheda torna in foreground:
 * - token valido e non in scadenza → no-op;
 * - token scaduto o in scadenza (< REFRESH_SKEW) → ri-firma da "Ricordami"
 *   (masterkey salvata), aggiornando localStorage + store;
 * - token scaduto e nessun "Ricordami" (o ri-firma fallita) → logout pulito
 *   (→ schermata di login), invece di restare "loggati" mandando API anonime.
 *
 * Risolve il bug per cui, alla scadenza dei 12h a sessione aperta, lo store in
 * memoria restava valorizzato ma `authToken()` tornava null → viste per-utente
 * vuote senza avviso.
 */
export async function ensureFreshSession(): Promise<void> {
	if (typeof localStorage === 'undefined') return;
	const s = load(); // null se scaduto/assente (load() rimuove gli scaduti)
	const now = Math.floor(Date.now() / 1000);
	const expiringSoon = !!s && !!s.exp && s.exp - now < REFRESH_SKEW;
	if (s && !expiringSoon) return; // ancora valido e lontano dalla scadenza

	let r: { principal?: string; mk?: string } | null = null;
	try { r = JSON.parse(localStorage.getItem(LS_REMEMBER) || 'null'); } catch { r = null; }
	if (r?.mk && r?.principal) {
		try {
			const { token, exp } = await signToken(r.principal, r.mk);
			const ns: Session = { principal: r.principal, token, exp };
			localStorage.setItem(LS_KEY, JSON.stringify(ns));
			_store.set(ns);
			return;
		} catch {
			/* ri-firma fallita → gestita sotto */
		}
	}
	// Nessun "Ricordami" o ri-firma fallita: se il token è ormai scaduto, esci
	// pulito così l'app mostra il login invece di mandare richieste anonime.
	if (!s) logout();
}

/** Token corrente per l'header Authorization, o null se non loggato/scaduto. */
export function authToken(): string | null {
	return load()?.token ?? null;
}

export function currentSession(): Session | null {
	return load();
}

/**
 * Conia un token EFFIMERO dedicato al pairing PWA (default 5 min), firmandolo
 * con la masterkey salvata da "Ricordami". Un QR di pairing NON deve riusare il
 * token di sessione (12h): è bearer e finirebbe in una foto/screenshot. Richiede
 * "Ricordami" attivo (la masterkey è l'unico modo per firmare un nuovo token).
 */
export async function mintPairingToken(ttlSeconds = 300): Promise<{ principal: string; token: string; exp: number }> {
	let r: { principal?: string; mk?: string } | null = null;
	try { r = JSON.parse(localStorage.getItem(LS_REMEMBER) || 'null'); } catch { r = null; }
	if (!r?.mk || !r?.principal) {
		throw new Error('Per generare un pairing sicuro attiva "Ricordami" al login (serve la masterkey per coniare un token a breve scadenza).');
	}
	const { token, exp } = await signToken(r.principal, r.mk, ttlSeconds);
	return { principal: r.principal, token, exp };
}

/**
 * Valida la sessione lato SERVER: il token in localStorage potrebbe essere
 * scaduto o firmato con una chiave non più corrispondente al cert (es. cert
 * riemesso). Il gate non deve fidarsi della sola presenza. Chiede a
 * `/clodia/whoami` chi è il proprietario della firma: se non combacia col
 * principal salvato (o 401) → logout. Fail-open SOLO su errore di rete.
 */
export async function validateSession(): Promise<boolean> {
	const s = load();
	if (!s) return false;
	try {
		const r = await fetch('/clodia/whoami', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: s.token })
		});
		if (!r.ok) {
			logout();
			return false;
		}
		const data = (await r.json()) as { principal?: string };
		if (data.principal !== s.principal) {
			logout();
			return false;
		}
		return true;
	} catch {
		return true; // rete/server giù → non sloggare (fail-open)
	}
}
