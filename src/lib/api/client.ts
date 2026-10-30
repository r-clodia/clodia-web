/**
 * Minimal HTTP + SSE client for the Clodia agent-server.
 *
 * Base URL precedence:
 *   1. `PUBLIC_API_BASE_URL` (Vite env, exposed because of the `PUBLIC_` prefix)
 *   2. Fallback: `''` (same origin — works behind any proxy/VPN without IP baking)
 *
 * The client is intentionally small: it manages auth headers and a session
 * in-memory GET cache so route changes can reuse data already fetched during
 * the current browser session. Mutating requests invalidate the cache.
 */

const FALLBACK_BASE_URL = '';

/** Resolve the base URL once per module load. */
function resolveBaseUrl(): string {
	// `import.meta.env` is replaced at build time by Vite. We read it lazily
	// here so that tests can override it via globals if needed.
	const fromEnv =
		typeof import.meta !== 'undefined' &&
		(import.meta as { env?: Record<string, string | undefined> }).env?.PUBLIC_API_BASE_URL;
	const raw = (fromEnv && fromEnv.trim()) || FALLBACK_BASE_URL;
	// Strip trailing slashes so callers can safely pass `/api/...`.
	return raw.replace(/\/+$/, '');
}

export const API_BASE_URL = resolveBaseUrl();

/** Error thrown when an HTTP response is not 2xx. */
export class ApiError extends Error {
	readonly status: number;
	readonly body: string;

	constructor(status: number, body: string, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.body = body;
	}
}

