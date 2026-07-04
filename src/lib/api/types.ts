/**
 * Type contracts for the agent-server REST surface used by the AGENTS
 * section of the WebUI v2.
 *
 * These types intentionally mirror the shape the server emits today —
 * fields are kept `readonly` to discourage accidental mutation. Optional
 * fields tolerate future-proofing on the server side.
 */

/** Avviso emesso quando un super-agent risponde in un topic il cui tier supera
 *  il SEAL del provider in uso (eccezione consentita solo ai super, con popup). */
export interface TierWarning {
	readonly kind: 'provider_below_tier';
	readonly tier: string;
	readonly responder: string;
	readonly provider: string | null;
	readonly provider_seal: string | null;
	readonly message: string;
	readonly suggestions: readonly string[];
}

export interface AgentSandbox {
	readonly allow_read?: ReadonlyArray<string>;
	readonly deny_read?: ReadonlyArray<string>;
	readonly allow_write?: ReadonlyArray<string>;
	readonly allow_shell_cmds?: ReadonlyArray<string>;
	readonly deny_shell_patterns?: ReadonlyArray<string>;
}

export interface AgentMemory {
	readonly dir?: string;
}

/** Opzione del selettore di provider nel profilo agent: un provider della lista
 *  dichiarata + il suo stato corrente. */
export interface ProviderOption {
	readonly id: string;
	readonly seal?: string | null;
	readonly connected: boolean;
	readonly paused: boolean;
	/** È il default (primo in lista di preferenza). */
	readonly default: boolean;
	/** È l'override manuale attualmente selezionato. */
	readonly selected: boolean;
	/** È il provider realmente in uso adesso (effettivo). */
	readonly effective: boolean;
}

/** Shape returned by `GET /api/agents/{name}` and embedded in the list. */
export interface Agent {
	readonly name: string;
	readonly display_name?: string;
	readonly description?: string;
	/** Categoria KYA: super (clodia/ophelia, poteri pieni) | normal (worker) | human. */
	readonly type?: 'super' | 'normal' | 'human';
	/** Canali di contatto derivati (email/telegram). Solo nel dettaglio agent. */
	readonly contact_channels?: { email?: string | null; telegram?: string | null };
	/** Riferimento alla costituzione (constitution-catalog) fusa nel system prompt
	 *  al materialize. null/assente = nessuna costituzione. Es. "platform-core". */
	readonly constitution?: string | null;
	/** Genealogia del seed (modello ereditario): progenitore/i, per tracciare il
	 *  drift dal genoma di Clodia Primal. Es. ["clodia-primal"]. */
	readonly parents?: ReadonlyArray<string>;
	readonly model?: string;
	readonly avatar_color?: string;
	readonly sandbox?: AgentSandbox | null;
	readonly skills?: ReadonlyArray<string>;
	/** Capability dichiarate (skill catalog dual: logic + data). Materializzate
	 *  al boot del workspace via skill_sync da skills-catalog/<name>/. */
	readonly capabilities?: ReadonlyArray<string>;
	/** Rules dichiarate (rules catalog dual). Materializzate via rule_sync da
	 *  rules-catalog/<name>.md, caricate on-demand quando i globs matchano. */
	readonly rules?: ReadonlyArray<string>;
	readonly memory?: AgentMemory | null;
	readonly can_delegate_to?: ReadonlyArray<string>;
	/** SDK runtime dell'agent (es. "claude"). */
	readonly agent_sdk?: string;
	/** Provider EFFETTIVO (primo compatibile collegato), o null se nessuno dei
	 *  provider compatibili è collegato. Risolto dal backend. */
	readonly provider?: string | null;
	/** Livello SEAL del provider a cui l'agent è ATTUALMENTE attribuito (es. 'SEAL-2'),
	 *  null se nessun provider attivo. */
	readonly provider_seal?: string | null;
	/** Provider compatibili dell'agent, in ordine di preferenza (lista esplicita
	 *  nell'agent.yaml o default dell'SDK). La UI mostra il preferito quando
	 *  l'effettivo è null. */
	readonly providers?: ReadonlyArray<string>;
	/** False se ci sono provider compatibili ma NESSUNO è collegato → card
	 *  'disconnected' e dimmed. Assente/true = collegato (o non determinabile). */
	readonly provider_connected?: boolean;
	/** Override manuale del provider (selezione dal profilo agent). null = segue
	 *  la preferenza dichiarata. */
	readonly provider_override?: string | null;
	/** Opzioni per il selettore di provider nel profilo agent: id + stato. */
	readonly provider_options?: ReadonlyArray<ProviderOption>;
	/** Ruolo del principal human: superadmin | admin | member. */
	readonly role?: string | null;
	/** Clearance di privacy del principal human (P0–P3). */
	readonly clearance?: string | null;
	/** Canali di contatto espliciti (editabili dall'admin). */
	readonly email?: string | null;
	readonly telegram?: string | null;
	/** Super genitore per il subaddress email dei regular (default clodia). */
	readonly mailbox_parent?: string | null;
	/** Priorità di selezione (default server-side: 100). */
	readonly priority?: number;
	/** Profilo di costo dichiarato: economy | standard | premium. */
	readonly cost_profile?: string;
	/** Permessi tool MCP granulari (es. ["trello.*", "email.send"]). */
	readonly tool_permissions?: ReadonlyArray<string>;
	/** Volume montabili dichiarati (id da volumes.yaml). */
	readonly volumes?: ReadonlyArray<string>;
	/** Nomi delle credenziali dedicate attese in secrets/agents/<name>/.
	 *  Sono SOLO riferimenti: il server non espone mai i valori. */
	readonly credentials?: ReadonlyArray<string>;
	readonly system_prompt?: string;
	readonly outputs?: unknown;
	readonly agent_dir?: string;
	/** Kill-switch: true se l'agent è in pausa, tutte le sue istanze sono
	 *  state cancellate e i nuovi claim sono skippati. Toggle via
	 *  pauseAgent / resumeAgent (POST /api/agents/<name>/pause|resume). */
	readonly paused?: boolean;
	/** Identità crittografica PKI dell'agent (cert X.509 firmato dalla CA
	 *  della colonia). `null` se l'agent non ha ancora un certificato. */
	readonly identity?: AgentIdentity | null;
	/** Contatori di esito dal registry colony (DB), per il success-rate con
	 *  cui la Selection Engine pesa l'agent. Assente se la colony è off. */
	readonly success_stats?: AgentSuccessStats | null;
}

