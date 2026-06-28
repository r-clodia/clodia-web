/**
 * Minimal HTTP + SSE client for the Clodia agent-server.
 *
 * Base URL precedence:
 *   1. `PUBLIC_API_BASE_URL` (Vite env, exposed because of the `PUBLIC_` prefix)
 *   2. Fallback: `''` (same origin — works behind any proxy/VPN without IP baking)
 *
 * The client is intentionally small: it does NOT manage auth, retries, or
 * caching. Those concerns belong to higher layers when/if they show up.
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
function authHeaders(): Record<string, string> {
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
}

/** GET <path> and parse the response as JSON (or text if not JSON). */
export async function apiGet<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
	const res = await fetch(joinUrl(path), {
		method: 'GET',
		headers: { Accept: 'application/json', ...authHeaders(), ...(opts.headers || {}) },
		signal: opts.signal
	});
	if (!res.ok) throw await parseError(res);
	return parseJsonOrText<T>(res);
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
	Kanban,
	KanbanDetail,
	Job,
	JobCreate,
	JobDetail,
	JobRunResponse,
	JobUpdate,
	JobsListResponse,
	Topic,
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
	// Preserve every server field on the result so the raw-payload viewer
	// stays useful; the canonical names (nome/schedule/...) win on
	// collision via the spread order.
	return { ...r, id, nome, schedule, enabled, last_run, durata, stato } as Job;
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

/** GET `/api/kanbans` — list of configured boards with per-lane card counts. */
export async function getKanbans(opts: RequestOptions = {}): Promise<ReadonlyArray<Kanban>> {
	const data = await apiGet<ReadonlyArray<Kanban>>('/api/kanbans', opts);
	return Array.isArray(data) ? data : [];
}

/** GET `/api/kanbans/{board_id}` — detail with full card lists per lane. */
export async function getKanbanDetail(
	boardId: string,
	opts: RequestOptions = {},
): Promise<KanbanDetail> {
	return apiGet<KanbanDetail>(`/api/kanbans/${encodeURIComponent(boardId)}`, opts);
}

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
	kind: 'human' | 'ai';
	text: string;
	attachments: string[];
	ts: string;
}
export interface ChannelInfo {
	tier: string;
	name: string;
	meta: { title?: string; owner?: string; participants?: string[]; tier?: string };
	summary?: string;
	tldr?: string;
}
export interface ChannelFile {
	name: string;
	path: string;
	/** "dir" per le sottocartelle navigabili, "file" (o assente) per i file. */
	kind?: string;
	size?: number | null;
	mtime_iso?: string | null;
}

export async function createChannel(
	input: { name: string; tier: string; title?: string; type?: string },
	opts: RequestOptions = {}
): Promise<{ tier: string; name: string }> {
	return apiPost('/clodia/channels', input, opts);
}

export async function getChannel(tier: string, name: string, opts: RequestOptions = {}): Promise<ChannelInfo> {
	return apiGet(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}`, opts);
}
export async function getChannelMessages(tier: string, name: string, opts: RequestOptions = {}): Promise<ChannelMessage[]> {
	const d = await apiGet<{ messages: ChannelMessage[] }>(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/messages`, opts);
	return d.messages ?? [];
}
export async function postChannelMessage(tier: string, name: string, content: string, opts: RequestOptions = {}): Promise<{ responder: string | null; reply?: string }> {
	return apiPost(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/post`, { content }, opts);
}
export async function setChannelParticipant(tier: string, name: string, agent: string, add: boolean): Promise<{ participants: string[] }> {
	const res = await fetch(
		joinUrl(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/participants`),
		{
			method: add ? 'POST' : 'DELETE',
			headers: { 'Content-Type': 'application/json', ...authHeaders() },
			body: JSON.stringify({ agent })
		}
	);
	if (!res.ok) throw await parseError(res);
	return parseJsonOrText(res);
}
export async function getChannelFiles(tier: string, name: string, subpath = '', opts: RequestOptions = {}): Promise<ChannelFile[]> {
	const qs = subpath ? `?path=${encodeURIComponent(subpath)}` : '';
	const d = await apiGet<{ files: ChannelFile[] }>(
		`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/files${qs}`, opts);
	return d.files ?? [];
}
export async function uploadChannelFile(tier: string, name: string, filename: string, contentB64: string, opts: RequestOptions = {}): Promise<{ name: string }> {
	return apiPost(`/clodia/channels/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/files`, { filename, content_b64: contentB64 }, opts);
}
/** URL di download di un file del canale (topic v2, via gateway). Usa l'endpoint
 *  /download (serve P0..P3 dal vault); /file è solo per i vecchi topic git e
 *  rifiuta i tier → 404. */