function joinUrl(path: string): string {
	if (/^https?:\/\//i.test(path)) return path;
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${API_BASE_URL}${suffix}`;
}

/**
 * Header di autenticazione dell'utente UMANO (session token ckt1), se loggato.
 * Allegato a tutte le richieste: il backend ne ricava il principal connesso.
 * `session.ts` non importa `client.ts` → nessun ciclo.
 */
export function authHeaders(): Record<string, string> {
	const tok = authToken();
	return tok ? { Authorization: `Bearer ${tok}` } : {};
}

async function parseError(res: Response): Promise<ApiError> {
	let body = '';
	try {
		body = await res.text();
	} catch {
		// ignore — body may be unreadable
	}
	const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
	const message = snippet
		? `HTTP ${res.status} ${res.statusText} — ${snippet}`
		: `HTTP ${res.status} ${res.statusText}`;
	return new ApiError(res.status, body, message);
}

async function parseJsonOrText<T>(res: Response): Promise<T> {
	const ct = res.headers.get('content-type') || '';
	if (ct.includes('application/json')) {
		return (await res.json()) as T;
	}
	// Some endpoints may return text/plain — surface it as-is.
	return (await res.text()) as unknown as T;
}

export interface RequestOptions {
	headers?: Record<string, string>;
	signal?: AbortSignal;
	cache?: boolean | { ttlMs?: number };
}

const DEFAULT_GET_TTL_MS = 30_000;
type CacheEntry = { expiresAt: number; promise: Promise<unknown> };
const getCache = new Map<string, CacheEntry>();

function cacheKey(path: string, headers: Record<string, string>): string {
	return `${authToken() || 'anon'}\n${joinUrl(path)}\n${JSON.stringify(headers)}`;
}

/**
 * La cache è **opt-in**: `cache: true` (o `{ttlMs}`) per richiesta.
 *
 * Il default è NON cachare, e non è una scelta conservativa a caso: in questa
 * app lo stato cambia per azione degli AGENTI, non solo dell'utente, mentre
 * l'invalidazione qui sotto scatta solo sulle mutazioni locali (apiPost/Put/
 * Patch/Delete). Con un default opt-out i poller — `/api/gate/pending` ogni 5s,
 * la pagina Activity ogni 4s — verrebbero serviti dalla cache e mostrerebbero
 * dati vecchi fino al TTL. Sul gate, che è una supervisione umana con finestra
 * di ~180s, sarebbero 30s di ritardo su un controllo di sicurezza.
 *
 * Vale la pena marcare `cache: true` solo sulle GET di dati STABILI (cataloghi,
 * elenchi di definizioni), che sono quelle che rallentano il cambio di sezione.
 */
function cacheTtl(opts: RequestOptions): number {
	if (opts.signal) return 0;              // richieste abortabili: mai cache
	if (opts.cache === true) return DEFAULT_GET_TTL_MS;
	if (typeof opts.cache === 'object') {
		return Math.max(0, opts.cache.ttlMs ?? DEFAULT_GET_TTL_MS);
	}
	return 0;                               // default: nessuna cache
}

export function invalidateApiCache(match?: string | RegExp): void {
	if (!match) {
		getCache.clear();
		return;
	}
	for (const key of Array.from(getCache.keys())) {
		if (typeof match === 'string' ? key.includes(match) : match.test(key)) {
			getCache.delete(key);
		}
	}
}

/** GET <path> and parse the response as JSON (or text if not JSON). */
export async function apiGet<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
	const headers = { Accept: 'application/json', ...authHeaders(), ...(opts.headers || {}) };
	const ttlMs = cacheTtl(opts);
	const key = ttlMs > 0 ? cacheKey(path, headers) : '';
	const now = Date.now();
	if (key) {
		const hit = getCache.get(key);
		if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;
	}
	const promise = fetch(joinUrl(path), {
		method: 'GET',
		headers,
		signal: opts.signal
	}).then(async (res) => {
		if (!res.ok) throw await parseError(res);
		return parseJsonOrText<T>(res);
	});
	if (key) {
		getCache.set(key, { expiresAt: now + ttlMs, promise });
		promise.catch(() => getCache.delete(key));
	}
	return promise;
}

/** POST <path> with a JSON body and parse the response as JSON (or text). */
export async function apiPost<T = unknown>(
	path: string,
	body: unknown,
	opts: RequestOptions = {}
): Promise<T> {
	const res = await fetch(joinUrl(path), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...authHeaders(),
			...(opts.headers || {})
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: opts.signal
	});
	if (!res.ok) throw await parseError(res);
	invalidateApiCache();
	return parseJsonOrText<T>(res);
}

/**
 * PATCH <path> with a JSON body and parse the response as JSON (or text).
 *
 * Used for partial updates (e.g. `PATCH /clodia/jobs/{id}` with only the
 * fields the user changed). Mirrors {@link apiPost} for content-type +
 * error handling, the only differences are the HTTP verb and that a 204
 * (No Content) response resolves to `undefined`.
 */
export async function apiPut<T = unknown>(
	path: string,
	body: unknown,
	opts: RequestOptions = {}
): Promise<T> {
	const res = await fetch(joinUrl(path), {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...authHeaders(),
			...(opts.headers || {})
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: opts.signal
	});
	if (!res.ok) throw await parseError(res);
	invalidateApiCache();
	if (res.status === 204) return undefined as unknown as T;
	const ct = res.headers.get('content-type') || '';
	if (!ct) return undefined as unknown as T;
	return parseJsonOrText<T>(res);
}

export async function apiPatch<T = unknown>(
	path: string,
	body: unknown,
	opts: RequestOptions = {}
): Promise<T> {
	const res = await fetch(joinUrl(path), {
		method: 'PATCH',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...authHeaders(),
			...(opts.headers || {})
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: opts.signal
	});
	if (!res.ok) throw await parseError(res);
	invalidateApiCache();
	if (res.status === 204) return undefined as unknown as T;
	const ct = res.headers.get('content-type') || '';
	if (!ct) return undefined as unknown as T;
	return parseJsonOrText<T>(res);
}

/**
 * DELETE <path>. Some servers return an empty body (204 No Content); we
 * tolerate that by returning `undefined as T` when the response has no body
 * or isn't JSON-y. Mirrors {@link apiGet} for everything else.
 */
export async function apiDelete<T = unknown>(
	path: string,
	opts: RequestOptions = {}
): Promise<T> {
	const res = await fetch(joinUrl(path), {
		method: 'DELETE',
		headers: { Accept: 'application/json', ...authHeaders(), ...(opts.headers || {}) },
		signal: opts.signal
	});
	if (!res.ok) throw await parseError(res);
	invalidateApiCache();
	// 204 No Content (or any empty body) → resolve with undefined.
	if (res.status === 204) return undefined as unknown as T;
	const ct = res.headers.get('content-type') || '';
	if (!ct) return undefined as unknown as T;
	return parseJsonOrText<T>(res);
}

// ---------------------------------------------------------------------------
// JOBS — thin typed wrappers around the read-only `/clodia/jobs` endpoints.
//
// Kept minimal on purpose: they only resolve the URL + apply the `Job` /
// `JobDetail` envelope types. Error and loading orchestration stay in the
// caller, mirroring how the AGENTS routes call `apiGet` directly.
// ---------------------------------------------------------------------------

import type {
	Agent,
	AgentReloadResponse,
	AgentsListResponse,
	AuthActionResponse,
	AuthLoginResponse,
	AuthStatus,
	Chat,
	ChatHistoryResponse,
	ChatMessage,
	ChatsListResponse,
	DatabasesInventory,
	InstanceProfile,
	AvailablePack,
	Pack,
	PackDrift,
	PackUpdateAllResult,
	Plugin,
	Rule,
	RuleDetail,
	Skill,
	SkillDetail,
	ColonyApproval,
	ColonyExecution,
	ColonyExecutionDetail,
	ColonyEvent,
	Pipeline,
	PipelineVersion,
	Job,
	JobCreate,
	JobDetail,
	JobRunResponse,
	JobUpdate,
	JobsListResponse,
	Topic,
	TopicGoal,
	TopicsListResponse,
	TopicTree
} from './types';
import { authToken } from '$lib/auth/session';

/**
 * Normalise a raw job payload from the server to the shape the UI consumes.
 *
 * Field mapping (server `JobOut` → UI `Job`):
 *   name          → nome
 *   cron_expr     → schedule (+ cron_expr preserved)
 *   last_run_at   → last_run
 *   last_status   → stato
 *   id (number)   → id (stringified — URLs need a string)
 *   stale / stale_reason → passati avanti come sono (giudizio del server)
 *
 * Unknown fields pass through unchanged so the "Raw payload" panel in the
 * detail view shows the full server response.
 */
function normaliseJob(raw: unknown): Job {
	if (!raw || typeof raw !== 'object') {
		return { id: '', nome: '' };
	}
	const r = raw as Record<string, unknown>;
	const id =
		typeof r.id === 'string'
			? r.id
			: typeof r.id === 'number'
			? String(r.id)
			: '';
	const nome =
		typeof r.nome === 'string'
			? (r.nome as string)
			: typeof r.name === 'string'
			? (r.name as string)
			: '';
	const schedule =
		typeof r.schedule === 'string'
			? (r.schedule as string)
			: typeof r.cron_expr === 'string'
			? (r.cron_expr as string)
			: null;
	const last_run =
		typeof r.last_run === 'string'
			? (r.last_run as string)
			: typeof r.last_run_at === 'string'
			? (r.last_run_at as string)
			: null;
	const stato =
		typeof r.stato === 'string'
			? (r.stato as string)
			: typeof r.last_status === 'string'
			? (r.last_status as string)
			: null;
	const enabled = typeof r.enabled === 'boolean' ? r.enabled : undefined;
	const durata =
		typeof r.durata === 'number'
			? r.durata
			: typeof r.last_duration_s === 'number'
			? r.last_duration_s
			: null;
	// Freschezza (clodia-platform#287). Passava già di qui con lo spread dei
	// campi ignoti, ma per caso: normalizzarla esplicitamente la rende un campo
	// del contratto invece di un residuo, e un server più vecchio — che quei
	// campi non li manda — resta un job semplicemente non stale.
	const stale = r.stale === true;
	const stale_reason = typeof r.stale_reason === 'string' ? r.stale_reason : null;
	// Preserve every server field on the result so the raw-payload viewer
	// stays useful; the canonical names (nome/schedule/...) win on
	// collision via the spread order.
	return {
		...r,
		id,
		nome,
		schedule,
		enabled,
		last_run,
		durata,
		stato,
		stale,
		stale_reason
	} as Job;
}

/**
 * GET `/clodia/jobs`.
 *
 * Tolerates two server shapes: `{ jobs: Job[] }` and a bare `Job[]`. Each
 * row is run through {@link normaliseJob} to bridge the
 * server's `name/cron_expr/last_run_at/...` → UI's `nome/schedule/last_run/...`
 * field aliases.
 */
export async function getJobs(opts: RequestOptions = {}): Promise<ReadonlyArray<Job>> {
	const data = await apiGet<JobsListResponse>('/clodia/jobs', opts);
	const raw = Array.isArray(data)
		? (data as ReadonlyArray<unknown>)
		: data && Array.isArray((data as { jobs?: unknown }).jobs)
		? ((data as { jobs: ReadonlyArray<unknown> }).jobs)
		: [];
	return raw.map(normaliseJob);
}

/** GET `/clodia/jobs/{id}` — full detail (configuration + recent runs). */
export async function getJob(id: string, opts: RequestOptions = {}): Promise<JobDetail> {
	const data = await apiGet<unknown>(`/clodia/jobs/${encodeURIComponent(id)}`, opts);
	return normaliseJob(data) as JobDetail;
}

// ---------------------------------------------------------------------------
// KANBAN wallboard — readonly aggregate of configured Trello boards.
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// COLONY — execution ledger + approval gates.
//
// Entrambi gli endpoint emettono bare array. Normalizziamo difensivamente:
// se il server (versioni più vecchie) non espone la route, la SPA fallback
// può rispondere con HTML — in quel caso ritorniamo [] invece di rompere
// il chiamante.
// ---------------------------------------------------------------------------

/** GET `/api/colony/executions?limit=N` — execution ledger, newest-first. */
export async function getColonyExecutions(
	limit = 100,
	opts: RequestOptions = {}
): Promise<ReadonlyArray<ColonyExecution>> {
	const data = await apiGet<unknown>(
		`/api/colony/executions?limit=${encodeURIComponent(String(limit))}`,
		opts
	);
	return Array.isArray(data) ? (data as ReadonlyArray<ColonyExecution>) : [];
}

/** GET `/api/colony/approvals?status=pending` — approval gate in attesa. */
export async function getColonyApprovals(
	status = 'pending',
	opts: RequestOptions = {}
): Promise<ReadonlyArray<ColonyApproval>> {
	const data = await apiGet<unknown>(
		`/api/colony/approvals?status=${encodeURIComponent(status)}`,
		opts
	);
	return Array.isArray(data) ? (data as ReadonlyArray<ColonyApproval>) : [];
}

// ---------------------------------------------------------------------------
// COLONY CONTROL PLANE — pipelines, execution detail, audit, strategy.
//
// Il backend (server/api/colony.py) serve già l'intero control plane; questi
// wrapper lo rendono finalmente raggiungibile dalla webui. Gli endpoint che
// emettono bare array sono normalizzati difensivamente a [] (come executions/
// approvals) per non rompere il chiamante se una versione vecchia del server
// risponde con la SPA fallback HTML.
// ---------------------------------------------------------------------------

/** GET `/api/colony/executions/{id}` — dettaglio + deliverable collegati. */
export async function getColonyExecution(
	executionId: string,
	opts: RequestOptions = {}
): Promise<ColonyExecutionDetail> {
	return apiGet<ColonyExecutionDetail>(
		`/api/colony/executions/${encodeURIComponent(executionId)}`,
		opts
	);
}

/** GET `/api/colony/events` — audit trail, newest-first, con filtri opzionali. */
export async function getColonyEvents(
	params: { limit?: number; agent?: string; action?: string; execution_id?: string } = {},
	opts: RequestOptions = {}
): Promise<ReadonlyArray<ColonyEvent>> {
	const qs = new URLSearchParams();
	if (params.limit !== undefined) qs.set('limit', String(params.limit));
	if (params.agent) qs.set('agent', params.agent);
	if (params.action) qs.set('action', params.action);
	if (params.execution_id) qs.set('execution_id', params.execution_id);
	const data = await apiGet<unknown>(`/api/colony/events?${qs.toString()}`, opts);
	return Array.isArray(data) ? (data as ReadonlyArray<ColonyEvent>) : [];
}

/** GET `/api/pipelines` — registry pipeline. */
export async function getPipelines(
	opts: RequestOptions = {}
): Promise<ReadonlyArray<Pipeline>> {
	const data = await apiGet<unknown>('/api/pipelines', opts);
	return Array.isArray(data) ? (data as ReadonlyArray<Pipeline>) : [];
}

/** GET `/api/pipelines/{name}` — dettaglio pipeline. */
export async function getPipeline(name: string, opts: RequestOptions = {}): Promise<Pipeline> {
	return apiGet<Pipeline>(`/api/pipelines/${encodeURIComponent(name)}`, opts);
}

/** GET `/api/pipelines/{name}/versions` — storico versioni. */
export async function getPipelineVersions(
	name: string,
	opts: RequestOptions = {}
): Promise<ReadonlyArray<PipelineVersion>> {
	const data = await apiGet<unknown>(
		`/api/pipelines/${encodeURIComponent(name)}/versions`,
		opts
	);
	return Array.isArray(data) ? (data as ReadonlyArray<PipelineVersion>) : [];
}

/** Transizioni di stato della pipeline (POST, ritornano la pipeline aggiornata). */
export async function validatePipeline(name: string, opts: RequestOptions = {}): Promise<Pipeline> {
	return apiPost<Pipeline>(`/api/pipelines/${encodeURIComponent(name)}/validate`, undefined, opts);
}
export async function activatePipeline(name: string, opts: RequestOptions = {}): Promise<Pipeline> {
	return apiPost<Pipeline>(`/api/pipelines/${encodeURIComponent(name)}/activate`, undefined, opts);
}
export async function pausePipeline(name: string, opts: RequestOptions = {}): Promise<Pipeline> {
	return apiPost<Pipeline>(`/api/pipelines/${encodeURIComponent(name)}/pause`, undefined, opts);
}
export async function deprecatePipeline(name: string, opts: RequestOptions = {}): Promise<Pipeline> {
	return apiPost<Pipeline>(`/api/pipelines/${encodeURIComponent(name)}/deprecate`, undefined, opts);
}

/** POST `/api/pipelines/{name}/seed-task` — card iniziale nella prima lane. */
export async function seedPipelineTask(
	name: string,
	body: { title: string; desc?: string },
	opts: RequestOptions = {}
): Promise<unknown> {
	return apiPost<unknown>(`/api/pipelines/${encodeURIComponent(name)}/seed-task`, body, opts);
}

/** POST `/api/colony/strategy` — invoca lo Strategy Agent su un obiettivo. */
export async function runStrategy(
	objective: string,
	opts: RequestOptions = {}
): Promise<Record<string, unknown>> {
	return apiPost<Record<string, unknown>>('/api/colony/strategy', { objective }, opts);
}

/** POST `/api/colony/strategy/generate` — strategy_output → pipeline DRAFT. */
export async function generatePipeline(
	name: string,
	strategyOutput: Record<string, unknown>,
	opts: RequestOptions = {}
): Promise<Pipeline> {
	return apiPost<Pipeline>(
		'/api/colony/strategy/generate',
		{ name, strategy_output: strategyOutput },
		opts
	);
}

/** POST `/api/colony/sync` — resync registry filesystem→DB. */
export async function colonySync(opts: RequestOptions = {}): Promise<Record<string, unknown>> {
	return apiPost<Record<string, unknown>>('/api/colony/sync', undefined, opts);
}

/** POST `/api/agents/consumer/poll-now` — forza un giro di polling del consumer. */
export async function consumerPollNow(opts: RequestOptions = {}): Promise<Record<string, unknown>> {
	return apiPost<Record<string, unknown>>('/api/agents/consumer/poll-now', undefined, opts);
}

// ---------------------------------------------------------------------------
// TOPICS — read-only wrappers around the `/topics` surface.
//
// The server identifies a topic by the pair (`classification`, `name`);
// both come back in the list response. File paths are topic-relative and
// are sent back via the `?path=` query of the file endpoint.
// ---------------------------------------------------------------------------

/**
 * GET `/topics`.
 *
 * Tolerates two server shapes: a bare `Topic[]` (what the server emits
 * today) and `{ topics: Topic[] }` (forward-compatible envelope), mirroring
 * how `getJobs` handles its list. Always returns a normalised array.
 */
export async function getTopics(opts: RequestOptions = {}): Promise<ReadonlyArray<Topic>> {
	const data = await apiGet<TopicsListResponse>('/topics', opts);
	if (Array.isArray(data)) return data;
	if (data && Array.isArray((data as { topics?: unknown }).topics)) {
		return (data as { topics: ReadonlyArray<Topic> }).topics;
	}
	return [];
}

/**
 * Segnali per-principal dei recent topics (issue clodia-platform#83):
 * `actionable` = mention non lette + gate pendenti assegnati a me (item, non
 * messaggi); `activity` = "si è mosso qualcosa" dopo l'ultima visita.
 * I topic non accessibili sono ASSENTI dalla mappa (mai un conteggio a zero).
 */
export interface TopicSignal {
	actionable: number;
	activity: boolean;
}
export async function getTopicSignals(
	keys: ReadonlyArray<string>,
	opts: RequestOptions = {}
): Promise<Record<string, TopicSignal>> {
	if (!keys.length) return {};
	const q = encodeURIComponent(keys.join(','));
	const data = await apiGet<{ signals?: Record<string, TopicSignal> }>(
		`/api/topics/signals?topics=${q}`,
		opts
	);
	return data?.signals ?? {};
}

/**
 * POST `/api/topics/{tier}/{name}/seen` — registra la visita (spegne il
 * pallino attività). Con `mentionsUpto` (ts dell'ultimo messaggio davvero
 * renderizzato) registra anche l'ack di lettura delle mention. Non tocca i
 * gate: quelli si spengono solo risolti o riassegnati.
 */
export async function postTopicSeen(
	tier: string,
	name: string,
	mentionsUpto?: string,
	opts: RequestOptions = {}
): Promise<void> {
	await apiPost(
		`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/seen`,
		mentionsUpto ? { mentions_upto: mentionsUpto } : {},
		opts
	);
}

/**
 * GET `/topics/{classification}/{name}/summary`.
 *
 * The server emits `text/plain; charset=utf-8` (markdown body). The
 * base client falls back to `text()` when the response isn't JSON, so we
 * type the wrapper as `string`.
 */
// ─── Canali (topic come group chat Slack-like) ───
export interface ChannelMessage {
	id: string;
	author: string;
	kind: 'human' | 'ai' | 'system';
	text: string;
	attachments: string[];
	ts: string;
}
export interface ChannelInfo {
	tier: string;
	name: string;
	/** The topic's message box (clodia-platform#583): its code, and the address
	 *  that reaches it ("" while the colony mailbox is not set). */
	message_box?: { code: string; address: string };
	meta: {
		title?: string;
		owner?: string;
		/** Mappa nome→ruolo dal 7 ago 2026. Un topic che nessuno ha ancora
		 *  toccato conserva la LISTA legacy, che vale tutta `contributor`: la
		 *  conversione avviene alla prima modifica, quindi entrambe le forme
		 *  circolano e chi legge deve saperle distinguere. */
		participants?: string[] | Record<string, string>;
		tier?: string;
		status?: string;
		deadline?: string | null;
		/** Path (dentro il topic) dell'immagine con cui la stanza si presenta.
		 *  La imposta solo l'owner; `logo_kind` è il tipo rilevato dai byte al
		 *  caricamento — il file non ha estensione, quindi chi lo serve non
		 *  potrebbe indovinarlo. */
		logo?: string;
		logo_kind?: string;
		schema_version?: number;
		/** Cartelle condivise Mac↔container agganciate a questo topic (20 set
		 *  2026): a differenza di Drive un BIND filesystem reale, non uno
		 *  specchio — nel topic è il mount `shared/` (#571), sul Mac
		 *  `ClodiaShared/<name>/`. Al più una. */
		local_folders?: { name: string }[];
		/** Datastores and RAG collections the topic imports, with per-agent
		 *  grants (clodia-platform#590). */
		data?: TopicDataImport[];
		/** The topic's own RAG collection (clodia-platform#599); absent until
		 *  the topic is indexed (then: enabled, collection unknown). */
		index?: TopicIndexMeta;
		/** Obiettivo del canale (clodia-platform#457): assente finché l'owner
		 *  non ne fissa uno. Sta nel meta e non fra i messaggi perché è un
		 *  requisito che deve restare leggibile quando la chat è andata avanti. */
		goal?: TopicGoal | null;
	};
	summary?: string;
	tldr?: string;
	/** Storia dei recap (TLDR) del topic, dal più recente. `seed` = entry corrente
	 *  sintetica quando non c'è ancora storia registrata. */
	recap_history?: { ts: string; tldr: string; seed?: boolean }[];
	/** Responder con un turno ATTUALMENTE in corso (dal backend): la UI mostra
	 *  l'indicatore di attività anche riaprendo il topic a metà turno. */
	active_responders?: string[];
	/** Istanze vive di ogni partecipante, per seed (agents-notebook A13).
	 *
	 *  Un seed multi-spawn è un SUPER-NODO: si disegna il seed e sotto una riga
	 *  per istanza, con ordinale e stato. `ordinal: null` = seed a istanza
	 *  singola, e allora non si mostra nessun `#N` — un `#1` suggerirebbe
	 *  l'esistenza di un `#2`.
	 *
	 *  Un partecipante senza istanze vive non compare nella mappa: è
	 *  partecipante, e in questo momento non gira niente. */
	participant_instances?: Record<string, { ordinal: number | null; state: 'working' | 'idle' }[]>;
	/** Chi ha azzerato il trifecta di questo canale, e quando (agents-notebook:
	 *  richiesta dell'owner del 17 ago 2026). Viaggia DENTRO `trifecta`, ma è
	 *  ridichiarato qui perché il tipo del profilo vive in `types.ts` e questo
	 *  campo è del canale. */
	/** Danger score «lethal trifecta» del canale (issue clodia-platform#77),
	 *  calcolato server-side dai grant dei partecipanti. `null` se non
	 *  calcolabile: la UI in quel caso non mostra il badge. */
	trifecta?: TrifectaProfile | null;
	/** Primo bit del vettore di contesto: contenuto non fidato ENTRATO nel canale
	 *  (clodia-platform#104 §4). Vive nel gateway ed è l'unico dei tre che cambia
	 *  in tempo reale — e l'unico che l'owner può azzerare, approvando. */
	taint?: { tainted: boolean; since?: number | null;
		sources?: { kind?: string; detail?: string; agent?: string; at?: number }[] } | null;
}
/** I tre lati del triangolo: dati privati · contenuto non fidato · uscita. */
export type TrifectaLeg = 'private_data' | 'untrusted_input' | 'egress';
export interface TrifectaAgentProfile {
	name: string;
	type?: string;
	human?: boolean;
	score: number;
	legs: Record<TrifectaLeg, boolean>;
	/** Grant che hanno acceso ciascun lato (per il tooltip: il numero da solo
	 *  non è azionabile). */
	why?: Record<TrifectaLeg, string[]>;
	shell?: boolean;
	expands?: boolean;
}
/** Un controllo che AVREBBE bloccato, in modalità di osservazione. */
export interface Observation {
	at: number;
	verb: string;
	agent: string;
	outcome: 'would_gate' | 'would_deny';
	channel?: string;
	why?: string;
}
export async function getObservations(since = 0, opts: RequestOptions = {}): Promise<{ observing: boolean; observations: Observation[] }> {
	return apiGet(`/api/observe/recent?since=${since}`, opts);
}
/** Etichetta leggibile di una voce di whitelist (clodia-platform#424): oggi
 *  solo per `gdrive:folder/<id>` — link sempre, nome quando Drive risponde. */
export type UriLabelInfo = { url: string; name: string | null };

export async function getEgressWhitelist(opts: RequestOptions = {}): Promise<{ mode: string; egress_allow: string[]; source_allow: string[]; egress_schemes?: string[]; source_schemes?: string[]; labels?: Record<string, UriLabelInfo> }> {
	return apiGet('/api/observe/whitelist', opts);
}

/**
 * Aggiunge o rimuove a mano una voce dalle liste (solo admin).
 *
 * `direction`: `egress` = dove si può scrivere · `ingress` = da dove si può
 * leggere senza contaminare. `action`: `allow` | `revoke`.
 *
 * La validazione sta nel gateway e il MOTIVO del rifiuto torna nel messaggio
 * d'errore: va mostrato così com'è, perché è l'unico modo che l'owner ha di
 * sapere come correggere la voce.
 */
export async function editEgressWhitelist(
	direction: 'egress' | 'ingress',
	action: 'allow' | 'revoke',
	uri: string,
	opts: RequestOptions = {}
): Promise<{ ok?: boolean; n?: number }> {
	return apiPost(`/api/observe/whitelist/${direction}/${action}`, { uri }, opts);
}

export interface TrifectaProfile {
	/** 0–3 sulla CHIUSURA (partecipanti + agenti invitabili da chi è dentro). */
	score: number;
	label: string;
	symbol: string;
	legs: Record<TrifectaLeg, boolean>;
	by_leg: Record<TrifectaLeg, string[]>;
	/** Punteggio dei soli partecipanti dichiarati, distinto dalla chiusura. */
	direct?: {
		score: number;
		label: string;
		legs: Record<TrifectaLeg, boolean>;
		by_leg: Record<TrifectaLeg, string[]>;
		/** Agenti con shell fra i PRESENTI (i raggiungibili stanno in shell_agents). */
		shell_agents?: string[];
	};
	agents: TrifectaAgentProfile[];
	reachable?: string[];
	expanded_by?: string[];
	/** Flag SEPARATO, non un quarto lato: con la shell il gate è aggirabile. */
	shell?: boolean;
	shell_agents?: string[];
	unknown_participants?: string[];
	/** Il vettore così com'è deciso dal backend: `110`, `010`, `?11`… Il `?` è il
	 *  primo bit non leggibile (gateway giù): non inventato né a 0 né a 1. */
	vector?: string;
	/** I tre bit separati, per la resa a simboli. */
	bits?: { tainted: number; private_data: number; arbitrary_egress: number };
	/** Stato di contaminazione: `null` = non leggibile. */
	tainted?: boolean | null;
	/** Il terzo bit è acceso da un REMOTE non vagliato, non dai verbi: un condotto
	 *  permanente verso l'esterno vale a prescindere da chi è nel canale. */
	remote_egress?: boolean;
	/** CAPACITÀ presente: l'OR dei tre lati, indipendentemente da cosa è accaduto
	 *  e da come è confinato. `score` conta i bit; questo conta i verbi. */
	capability?: number;
	capability_legs?: Record<TrifectaLeg, boolean>;
	/** Alias storico: `score` È già il rischio residuo. */
	residual?: number;
	/** Modo del confinamento in uscita del gateway (`gate` | `on` | `report` | `off`). */
	egress_mode?: string;
	egress_scopes?: string[];
	unclassified?: string[];
	config_version?: number;
}
export interface ChannelFile {
	name: string;
	path: string;
	/** "dir" per le sottocartelle navigabili, "file" (o assente) per i file. */
	kind?: string;
	size?: number | null;
	mtime_iso?: string | null;
	/** Google Doc nativo: proxy/link al documento remoto su Drive (non scaricabile
	 *  come binario: si legge/edita direttamente su Drive). `url` = webViewLink. */
	remote?: boolean;
	/** Provenienza dichiarata all'upload (clodia-platform#104 §3):
	 *  `trusted` | `untrusted` | `agent` | `unknown` (caricato prima della §3). */
	provenance?: string;
	/** webViewLink. Presente anche sulle voci `kind: "dir"` di un topic con remote
	 *  Drive: la cartella si NAVIGA qui dentro, e questo link è l'alternativa
	 *  esplicita (bottone ↗) per aprirla nella web app di Drive (#117). */
	url?: string;
	mime?: string | null;
}

export async function createChannel(
	input: {
		name: string; tier: string; title?: string; type?: string; contact_agent?: string;
		/** Storage dei file del topic: assente/local = default; drive = Google Drive
		 *  (folder = link/id di una cartella esistente, oppure vuoto per crearne una). */
		storage_config?: { type: 'drive'; folder?: string; account?: string };
	},
	opts: RequestOptions = {}
): Promise<{ tier: string; name: string }> {
	return apiPost('/clodia/channels', input, opts);
}

export async function getChannel(tier: string, name: string, opts: RequestOptions = {}): Promise<ChannelInfo> {
	return apiGet(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}`, opts);
}
/** Stato di presenza di una persona rispetto a QUESTA stanza.
 *  `here` la sta guardando · `elsewhere` è nella webui ma altrove ·
 *  `background` ha la scheda dietro · `away` non c'è. */
export type PresenceState = 'here' | 'elsewhere' | 'background' | 'away';

export async function getChannelMessages(tier: string, name: string, opts: RequestOptions = {}): Promise<ChannelMessage[]> {
	const d = await apiGet<{ messages: ChannelMessage[] }>(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/messages`, opts);
	return d.messages ?? [];
}

/** Messaggi + presenza degli umani, dalla stessa chiamata: il polling della
 *  conversazione è già in corso ogni cinque secondi, e la presenza cambia con
 *  la stessa cadenza — una rotta dedicata raddoppierebbe le richieste per un
 *  dato che arriva insieme all'altro. */