/** Identità PKI di un agent — sottoinsieme pubblico del certificato (mai
 *  la chiave privata). Da `GET /api/agents` campo `identity`. */
export interface AgentIdentity {
	readonly cert_fingerprint_sha256: string;
	readonly not_before?: string;
	readonly not_after?: string;
	readonly revoked?: boolean;
}

/** Contatori di affidabilità storica dell'agent (colony.db AgentRow). */
export interface AgentSuccessStats {
	readonly runs_total: number;
	readonly runs_ok: number;
}

/** Envelope returned by `GET /api/agents`. */
export interface AgentsListResponse {
	readonly agents: ReadonlyArray<Agent>;
	readonly errors?: Record<string, string>;
	readonly base_dir?: string;
}

/**
 * Envelope returned by `POST /api/agents/reload`.
 *
 * The server returns `{ loaded: number, errors: Record<string,string> }`;
 * `loaded` is the count of agent definitions re-scanned successfully and
 * `errors` maps agent-name → error message for the ones that failed.
 */
export interface AgentReloadResponse {
	readonly loaded: number;
	readonly errors: Record<string, string>;
}

/**
 * Lightweight in-app template descriptor used by the "+ New agent" form.
 *
 * The agent-server does NOT expose a templates endpoint today; templates are
 * therefore hard-coded on the client as starting points. When a real
 * `/api/agents/templates` endpoint lands, this type stays compatible.
 */
export interface AgentTemplate {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly defaults: Partial<Agent>;
	readonly systemPromptBody?: string;
}

/** One row from `GET /api/agents/{name}/activity`. */
export interface AgentActivityEvent {
	readonly ts: string;
	readonly agent: string;
	readonly type: string;
	readonly task_id?: string;
	readonly card_id?: string;
	readonly payload?: Record<string, unknown>;
}

/** Envelope returned by `GET /api/agents/{name}/activity`. */
export interface AgentActivityResponse {
	readonly agent: string;
	readonly events: ReadonlyArray<AgentActivityEvent>;
}

