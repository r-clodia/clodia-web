/**
 * Auth store — the WebUI's view of the agent-server login session.
 *
 * The agent-server drives the Claude Max OAuth flow server-side and keeps a
 * single token in `~/.claude`. There is no per-browser token, so the WebUI
 * "session" is simply a client-side mirror of `GET /auth/status`:
 *
 *   { status: 'unknown' | 'checking' | 'authed' | 'anon', loggedIn, error }
 *
 * The store also owns the **dev-mode bypass**: when the app is built/served
 * with `PUBLIC_AUTH_DISABLED=1` (or `true`), the guard treats the user as
 * authenticated without ever calling the server, so the app stays fully
 * usable locally without completing the OAuth dance. This is the explicit
 * "don't make the app unusable" requirement from the brief.
 *
 * Browser-only concerns (sessionStorage caching) are guarded so the module
 * is safe to import in SSR even though the app runs as an SPA.
 */

import { writable, type Readable } from 'svelte/store';
import {
	getAuthStatus,
	startLogin as apiStartLogin,
	submitAuthCode as apiSubmitAuthCode,
	logout as apiLogout,
	ApiError
} from '$lib/api/client';
import type { AuthLoginResponse, AuthStatus } from '$lib/api/types';

/**
 * Dev-mode bypass flag.
 *
 * Read from the `PUBLIC_AUTH_DISABLED` Vite env (the `PUBLIC_` prefix exposes
 * it to client code, see `vite.config.ts`). Truthy values: `1`, `true`, `yes`,
 * `on` (case-insensitive). Anything else — including unset — means auth is
 * ENABLED (the safe default).
 */
function resolveAuthDisabled(): boolean {
	const raw =
		typeof import.meta !== 'undefined' &&
		(import.meta as { env?: Record<string, string | undefined> }).env
			?.PUBLIC_AUTH_DISABLED;
	if (typeof raw !== 'string') return false;
	return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/** Whether the auth gate is disabled for local development. */
export const AUTH_DISABLED: boolean = resolveAuthDisabled();

const SESSION_KEY = 'clodia.auth.session';

export type AuthPhase = 'unknown' | 'checking' | 'authed' | 'anon';

export interface AuthState {
	/** Coarse phase the guard branches on. */
	phase: AuthPhase;
	/** True when the agent-server reports a valid token (or bypass is on). */
	loggedIn: boolean;
	/** True while a `/auth/status` round-trip is in flight. */
	checking: boolean;
	/** Last error talking to the auth surface (network / server), if any. */
	error: string | null;
	/** True when the dev-mode bypass short-circuited the gate. */
	bypassed: boolean;
}

const initial: AuthState = {
	phase: AUTH_DISABLED ? 'authed' : 'unknown',
	loggedIn: AUTH_DISABLED,
	checking: false,
	error: null,
	bypassed: AUTH_DISABLED
};

const _state = writable<AuthState>(initial);

/** Public read-only handle to the auth state. */
export const auth: Readable<AuthState> = { subscribe: _state.subscribe };

// --- session cache (browser only) -----------------------------------------

function rememberSession(loggedIn: boolean): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		if (loggedIn) sessionStorage.setItem(SESSION_KEY, '1');
		else sessionStorage.removeItem(SESSION_KEY);
	} catch {
		/* storage may be unavailable (privacy mode) — ignore */
	}
}

/** True if a previous successful check is cached for this browser session. */
export function hasCachedSession(): boolean {
	if (AUTH_DISABLED) return true;
	if (typeof sessionStorage === 'undefined') return false;
	try {
		return sessionStorage.getItem(SESSION_KEY) === '1';
	} catch {
		return false;
	}
}

// --- actions ----------------------------------------------------------------

/**
 * Refresh the auth state from `GET /auth/status`.
 *
 * In dev-bypass mode this is a no-op that always resolves "authed". Otherwise
 * it updates the store and the session cache, and surfaces network/server
 * errors as `error` while leaving `loggedIn` false (so the guard sends the
 * user to /login, where the error is shown).
 *
 * Returns the resolved `loggedIn` boolean for callers that want to branch.
 */
export async function refreshAuth(opts?: { signal?: AbortSignal }): Promise<boolean> {
	if (AUTH_DISABLED) {
		_state.set({
			phase: 'authed',
			loggedIn: true,
			checking: false,
			error: null,
			bypassed: true
		});
		return true;
	}

	_state.update((s) => ({ ...s, phase: 'checking', checking: true, error: null }));
	try {
		const status: AuthStatus = await getAuthStatus({ signal: opts?.signal });
		rememberSession(status.logged_in);
		_state.set({
			phase: status.logged_in ? 'authed' : 'anon',
			loggedIn: status.logged_in,
			checking: false,
			error: status.login_error,
			bypassed: false
		});
		return status.logged_in;
	} catch (err) {
		const msg =
			err instanceof ApiError
				? err.message
				: err instanceof Error
					? err.message
					: 'Errore di rete contattando il server di autenticazione.';
		rememberSession(false);
		_state.set({
			phase: 'anon',
			loggedIn: false,
			checking: false,
			error: msg,
			bypassed: false
		});
		return false;
	}
}

/** Kick off the OAuth flow. Thin pass-through that surfaces the OAuth URL. */
export async function startLogin(): Promise<AuthLoginResponse> {
	const res = await apiStartLogin();
	if (res.status === 'already_logged_in') {
		rememberSession(true);
		_state.set({
			phase: 'authed',
			loggedIn: true,
			checking: false,
			error: null,
			bypassed: false
		});
	}
	return res;
}

/** Forward the OAuth return code to the agent-server. */
export async function submitAuthCode(code: string): Promise<void> {
	await apiSubmitAuthCode(code);
}

/**
 * Log out.
 *
 * In dev-bypass mode this does NOT touch the server (we don't want a local
 * dev convenience to wipe a real token); it just reports an info status so
 * the caller can toast "auth disabilitata". Otherwise it calls
 * `POST /auth/logout`, clears the cached session, and flips the store to
 * anonymous so the guard redirects to /login.
 */
export async function doLogout(): Promise<{ bypassed: boolean }> {
	if (AUTH_DISABLED) {
		return { bypassed: true };
	}
	try {
		await apiLogout();
	} finally {
		rememberSession(false);
		_state.set({
			phase: 'anon',
			loggedIn: false,
			checking: false,
			error: null,
			bypassed: false
		});
	}
	return { bypassed: false };
}