export async function getChannelMessagesAndPresence(
	tier: string, name: string, opts: RequestOptions = {}
): Promise<{ messages: ChannelMessage[]; presence: Record<string, PresenceState> }> {
	const d = await apiGet<{ messages: ChannelMessage[]; presence?: Record<string, PresenceState> }>(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/messages`, opts);
	return { messages: d.messages ?? [], presence: d.presence ?? {} };
}

/** Battito: dove sto guardando e se sono in primo piano. Non solleva mai — un
 *  battito perso vale un pallino impreciso per un minuto, e non deve poter
 *  rompere la pagina che lo manda. */
export async function sendPresenceBeat(
	chat: string | null, visible: boolean
): Promise<void> {
	try {
		await apiPost('/api/presence', { chat, visible });
	} catch {
		/* silenzio deliberato */
	}
}
export async function postChannelMessage(
	tier: string,
	name: string,
	content: string,
	opts: RequestOptions = {}
): Promise<{ responder?: string | null; responders?: string[]; skipped?: string[]; reply?: string; queued?: boolean; error?: string; note?: string; warning?: import('./types').TierWarning | null }> {
	return apiPost(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/post`, { content }, opts);
}

export async function getChannelAliases(opts: RequestOptions = {}): Promise<Record<string, string>> {
	const data = await apiGet<{ aliases?: Record<string, string> }>('/api/channel-aliases', opts);
	return data.aliases ?? {};
}

export async function putChannelAliases(
	aliases: Record<string, string>, opts: RequestOptions = {}
): Promise<Record<string, string>> {
	const data = await apiPut<{ aliases?: Record<string, string> }>('/api/channel-aliases', { aliases }, opts);
	return data.aliases ?? {};
}
export async function resetChannelContext(
	tier: string,
	name: string,
	opts: RequestOptions = {}
): Promise<{ reset: boolean; sessions_deleted?: string[] }> {
	return apiPost(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/reset-context`, {}, opts);
}
/** Interrompe i turni in corso di questo canale.
 *
 *  `agents` dice CHI fermare (clodia-platform#403): è il ⏹ che sta nel box di
 *  ragionamento di un agente, quindi ferma quell'agente. Ogni voce è un seed
 *  (`worker`: tutte le sue istanze) o uno spawn (`worker-221`: quella sola).
 *  Omesso ⇒ tutta la stanza, che resta il significato di una richiesta senza
 *  bersaglio. */
export async function interruptChannel(
	tier: string,
	name: string,
	agents?: readonly string[],
	opts: RequestOptions = {}
): Promise<{ interrupted: string[] }> {
	const body = agents && agents.length ? { agents: [...agents] } : {};
	return apiPost(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/interrupt`, body, opts);
}

/** Delega permanente (async·A): sblocca i gate che coprono lo scope. */
export interface Delegation {
	principal: string;
	scope: { verb: string; agent?: string; job?: number };
	exp: number;
}
export async function listDelegations(): Promise<{ delegations: Delegation[] }> {
	return apiGet('/clodia/delegations');
}
export async function registerDelegation(token: string): Promise<{ ok: boolean; principal: string; scope: unknown; exp: number }> {
	return apiPost('/clodia/delegations', { token });
}
export async function revokeDelegation(principal: string, verb: string): Promise<{ revoked: boolean }> {
	return apiPost('/clodia/delegations/revoke', { principal, verb });
}

/**
 * Singolo trigger periodico associato a un topic.
 *
 * La periodicità è «ogni `interval_minutes`, per `repeat_count` volte»
 * (clodia-platform#239). Ha sostituito l'espressione cron a testo libero, che
 * resta solo sui trigger creati prima: quelli arrivano con `interval_minutes`
 * a `null` e `cron_expr` valorizzato, continuano a girare così, e il pannello
 * propone la conversione senza applicarla.
 */
export interface TopicCronTrigger {
	id: number;
	/** Ogni quanti minuti. `null` = trigger legacy, ancora a cron. */
	interval_minutes: number | null;
	/** Quante ripetizioni in tutto. `0` = ricorrente senza fine. */
	repeat_count: number;
	/** Quante ne ha già eseguite (avanza solo sui fire davvero postati). */
	fired_count: number;
	/** Popolato solo sui trigger legacy; vuoto su quelli a intervallo. */
	cron_expr: string;
	/** Solo in lettura e solo sui legacy: la cadenza equivalente da PROPORRE
	 *  nel form. `null` quando il cron non ha un equivalente onesto (cadenza
	 *  irregolare o oltre la settimana) — allora l'owner sceglie da zero. */
	suggested_interval_minutes?: number | null;
	prompt: string;
	agent: string;
	enabled: boolean;
	last_run_at: string | null;
	last_status: string | null;
	/** When true a fire is skipped (no model call) unless new mail reached the
	 *  topic's local/mailbox since the last dispatched fire. Absent on older
	 *  backends: treat as false. */
	only_if_new_mail?: boolean;
}
/** Channel trigger «incoming mail» (clodia-platform#628): when the mail
 *  courier delivers mail into the room, ONE turn of `agent` with `prompt`
 *  plus the list of that mail. At most 12 an hour per room. */
export interface TopicMailTrigger {
	tier: string;
	name: string;
	agent: string;
	prompt: string;
	enabled: boolean;
	owner?: string;
	fired_count: number;
	fires_last_hour?: number;
	last_run_at: string | null;
	/** ok | not_started | rate_limited | agent_not_participant | null */
	last_status: string | null;
}
function topicMailTriggerPath(tier: string, name: string): string {
	return `/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/mail-trigger`;
}
export async function getTopicMailTrigger(
	tier: string,
	name: string
): Promise<{ trigger: TopicMailTrigger | null }> {
	return apiGet(topicMailTriggerPath(tier, name));
}
export async function putTopicMailTrigger(
	tier: string,
	name: string,
	body: { agent: string; prompt: string; enabled: boolean }
): Promise<{ trigger: TopicMailTrigger }> {
	return apiPut(topicMailTriggerPath(tier, name), body);
}
export async function deleteTopicMailTrigger(
	tier: string,
	name: string
): Promise<{ deleted: boolean }> {
	return apiDelete(topicMailTriggerPath(tier, name));
}
function topicCronPath(tier: string, name: string): string {
	return `/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/cron-trigger`;
}
export async function getTopicCronTrigger(
	tier: string,
	name: string
): Promise<{ trigger: TopicCronTrigger | null }> {
	return apiGet(topicCronPath(tier, name));
}
export async function putTopicCronTrigger(
	tier: string,
	name: string,
	body: {
		interval_minutes: number;
		repeat_count: number;
		prompt: string;
		agent?: string | null;
		only_if_new_mail?: boolean;
	}
): Promise<{ trigger: TopicCronTrigger }> {
	return apiPut(topicCronPath(tier, name), body);
}
export async function deleteTopicCronTrigger(
	tier: string,
	name: string
): Promise<{ deleted: boolean }> {
	return apiDelete(topicCronPath(tier, name));
}

export interface AgentContext {
	used: number;
	window: number;
	pct: number; // 0..1 occupazione della finestra di contesto
}
export interface AgentEligibility {
	name: string;
	type: string;
	/** APPARTENENZA (clodia-platform#190), bit DUREVOLE: lo stack DICHIARATO dal
	 *  seed — non quello acceso adesso — regge il tier del topic. Filtra il
	 *  dropdown d'invito; non filtra MAI la lista dei partecipanti. */
	eligible: boolean;
	/** Può prendere un turno ADESSO: provider collegato, non in pausa, SEAL ≥
	 *  tier. È un badge accanto al partecipante, non un'espulsione — un provider
	 *  in pausa non cambia la composizione di un canale. Sempre `true` per gli
	 *  umani, che non rispondono attraverso un provider. */
	available: boolean;
	warn: boolean;
	context: AgentContext | null;
	/** Provider EFFETTIVO in questa stanza (clodia-platform#310, A14) — dipende
	 *  dal tier del topic, non dal preferito fuori-stanza. `null` per gli umani. */
	provider: string | null;
	/** Modello ABBINATO a quel provider (clodia-platform#315): non è un asse
	 *  indipendente, cambia col provider scelto per il tier. `null` per gli umani
	 *  e quando lo stack non si risolve. */
	model: string | null;
}
/** Feedback sulla scelta del router, distinto dal feedback sulla risposta. */
export async function recordRoutingFeedback(
	tier: string,
	name: string,
	body: { kind: 'confirm' | 'correction'; chosen: string; correct_agent?: string }
): Promise<{ ok: boolean; kind: 'confirm' | 'correction'; learned: string }> {
	return apiPost('/clodia/routing/feedback', { tier, name, ...body });
}

/** Scavalca una scelta del router GIÀ ESEGUITA (clodia-platform#187).
 *
 *  Distinta da `recordRoutingFeedback`, che insegna per la volta dopo e lascia
 *  parlare l'agente sbagliato: qui il turno in corso si ferma e riparte su
 *  quello nominato dall'umano. Il server ammette solo l'autore del messaggio
 *  instradato male, o l'owner del topic come ripiego.
 */
export async function overruleRouting(
	tier: string,
	name: string,
	agent: string,
	chosen?: string
): Promise<{
	ok: boolean;
	/** clodia-platform#253 · L'ATTO, distinto dall'apprendimento: `false` con un
	 *  `outcome` quando la correzione è stata registrata ma il turno non è
	 *  passato (non autorizzato, stesso agente, agente non instradabile). */
	acted?: boolean;
	outcome?: 'overruled' | 'not-authorized' | 'same-agent' | 'not-routable';
	detail?: string | null;
	/** Vuoto quando il turno sbagliato era già finito: da #253 l'interruzione
	 *  colpisce solo l'agente scelto dal router, non tutta la stanza. */
	interrupted: string[];
	queued: boolean;
	responder: string | null;
	learned: boolean;
}> {
	return apiPost(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/routing-overrule`,
		{ agent, ...(chosen ? { chosen } : {}) }
	);
}

export async function resolveRoutingChoice(
	tier: string,
	name: string,
	agent: string
): Promise<{ ok: boolean; queued: boolean; responder: string | null; learned: boolean }> {
	return apiPost(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/routing-choice`,
		{ agent }
	);
}
export async function getChannelEligibility(
	tier: string,
	name: string,
	opts: RequestOptions = {}
): Promise<{ tier: string; agents: AgentEligibility[] }> {
	return apiGet(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/eligibility`, opts);
}
/** Il ragionamento di un turno concluso (clodia-platform#484).
 *
 *  Due chiamate e non una: l'indice è piccolo e si legge all'apertura del
 *  canale per sapere QUALI bolle hanno qualcosa da mostrare, il testo è grosso
 *  e si scarica solo quando qualcuno apre quel 💭. Portarsi dietro il
 *  ragionamento di ogni turno insieme ai messaggi sarebbe decine di KB per
 *  bolla, quasi sempre per non guardarli. */
export async function getChannelReasoningIndex(
	tier: string,
	name: string,
	opts: RequestOptions = {}
): Promise<{ messages: string[] }> {
	return apiGet(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/reasoning`,
		opts
	);
}
export async function getChannelReasoning(
	tier: string,
	name: string,
	messageId: string,
	opts: RequestOptions = {}
): Promise<{
	message_id: string;
	spawn: string | null;
	seed: string | null;
	ts: string | null;
	truncated: boolean;
	text: string;
	tools?: Array<{ tool: string; input_summary: string }>;
	tools_omitted?: number;
}> {
	return apiGet(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/reasoning/${encodeURIComponent(messageId)}`,
		opts
	);
}

/** Ruolo di un ospite nello scope. `owner` non si assegna invitando: è la
 *  proprietà del topic, non un grado di accesso. `reader` è abolito dal
 *  24 ott 2026 (epic #604): ogni partecipante ha gli stessi verbi. */
export type ScopeRole = 'contributor';

/** Invita, rimuove, o cambia il ruolo di chi è già dentro. Il cambio passa da
 *  qui e non da togli-e-rimetti: quello farebbe uscire la persona dal canale e
 *  le manderebbe un messaggio di uscita e uno di rientro per un cambio di grado. */
export async function resetChannelTrifecta(tier: string, name: string): Promise<void> {
	// L'owner si assume la responsabilità del punteggio di questo canale. Il
	// server registra chi e quando: non è un silenziamento anonimo.
	await apiPost(
		joinUrl(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/trifecta/reset`),
		{}
	);
}

export async function undoChannelTrifectaReset(tier: string, name: string): Promise<void> {
	await apiDelete(
		joinUrl(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/trifecta/reset`)
	);
}

export async function setChannelParticipant(
	tier: string,
	name: string,
	agent: string,
	add: boolean,
	role?: ScopeRole
): Promise<{ participants: Record<string, string> | string[] }> {
	const res = await fetch(
		joinUrl(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/participants`),
		{
			method: add ? 'POST' : 'DELETE',
			headers: { 'Content-Type': 'application/json', ...authHeaders() },
			body: JSON.stringify(role ? { agent, role } : { agent })
		}
	);
	if (!res.ok) throw await parseError(res);
	return parseJsonOrText(res);
}

/** Conferma SINCRONA (popup in chat) di una proposta di job: solo l'owner (admin).
 *  choice = 'Approva' | 'Annulla'. Approva → crea+registra il job. */
export async function decideJobProposal(id: number, choice: string): Promise<{ ok: boolean; outcome: string; job_id?: number }> {
	const res = await fetch(joinUrl(`/clodia/jobs/proposals/${id}/decide`), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders() },
		body: JSON.stringify({ choice })
	});
	if (!res.ok) throw await parseError(res);
	return parseJsonOrText(res);
}
export async function getChannelFiles(tier: string, name: string, subpath = '', opts: RequestOptions = {}): Promise<ChannelFile[]> {
	const qs = subpath ? `?path=${encodeURIComponent(subpath)}` : '';
	const d = await apiGet<{ files: ChannelFile[] }>(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/files${qs}`, opts);
	return d.files ?? [];
}
/** Carica un file nel canale. `provenance` dichiara DA DOVE viene il file
 *  (clodia-platform#104 §3): `trusted` = fonte che l'utente conosce, `untrusted`
 *  = fonte esterna o non verificata. Default `untrusted`, perché se non è
 *  dichiarata non si assume il bene. Un file untrusted contamina il canale: si
 *  legge normalmente, ma l'uscita successiva passa da un'approvazione. */
export async function uploadChannelFile(tier: string, name: string, filename: string, contentB64: string, provenance: 'trusted' | 'untrusted' = 'untrusted', opts: RequestOptions = {}): Promise<{ name: string }> {
	return apiPost(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/files`, { filename, content_b64: contentB64, provenance }, opts);
}
/** URL di download di un file del canale (topic v2, via gateway). Usa l'endpoint
 *  /download (serve P0..P3 dal vault); /file è solo per i vecchi topic git e
 *  rifiuta i tier → 404. */
export function channelFileUrl(tier: string, name: string, path: string): string {
	return `${API_BASE_URL}/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/download?path=${encodeURIComponent(path)}`;
}

/** URL FIRMATO a scadenza per il download (fix sicurezza 7 lug 2026): il
 *  backend richiede login+membership per firmare; il link risultante vale
 *  ~15 min e solo per quel file. Da usare per aprire/scaricare da <a>. */
export async function signedChannelFileUrl(tier: string, name: string, path: string): Promise<string> {
	const r = await apiGet<{ url: string }>(
		`/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/download-url?path=${encodeURIComponent(path)}`
	);
	return `${API_BASE_URL}${r.url}`;
}

/** Scope rules of a topic: the text injected into every agent's context, every
 * turn. `authoritative` is false while it still comes from the legacy
 * `files/AGENTS.md`, where any participant could write it — the UI must say so,
 * because the same text means two different things depending on who could have
 * written it. */
export interface TopicAgentsMd {
	text: string | null;
	version: string | null;
	authoritative: boolean;
}

export async function getTopicAgentsMd(
	tier: string,
	name: string,
	opts: RequestOptions = {}
): Promise<TopicAgentsMd> {
	return apiGet<TopicAgentsMd>(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/agents-md`,
		opts
	);
}

/** Writes them under the optimistic lock. A 409 means someone else wrote in the
 * meantime: re-read and merge, never retry the same body. */
export async function saveTopicAgentsMd(
	tier: string,
	name: string,
	text: string,
	baseVersion: string | null,
	opts: RequestOptions = {}
): Promise<{ agents_md_version: string | null; removed: boolean }> {
	return apiPost(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/agents-md`,
		{ text, base_version: baseVersion },
		opts
	);
}

export async function getTopicSummary(
	classification: string,
	name: string,
	opts: RequestOptions = {}
): Promise<string> {
	return apiGet<string>(
		`/topics/${encodeURIComponent(classification)}/${encodeURIComponent(name)}/summary`,
		{ ...opts, headers: { Accept: 'text/plain, */*', ...(opts.headers || {}) } }
	);
}

/** GET `/topics/{classification}/{name}/tree` — full file tree for the topic. */
export async function getTopicTree(
	classification: string,
	name: string,
	opts: RequestOptions = {}
): Promise<TopicTree> {
	return apiGet<TopicTree>(
		`/topics/${encodeURIComponent(classification)}/${encodeURIComponent(name)}/tree`,
		opts
	);
}

/**
 * GET `/topics/{classification}/{name}/file?path=...` — raw content of a
 * single file inside a topic. Returns plain text (callers decide how to
 * render based on the file extension).
 */