/** One row from `GET /api/agents/activity/summary`. */
export interface AgentSummaryRow {
	readonly agent: string;
	readonly today_runs: number;
	readonly runs: number;
	readonly tokens_in: number;
	readonly tokens_out: number;
	readonly status: 'idle' | 'running' | string;
	readonly last_run_ts?: string | null;
	readonly last_event_ts?: string | null;
	readonly last_event_type?: string | null;
}

/** Envelope returned by `GET /api/agents/activity/summary`. */
export interface ActivitySummaryResponse {
	readonly agents: ReadonlyArray<AgentSummaryRow>;
}

/** Per-agent idle/running indicator. */
export type AgentRunState = 'idle' | 'running';

/* ------------------------------------------------------------------------ */
/*  JOBS — Clodia scheduled-work surface                                    */
/* ------------------------------------------------------------------------ */

/**
 * Canonical job lifecycle states understood by the UI. The server is the
 * source of truth; any unrecognised string is preserved as-is via the
 * fallback `string` branch and rendered neutrally.
 */
export type JobStatus = 'idle' | 'running' | 'success' | 'failed';

/** One row from `GET /clodia/jobs`. */
export interface Job {
	readonly id: string;
	readonly nome: string;
	readonly schedule?: string | null;
	/** Agent (kind) che lo scheduler spawna al fire del job. */
	readonly agent?: string;
	readonly enabled?: boolean;
	readonly last_run?: string | null;
	/** Duration of the last run, in seconds. */
	readonly durata?: number | null;
	readonly stato?: JobStatus | string | null;
}

/** Envelope returned by `GET /clodia/jobs`.
 *
 * We tolerate two server shapes:
 *   - `{ jobs: Job[] }` — preferred envelope, mirrors `/api/agents`
 *   - `Job[]`           — bare array, fallback
 *
 * The list page normalises both into a single array.
 */
export type JobsListResponse =
	| { readonly jobs: ReadonlyArray<Job>; readonly errors?: Record<string, string> }
	| ReadonlyArray<Job>;

/** One execution of a job from the detail endpoint's `runs` array. */
export interface JobRun {
	readonly id?: string;
	readonly ts?: string | null;
	/** Duration in seconds. */
	readonly durata?: number | null;
	readonly stato?: JobStatus | string | null;
	/** Optional URL or path to logs/output (server-defined). */
	readonly log_url?: string | null;
	readonly output?: string | null;
	readonly exit_code?: number | null;
	readonly error?: string | null;
}

/**
 * Shape returned by `GET /clodia/jobs/{id}`.
 *
 * The brief specifies the detail endpoint returns "configurazione + storico
 * run", but doesn't enumerate the configuration fields exhaustively. We model
 * configuration as an open record and surface known top-level fields
 * explicitly. Unknown keys still render in the "Raw payload" panel.
 */
export interface JobDetail extends Job {
	readonly description?: string;
	readonly command?: string;
	readonly enabled?: boolean;
	readonly timezone?: string;
	readonly next_run?: string | null;
	/** The server stores the cron expression under `cron_expr`; some endpoints
	 *  surface it under the alias `schedule` (inherited from {@link Job}). */
	readonly cron_expr?: string | null;
	/** Free-form text the scheduler will pass to the agent on run. */
	readonly prompt?: string;
	/** Free-form configuration — server-defined. */
	readonly config?: Record<string, unknown>;
	/** Recent runs, newest-first or oldest-first (UI sorts defensively). */
	readonly runs?: ReadonlyArray<JobRun>;
}

/**
 * Payload for `POST /clodia/jobs`.
 *
 * Mirrors `JobCreate` from the agent-server OpenAPI spec:
 *   - `name`      required, 1–200 chars
 *   - `cron_expr` required, 1–200 chars (standard 5-field cron)
 *   - `prompt`    required, ≥1 char (the message the scheduler enqueues)
 *   - `enabled`   optional, defaults server-side to `true`
 */
export interface JobCreate {
	readonly name: string;
	readonly cron_expr: string;
	readonly prompt: string;
	/** Agent (kind) che lo scheduler spawna al fire. Default server "clodia". */
	readonly agent?: string;
	readonly enabled?: boolean;
}

/**
 * Payload for `PATCH /clodia/jobs/{id}`.
 *
 * Every field is optional; the server merges only the keys the client sends.
 * Mirrors `JobUpdate` from the OpenAPI spec.
 */