export function channelFileUrl(tier: string, name: string, path: string): string {
	return `${API_BASE_URL}/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/download?path=${encodeURIComponent(path)}`;
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
 * event. Returns a cleanup function that closes the underlying EventSource.
 *
 * Notes:
 *  - Uses the browser-native `EventSource`. In SSR (Node) it will no-op and
 *    return a cleanup that does nothing.
 *  - `onError` is optional; when omitted, errors are logged to console.
 */
export function apiSSE(
	path: string,
	onEvent: (ev: SSEEvent) => void,
	onError?: (err: Event) => void
): () => void {
	if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
		// SSR or unsupported environment — return a noop closer.
		return () => {};
	}

	const url = joinUrl(path);
	const es = new EventSource(url, { withCredentials: false });

	const wrap = (event: string) => (e: MessageEvent) => {
		const data = typeof e.data === 'string' ? e.data : String(e.data ?? '');
		let json: unknown = undefined;
		try {
			json = JSON.parse(data);
		} catch {
			/* not JSON — that's fine */
		}
		onEvent({ event, data, id: (e as MessageEvent).lastEventId || undefined, json });
	};

	// The default `message` channel.
	es.onmessage = wrap('message');

	// We can't enumerate custom event names ahead of time. Consumers who need
	// named events should subscribe via the returned EventSource — for now we
	// expose the most common case (the default channel). To keep the surface
	// minimal and predictable we don't attach listeners for arbitrary names.

	es.onerror = (e) => {
		if (onError) onError(e);
		else console.error('[apiSSE] error', e);
	};

	return () => {
		try {
			es.close();
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

/** Connettore delegabile (account email) con lo stato di grant per un agent. */
export interface Connector {
	id: string;
	type: string;
	credential: string;
	granted: boolean;
	agents: string[];
}
/** GET `/api/connectors?agent=` — connettori con grant per l'agent (admin). */
export async function getConnectors(agent: string, opts: RequestOptions = {}): Promise<Connector[]> {
	const d = await apiGet<{ connectors: Connector[] }>(`/api/connectors?agent=${encodeURIComponent(agent)}`, opts);
	return d.connectors ?? [];
}
/** POST `/api/connectors/grant` — abilita/disabilita un agent su un connettore. */
export async function grantConnector(agent: string, account: string, granted: boolean, opts: RequestOptions = {}): Promise<unknown> {
	return apiPost('/api/connectors/grant', { agent, account, granted }, opts);
}

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
): Promise<{ ok: boolean; name: string; bytes: number }> {
	return apiPost(`/api/agents/${encodeURIComponent(name)}/pfp/generate`, {
		prompt: body.prompt,
		image_b64: body.imageB64
	}, opts);
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
	const raw = await apiGet<unknown>('/clodia/skills', opts);
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

/** GET `/clodia/rules` — deduplicated rule catalog. */
export async function listRules(opts: RequestOptions = {}): Promise<ReadonlyArray<Rule>> {
	const raw = await apiGet<unknown>('/clodia/rules', opts);
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

/** POST `/api/kanbans/{id}/pause` — mette in pausa la pipeline di un board. */
export async function pauseKanban(boardId: string, opts: RequestOptions = {}): Promise<{ paused: boolean }> {
	return apiPost<{ paused: boolean }>(`/api/kanbans/${encodeURIComponent(boardId)}/pause`, {}, opts);
}

/** POST `/api/kanbans/{id}/resume` — riprende la pipeline di un board. */
export async function resumeKanban(boardId: string, opts: RequestOptions = {}): Promise<{ paused: boolean }> {
	return apiPost<{ paused: boolean }>(`/api/kanbans/${encodeURIComponent(boardId)}/resume`, {}, opts);
}

// ─── Tools / connettori OAuth (backend gateway clodia-tools, wire diretto) ───

export interface ToolConnector {
	id: string;
	label: string;
	provider: string;
	connected: boolean;
	accounts: string[];
	transport?: string;
	/** storage backend dei topic (provider 'storage'): adapter attivo + versioning. */
	builtin?: boolean;
	backend?: string;
	versioning?: string;
}

/** GET `/tools` — stato dei connettori (quali account sono connessi). */
export async function getTools(opts: RequestOptions = {}): Promise<{ connectors: ToolConnector[] }> {
	return apiGet<{ connectors: ToolConnector[] }>('/tools', opts);
}

// ── Backup gestito (ISO 27001 A.8.13) ───────────────────────────────────────
export interface BackupStatus {
	configured: boolean;
	backend?: string;
	repository?: string;
	schedule?: string;
	retention?: { daily: number; weekly: number; monthly: number };
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

/** GET `/tools/google/app` — l'app OAuth Google (client_id/secret) è configurata? */
export async function getGoogleAppStatus(
	opts: RequestOptions = {}
): Promise<{ configured: boolean; redirect_uri: string }> {
	return apiGet('/tools/google/app', opts);
}

/** POST `/tools/google/app` — deposita la credenziale d'app OAuth Google. */
export async function configureGoogleApp(
	body: { client_json?: string; client_id?: string; client_secret?: string; redirect_uri?: string },
	opts: RequestOptions = {}
): Promise<{ configured: boolean; redirect_uri: string }> {
	return apiPost('/tools/google/app', body, opts);
}

/** GET `/tools/gmail/auth` — URL di consenso Google (selettore account) + state. */
export async function getGmailAuth(
	opts: RequestOptions = {}
): Promise<{ auth_url: string; state: string; redirect_uri: string }> {
	return apiGet('/tools/gmail/auth', opts);
}

/** POST `/tools/gmail/connect` — scambia il code, ricava l'account dal profilo e lo deposita. */
export async function gmailConnect(
	body: { code: string; state: string },
	opts: RequestOptions = {}
): Promise<{ connected: boolean; account: string; email: string }> {
	return apiPost('/tools/gmail/connect', body, opts);
}

/** GET `/tools/gworkspace/auth` — URL di consenso Google Workspace (Drive · Docs · Calendar) + state. */
export async function getWorkspaceAuth(
	opts: RequestOptions = {}
): Promise<{ auth_url: string; state: string; redirect_uri: string }> {
	return apiGet('/tools/gworkspace/auth', opts);
}

/** POST `/tools/gworkspace/connect` — scambia il code, ricava l'account da userinfo e lo deposita. */
export async function workspaceConnect(
	body: { code: string; state: string },
	opts: RequestOptions = {}
): Promise<{ connected: boolean; account: string; email: string }> {
	return apiPost('/tools/gworkspace/connect', body, opts);
}

/** POST `/clodia/cert-request` — un nuovo utente chiede all'admin di emettere il
 *  certificato per la propria pubkey (notifica telegram/email; non crea nulla). */
export async function requestCert(
	body: { pubkey: string; name?: string; contact?: string },
	opts: RequestOptions = {}
): Promise<{ submitted: boolean; notified: string[] }> {
	return apiPost('/clodia/cert-request', body, opts);
}

/** POST `/tools/openai/connect` — attiva l'integrazione Image generation:
 *  deposita la OpenAI API key nel vault del gateway. `api_key` vuota = disconnette. */
export async function connectOpenAI(
	api_key: string,
	opts: RequestOptions = {}
): Promise<{ connected: boolean }> {
	return apiPost('/tools/openai/connect', { api_key }, opts);
}

/** Caselle email generiche (IMAP/SMTP) — connettore multi-mailbox. */
export interface MailboxInput {
	account: string;
	email: string;
	password: string;
	imap_server: string;
	smtp_server: string;
	imap_port?: number;
	smtp_port?: number;
	display_name?: string;
	sent_folder?: string;
	smtp_user?: string;
}
export async function getMailboxes(opts: RequestOptions = {}): Promise<string[]> {
	const d = await apiGet<{ mailboxes: string[] }>('/tools/email/mailboxes', opts);
	return d.mailboxes ?? [];
}
export async function addMailbox(m: MailboxInput, opts: RequestOptions = {}): Promise<{ account: string; connected: boolean }> {
	return apiPost('/tools/email/mailboxes', m, opts);
}
export async function removeMailbox(account: string, opts: RequestOptions = {}): Promise<void> {
	await apiDelete(`/tools/email/mailboxes/${encodeURIComponent(account)}`, opts);
}

/** POST `/tools/trello/connect` — deposita API key + token Trello nel vault. */
export async function connectTrello(
	api_key: string,
	token: string,
	opts: RequestOptions = {}
): Promise<{ connected: boolean }> {
	return apiPost('/tools/trello/connect', { api_key, token }, opts);
}

/** POST `/tools/github/connect` — deposita il PAT GitHub nel vault e registra il
 *  backend MCP ufficiale. PAT vuoto → disconnette. */
export async function connectGithub(
	pat: string,
	opts: RequestOptions = {}
): Promise<{ connected: boolean }> {
	return apiPost('/tools/github/connect', { pat }, opts);
}

/** POST `/tools/mcp` — registra uno o più MCP server da mcp.json. I valori in
 *  `secrets` (per i placeholder ${NAME}) sono depositati nel vault, non nel config. */
export async function registerMcp(
	body: { config: unknown; secrets?: Record<string, string> },
	opts: RequestOptions = {}
): Promise<{ registered: string[] }> {
	return apiPost('/tools/mcp', body, opts);
}

/** DELETE `/tools/mcp/{name}` — smonta un MCP server registrato. */
export async function unregisterMcp(name: string, opts: RequestOptions = {}): Promise<{ unregistered: string }> {
	return apiDelete(`/tools/mcp/${encodeURIComponent(name)}`, opts);
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
}

/** GET `/api/providers` — stato dei provider (mai i valori). */
export async function getProviders(opts: RequestOptions = {}): Promise<{ providers: ProviderStatus[] }> {
	return apiGet('/api/providers', opts);
}

/** POST `/api/providers/{id}/key` — salva la API key (→ keystore/env). */
export async function setProviderKey(
	id: string,
	api_key: string,
	opts: RequestOptions = {}
): Promise<{ connected: boolean; via: string }> {
	return apiPost(`/api/providers/${encodeURIComponent(id)}/key`, { api_key }, opts);
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