export async function getTopicFile(
	classification: string,
	name: string,
	path: string,
	opts: RequestOptions = {}
): Promise<string> {
	const qs = new URLSearchParams({ path }).toString();
	return apiGet<string>(
		`/topics/${encodeURIComponent(classification)}/${encodeURIComponent(name)}/file?${qs}`,
		{ ...opts, headers: { Accept: 'text/plain, */*', ...(opts.headers || {}) } }
	);
}

// ---------------------------------------------------------------------------
// DM — conversazione 1-1 come canale a 2 partecipanti.
//
// Le vecchie chat libere (`/clodia/chats/*`) sono state rimosse. Una
// conversazione diretta è ora un canale (meta.kind="dm") con esattamente due
// partecipanti: riusa la pagina /topics/[tier]/[name] e i suoi endpoint.
// ---------------------------------------------------------------------------

/**
 * POST `/clodia/dms` — crea (o riapre, idempotente) un DM con `other`.
 * Ritorna `{ tier, name }` del canale, su cui navigare con /topics/{tier}/{name}.
 */
export async function createOrOpenDm(
	other: string,
	opts: RequestOptions = {}
): Promise<{ tier: string; name: string }> {
	return apiPost('/clodia/dms', { with: other }, opts);
}

/** SSE event surfaced to the consumer. */
export interface SSEEvent {
	/** Event name (defaults to `'message'` when the stream omits `event:`). */
	event: string;
	/** Raw `data:` payload (may span multiple lines, joined with `\n`). */
	data: string;
	/** Optional `id:` field, if the server emits one. */
	id?: string;
	/** Parsed JSON, when `data` is valid JSON. `undefined` otherwise. */
	json?: unknown;
}

/**
 * Open an SSE connection to `<base>/<path>` and call `onEvent` for each
 * event. Returns a cleanup function that closes the connection.
 *
 * Notes:
 *  - A `fetch()` reader, not `EventSource` (clodia-platform#511): `EventSource`
 *    cannot send headers, so the session token travelled in the query string
 *    and every access log kept it in clear. Here it goes in `Authorization`,
 *    and the server refuses a token passed as a query parameter.
 *  - In SSR (Node) it no-ops and returns a cleanup that does nothing.
 *  - `onError` is called once when the stream fails or ends: the caller
 *    decides whether to reconnect (EventSource used to retry on its own).
 */
export function apiSSE(
	path: string,
	onEvent: (ev: SSEEvent) => void,
	onError?: (err: Event) => void
): () => void {
	if (typeof window === 'undefined' || typeof fetch === 'undefined'
		|| typeof AbortController === 'undefined') {
		return () => {};
	}

	const ctrl = new AbortController();
	let closed = false;
	const fail = (why: string, status?: number) => {
		if (closed) return;
		closed = true;
		// `status` travels on the event: 401/403 mean "log in again", not
		// "retry in 5 s" (review of #248).
		const e = Object.assign(new Event('error'), { status });
		if (onError) onError(e);
		else console.error('[apiSSE] error', why);
	};

	const headers: Record<string, string> = { Accept: 'text/event-stream' };
	const tok = authToken();
	if (tok) headers.Authorization = `Bearer ${tok}`;

	const emit = (event: string, dataLines: string[], id: string | undefined) => {
		if (!dataLines.length) return;
		const data = dataLines.join('\n');
		let json: unknown = undefined;
		try {
			json = JSON.parse(data);
		} catch {
			/* not JSON — that's fine */
		}
		onEvent({ event: event || 'message', data, id, json });
	};

	(async () => {
		let res: Response;
		try {
			res = await fetch(joinUrl(path), { headers, signal: ctrl.signal, cache: 'no-store' });
		} catch (err) {
			if (!ctrl.signal.aborted) fail(String(err));
			return;
		}
		if (!res.ok || !res.body) {
			try {
				await res.body?.cancel();
			} catch {
				/* ignore */
			}
			fail(`HTTP ${res.status}`, res.status);
			return;
		}
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		let event = '';
		let id: string | undefined;
		let dataLines: string[] = [];
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				let nl: number;
				while ((nl = buf.search(/\r\n|\n|\r/)) >= 0) {
					// A CRLF split across two chunks: wait for the `\n`, or the
					// lone `\r` would end a line and the next `\n` an empty one.
					if (buf[nl] === '\r' && nl === buf.length - 1) break;
					const line = buf.slice(0, nl);
					buf = buf.slice(nl + (buf.startsWith('\r\n', nl) ? 2 : 1));
					if (line === '') {
						emit(event, dataLines, id);
						event = '';
						dataLines = [];
						continue;
					}
					if (line.startsWith(':')) continue; // comment / keep-alive
					const colon = line.indexOf(':');
					const field = colon < 0 ? line : line.slice(0, colon);
					let val = colon < 0 ? '' : line.slice(colon + 1);
					if (val.startsWith(' ')) val = val.slice(1);
					if (field === 'data') dataLines.push(val);
					else if (field === 'event') event = val;
					else if (field === 'id') id = val;
				}
			}
		} catch (err) {
			if (!ctrl.signal.aborted) fail(String(err));
			return;
		}
		// The server closed the stream: same as an EventSource error.
		if (!ctrl.signal.aborted) fail('stream ended');
	})();

	return () => {
		closed = true;
		try {
			ctrl.abort();
		} catch {
			/* ignore */
		}
	};
}

// ---------------------------------------------------------------------------
// AGENTS write actions
//
// What the server exposes today (verified via /openapi.json on agent-server
// v4.0.2): only `POST /api/agents/reload`. There is **no** PATCH or POST
// endpoint for editing or creating agents — the registry is loaded from the
// filesystem (`/clodia/agents/*`) at startup and re-scanned on `reload`.
//
// We still ship typed wrappers for create/update so the UI can call them; the
// server replies with HTTP 405 (Method Not Allowed), which surfaces in the UI
// as a clear "endpoint not exposed by this agent-server version" message
// instead of a silent failure. This mirrors how the DAEMONS log viewer
// degrades when the server hasn't exposed `/daemons/{name}/log` yet.
// ---------------------------------------------------------------------------

/**
 * GET `/api/agents` — elenco degli agent del registry.
 *
 * Usato dal form job per popolare il selettore "agent". Tollera la sola shape
 * `{ agents: Agent[] }`; ritorna sempre un array (vuoto su shape inattesa).
 */
export async function getAgents(opts: RequestOptions = {}): Promise<ReadonlyArray<Agent>> {
	const data = await apiGet<AgentsListResponse>('/api/agents', opts);
	return data && Array.isArray((data as { agents?: unknown }).agents)
		? (data as AgentsListResponse).agents
		: [];
}

/**
 * POST `/api/agents/reload`.
 *
 * Re-scans the agents directory on the server. Returns a small summary:
 * `{ loaded: number, errors: Record<string, string> }`.
 */
export async function reloadAgents(opts: RequestOptions = {}): Promise<AgentReloadResponse> {
	const data = await apiPost<AgentReloadResponse>('/api/agents/reload', {}, opts);
	return (data && typeof data === 'object' ? data : { loaded: 0, errors: {} }) as AgentReloadResponse;
}

/**
 * POST `/api/agents/<name>/pause` — kill-switch dell'agent.
 *
 * Tutte le istanze running dell'agent vengono cancellate (asyncio.Task) e
 * niente nuovi claim finché resume. Stato persistente tra restart.
 */
export async function pauseAgent(name: string, opts: RequestOptions = {}): Promise<{ paused: boolean; cancelled_tasks?: number; was_paused?: boolean }> {
	return apiPost(`/api/agents/${encodeURIComponent(name)}/pause`, {}, opts);
}

/** POST `/api/agents/<name>/resume` — riprende i claim normali. */
export async function resumeAgent(name: string, opts: RequestOptions = {}): Promise<{ paused: boolean; was_paused?: boolean }> {
	return apiPost(`/api/agents/${encodeURIComponent(name)}/resume`, {}, opts);
}

/**
 * PATCH `/api/agents/{name}`.
 *
 * The agent-server does not expose this endpoint today (returns 405). The
 * wrapper still ships so the UI can attempt the call and degrade gracefully
 * — callers catch ApiError and check `status === 405` to render the
 * "edit-on-disk-then-reload" guidance.
 */
export async function updateAgent(
	name: string,
	patch: Partial<Agent>,
	opts: RequestOptions = {}
): Promise<Agent> {
	return apiPatch<Agent>(`/api/agents/${encodeURIComponent(name)}`, patch, opts);
}

/**
 * POST `/api/agents/{name}/provider` — seleziona manualmente il provider da usare
 * per l'agent, scelto dalla sua lista dichiarata. `provider=null` azzera l'override
 * (torna alla preferenza). È stato operativo (routing): consentito ANCHE sui super
 * immutabili. Solo admin.
 */
export async function selectAgentProvider(
	name: string,
	provider: string | null,
	opts: RequestOptions = {}
): Promise<{ agent: string; provider_override: string | null; provider: string | null; provider_connected: boolean }> {
	return apiPost(`/api/agents/${encodeURIComponent(name)}/provider`, { provider }, opts);
}

// `Connector`, `getConnectors()` e `grantConnector()` non esistono più
// (clodia-platform#410). Chiamavano `/api/connectors[/grant]`, che l'agent-server
// girava a una rotta del gateway mai registrata: 502 a ogni chiamata, quindi la
// delega per-agent che mostravano non è mai stata applicata da qui. Il modello
// dietro era comunque superato dal 18/09: una casella si autorizza PER SCOPE
// (whitelist `inbox:`/`outbox:`, connettore Mailbox del canale, #406), non
// per agente. Lo stato dei connettori si legge da `getTools()` (`ToolConnector`).

/** Patch admin di meta + canali di contatto + model/sdk. Stringa vuota = azzera. */
export interface AgentSettingsPatch {
	display_name?: string;
	description?: string;
	avatar_color?: string;
	clearance?: string;
	email?: string;
	telegram?: string;
	model?: string;
	agent_sdk?: string;
	mailbox_parent?: string;
}
export async function patchAgentSettings(
	name: string,
	patch: AgentSettingsPatch,
	opts: RequestOptions = {}
): Promise<Agent> {
	return apiPatch<Agent>(`/api/agents/${encodeURIComponent(name)}`, patch, opts);
}

/**
 * POST `/api/agents`.
 *
 * Same status as {@link updateAgent}: not exposed by the current server.
 * The wrapper exists to make the missing surface visible in the UI rather
 * than to fabricate behavior client-side.
 */
export async function createAgent(spec: Partial<Agent>, opts: RequestOptions = {}): Promise<Agent> {
	return apiPost<Agent>('/api/agents', spec, opts);
}

/** Crea un principal umano (member) certificando una pubkey già fornita. */
export async function createHumanAgent(
	input: { name: string; pubkey: string; clearance: string; display_name?: string; email?: string; telegram?: string },
	opts: RequestOptions = {}
): Promise<unknown> {
	return apiPost('/api/agents', { type: 'human', ...input }, opts);
}

/** Richiesta di accesso pendente (cert-request) — nome e pubkey già presenti. */
export interface CertRequest {
	id: string;
	name: string;
	contact?: string;
	pubkey: string;
	ts?: string;
}

/** GET `/api/cert-requests` — richieste pendenti (admin). */
export async function getCertRequests(opts: RequestOptions = {}): Promise<CertRequest[]> {
	return apiGet<CertRequest[]>('/api/cert-requests', opts);
}

/** DELETE `/api/cert-requests/{id}` — rimuove una richiesta (admin). */
export async function deleteCertRequest(id: string, opts: RequestOptions = {}): Promise<void> {
	await apiDelete(`/api/cert-requests/${encodeURIComponent(id)}`, opts);
}

// ─── Bootstrap & Admin Auth (F1) ─────────────────────────────────────────────

export interface AdminState {
	initialized: boolean;
	admins: string[];
}

/** GET `/api/admin/state` — l'istanza è già stata reclamata da un admin? */
export async function getAdminState(opts: RequestOptions = {}): Promise<AdminState> {
	return apiGet<AdminState>('/api/admin/state', opts);
}

/** Riga della vista "Agents Activity" (sessioni agente live). */
export interface RuntimeSession {
	chat_id: string;
	agent: string;
	spawn_id?: string | null;
	spawn_instance?: string | null;
	runtime?: string | null;
	principal?: string | null;
	topic?: string | null;
	context_kind: string;
	state: 'running' | 'idle' | 'blocked' | 'stopped' | string;
	last_activity?: string | null;
	created_at?: string | null;
	tokens_in: number;
	tokens_out: number;
	runs: number;
}

/** GET `/clodia/runtime/sessions` — agenti spawnati con topic, token, stato. */
export async function getRuntimeSessions(opts: RequestOptions = {}): Promise<RuntimeSession[]> {
	const d = await apiGet<{ sessions: RuntimeSession[] }>('/clodia/runtime/sessions', opts);
	return d.sessions ?? [];
}

export interface AgentActivitySummaryRow {
	agent: string;
	today_runs: number;
	runs: number;
	tokens_in: number;
	tokens_out: number;
	status: 'idle' | 'running' | 'error' | string;
	last_run_ts?: string | null;
	last_event_ts?: string | null;
	last_event_type?: string | null;
}

/** Una riga della leaderboard per provider di inferenza. */
export interface ProviderActivitySummaryRow {
	provider: string;
	runs: number;
	tokens_in: number;
	tokens_out: number;
	agents: string[];
	agents_count: number;
	last_event_ts?: string | null;
}

export interface ActivitySummary {
	agents: AgentActivitySummaryRow[];
	providers: ProviderActivitySummaryRow[];
}

/** GET `/api/agents/activity/summary` — leaderboard cumulativa per agent seed e per provider. */
export async function getActivitySummary(opts: RequestOptions = {}): Promise<ActivitySummary> {
	const d = await apiGet<Partial<ActivitySummary>>('/api/agents/activity/summary', opts);
	return { agents: d.agents ?? [], providers: d.providers ?? [] };
}

/** Snapshot import/export dei topic (solo admin). */
export interface TopicsImportResult {
	imported: string[];
	skipped: string[];
	imported_count: number;
	skipped_count: number;
}

/** Voce del catalogo topic (per il picker di export). */
export interface TopicCatalogItem {
	tier: string;
	name: string;
	title: string;
	kind?: string | null;
}

/** GET `/api/topics/catalog` — catalogo COMPLETO dei topic (admin, per il picker). */
export async function getTopicsCatalog(opts: RequestOptions = {}): Promise<TopicCatalogItem[]> {
	return apiGet<TopicCatalogItem[]>('/api/topics/catalog', opts);
}

/** GET `/api/topics/export` — scarica il tar.gz. `topics` = ['tier/name', …]; vuoto → tutti. */
export async function exportTopicsBundle(topics?: string[]): Promise<Blob> {
	const qs = topics && topics.length ? `?topics=${encodeURIComponent(topics.join(','))}` : '';
	const res = await fetch(joinUrl(`/api/topics/export${qs}`), { headers: { ...authHeaders() } });
	if (!res.ok) throw await parseError(res);
	return res.blob();
}

/** POST `/api/topics/import` — carica un tar.gz di topic (merge non-distruttivo). */
export async function importTopicsBundle(file: File): Promise<TopicsImportResult> {
	const res = await fetch(joinUrl('/api/topics/import'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/gzip', ...authHeaders() },
		body: file
	});
	if (!res.ok) throw await parseError(res);
	return parseJsonOrText<TopicsImportResult>(res);
}


/**
 * POST `/api/agents/{name}/pfp/generate` — genera la PFP via gpt-image-2 (lato
 * gateway) e la salva. Passa `prompt` (text→image) e/o `imageB64` (immagine
 * caricata → restyle). Lo stile manga/ghibli è applicato dal backend.
 */
export async function generateAgentPfp(
	name: string,
	body: { prompt?: string; imageB64?: string },
	opts: RequestOptions = {}
): Promise<{ status: string; name: string }> {
	return apiPost(`/api/agents/${encodeURIComponent(name)}/pfp/generate`, {
		prompt: body.prompt,
		image_b64: body.imageB64
	}, opts);
}
/** Stato della generazione PFP (async): idle | generating | done | error. */
export async function getAgentPfpStatus(
	name: string,
	opts: RequestOptions = {}
): Promise<{ name: string; state: string; error?: string; bytes?: number }> {
	return apiGet(`/api/agents/${encodeURIComponent(name)}/pfp/status`, opts);
}

// ---------------------------------------------------------------------------
// JOBS write actions
//
// Endpoints (from /openapi.json):
//   POST   /clodia/jobs            body = JobCreate { name, cron_expr, prompt, enabled? }
//   PATCH  /clodia/jobs/{id}       body = JobUpdate { name?, cron_expr?, prompt?, enabled? }
//   DELETE /clodia/jobs/{id}
//   POST   /clodia/jobs/{id}/run
// ---------------------------------------------------------------------------