export interface JobUpdate {
	readonly name?: string;
	readonly cron_expr?: string;
	readonly prompt?: string;
	readonly agent?: string;
	readonly enabled?: boolean;
}

/**
 * Response shape from `POST /clodia/jobs/{id}/run`.
 *
 * The server returns a small ack envelope (today: `{ run_id, chat_id,
 * started_at }`). We type it as an open record so the UI can surface
 * whichever fields the server actually emits without requiring a rigid
 * contract — the run-now button uses the fields opportunistically.
 */
export interface JobRunResponse {
	readonly run_id?: string;
	readonly chat_id?: string;
	readonly started_at?: string;
	readonly [key: string]: unknown;
}

/* ------------------------------------------------------------------------ */
/*  CATALOG — Skills / Rules readonly registry                              */
/* ------------------------------------------------------------------------ */

export type CatalogSource = 'logic' | 'data' | 'both';
export type CatalogPack = string;

export interface CatalogVariant {
	readonly origin: 'logic' | 'data';
	readonly source: 'logic' | 'data';
	readonly pack: CatalogPack;
	readonly path: string;
	readonly active: boolean;
}

export interface CatalogItem {
	readonly name: string;
	readonly description: string;
	readonly source: CatalogSource;
	readonly pack: CatalogPack;
	readonly path: string;
	readonly available_in: ReadonlyArray<'logic' | 'data'>;
	readonly available_packs: ReadonlyArray<CatalogPack>;
	readonly variants: ReadonlyArray<CatalogVariant>;
}

export interface CatalogDetail extends CatalogItem {
	readonly frontmatter: Record<string, unknown>;
	readonly body: string;
}

export type Skill = CatalogItem;
export type SkillDetail = CatalogDetail;
export type Rule = CatalogItem;
export type RuleDetail = CatalogDetail;

/* ------------------------------------------------------------------------ */
/*  PLUGIN & PACK — pack := [agent seeds]+[plugins];                        */
/*  plugin := [skills]+[rules]+[mcp] (standard Claude Code)                 */
/* ------------------------------------------------------------------------ */

export type PluginOrigin = 'logic' | 'local' | 'external' | 'user' | 'imported';

/** Voce figlia di un plugin (skill o rule): nome + descrizione breve. */
export interface PluginEntry {
	readonly name: string;
	readonly description: string;
}

/** MCP server dichiarato da un plugin (config con secret mascherati lato server). */
export interface PluginMcpServer {
	readonly name: string;
	readonly transport: string;
	readonly config: Record<string, unknown>;
}

export interface Plugin {
	readonly name: string;
	readonly description: string;
	readonly origin: PluginOrigin;
	readonly deletable: boolean;
	readonly version: string;
	readonly source: string;
	readonly skills: ReadonlyArray<PluginEntry>;
	readonly rules: ReadonlyArray<PluginEntry>;
	readonly mcp_servers: ReadonlyArray<PluginMcpServer>;
	readonly counts: {
		readonly skills: number;
		readonly rules: number;
		readonly mcp_servers: number;
	};
}

/** Prerequisito (soft) di un agent seed verso un plugin. */
export interface PluginRequirement {
	readonly name: string;
	readonly hard: boolean;
}

/** Agente dichiarato da un pack, con stato dei prerequisiti plugin. */
export interface PackAgent {
	readonly name: string;
	readonly installed: boolean;
	readonly description: string;
	readonly requires_plugins: ReadonlyArray<PluginRequirement>;
	readonly missing_plugins: ReadonlyArray<string>;
}

/** Plugin referenziato da un pack ma non (più) installato. */
export interface PackPluginMissing {
	readonly name: string;
	readonly missing: true;
}

export interface Pack {
	readonly name: string;
	readonly description: string;
	readonly version: string;
	readonly source: string;
	readonly agents: ReadonlyArray<PackAgent>;
	readonly plugins: ReadonlyArray<Plugin | PackPluginMissing>;
	readonly counts: {
		readonly agents: number;
		readonly plugins: number;
	};
}

/* ------------------------------------------------------------------------ */
/*  TOPICS — Clodia topic registry (read-only)                              */
/* ------------------------------------------------------------------------ */