/** GET `/clodia/jobs/parse-schedule` — periodicità in linguaggio naturale → cron. */
export async function parseSchedule(
	text: string,
	opts: RequestOptions = {}
): Promise<{ cron_expr: string; description: string }> {
	return apiGet(`/clodia/jobs/parse-schedule?text=${encodeURIComponent(text)}`, opts);
}

/** POST `/clodia/jobs` — create a new scheduled job. */
export async function createJob(body: JobCreate, opts: RequestOptions = {}): Promise<Job> {
	const raw = await apiPost<unknown>('/clodia/jobs', body, opts);
	return normaliseJob(raw);
}

/** PATCH `/clodia/jobs/{id}` — partial update. Server expects JobUpdate shape. */
export async function updateJob(
	id: string,
	patch: JobUpdate,
	opts: RequestOptions = {}
): Promise<Job> {
	const raw = await apiPatch<unknown>(`/clodia/jobs/${encodeURIComponent(id)}`, patch, opts);
	return normaliseJob(raw);
}

/** DELETE `/clodia/jobs/{id}`. */
export async function deleteJob(id: string, opts: RequestOptions = {}): Promise<void> {
	await apiDelete<unknown>(`/clodia/jobs/${encodeURIComponent(id)}`, opts);
}

/**
 * POST `/clodia/jobs/{id}/run` — trigger the job immediately.
 *
 * The server returns a small ack payload; we type it as `JobRunResponse`
 * (open record) so the UI can surface whatever the server reports
 * (typically `{ run_id, chat_id, started_at }` or similar) without
 * requiring a rigid shape contract.
 */
export async function runJob(id: string, opts: RequestOptions = {}): Promise<JobRunResponse> {
	const raw = await apiPost<JobRunResponse>(
		`/clodia/jobs/${encodeURIComponent(id)}/run`,
		{},
		opts
	);
	return (raw && typeof raw === 'object' ? raw : {}) as JobRunResponse;
}

// ---------------------------------------------------------------------------
// CATALOG — readonly skills/rules registry
// ---------------------------------------------------------------------------

/** GET `/clodia/skills` — deduplicated skill catalog. */
export async function listSkills(opts: RequestOptions = {}): Promise<ReadonlyArray<Skill>> {
	const raw = await apiGet<unknown>('/clodia/skills', { cache: true, ...opts });
	return Array.isArray(raw) ? (raw as ReadonlyArray<Skill>) : [];
}

/** GET `/clodia/skills/{name}` — markdown body + parsed frontmatter. */
export async function getSkill(name: string, opts: RequestOptions = {}): Promise<SkillDetail> {
	return apiGet<SkillDetail>(`/clodia/skills/${encodeURIComponent(name)}`, opts);
}

export interface SkillImportResult {
	imported: string[];
	pack: string;
}

/** POST `/clodia/skills/import-url` — importa una skill da URL (git repo o .zip
 *  remoto) nel pack `user-pack`. */
export async function importSkillUrl(
	url: string,
	opts: RequestOptions = {}
): Promise<SkillImportResult> {
	return apiPost<SkillImportResult>('/clodia/skills/import-url', { url }, opts);
}

/** POST `/clodia/skills/import` — importa una skill da archivio .zip (multipart)
 *  nel pack `user-pack`. */
export async function importSkillZip(
	file: File,
	opts: RequestOptions = {}
): Promise<SkillImportResult> {
	const fd = new FormData();
	fd.append('file', file);
	const res = await fetch(joinUrl('/clodia/skills/import'), {
		method: 'POST',
		headers: { ...authHeaders(), ...(opts.headers || {}) },
		body: fd,
		signal: opts.signal
	});
	if (!res.ok) throw await parseError(res);
	return parseJsonOrText<SkillImportResult>(res);
}

/** DELETE `/clodia/skills/{name}` — elimina una skill utente. */
export async function deleteSkill(name: string, opts: RequestOptions = {}): Promise<void> {
	await apiDelete(`/clodia/skills/${encodeURIComponent(name)}`, opts);
}

// ---------------------------------------------------------------------------
// INSTANCE PROFILE — profilo dell'edizione (Modular Distro)
// ---------------------------------------------------------------------------

/** GET `/profile` — feature attive + branding dell'istanza (mai segreti). */
/** `GET /health` — versione COLLETTIVA di piattaforma + semver del componente.
 *
 *  Il numero di piattaforma sta nel backend, in un solo posto. Prima era un
 *  letterale nella sidebar (`|| 'v7.0'`), sovrascrivibile da una variabile di
 *  build che nessuna build impostava: a 8.0 nessuno l'ha alzato, e l'unico posto
 *  dove si guarda per sapere cosa gira dichiarava una release vecchia di una
 *  major. Una versione replicata è una versione che mente.
 */
export interface HealthInfo {
	status: string;
	/** Tag collettivo, es. `v8.0`. */
	platform?: string;
	/** Semver del solo agent-server, es. `6.124.0`. */
	version?: string;
	commit?: string;
}

/** Un verbo effettivo di un seed, col lucchetto se richiede consenso umano. */
export interface AgentVerb {
	verb: string;
	gated: boolean;
	/** `global` = pericoloso per chiunque · `agent` = privilegiato per QUESTO seed ·
	 *  `profile` = raggiungibile ma fuori dal mestiere dichiarato. */
	/**
	 * Perché è gated, e i quattro casi chiedono cose diverse:
	 * `global` pericoloso per chiunque · `agent` per costui · `channel` libero
	 * fuori da un canale e da approvare dentro · `profile` fuori dal mestiere.
	 * `admin` compare solo per un principal umano: non è un consenso per-uso,
	 * è il ruolo.
	 */
	gated_by?: 'global' | 'agent' | 'channel' | 'profile' | 'admin' | null;
	/** `false` = fuori dal profilo dichiarato · `null` = l'agente non dichiara un profilo. */
	in_profile?: boolean | null;
	description?: string;
	via?: string;
}
/** Un grant wildcard. Espanso SOLO se contiene almeno un verbo gated: si espande
 *  dove c'è qualcosa da vedere, altrimenti un `*` produce duecento righe in cui
 *  il lucchetto che conta non si nota. Compatto → `count` dice quanti copre. */
export interface AgentVerbGroup {
	grant: string;
	expanded: boolean;
	count?: number;
	verbs: AgentVerb[];
}
/** Un nodo dell'albero: un namespace coi suoi verbi. */
export interface AgentVerbNode {
	namespace: string;
	verbs: AgentVerb[];
	gated: number;
	outside: number;
	/** Aperto di default dove c'è qualcosa da guardare (lucchetti o fuori profilo). */
	open_by_default: boolean;
}
export interface AgentVerbs {
	agent: string;
	verbs: AgentVerb[];
	groups: AgentVerbGroup[];
	tree?: AgentVerbNode[];
	/** Il mestiere dichiarato: questi sono liberi, il resto passa da un gate. */
	profile?: string[];
	has_profile?: boolean;
	denied?: string[];
	gated_agent?: string[];
	catalogue_complete?: boolean;
	unavailable?: string;
	/** `human` o `agent`: un solo tipo di principal, ma il lucchetto ha due letture. */
	principal_kind?: 'human' | 'agent';
	/** Ruolo DICHIARATO nel seed (es. `member`), non il bucket di autorizzazione. */
	role?: string | null;
	clearance?: string | null;
	is_admin?: boolean | null;
	/**
	 * `false` = nessuna matrice dichiarata → l'umano ricade sulla regola
	 * precedente, che è AMPIA. Non significa «nessun verbo»: mostrarlo come zero
	 * direbbe «bloccato» dove il sistema è «aperto».
	 */
	matrix_declared?: boolean;
	/** Conteggi: raggiungibili in totale, liberi (il mestiere), su approvazione. */
	summary?: { reachable: number; free: number; on_approval: number };
	/** Verbi gated solo DENTRO un canale (quarto motivo di gate). */
	gated_in_channel?: string[];
}

/** One clause of an A·V·R·Q rule: what happens on targets matching `match`. */
export interface AuthzClause {
	effect: 'allow' | 'ask' | 'deny' | string;
	match?: string;
}

/** A global A·V·R·Q tuple (#626): agent · verb · resource · rule. */
export interface AuthzTuple {
	id: string;
	agent: string;
	verb: string;
	resource?: string;
	/** `outside` = only outside rooms (DMs, jobs); absent = everywhere. */
	where?: string | null;
	rule: AuthzClause[];
}

/** GET `/api/agents/{name}/authz` — the agent's global rules and `*`'s
 *  (#626). Seeds no longer carry verbs: in a room the room decides
 *  (Strumenti); these are what holds outside rooms and the governance verbs. */
export interface AgentAuthz {
	agent: string;
	mode?: string;
	tuples: AuthzTuple[];
	/** Set when the gateway did not answer. */
	unavailable?: string;
}

export async function getAgentAuthz(name: string, opts: RequestOptions = {}): Promise<AgentAuthz> {
	return apiGet<AgentAuthz>(`/api/agents/${encodeURIComponent(name)}/authz`, opts);
}

export async function getAgentVerbs(name: string, opts: RequestOptions = {}): Promise<AgentVerbs> {
	return apiGet<AgentVerbs>(`/api/agents/${encodeURIComponent(name)}/verbs`, opts);
}

export async function getHealth(opts: RequestOptions = {}): Promise<HealthInfo> {
	return apiGet<HealthInfo>('/health', opts);
}

export async function getInstanceProfile(opts: RequestOptions = {}): Promise<InstanceProfile> {
	return apiGet<InstanceProfile>('/profile', opts);
}

/** PATCH `/profile` — aggiorna campi runtime admin-only del profilo. */
export async function patchInstanceProfile(
	patch: { channel_aliases?: Record<string, string> },
	opts: RequestOptions = {}
): Promise<InstanceProfile> {
	return apiPatch<InstanceProfile>('/profile', patch, opts);
}

// ---------------------------------------------------------------------------
// PLUGIN & PACK — pack := [agent seeds]+[plugins]; plugin := [skills]+[rules]+[mcp]
// ---------------------------------------------------------------------------

/** GET `/clodia/plugins` — tutti i plugin (anche sciolti, fuori dai pack). */
export async function listPlugins(opts: RequestOptions = {}): Promise<ReadonlyArray<Plugin>> {
	const raw = await apiGet<unknown>('/clodia/plugins', { cache: true, ...opts });
	return Array.isArray(raw) ? (raw as ReadonlyArray<Plugin>) : [];
}

/** GET `/clodia/plugins/{name}` — dettaglio di un singolo plugin. */
export async function getPlugin(name: string, opts: RequestOptions = {}): Promise<Plugin> {
	return apiGet<Plugin>(`/clodia/plugins/${encodeURIComponent(name)}`, opts);
}

/** DELETE `/clodia/plugins/{name}` — rimuove un plugin non nativo. */
export async function deletePlugin(name: string, opts: RequestOptions = {}): Promise<void> {
	await apiDelete(`/clodia/plugins/${encodeURIComponent(name)}`, opts);
}

/** GET `/clodia/datastores` — inventario datastore SQL + collection RAG dei
 *  pack (attivi/archiviati/orfani), indipendenti dai topic. */
export async function listDatabases(opts: RequestOptions = {}): Promise<DatabasesInventory> {
	return apiGet<DatabasesInventory>('/clodia/datastores', { cache: true, ...opts });
}

/** DELETE `/clodia/datastores/archived/{dir}` — purge definitivo di un
 *  datastore già archiviato (pack rimosso). Unica azione distruttiva
 *  dell'inventario: le collection RAG orfane restano sola lettura finché il
 *  servizio eu-rag-search non espone un modo di cancellarle. */
export async function purgeArchivedDatastore(
	archiveDir: string,
	opts: RequestOptions = {}
): Promise<void> {
	await apiDelete(`/clodia/datastores/archived/${encodeURIComponent(archiveDir)}`, opts);
}

// ---------------------------------------------------------------------------
// TOPIC DATA (clodia-platform#590) — instance data catalog, imports into a
// topic, per-agent grants inside the topic, migration from seed grants.
// ---------------------------------------------------------------------------

export type DataKind = 'datastore' | 'rag';
export type DataGrantMode = 'read' | 'write';
export type DataAccessMode = 'legacy' | 'topic';

/** One resource of the instance data catalog. */
export interface DataCatalogEntry {
	key: string;
	kind: DataKind;
	name: string;
	tier: string;
	owner: string;
	/** Who may import it into a topic; `"@admin"` = any admin. */
	importers: string[];
	created_at: string;
	source: string;
	/** Topics that import it, as `"SEAL-2/name"`; absent on older backends. */
	importing_topics?: string[];
	/** For a topic's own RAG index: its topic as `"SEAL-2/name"` (admins only). */
	topic?: string;
	/** Status of that topic (`active`, `archived`, …): archived ones are not offered. */
	topic_status?: string;
}

/**
 * Human-readable label of a catalog resource: a topic's own index reads as
 * "Indice · <slug>" (the raw `topic-…` id stays for tooltips); anything
 * else, or an entry without `topic`, keeps its name.
 */
export function catalogLabel(entry: { name: string; topic?: string }): string {
	if (!entry.topic) return entry.name;
	const i = entry.topic.indexOf('/');
	return `Indice · ${i >= 0 ? entry.topic.slice(i + 1) : entry.topic}`;
}

/** Tier part of a topic index's `topic` (`"SEAL-2/name"` → `"SEAL-2"`). */
export function catalogTopicTier(entry: { topic?: string }): string {
	const i = entry.topic?.indexOf('/') ?? -1;
	return i > 0 ? entry.topic!.slice(0, i) : '';
}

export interface DataCatalog {
	entries: DataCatalogEntry[];
	data_access: DataAccessMode;
}

/** A resource imported by a topic (`meta.data`), with its per-agent grants. */
export interface TopicDataImport {
	kind: DataKind;
	name: string;
	grants?: Record<string, DataGrantMode>;
}

export interface DataMigrationItem {
	/** `"SEAL-2/name"`. */
	topic: string;
	kind: DataKind;
	name: string;
	tier: string;
	grants: Record<string, DataGrantMode>;
	status: 'ok' | 'already' | 'skipped';
	reason?: string;
}

export interface DataMigrationPlan {
	items: DataMigrationItem[];
	notes: string[];
	counts: { ok: number; already: number; skipped: number };
}

/** The `detail` of a FastAPI error body (Italian, for the user), else the message. */
export function apiErrorDetail(err: unknown): string {
	if (err instanceof ApiError) {
		try {
			const d = (JSON.parse(err.body) as { detail?: unknown }).detail;
			if (typeof d === 'string' && d) return d;
		} catch {
			// not JSON: fall back to the message
		}
		return err.message;
	}
	return err instanceof Error ? err.message : String(err);
}

/** GET `/clodia/data-catalog` — non-admins receive only what they may import. */
export async function getDataCatalog(opts: RequestOptions = {}): Promise<DataCatalog> {
	return apiGet<DataCatalog>('/clodia/data-catalog', opts);
}

function postDataCatalog<T>(body: Record<string, unknown>, opts: RequestOptions): Promise<T> {
	return apiPost<T>('/clodia/data-catalog', body, opts);
}

/** Admin: change a catalog entry's tier and/or importers. */
export async function updateDataCatalogEntry(
	kind: DataKind,
	resource: string,
	patch: { tier?: string; importers?: string[] },
	opts: RequestOptions = {}
): Promise<DataCatalogEntry> {
	return postDataCatalog({ action: 'update', kind, resource, ...patch }, opts);
}

/** Admin: drop a resource from the catalog (the data is not deleted). */
export async function retireDataCatalogEntry(
	kind: DataKind, resource: string, opts: RequestOptions = {}
): Promise<{ retired: boolean }> {
	return postDataCatalog({ action: 'retire', kind, resource }, opts);
}

/** Admin: register the datastores and collections not yet in the catalog. */
export async function syncDataCatalog(opts: RequestOptions = {}): Promise<{ added: number }> {
	return postDataCatalog({ action: 'sync' }, opts);
}

/** Admin: compute the migration from seed grants to topic imports (read-only). */
export async function getDataMigrationPlan(opts: RequestOptions = {}): Promise<DataMigrationPlan> {
	return postDataCatalog({ action: 'migration_plan' }, opts);
}

/** Admin: apply the approved items of the migration plan. */
export async function applyDataMigration(
	items: DataMigrationItem[], opts: RequestOptions = {}
): Promise<{ applied: string[]; failed: { item: unknown; error: string }[] }> {
	return postDataCatalog({ action: 'migration_apply', items }, opts);
}

/** Admin: switch the instance between seed grants (`legacy`) and topic imports. */
export async function setDataAccessMode(
	mode: DataAccessMode, opts: RequestOptions = {}
): Promise<{ data_access: DataAccessMode }> {
	return postDataCatalog({ action: 'set_mode', mode }, opts);
}

function topicDataPath(tier: string, name: string): string {
	return `/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/data`;
}