/**
 * One row from `GET /topics`. A topic is identified by the composite
 * (`classification`, `name`); `title` is a human-friendly label and
 * `last_commit` is an ISO-ish timestamp the server already formats.
 */
export interface TopicArtifact {
	readonly name: string;
	/** Percorso relativo alla root del topic (es. "files/report.pdf"). */
	readonly path: string;
	/** Data di ultima modifica in ISO 8601 UTC. */
	readonly mtime_iso: string;
}

export interface Topic {
	readonly name: string;
	/** Tier/classe del topic (Topic System v2): P0|P1|P2|P3. Sostituisce personal/confidential. */
	readonly tier: string;
	/** Nome amichevole del tier: Public/Internal/Confidential/Restricted. */
	readonly tier_name?: string;
	readonly title?: string;
	readonly last_commit?: string | null;
	readonly last_commit_hash?: string | null;
	readonly last_commit_subject?: string | null;
	/** Ultimo accesso dalla UI (apertura/scrittura del canale): ordina la lista. */
	readonly last_accessed?: string | null;
	readonly summary_url?: string;
	readonly tldr?: string;
	readonly action_points?: ReadonlyArray<string>;
	/** Ultimi max 3 artefatti modificati in files/ (ordine mtime desc). */
	readonly recent_artifacts?: ReadonlyArray<TopicArtifact>;
	/** Agent contact point del topic (da meta.yaml `contact_agent`, default
	 *  "clodia"). È l'agent con cui la card apre una chat dedicata. */
	readonly contact_agent?: string;
	/** Owner del canale/topic (chi l'ha creato; gestisce i partecipanti). */
	readonly owner?: string;
	/** Partecipanti del canale (umani + AI invitati). */
	readonly participants?: ReadonlyArray<string>;
	/** Tipo di canale: "dm" = messaggio diretto a 2; assente/altro = canale/topic. */
	readonly kind?: string;
	/** Stato del topic (selezione unica): await | active | archived | urgent
	 *  (default active). La vista Topics nasconde di default gli `archived`. */
	readonly status?: string;
	/** Scadenza più vicina fra i todo (action_points) con data, ISO YYYY-MM-DD;
	 *  null se nessun todo ha una scadenza. Mostrata come badge sulla card. */
	readonly next_deadline?: string | null;
	/** Backend di storage che contiene il topic (Topic System v2): es. "local-fs". */
	readonly storage?: string;
}

/**
 * Envelope returned by `GET /topics`. The server today emits a bare
 * `Topic[]`; the tolerant `{ topics: Topic[] }` shape is accepted so the
 * client doesn't break if/when the server grows an envelope (mirrors the
 * JOBS approach).
 */
export type TopicsListResponse = ReadonlyArray<Topic> | { readonly topics: ReadonlyArray<Topic> };

/**
 * A node inside a topic's file tree. Directories may carry a `children`
 * array (possibly empty); files never do. `path` is always topic-relative
 * (the same string you pass back as the `?path=` query of the file
 * endpoint).
 */
export interface TopicTreeNode {
	readonly type: 'file' | 'directory';
	readonly name: string;
	readonly path: string;
	readonly children?: ReadonlyArray<TopicTreeNode>;
}

/**
 * Shape returned by `GET /topics/{classification}/{name}/tree`. It is a
 * tree node itself (the topic root) augmented with the `classification`
 * + `title` of the topic.
 */
export interface TopicTree {
	readonly name: string;
	readonly classification: string;
	readonly title?: string;
	readonly children?: ReadonlyArray<TopicTreeNode>;
}

/* ------------------------------------------------------------------------ */
/*  CHATS — Clodia interactive conversation surface                         */
/*                                                                          */
/*  The CHATS section is the only **interactive** read-write area of the    */
/*  WebUI v2: users send messages, the server streams assistant tokens      */
/*  back through SSE (`/clodia/events`), and a single `interrupt` endpoint  */
/*  lets the UI stop a runaway generation.                                  */
/*                                                                          */
/*  All types stay `readonly` to discourage accidental in-place mutation —  */
/*  state machines in the page work on full replacements instead.           */
/* ------------------------------------------------------------------------ */