/** Topic owner: import a catalog resource into the topic. */
export async function importTopicData(
	tier: string, name: string, kind: DataKind, resource: string, opts: RequestOptions = {}
): Promise<{ ok: boolean; imported?: boolean; already?: boolean }> {
	return apiPost(topicDataPath(tier, name), { action: 'import', kind, resource }, opts);
}

/** Topic owner: remove an imported resource from the topic. */
export async function removeTopicData(
	tier: string, name: string, kind: DataKind, resource: string, opts: RequestOptions = {}
): Promise<{ ok: boolean; removed: boolean }> {
	return apiPost(topicDataPath(tier, name), { action: 'remove', kind, resource }, opts);
}

/** Topic owner: set an agent's access to an imported resource (`null` revokes). */
export async function grantTopicData(
	tier: string, name: string, kind: DataKind, resource: string,
	agent: string, mode: DataGrantMode | null, opts: RequestOptions = {}
): Promise<{ ok: boolean; grants: Record<string, DataGrantMode> }> {
	return apiPost(topicDataPath(tier, name), { action: 'grant', kind, resource, agent, mode }, opts);
}

/** The topic's own RAG index (`meta.index`, clodia-platform#599). */
export interface TopicIndexMeta {
	collection?: string;
	enabled?: boolean;
}

/** Topic owner or admin: switch the topic's RAG index on or off.
 *  Switching it off drops the collection's documents. */
export async function setTopicIndex(
	tier: string, name: string, enabled: boolean, opts: RequestOptions = {}
): Promise<{ enabled: boolean; collection: string }> {
	return apiPost(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/index`,
		{ enabled }, opts
	);
}

/** The room's toolbox (clodia-platform#605/#609): the MCP/connector verbs a
 *  room enables for every participant, what may be
 *  enabled (by namespace; an empty list = a backend whose verbs are named by
 *  the backend) and which verbs still ask for confirmation. */
export interface Toolbox {
	enabled: string[];
	/** Per-agent exceptions: dropped from the UI (owner's decision, 26 Oct
	 *  2026). A gateway may still send them; ignored here. */
	except?: Record<string, string[]>;
	enablable: Record<string, string[]>;
	gated?: string[];
	/** The MCP form (clodia-platform#620). Absent on a gateway before 2.138.0:
	 *  the panel then falls back to the per-verb toolbox. */
	mcp_catalogue?: Record<string, McpInfo>;
	mcp?: Record<string, { resources: McpResource[] }>;
	/** Ignored, like `except`. */
	except_mcp?: Record<string, Record<string, string>>;
	/** Drive folders linked to the room: Google resources, read only here. */
	linked_folders?: string[];
}

/** One MCP a room can authorise (#620): a pack connector family (Google is
 *  one), a mounted MCP backend or a native namespace. */
export interface McpInfo {
	id: string;
	label: string;
	kind: string;
	namespaces: string[];
	verbs: string[];
	/** The verbs that write or leave. */
	write: string[];
	/** The resource kinds its verbs reach, from the connector manifests. */
	schemes: { scheme: string; direction: string; verbs: string[] }[];
	/** False when the backend names its own verbs and the gateway cannot list
	 *  them from here. */
	enumerable: boolean;
}

export type McpEffect = 'allow' | 'ask' | 'deny';

export interface McpResource {
	uri: string;
	effect: McpEffect;
	verbs?: string[];
}

/** Owner or admin: the MCP actions of the room's tools (#620). The gateway
 *  validates every field and canonicalises the URI. */
export type McpToolAction =
	| { action: 'enable_mcp' | 'disable_mcp'; mcp: string }
	| { action: 'set_resource'; mcp: string; uri: string; effect: McpEffect; verbs?: string[] }
	| { action: 'unset_resource'; mcp: string; uri: string };

export type ToolboxAction = 'enable' | 'disable';

/** May using `entry` ask for confirmation? For `ns.*`: if any verb of the
 *  namespace may. «May», not «will»: a push toward an approved repository,
 *  for one, does not ask (clodia-platform#609). */
export function toolMayAsk(entry: string, gated: readonly string[] = []): boolean {
	if (entry.endsWith('.*')) {
		const prefix = entry.slice(0, -1);
		return gated.some((g) => g.startsWith(prefix));
	}
	return gated.includes(entry);
}

const channelToolsPath = (tier: string, name: string) =>
	`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/tools`;

export async function getChannelTools(tier: string, name: string, opts: RequestOptions = {}): Promise<Toolbox> {
	return apiGet<Toolbox>(channelToolsPath(tier, name), opts);
}

/** Owner or admin: enable/disable a verb in the room. */
export async function setChannelTool(
	tier: string, name: string, action: ToolboxAction, verb: string,
	opts: RequestOptions = {}
): Promise<unknown> {
	return apiPost(channelToolsPath(tier, name), { action, verb }, opts);
}

export async function setChannelMcp(
	tier: string, name: string, body: McpToolAction, opts: RequestOptions = {}
): Promise<unknown> {
	return apiPost(channelToolsPath(tier, name), body, opts);
}

/** The verbs enabled outside a room (DMs, jobs not bound to a topic). */
export async function getDmTools(opts: RequestOptions = {}): Promise<Toolbox> {
	return apiGet<Toolbox>('/clodia/dm-tools', opts);
}

/** Admin: enable or disable a verb outside rooms. */
export async function setDmTool(action: 'enable' | 'disable', verb: string, opts: RequestOptions = {}): Promise<unknown> {
	return apiPost('/clodia/dm-tools', { action, verb }, opts);
}

/** GET `/clodia/packs` — pack (aggregati di agent seeds + plugins). */
export async function listPacks(opts: RequestOptions = {}): Promise<ReadonlyArray<Pack>> {
	const raw = await apiGet<unknown>('/clodia/packs', { cache: true, ...opts });
	return Array.isArray(raw) ? (raw as ReadonlyArray<Pack>) : [];
}

/** GET `/clodia/packs/{name}` — dettaglio di un singolo pack. */
export async function getPack(name: string, opts: RequestOptions = {}): Promise<Pack> {
	return apiGet<Pack>(`/clodia/packs/${encodeURIComponent(name)}`, opts);
}

/** Risultato dell'import UNIFICATO: un pack (agents+plugins) o un plugin sciolto. */
export interface PackImportResult {
	kind: 'pack' | 'plugin';
	// kind === 'pack'
	pack?: string;
	agents?: Array<{ name: string; status: 'installed' | 'exists' | 'error'; detail?: string }>;
	plugins?: Array<{ plugin: string; skills: string[]; rules: string[]; mcp_servers: string[] }>;
	// kind === 'plugin'
	plugin?: string;
	skills?: string[];
	rules?: string[];
	mcp_servers?: string[];
}

/** POST `/clodia/packs/import-url` — import unificato da URL (git o .zip remoto). */
export async function importPackUrl(
	url: string,
	opts: RequestOptions = {}
): Promise<PackImportResult> {
	return apiPost<PackImportResult>('/clodia/packs/import-url', { url }, opts);
}

/** POST `/clodia/packs/import` — import unificato da archivio .zip (multipart). */
export async function importPackZip(
	file: File,
	opts: RequestOptions = {}
): Promise<PackImportResult> {
	const fd = new FormData();
	fd.append('file', file);
	const res = await fetch(joinUrl('/clodia/packs/import'), {
		method: 'POST',
		headers: { ...authHeaders(), ...(opts.headers || {}) },
		body: fd,
		signal: opts.signal
	});
	if (!res.ok) throw await parseError(res);
	return parseJsonOrText<PackImportResult>(res);
}

/** DELETE `/clodia/packs/{name}` — rimuove un pack (plugin + agenti + manifest). */
export async function deletePack(name: string, opts: RequestOptions = {}): Promise<void> {
	await apiDelete(`/clodia/packs/${encodeURIComponent(name)}`, opts);
}

/** GET `/clodia/packs/available` — i pack ufficiali (di prima parte) non installati,
 * reinstallabili dal loro upstream (clodia-platform#562). Solo admin. */
export async function listAvailablePacks(
	opts: RequestOptions = {}
): Promise<AvailablePack[]> {
	return apiGet<AvailablePack[]>('/clodia/packs/available', opts);
}

/** POST `/clodia/packs/{name}/install` — reinstalla un pack ufficiale rimosso
 * (stesso percorso fidato dell'Update; clodia-platform#562). */
export async function installPack(
	name: string,
	opts: RequestOptions = {}
): Promise<{ installed: string; version: string; agents_restarted: number }> {
	return apiPost(`/clodia/packs/${encodeURIComponent(name)}/install`, {}, opts);
}

/** POST `/clodia/packs/{name}/disable` | `/enable` — spegne o riaccende un
 * pack senza rimuoverlo (clodia-platform#563). */
export async function setPackEnabled(
	name: string,
	enabled: boolean,
	opts: RequestOptions = {}
): Promise<{ agents_restarted?: number; already?: boolean }> {
	const verbo = enabled ? 'enable' : 'disable';
	return apiPost(`/clodia/packs/${encodeURIComponent(name)}/${verbo}`, {}, opts);
}

/** POST `/clodia/packs/{name}/check-update` — controlla su GitHub se c'è una versione più recente. */
export async function checkPackUpdate(
	name: string,
	opts: RequestOptions = {}
): Promise<{ name: string; installed: string; remote: string; update_available: boolean }> {
	return apiPost(`/clodia/packs/${encodeURIComponent(name)}/check-update`, {}, opts);
}

/** POST `/clodia/packs/{name}/update` — aggiorna dal repo upstream (replace + restart agenti). */
export async function updatePack(
	name: string,
	opts: RequestOptions = {}
): Promise<{ updated: string; version: string; agents_restarted: number }> {
	return apiPost(`/clodia/packs/${encodeURIComponent(name)}/update`, {}, opts);
}

/** POST `/clodia/packs/{name}/drift` — i seed installati corrispondono ancora a
 *  quelli dichiarati dal pack? (clodia-platform#266)
 *
 *  POST benché sia una lettura: risolvere il riferimento può costare un download
 *  dall'upstream, e non è cosa da mettere dietro una GET che una cache qualsiasi
 *  si sente in diritto di ripetere. */
export async function checkPackDrift(name: string, opts: RequestOptions = {}): Promise<PackDrift> {
	return apiPost(`/clodia/packs/${encodeURIComponent(name)}/drift`, {}, opts);
}

/** POST `/clodia/packs/update-all` — Update + setup LOGICO (non un turno
 *  d'agente) per ogni pack con upstream dichiarato (18 set 2026, richiesta
 *  di Davide). Un pack che fallisce non blocca gli altri: il report elenca
 *  ok/errore per ciascuno. */
export async function updateAllPacks(
	opts: RequestOptions = {}
): Promise<{ packs: ReadonlyArray<PackUpdateAllResult>; agents_restarted: number }> {
	return apiPost('/clodia/packs/update-all', {}, opts);
}

/** GET `/clodia/rules` — deduplicated rule catalog. */
export async function listRules(opts: RequestOptions = {}): Promise<ReadonlyArray<Rule>> {
	const raw = await apiGet<unknown>('/clodia/rules', { cache: true, ...opts });
	return Array.isArray(raw) ? (raw as ReadonlyArray<Rule>) : [];
}

/** GET `/clodia/rules/{name}` — markdown body + parsed frontmatter. */
export async function getRule(name: string, opts: RequestOptions = {}): Promise<RuleDetail> {
	return apiGet<RuleDetail>(`/clodia/rules/${encodeURIComponent(name)}`, opts);
}

// ---------------------------------------------------------------------------
// AUTH — Claude Max OAuth flow, driven server-side by the agent-server.
//
// Endpoints (from server/api/auth.py):
//   GET  /auth/status → { logged_in, login_in_progress, login_url, login_error }
//   POST /auth/login  → { status, url }   (kicks off `claude auth login`)
//   POST /auth/code   → { status }        (forwards the OAuth return code)
//   POST /auth/logout → { status }        (deletes the local token)
//
// These wrappers are intentionally thin: they only resolve the URL and apply
// the envelope types. The orchestration (polling, dev-mode bypass, redirects)
// lives in `src/lib/stores/auth.ts`.
// ---------------------------------------------------------------------------

/** GET `/auth/status` — current login state on the agent-server. */
export async function getAuthStatus(opts: RequestOptions = {}): Promise<AuthStatus> {
	const raw = await apiGet<Partial<AuthStatus>>('/auth/status', opts);
	const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AuthStatus>;
	return {
		logged_in: r.logged_in === true,
		login_in_progress: r.login_in_progress === true,
		login_url: typeof r.login_url === 'string' ? r.login_url : null,
		login_error: typeof r.login_error === 'string' ? r.login_error : null
	};
}

/**
 * POST `/auth/login` — start the OAuth flow.
 *
 * Returns `{ status, url }`. When `status === 'already_logged_in'` the URL
 * is null; otherwise `url` is the Claude OAuth page the user must open.
 */
export async function startLogin(opts: RequestOptions = {}): Promise<AuthLoginResponse> {
	const raw = await apiPost<Partial<AuthLoginResponse>>('/auth/login', {}, opts);
	const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AuthLoginResponse>;
	return {
		status: typeof r.status === 'string' ? r.status : 'unknown',
		url: typeof r.url === 'string' ? r.url : null
	};
}

/** POST `/auth/code` — forward the OAuth return code to the waiting process. */
export async function submitAuthCode(
	code: string,
	opts: RequestOptions = {}
): Promise<AuthActionResponse> {
	const raw = await apiPost<Partial<AuthActionResponse>>('/auth/code', { code }, opts);
	const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AuthActionResponse>;
	return { status: typeof r.status === 'string' ? r.status : 'unknown' };
}

/** POST `/auth/logout` — drop the local Claude OAuth token. */
export async function logout(opts: RequestOptions = {}): Promise<AuthActionResponse> {
	const raw = await apiPost<Partial<AuthActionResponse>>('/auth/logout', {}, opts);
	const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AuthActionResponse>;
	return { status: typeof r.status === 'string' ? r.status : 'unknown' };
}

// ---------------------------------------------------------------------------
// KANBAN — Pause / Resume pipeline per board
// ---------------------------------------------------------------------------



// ─── Tools / connettori OAuth (backend gateway clodia-tools, wire diretto) ───

export interface ToolConnector {
	id: string;
	label: string;
	provider: string;
	connected: boolean;
	operational?: boolean;
	accounts: string[];
	issues?: ConnectorIssue[];
	transport?: string;
	/** backend MCP con consenso OAuth (clodia-platform#532): 'oauth' o assente. */
	auth?: string;
	/** solo per `auth === 'oauth'`: il consenso c'è ed è ancora spendibile. */
	authorized?: boolean;
	/** metodi del «Connetti» (clodia-platform#565): tipi, scope, campi — mai valori. */
	auth_methods?: { type: string; scope?: string; fields?: { name: string; label: string; secret: boolean }[] }[];
	/** il metodo con cui il backend è connesso, o null. */
	auth_active?: string | null;
	/** tool del backend MCP disattivati da un admin (#633). */
	disabled_tools?: string[];
	/** storage backend dei topic (provider 'storage'): adapter attivo + versioning. */
	builtin?: boolean;
	backend?: string;
	versioning?: string;
}

export interface ConnectorIssue {
	account: string;
	missing?: string[];
	error?: string | null;
}

/** Un servizio lungo-vivo dichiarato da un pack (clodia-platform#515). */
export interface PackService {
	pack: string;
	service: string;
	state: string;
	pid?: number | null;
	isolated?: boolean;
	failures?: number;
	last_exit?: number | null;
	last_error?: string | null;
	health?: string | null;
}

/** GET `/tools` — stato dei connettori (quali account sono connessi).
 *
 * `services` arriva da clodia-tools#362 (#515) ed è opzionale di proposito:
 * finché quella versione non è in produzione il campo non c'è, e la pagina
 * mostra la sezione solo quando c'è qualcosa da mostrare. */
export async function getTools(
	opts: RequestOptions = {}
): Promise<{ connectors: ToolConnector[]; services?: PackService[] }> {
	return apiGet<{ connectors: ToolConnector[]; services?: PackService[] }>('/tools', opts);
}

/** Una voce del registry dei connettori (`GET /tools/connectors`). */
export interface RegistryConnector {
	id: string;
	label: string;
	pack: string;
	namespace: string;
	builtin: boolean;
	schemes: {
		scheme: string;
		direction: string;
		label: string;
		icon: string;
		hierarchical: boolean;
		danger: string;
		forms: { label: string; example: string }[];
	}[];
	providers: {
		id: string;
		label: string;
		kind: string;
		vault_entry: string;
		connected?: boolean;
		fields: { name: string; label: string; secret: boolean; required: boolean; placeholder: string }[];
	}[];
	verbs: { verb: string; direction: string; scheme: string; prefix: boolean; dtype: string }[];
	topic_actions: {
		id: string;
		label: string;
		binding: string;
		admin_only: boolean;
		fields: { name: string; label: string; required: boolean; placeholder: string; options?: unknown }[];
		adds: { ingress: string[]; egress: string[] };
	}[];
	tools_card: {
		setup_label: string;
		status_verb: string;
		docs_url: string;
		blurb: string;
		scope: string;
		icon: string;
	} | null;
	/** The connector has a device pairing step (#639). */
	pairing?: boolean;
	/** The connector is a chat relay transport (#638). */
	relay?: { label?: string; attachments?: boolean; schemes?: string[] };
}

export interface ConnectorRegistry {
	connectors: RegistryConnector[];
	schemes: { egress: string[]; source: string[] };
	services?: PackService[];
	problems?: string[];
	ignored?: string[];
}

/** GET `/tools/connectors` — i connettori INSTALLATI, dal registry dei pack.
 *
 * È la sorgente di ciò che le pagine disegnano (clodia-platform#520): quali
 * bottoni ha un topic, quali card ha la pagina Tools, come si chiamano gli
 * schemi. `/tools/connectors` e non `/internal/connectors` perché `/internal`
 * è server-to-server e il proxy della webui non lo inoltra: sono la stessa
 * funzione del gateway, montata dove il browser arriva. */
export async function getConnectorRegistry(opts: RequestOptions = {}): Promise<ConnectorRegistry> {
	return apiGet<ConnectorRegistry>('/tools/connectors', opts);
}

/** The connectors as a TOPIC page draws them (`GET /api/topics/{tier}/{name}/connectors`,
 *  clodia-logic#521). Owner-scoped: the agent-server serves it to the human
 *  topic owner or an admin, reduced to topic actions with their declared
 *  fields, scheme forms, verb families and glyph — no providers, no vault
 *  entry names, and no `admin_only` action for a non-admin. The topic page
 *  must not read `/tools/connectors`: the gateway serves that to admins only,
 *  and a non-admin owner would lose the buttons with a silent 401. */
export interface TopicConnectors {
	tier: string;
	connectors: {
		id: string;
		label: string;
		schemes: RegistryConnector['schemes'];
		verbs: { verb: string; dtype: string }[];
		topic_actions: {
			id: string;
			label: string;
			binding: string;
			admin_only: boolean;
			fields: { name: string; label: string; required: boolean; placeholder: string; options?: string }[];
		}[];
		tools_card: { icon: string } | null;
		/** A chat relay transport (#638): its group links admit every member. */
		relay?: { label?: string };
	}[];
}

export async function getTopicConnectors(
	tier: string, name: string, opts: RequestOptions = {}
): Promise<TopicConnectors> {
	return apiGet<TopicConnectors>(
		`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/connectors`, opts);
}

/** POST `/tools/connectors/{id}/connect` — la credenziale che il manifest
 * dichiara. I campi sono quelli dichiarati dal provider: questo client non ne
 * conosce i nomi, li inoltra. Campi vuoti = disconnessione. */
export async function connectConnector(
	id: string,
	provider: string,
	fields: Record<string, string>,
	opts: RequestOptions = {}
): Promise<{ connected: boolean; connector: string; provider: string }> {
	return apiPost(`/tools/connectors/${encodeURIComponent(id)}/connect`, { provider, ...fields }, opts);
}

/** The device pairing state of a pack connector that declares `pairing:`
 *  (clodia-platform#639). The gateway forwards to the pack service on loopback
 *  and returns ONLY these fields. `code` and `qr` are short-lived secrets for
 *  the person in front of the screen: never log them. */
export interface ConnectorPairing {
	/** `unpaired` | `connecting` | `pairing` | `open` | `reconnecting` |
	 *  `logged_out` | `starting`, or anything newer the service reports. */
	state: string;
	/** A linking code to type on the device (while `state === 'pairing'`). */
	code?: string;
	/** A QR payload to render and scan (while `state === 'pairing'`). */
	qr?: string;
	/** The paired identity, for display (when `state === 'open'`). */
	me?: string;
	error?: string;
}

/** GET `/tools/connectors/{id}/pairing` — the pairing status. Human admin only. */
export async function getConnectorPairing(id: string, opts: RequestOptions = {}): Promise<ConnectorPairing> {
	return apiGet<ConnectorPairing>(`/tools/connectors/${encodeURIComponent(id)}/pairing`, opts);
}

/** POST `/tools/connectors/{id}/pairing` — starts pairing. Human admin only. */
export async function startConnectorPairing(id: string, opts: RequestOptions = {}): Promise<ConnectorPairing> {
	return apiPost<ConnectorPairing>(`/tools/connectors/${encodeURIComponent(id)}/pairing`, {}, opts);
}

// ── Backup gestito (ISO 27001 A.8.13) ───────────────────────────────────────
export interface BackupStatus {
	configured: boolean;
	backend?: string;
	repository?: string;
	schedule?: string;
	retention?: { daily: number; weekly: number; monthly: number };
	/** Ultimo backup ESEGUITO (anche se fallito): data + esito. */
	last_run?: { time: string; ok: boolean; error?: string };
	/** Ultimo backup VALIDO (ultimo snapshot restic: sempre un successo). */
	last_snapshot?: { time: string; id: string };
}
export async function getBackupStatus(opts: RequestOptions = {}): Promise<BackupStatus> {
	return apiGet<BackupStatus>('/tools/backup/status', opts);
}
export async function configureBackup(body: {
	backend: string; repository: string; env: Record<string, string>;
	passphrase: string; retention?: { daily: number; weekly: number; monthly: number }; schedule?: string;
}, opts: RequestOptions = {}): Promise<{ configured: boolean; backend?: string }> {
	return apiPost('/tools/backup/config', body, opts);
}
export async function runBackup(opts: RequestOptions = {}): Promise<{ ok: boolean; check_rc?: number }> {
	return apiPost('/tools/backup/run', {}, opts);
}
export async function backupSnapshots(opts: RequestOptions = {}): Promise<{ snapshots: Array<{ id: string; time: string }> }> {
	return apiGet('/tools/backup/snapshots', opts);
}
export async function restoreTest(opts: RequestOptions = {}): Promise<{ ok: boolean; restored_topics: number }> {
	return apiPost('/tools/backup/restore-test', {}, opts);
}

/** The Google OAuth flow is google-pack's gateway component's: its routes
 *  `/tools/google-pack/{app,auth,connect}` (clodia-platform#558), reached
 *  directly since the gateway's `/tools/google/*` aliases were removed
 *  (#526). The component authenticates (a human admin) and audits. */
const GOOGLE_PACK = '/tools/google-pack';

/** GET `…/app` — l'app OAuth Google (client_id/secret) è configurata? */
export async function getGoogleAppStatus(
	opts: RequestOptions = {}
): Promise<{ configured: boolean; redirect_uri: string }> {
	return apiGet(`${GOOGLE_PACK}/app`, opts);
}

/** POST `…/app` — deposita la credenziale d'app OAuth Google. */
export async function configureGoogleApp(
	body: { client_json?: string; client_id?: string; client_secret?: string; redirect_uri?: string },
	opts: RequestOptions = {}
): Promise<{ configured: boolean; redirect_uri: string }> {
	return apiPost(`${GOOGLE_PACK}/app`, body, opts);
}

/** GET `…/auth` — URL del consenso Google UNIFICATO (Gmail + Drive + Docs + Calendar). */
export async function getGoogleAuth(
	opts: RequestOptions = {}
): Promise<{ auth_url: string; state: string; redirect_uri: string }> {
	return apiGet(`${GOOGLE_PACK}/auth`, opts);
}

/** POST `…/connect` — scambia il code del consenso unificato → google_<account>. */
export async function googleConnect(
	body: { code: string; state: string },
	opts: RequestOptions = {}
): Promise<{ connected: boolean; account: string; email: string }> {
	return apiPost(`${GOOGLE_PACK}/connect`, body, opts);
}

/** POST `/clodia/cert-request` — un nuovo utente chiede all'admin di emettere il
 *  certificato per la propria pubkey (notifica telegram/email; non crea nulla). */
export async function requestCert(
	body: { pubkey: string; name?: string; contact?: string },
	opts: RequestOptions = {}
): Promise<{ submitted: boolean; notified: string[] }> {
	return apiPost('/clodia/cert-request', body, opts);
}

/** Caselle email generiche (IMAP/SMTP) — connettore multi-mailbox. */
export interface MailboxInput {
	account: string;
	email: string;
	password: string;
	smtp_server: string;
	/** Opzionale: senza IMAP la casella è di **solo invio** — un alias con SMTP
	 *  e nessuna casella dietro. È una forma legittima, non una mancanza. */
	imap_server?: string;
	imap_port?: number;
	smtp_port?: number;
	display_name?: string;
	sent_folder?: string;
	smtp_user?: string;
}
export interface MailboxStatus extends ConnectorIssue {
	operational: boolean;
	/** Casella di solo invio (nessun IMAP): si spedisce, non si legge. */
	send_only?: boolean;
}
export interface MailboxesResponse {
	mailboxes: string[];
	statuses: MailboxStatus[];
}
export async function getMailboxes(opts: RequestOptions = {}): Promise<MailboxesResponse> {
	const d = await apiGet<Partial<MailboxesResponse>>('/tools/email/mailboxes', opts);
	const mailboxes = d.mailboxes ?? [];
	return {
		mailboxes,
		statuses: d.statuses ?? mailboxes.map((account) => ({ account, operational: true }))
	};
}
export async function addMailbox(m: MailboxInput, opts: RequestOptions = {}): Promise<{ account: string; connected: boolean }> {
	return apiPost('/tools/email/mailboxes', m, opts);
}
export async function removeMailbox(account: string, opts: RequestOptions = {}): Promise<void> {
	await apiDelete(`/tools/email/mailboxes/${encodeURIComponent(account)}`, opts);
}


/** A verb of a tested MCP backend (#575): its gateway name, the backend's
 *  description (untrusted text), and whether the gateway lets it through. */
export interface McpTestVerb {
	name: string;
	description: string;
	/** the gateway's reachability (#575), not the admin's toggle */
	enabled: boolean;
	reason?: string;
	/** the backend's own tool name, without the server prefix (#633) */
	tool?: string;
	/** switched off by an admin in this list (#633) */
	disabled?: boolean;
	/** not listed at the previous Test (#633) */
	new?: boolean;
	/** disabled, and the server no longer lists it (#633) */
	gone?: boolean;
}

/** POST `/tools/mcp/{name}/tools` — switch one tool of a mounted MCP server on
 *  or off for the whole instance (clodia-platform#633). Human admin only. */
export async function setMcpToolEnabled(
	name: string,
	tool: string,
	enabled: boolean,
	opts: RequestOptions = {}
): Promise<{ backend: string; tool: string; enabled: boolean; disabled: string[] }> {
	return apiPost(`/tools/mcp/${encodeURIComponent(name)}/tools`, { tool, enabled }, opts);
}

/** POST `/tools/{id}/test` — verifica REALE della connessione (chiamata al
 *  provider). {ok: bool|null, detail}. ok=null → non testabile. Per un
 *  backend MCP riuscito anche `verbs` (#575). */
export async function testConnector(
	id: string,
	opts: RequestOptions = {}
): Promise<{ ok: boolean | null; detail: string; verbs?: McpTestVerb[] }> {
	return apiPost(`/tools/${encodeURIComponent(id)}/test`, {}, opts);
}

/** POST `/tools/mcp` — registra uno o più MCP server da mcp.json. I valori in
 *  `secrets` (per i placeholder ${NAME}) sono depositati nel vault, non nel config.
 *  `pack` (clodia-platform#641, gateway ≥ 2.153.0) mounts the servers FOR an
 *  installed pack whose manifest names them, so its `pending` servers and its
 *  connector can use them. Human admin only; omitted when not chosen. */
export async function registerMcp(
	body: { config: unknown; secrets?: Record<string, string>; pack?: string },
	opts: RequestOptions = {}
): Promise<{ registered: string[] }> {
	return apiPost('/tools/mcp', body, opts);
}

/** DELETE `/tools/mcp/{name}` — smonta un MCP server registrato. */
export async function unregisterMcp(name: string, opts: RequestOptions = {}): Promise<{ unregistered: string }> {
	return apiDelete(`/tools/mcp/${encodeURIComponent(name)}`, opts);
}

/** POST `/tools/mcp/{name}/oauth/start` — avvia il consenso OAuth di un server
 *  MCP montato (clodia-platform#532) e ritorna la URL di autorizzazione da
 *  aprire. Nessun segreto nella risposta: lo `state` è il filo del consenso,
 *  il token resta nel vault del gateway. */
export async function startMcpOAuth(
	name: string,
	opts: RequestOptions = {}
): Promise<{ state: string; auth_url: string; redirect_uri: string }> {
	return apiPost(`/tools/mcp/${encodeURIComponent(name)}/oauth/start`, {}, opts);
}

/** POST `/tools/mcp/{name}/oauth/complete` — chiude il consenso. `code` accetta
 *  il parametro nudo o la URL intera su cui il browser è atterrato. */
export async function completeMcpOAuth(
	name: string,
	body: { state: string; code: string },
	opts: RequestOptions = {}
): Promise<{ connected: boolean; server: string; detail?: string }> {
	return apiPost(`/tools/mcp/${encodeURIComponent(name)}/oauth/complete`, body, opts);
}

/** POST `/tools/mcp/{name}/connect` — «Connetti» con una credenziale inserita
 *  (clodia-platform#565). Il gateway prova i valori con `list_tools` e li mette
 *  nel vault SOLO se il backend risponde; la risposta non li contiene mai. */
export async function connectMcp(
	name: string,
	fields: Record<string, string>,
	opts: RequestOptions = {}
): Promise<{ connected: boolean; server: string; method: string; detail?: string }> {
	return apiPost(`/tools/mcp/${encodeURIComponent(name)}/connect`, { fields }, opts);
}

/** POST `/tools/mcp/{name}/disconnect` — cancella dal vault credenziale e token OAuth. */
export async function disconnectMcp(
	name: string,
	opts: RequestOptions = {}
): Promise<{ disconnected: boolean; server: string; removed: string[] }> {
	return apiPost(`/tools/mcp/${encodeURIComponent(name)}/disconnect`, {}, opts);
}

// ─── Providers (motori di inferenza, backend clodia-logic) ───────────────────

export interface ProviderStatus {
	id: string;
	name: string;
	connected: boolean;
	via: 'subscription' | 'apikey' | null;
	/** Meccanismo UNICO del provider (split DPA/costi 21 giu 2026): un provider
	 *  è O apikey O subscription, non entrambi. */
	mechanism?: 'subscription' | 'apikey';
	/** SDK servito (claude | codex | …). */
	sdk?: string | null;
	/** Capacità: 'oauth' se il provider supporta il login-abbonamento OAuth-paste,
	 *  null se offre solo API key (l'abbonamento, se c'è, passa da altro canale). */
	subscription?: 'oauth' | null;
	/** Livello SEAL effettivo (EC Cloud Sovereignty Framework) — es. 'SEAL-2'. */
	seal?: string | null;
	/** Dettaglio sovranità: SEAL + breakdown SOV-2/3/7 + dimensioni (DPA, residency…). */
	sovereignty?: ProviderSovereignty | null;
	/** In pausa: connesso ma escluso dalla selezione (gli agent ripiegano altrove). */
	paused?: boolean;
	/** Provider a ENDPOINT dichiarato dall'admin (clodia-platform#265): nomi dei
	 *  campi che il collegamento deve chiedere (`['base_url', 'model']`), in
	 *  ordine. `null` per i provider a endpoint fisso. */
	configurable?: string[] | null;
	/** La API key è FACOLTATIVA: un endpoint locale (ollama, LM Studio) non ne
	 *  chiede nessuna, e ciò che rende il provider collegato è il `base_url`. */
	apikey_optional?: boolean | null;
	/** Endpoint attualmente configurato. NON è un segreto — a differenza della
	 *  chiave, che dal backend non esce mai — e serve a ripresentare il form di
	 *  «Riconnetti» già compilato: `set_key` riscrive il bundle intero. */
	base_url?: string | null;
	/** Modello attualmente configurato sull'endpoint, se dichiarato. */
	model?: string | null;
}

export interface ProviderSovereignty {
	seal?: string;
	/** { "SOV-2": "SEAL-2", "SOV-3": "SEAL-3", "SOV-7": "SEAL-3" } */
	assessment?: Record<string, string>;
	dimensions?: {
		jurisdiction?: string;
		dpa?: boolean;
		dpa_url?: string;
		no_training?: boolean | string;
		data_residency?: string;
		retention?: string;
		cloud_act_exposed?: boolean;
	};
	note?: string;
}

/** GET `/api/providers` — stato dei provider (mai i valori). */
export async function getProviders(opts: RequestOptions = {}): Promise<{ providers: ProviderStatus[] }> {
	return apiGet('/api/providers', opts);
}

/** POST `/api/providers/{id}/key` — salva la credenziale (→ keystore/env).
 *
 *  Il corpo porta anche i campi `configurable` del provider a endpoint
 *  (`base_url`, `model`): il backend li accetta SOLO se il provider li dichiara
 *  e rifiuta con 400 quelli che non conosce, quindi si mandano quelli scelti da
 *  `connectPayload` (src/lib/providerConnect.js), non tutto ciò che è a schermo.
 *  `api_key` è facoltativa per i provider `apikey_optional`. */
export async function setProviderKey(
	id: string,
	body: { api_key?: string; base_url?: string; model?: string },
	opts: RequestOptions = {}
): Promise<{ connected: boolean; via: string; base_url?: string | null; model?: string | null }> {
	return apiPost(`/api/providers/${encodeURIComponent(id)}/key`, body, opts);
}

/** POST `/api/providers/{id}/login/start` — avvia il login-abbonamento OAuth+PKCE.
 *  Ritorna l'authorize URL da aprire; l'utente autorizza e copia `code#state`. */
export async function providerLoginStart(
	id: string,
	opts: RequestOptions = {}
): Promise<{ auth_url: string; state: string }> {
	return apiPost(`/api/providers/${encodeURIComponent(id)}/login/start`, {}, opts);
}

/** POST `/api/providers/{id}/login/complete` — exchange della stringa `code#state`
 *  incollata dopo l'autorizzazione (PKCE, exchange server-side). */
export async function providerLoginComplete(
	id: string,
	code: string,
	opts: RequestOptions = {}
): Promise<{ connected: boolean; via: string }> {
	return apiPost(`/api/providers/${encodeURIComponent(id)}/login/complete`, { code }, opts);
}

/** DELETE `/api/providers/{id}` — disconnetti. */
export async function disconnectProvider(id: string, opts: RequestOptions = {}): Promise<{ connected: boolean }> {
	return apiDelete(`/api/providers/${encodeURIComponent(id)}`, opts);
}

/** POST `/api/providers/{id}/pause` — connesso ma escluso dalla selezione. */
export async function pauseProvider(id: string, opts: RequestOptions = {}): Promise<{ paused: boolean }> {
	return apiPost(`/api/providers/${encodeURIComponent(id)}/pause`, {}, opts);
}

/** POST `/api/providers/{id}/resume` — riattiva un provider in pausa. */
export async function resumeProvider(id: string, opts: RequestOptions = {}): Promise<{ paused: boolean }> {
	return apiPost(`/api/providers/${encodeURIComponent(id)}/resume`, {}, opts);
}

// ── Profilo dati personali (PII) per-agent — ACL self/admin/grant ───────────
export interface AgentProfile {
	agent: string;
	fields: Record<string, string>;
	grants: string[];
	exists: boolean;
}
export async function getAgentProfile(name: string, opts: RequestOptions = {}): Promise<AgentProfile> {
	return apiGet<AgentProfile>(`/clodia/agents/${encodeURIComponent(name)}/profile`, opts);
}
export async function setAgentProfile(name: string, fields: Record<string, string | null>, opts: RequestOptions = {}): Promise<AgentProfile> {
	return apiPut<AgentProfile>(`/clodia/agents/${encodeURIComponent(name)}/profile`, { fields }, opts);
}
export async function grantAgentProfile(name: string, grantee: string, granted: boolean, opts: RequestOptions = {}): Promise<AgentProfile> {
	return apiPost<AgentProfile>(`/clodia/agents/${encodeURIComponent(name)}/profile/grant`, { grantee, granted }, opts);
}

// ── Allegati del profilo (ACL self/admin/grant) ────────────────────────────
export interface ProfileFile { name: string; size: number; mtime_iso: string; }
export async function listProfileFiles(name: string, opts: RequestOptions = {}): Promise<ProfileFile[]> {
	const d = await apiGet<{ files: ProfileFile[] }>(`/clodia/agents/${encodeURIComponent(name)}/profile/files`, opts);
	return d.files ?? [];
}
export async function uploadProfileFile(name: string, filename: string, dataB64: string, opts: RequestOptions = {}): Promise<{ name: string }> {
	return apiPost(`/clodia/agents/${encodeURIComponent(name)}/profile/files`, { filename, data_b64: dataB64 }, opts);
}
export async function deleteProfileFile(name: string, filename: string, opts: RequestOptions = {}): Promise<void> {
	await apiDelete(`/clodia/agents/${encodeURIComponent(name)}/profile/files/${encodeURIComponent(filename)}`, opts);
}
/** Scarica un allegato con l'header Authorization (un <a href> non lo manderebbe). */
export async function downloadProfileFile(name: string, filename: string): Promise<void> {
	const res = await fetch(joinUrl(`/clodia/agents/${encodeURIComponent(name)}/profile/files/${encodeURIComponent(filename)}`), {
		headers: { ...authHeaders() }
	});
	if (!res.ok) throw await parseError(res);
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url; a.download = filename; a.click();
	URL.revokeObjectURL(url);
}

/** Scarica uno ZIP con TUTTI i file del topic (summary, meta, minute, files/). */
export async function downloadTopicZip(tier: string, name: string): Promise<void> {
	const res = await fetch(
		joinUrl(`/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/download-all`),
		{ headers: { ...authHeaders() } }
	);
	if (!res.ok) throw await parseError(res);
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url; a.download = `${name}.zip`; a.click();
	URL.revokeObjectURL(url);
}

/* Il «collegamento» di un gruppo Telegram a uno scope (meccanismo A) non ha più
 * client qui: il pannello che lo configurava è stato rimosso con
 * clodia-platform#240 e il codice rimasto — il tipo del mount, il campo dei
 * gruppi collegati sul meta del topic e la POST su
 * `/api/topics/{tier}/{name}/telegram` — con #362. Telegram entra ora dalla
 * porta di tutti, come ingress `tg:` nella whitelist (epic #359); l'endpoint
 * lato server resta per i gruppi già collegati, ma non lo chiama più questa UI.
 * La guard scripts/check-no-telegram-panel.mjs tiene il posto vuoto. */

/** POST `/api/topics/{tier}/{name}/logo` — immagine del topic (solo owner).
 *  I byte viaggiano in base64: un logo è piccolo per definizione. */
export async function setTopicLogo(
	tier: string, name: string, data: string, opts: RequestOptions = {}
): Promise<{ logo: string; kind: string; size: number }> {
	return apiPost(`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/logo`,
		{ data }, opts);
}

/** DELETE `/api/topics/{tier}/{name}/logo` — toglie l'immagine (solo owner). */
export async function clearTopicLogo(
	tier: string, name: string, opts: RequestOptions = {}
): Promise<{ logo: string }> {
	return apiDelete(`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/logo`, opts);
}

/** GET `/api/observe/whitelist/scope/{tier}/{name}` — egress/ingress LOCALI
 *  di un topic (sidebar del topic, sostituisce il pannello Proxy dal 10 set
 *  2026). Solo le voci di questo scope, mai la lista globale — quella sta
 *  in `getEgressWhitelist()` / `/settings/egress`. */
export async function getTopicEgressScope(
	tier: string, name: string, opts: RequestOptions = {}
): Promise<{ egress: string[]; ingress: string[]; labels?: Record<string, UriLabelInfo> }> {
	return apiGet(`/api/observe/whitelist/scope/${encodeURIComponent(tier)}/${encodeURIComponent(name)}`, opts);
}

/** POST `/api/observe/whitelist/scope/{tier}/{name}/{direction}/{action}` —
 *  aggiunge/toglie una voce egress/ingress LOCALE a questo topic (18 set
 *  2026, sidebar del topic). Owner-only + verbo gated lato server
 *  (`topic.egress_add`/`ingress_add`/`*_remove`, GATE_WALLS): un 403 qui
 *  significa che il chiamante non ha entrambi i requisiti, non un guasto. */
export async function editTopicEgressScope(
	tier: string, name: string, direction: 'egress' | 'ingress', action: 'allow' | 'revoke',
	uri: string, opts: RequestOptions = {}
): Promise<{ ok: boolean; added?: boolean; removed?: boolean; uri?: string }> {
	return apiPost(
		`/api/observe/whitelist/scope/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/${direction}/${action}`,
		{ uri }, opts);
}

/** POST `/api/topics/{tier}/{name}/archive` — imposta status=archived. */
export async function archiveTopic(tier: string, name: string, opts: RequestOptions = {}): Promise<{ archived: boolean }> {
	return apiPost(`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/archive`, {}, opts);
}

/** Vocabolario unico di status del topic (selezione uguale per tutti). */
export const TOPIC_STATUSES = ['active', 'on-hold', 'done', 'archived'] as const;

/** POST `/api/topics/{tier}/{name}/status` — imposta lo status (active|on-hold|done|archived). */
export async function setTopicStatus(tier: string, name: string, status: string, opts: RequestOptions = {}): Promise<{ status: string }> {
	return apiPost(`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/status`, { status }, opts);
}

/** POST `/api/topics/{tier}/{name}/deadline` — imposta la deadline (YYYY-MM-DD|null). */
export async function setTopicDeadline(tier: string, name: string, deadline: string | null, opts: RequestOptions = {}): Promise<{ deadline: string | null }> {
	return apiPost(`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/deadline`, { deadline }, opts);
}

/** POST `/api/topics/{tier}/{name}/goal` — fissa il messaggio come OBIETTIVO
 *  del canale, oppure lo toglie (`goal: null`). Owner-only lato server.
 *
 *  `pinned_by` NON si manda: lo scrive il server col principal che ha appena
 *  verificato come owner. Un campo che dice chi ha deciso e che il client
 *  riempie da sé non è una firma. */
export async function setTopicGoal(
	tier: string,
	name: string,
	goal: { text: string; message_id?: string; state?: string; strategy_path?: string } | null,
	opts: RequestOptions = {}
): Promise<{ goal: TopicGoal | null; unpinned?: boolean }> {
	return apiPost(`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/goal`, { goal }, opts);
}

/** POST `/api/topics/{tier}/{name}/local-folder` — cartella condivisa
 *  Mac↔container (20 set 2026): a differenza di Drive è un BIND filesystem
 *  reale su una radice unica del gateway, non uno specchio. Owner-only +
 *  verbo gated lato server (GATE_WALLS, simmetrico a drive_folder_add/remove):
 *  un 403 qui significa che il chiamante non ha entrambi i requisiti. */
export async function addLocalFolder(tier: string, name: string, mount: string, opts: RequestOptions = {}): Promise<{ ok: boolean; local_folder: { name: string } }> {
	return apiPost(`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/local-folder`, { action: 'add', mount }, opts);
}

export async function removeLocalFolder(tier: string, name: string, mount: string, opts: RequestOptions = {}): Promise<{ ok: boolean; removed: string }> {
	return apiPost(`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/local-folder`, { action: 'remove', mount }, opts);
}

/** Il cap SEAL di un'azione che aggancia un canale (il bottone Telegram del
 *  topic, `ConnectorActionState.seal`, clodia-platform#405). */
export interface TelegramSealState {
	/** Tier del topic, come lo vede il server. */
	tier: string;
	/** Tier massimo che il channel Telegram regge (provider extra-UE, gruppi
	 *  non E2E). Oggi SEAL-1 — ma il valore lo dice il server, non questo file. */
	cap: string | null;
	/** Il cap morde e l'owner non ha ancora preso atto del downgrade: senza la
	 *  sua conferma esplicita il collegamento viene rifiutato. */
	requires_ack: boolean;
	/** La presa d'atto registrata (chi/quando/per quale tier), o null. */
	ack: { channel: string; tier: string; cap: string; by: string; at: string } | null;
}

/** GET/POST `/api/topics/{tier}/{name}/mailbox-link` — connettore «Mailbox»
 *  del canale (clodia-platform#406): si sceglie una casella GIÀ configurata
 *  nel sistema e quella diventa in un colpo solo fonte (`inbox:`) e
 *  destinazione (`outbox:`) di questo topic. Owner-only lato server, in
 *  lettura e in scrittura. A differenza di Telegram non c'è nessun binding:
 *  qui si autorizza soltanto — la posta la leggono i verbi email. */
export interface TopicMailbox {
	account: string;
	email: string;
	/** Alias SMTP senza IMAP: può spedire, non leggerà mai nulla. */
	send_only: boolean;
	inbox: boolean;
	outbox: boolean;
	/** La voce sta nella lista di QUESTA stanza — l'unica removibile da qui.
	 *  Falso con `inbox`/`outbox` veri = autorizzata globalmente, da
	 *  Impostazioni. */
	local: boolean;
}

export async function getTopicMailboxes(tier: string, name: string, opts: RequestOptions = {}): Promise<TopicMailbox[]> {
	const d = await apiGet<{ mailboxes?: TopicMailbox[] }>(
		`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/mailbox-link`, opts);
	return d.mailboxes ?? [];
}

/** Lo stato di UNA azione di connettore su un topic (clodia-platform#520).
 *
 *  La forma generica dei bottoni di un topic: i campi da riempire li
 *  dichiara il manifest del connettore, i valori offerti li risolve il gateway
 *  (una casella si SCEGLIE fra quelle di sistema, non si digita — un indirizzo
 *  scritto a mano finirebbe in whitelist senza una credenziale dietro), e
 *  `entries` sono le voci che questa stanza ha già. */
export interface ConnectorActionState {
	connector: string;
	action: string;
	label: string;
	binding: string;
	admin_only: boolean;
	tier: string;
	fields: {
		name: string;
		label: string;
		required: boolean;
		placeholder: string;
		options?: { value: string; label: string }[] | null;
	}[];
	entries: { ingress: string[]; egress: string[] };
	seal?: TelegramSealState | null;
	bound?: string | null;
	connected?: boolean;
	/** Chats the bot joined for this topic by link (clodia-platform#549),
	 *  ready for the owner: picking one fills the fields with the id Telegram
	 *  gave. Nothing is authorised until the owner connects it. */
	suggestions?: {
		label: string;
		values: Record<string, string>;
		requested_by?: string;
		added_by?: string;
	}[];
}

export async function getConnectorAction(
	tier: string, name: string, connector: string, action: string, opts: RequestOptions = {}
): Promise<ConnectorActionState> {
	return apiGet(
		`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/connectors/` +
			`${encodeURIComponent(connector)}/${encodeURIComponent(action)}`, opts);
}

/** POST della stessa rotta: `{action}` più i campi DICHIARATI dall'azione.
 *  I nomi dei campi non sono scritti qui — è ciò che permette a un connettore
 *  arrivato con un pack di funzionare senza toccare questo file. */
export async function applyConnectorAction(
	tier: string, name: string, connector: string, action: string,
	verso: 'connect' | 'disconnect', fields: Record<string, unknown> = {},
	opts: RequestOptions = {}
): Promise<ConnectorActionState> {
	return apiPost(
		`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/connectors/` +
			`${encodeURIComponent(connector)}/${encodeURIComponent(action)}`,
		{ action: verso, ...fields }, opts);
}

/** Riclassificazione del livello SEAL di un topic (clodia-platform#426). */
export type TierImpact = {
	from: string; to: string; direction: 'up' | 'down' | 'unknown';
	lose_access: { name: string; type: string }[];
	gain_access: { name: string; type: string }[];
};

export async function previewTopicTier(
	tier: string, name: string, to: string, opts: RequestOptions = {}
): Promise<TierImpact> {
	return apiGet(`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/tier-preview?to=${encodeURIComponent(to)}`, opts);
}

export async function setTopicTier(
	tier: string, name: string, to: string, reason: string, opts: RequestOptions = {}
): Promise<{ from: string; to: string; name: string }> {
	return apiPost(`/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/tier`,
		{ tier: to, reason, accept_responsibility: true }, opts);
}

/* ── Audit trail (clodia-platform#447) ────────────────────────────────────── */

/** Health of the gateway's audit trail, as the admin sees it. */
export interface AuditStatus {
	ok: boolean;
	events?: number;
	head_hash?: string | null;
	isolated?: boolean;
	key_id?: string;
	last_checkpoint?: { seq: number; timestamp: string } | null;
	unanchored_events?: number;
	exporters?: Array<{ type: string; target: string }>;
	off_system?: boolean;
	failures?: number;
	last_error?: string | null;
	fail_closed?: boolean;
	error?: string;
}

/** GET `/api/admin/audit/status` — admin only. */
export async function getAuditStatus(opts: RequestOptions = {}): Promise<AuditStatus> {
	return apiGet<AuditStatus>('/api/admin/audit/status', opts);
}

/**
 * POST `/api/admin/audit/export` — downloads the signed bundle. It goes through
 * `fetch` with the Authorization header (a plain `<a href>` would arrive
 * anonymous), and the export is recorded on the trail in the admin's name.
 */
export async function downloadAuditExport(body: {
	since?: string; until?: string; purpose?: string;
}): Promise<void> {
	const res = await fetch(joinUrl('/api/admin/audit/export'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders() },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await parseError(res);
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `clodia-audit-${new Date().toISOString().slice(0, 10)}.tgz`;
	a.click();
	URL.revokeObjectURL(url);
}