/** One row from `GET /clodia/chats`. */
export interface Chat {
	readonly id: string;
	/** Tipo/agente della chat (clodia | ada | looper). Usato per l'avatar. */
	readonly kind?: string;
	readonly title?: string;
	readonly created_at?: string;
	readonly updated_at?: string;
	/** Short preview of the most-recent message, when the server provides it. */
	readonly last_message?: string;
}

/**
 * Envelope returned by `GET /clodia/chats`.
 *
 * Tolerates two server shapes (mirrors JOBS/TOPICS):
 *   - `{ chats: Chat[] }` — preferred envelope
 *   - `Chat[]`           — bare array, fallback
 */
export type ChatsListResponse = { readonly chats: ReadonlyArray<Chat> } | ReadonlyArray<Chat>;

/**
 * Conversational role of a message. The server may emit any string here
 * (e.g. `'tool'`); we keep the union open via the trailing `string` so we
 * never throw on an unknown role and just render it neutrally.
 */
export type ChatRole = 'user' | 'assistant' | 'system' | 'tool' | string;

/** One message inside a chat thread. */
export interface ChatMessage {
	readonly id?: string;
	readonly chat_id?: string;
	readonly role: ChatRole;
	readonly content: string;
	readonly ts?: string;
	/**
	 * Testo del *thinking* (extended thinking) accumulato per questa bolla
	 * assistant, alimentato dagli eventi `thinking_chunk` dello stream. Reso
	 * in stile distinto (italic/monospace, collassabile) sopra `content`.
	 */
	readonly thinking?: string;
}

/**
 * Envelope returned by `GET /clodia/chats/{id}/history`.
 *
 * Same tolerance pattern as the list endpoint.
 */
export type ChatHistoryResponse =
	| { readonly messages: ReadonlyArray<ChatMessage> }
	| ReadonlyArray<ChatMessage>;

/**
 * One event yielded by the global SSE stream at `GET /clodia/events`.
 *
 * The server today emits a small set of well-known `type`s but we leave the
 * union open: any unknown payload is passed through and just ignored by the
 * page's reducer.
 *
 * Semantics:
 *   - `message_start` → a new assistant message is about to be produced.
 *     The UI creates an empty assistant bubble keyed by `message_id` (when
 *     present) so subsequent `token` events can append to it.
 *   - `token` with `delta` → incremental token to **append** to the
 *     current assistant bubble's `content`.
 *   - `token` with `content` (no `delta`) → snapshot of the full content
 *     so far. The UI **replaces** the bubble's `content` with it. This
 *     covers servers that emit cumulative payloads instead of deltas.
 *   - `message_end` → the assistant message is final. No-op for the UI
 *     beyond clearing the "streaming" flag for that chat.
 *   - `error` → render `error` text inline at the bottom of the thread.
 *
 * Any other `type` is preserved on the wire but ignored by the renderer.
 */
export interface ChatStreamEvent {
	readonly chat_id: string;
	/**
	 * Event type emitted by the agent-server on `/clodia/events`. The shipping
	 * server uses `message` (full message, with `role`+`content`),
	 * `message_chunk` (assistant text, in `text`), `status` (`thinking`/`idle`,
	 * in `status`) and `usage`. The legacy `token`/`message_start`/`message_end`
	 * names are kept for forward-compat.
	 */
	readonly type?:
		| 'message'
		| 'message_chunk'
		| 'thinking_chunk'
		| 'status'
		| 'usage'
		| 'token'
		| 'message_start'
		| 'message_end'
		| 'error'
		| string;
	/** Incremental token; appended to the current assistant content. */
	readonly delta?: string;
	/** Assistant text carried by a `message_chunk` event (server protocol). */
	readonly text?: string;
	/** Snapshot of the message content so far (replaces the bubble's text). */
	readonly content?: string;
	/** Lifecycle status carried by a `status` event: `thinking` | `idle`. */
	readonly status?: string;
	readonly role?: ChatRole;
	readonly message_id?: string;
	readonly error?: string;
}

// ---------------------------------------------------------------------------
// AUTH — OAuth login via the agent-server `/auth` surface.
//
// The agent-server drives the Claude Max OAuth flow server-side (it spawns
// `claude auth login --claudeai`, captures the OAuth URL, and waits for the
// return code on stdin). The WebUI's job is purely to orchestrate that flow
// from the browser:
//   POST /auth/login  → { status, url }     (kick off, get the OAuth URL)
//   POST /auth/code   → { status }          (forward the pasted return code)
//   GET  /auth/status → AuthStatus          (poll for completion)
//   POST /auth/logout → { status }          (drop the local token)
//
// Auth state is server-global (a single token in ~/.claude), so the WebUI
// "session" is really "is the agent-server logged in" — mirrored client-side
// by the auth store.
// ---------------------------------------------------------------------------

/** Response of `GET /auth/status`. */
export interface AuthStatus {
	/** True when the agent-server holds a valid Claude OAuth token. */
	readonly logged_in: boolean;
	/** True while a `claude auth login` subprocess is mid-flight. */
	readonly login_in_progress: boolean;
	/** The OAuth URL to open, present while a login is pending. */
	readonly login_url: string | null;
	/** Last login error reported by the server, if any. */
	readonly login_error: string | null;
}

/**
 * Response of `POST /auth/login`.
 *
 * `status` is one of:
 *   - `already_logged_in` — a token already exists; `url` is null.
 *   - `pending` / `in_progress` — login started; `url` holds the OAuth URL.
 */
export interface AuthLoginResponse {
	readonly status: string;
	readonly url: string | null;
}

/** Response of `POST /auth/code` and `POST /auth/logout`. */
export interface AuthActionResponse {
	readonly status: string;
}

// ---------------------------------------------------------------------------
// KANBAN wallboard — readonly aggregate of Trello boards configured on the
// agent-server. One row per lane, count = open cards in that lane.
// ---------------------------------------------------------------------------

export interface CardStateBreakdown {
	readonly running: number;
	readonly await: number;
	readonly ready: number;
	readonly idle: number;
}

export interface KanbanLane {
	readonly id?: string;
	readonly name: string;
	readonly pos?: number;
	readonly count: number;
	/** Card con `idMembers != []`: un agent o umano le sta lavorando.
	 *  Convenzione kanban-operations: claim = self-assign, release a fine lavoro. */
	readonly in_progress?: number;
	/** Breakdown delle card per stato runtime (running/await/ready/idle). */
	readonly states?: CardStateBreakdown;
	/** Skill Claude Code richiesta per lavorare task in questa lane.
	 *  null/assente = nessuna skill mappata (badge nascosto nella UI). */
	readonly skill?: string | null;
}

export interface Kanban {
	readonly id: string;
	readonly name: string | null;
	readonly url: string | null;
	readonly lanes: ReadonlyArray<KanbanLane>;
	/** Breakdown aggregato delle card del board per stato runtime. */
	readonly states?: CardStateBreakdown;
	/** Present only when the server failed to fetch this board from Trello. */
	readonly error?: string;
	/** true = pipeline in pausa (lane_consumer salta le card di questo board). */
	readonly paused?: boolean;
}

// ---------------------------------------------------------------------------
// KANBAN board detail — drilldown view of a single board with full card lists.
// ---------------------------------------------------------------------------

/** Stato runtime di una card: running | await | ready | idle.
 *  - `running`: agent al lavoro (claim attivo nel consumer o member su Trello)
 *  - `await`: lane umana — aspetta intervento di owner/Clodia
 *  - `ready`: lane skill-mapped, non ancora claimata (il consumer la prenderà)
 *  - `idle`: lane senza skill (parking/terminale), nessuno la lavora */
export type CardState = 'running' | 'await' | 'ready' | 'idle';

export interface KanbanCard {
	readonly id: string;
	readonly name: string;
	readonly url: string | null;
	readonly in_progress: boolean;
	readonly state?: CardState;
	readonly dateLastActivity: string | null;
	/** Presente solo quando `state === 'running'`: chi sta lavorando la card. */
	readonly agent?: { readonly name: string; readonly display_name: string };
}

export interface KanbanLaneDetail extends KanbanLane {
	readonly id: string;
	readonly pos: number;
	readonly cards: ReadonlyArray<KanbanCard>;
	readonly is_notify?: boolean;
}

export interface KanbanDetail {
	readonly id: string;
	readonly name: string | null;
	readonly url: string | null;
	readonly lanes: ReadonlyArray<KanbanLaneDetail>;
	readonly paused?: boolean;
}

// ---------------------------------------------------------------------------
// COLONY — execution ledger + approval gates (agent-server colony runtime).
// ---------------------------------------------------------------------------

/** Stato di una execution nel ledger della colony. L'unione resta aperta
 *  (trailing `string`) così stati futuri non rompono il renderer. */
export type ColonyExecutionStatus =
	| 'CLAIMED'
	| 'RUNNING'
	| 'DELIVERED'
	| 'FAILED'
	| 'STALE'
	| 'RETRY_PENDING'
	| 'ESCALATED'
	| 'DONE'
	| string;

/** One row from `GET /api/colony/executions`. */
export interface ColonyExecution {
	readonly execution_id: string;
	readonly card_id: string;
	readonly board_id?: string;
	readonly agent: string;
	readonly skill?: string;
	readonly lane?: string;
	readonly status: ColonyExecutionStatus;
	readonly started_at?: string | null;
	readonly finished_at?: string | null;
	readonly error?: string | null;
	readonly last_heartbeat_at?: string | null;
	/** execution_id di cui questa è un retry (recovery, spec §15). Vuoto se
	 *  è il primo tentativo. Permette di ricostruire la catena di recovery. */
	readonly retry_of?: string | null;
	readonly workspace_path?: string | null;
}

/** One row from `GET /api/colony/approvals`. Con `status` diverso da
 *  pending l'endpoint ritorna anche le decisioni storiche. */
export interface ColonyApproval {
	readonly token: string;
	readonly card_id: string;
	readonly board_id?: string;
	readonly lane?: string;
	readonly card_name?: string;
	readonly status: string;
	readonly comment?: string | null;
	readonly created_at?: string | null;
	readonly decided_at?: string | null;
}

// ---------------------------------------------------------------------------
// COLONY — control plane: deliverables, execution detail, audit, pipelines.
// ---------------------------------------------------------------------------

/** Tipo di artefatto prodotto da una execution (colony RESULT_TYPES). */
export type DeliverableResultType =
	| 'FILE'
	| 'LINK'
	| 'COMMIT'
	| 'PR'
	| 'DB_CHANGE'
	| 'API_ACTION'
	| 'MIXED'
	| string;

/** Outcome strutturato di un deliver (colony DeliverableRow). È *cosa ha
 *  prodotto* l'agente: il PR, il commit, il link, i side-effect. */
export interface ColonyDeliverable {
	readonly id?: number;
	readonly execution_id: string;
	readonly status?: string;
	readonly result_type: DeliverableResultType;
	readonly deliverables: ReadonlyArray<unknown>;
	readonly side_effects: ReadonlyArray<unknown>;
	readonly created_at?: string | null;
}

/** Dettaglio di una execution: la riga + i deliverable collegati. Da
 *  `GET /api/colony/executions/{id}`. */
export interface ColonyExecutionDetail extends ColonyExecution {
	readonly deliverables?: ReadonlyArray<ColonyDeliverable>;
}

/** Una riga dell'audit trail (colony EventRow). Da `GET /api/colony/events`. */
export interface ColonyEvent {
	readonly id?: number;
	readonly ts: string;
	readonly agent?: string;
	readonly execution_id?: string;
	readonly action: string;
	readonly payload?: Record<string, unknown>;
}

/** Stato di una pipeline (colony PIPELINE_STATES). */
export type PipelineStatus =
	| 'DRAFT'
	| 'VALIDATING'
	| 'READY'
	| 'ACTIVE'
	| 'PAUSED'
	| 'DEPRECATED'
	| 'FAILED_VALIDATION'
	| string;

/** Uno step di pipeline: lane Trello mappata a una skill, con flag human. */
export interface PipelineStep {
	readonly name: string;
	readonly skill?: string;
	readonly human?: boolean;
	readonly approval_gate?: boolean;
}

/** Una pipeline del registry (colony PipelineRow). */
export interface Pipeline {
	readonly name: string;
	readonly version: number;
	readonly status: PipelineStatus;
	readonly objective?: string;
	readonly steps: ReadonlyArray<PipelineStep>;
	readonly board_id?: string;
	readonly validation_report?: Record<string, unknown>;
	readonly created_at?: string | null;
	readonly updated_at?: string | null;
}

/** Una versione storica della pipeline (colony PipelineVersionRow). */
export interface PipelineVersion {
	readonly version: number;
	readonly steps: ReadonlyArray<PipelineStep>;
	readonly note?: string;
	readonly created_at?: string | null;
}
