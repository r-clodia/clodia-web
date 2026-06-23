# Fase 8 — Azioni write & polish

Ultima fase del WebUI v2: si aggiungono le azioni write (AGENTS reload, JOBS
CRUD completo), un canale live globale (SSE) per riflettere subito i cambi
di stato, e un layer di polish (toasts, modali, conferme, loading,
disable-during-submit).

## Funzionalità nuove

### AGENTS

| Azione | Endpoint | Stato |
| --- | --- | --- |
| **Reload registry** | `POST /api/agents/reload` | ✅ funzionante |
| **+ Nuovo agente** (form modal con 3 template) | `POST /api/agents` | UI pronta, server **non espone l'endpoint** (405) — il form mostra istruzioni copy-to-disk |
| **Edit system prompt** (textarea inline) | `PATCH /api/agents/{name}` | UI pronta, server **non espone l'endpoint** (405) — degrade idem |

Il bottone "Reload registry" nella lista `/agents` chiama il vero
`POST /api/agents/reload`, mostra un toast di successo con il conteggio degli
agenti caricati, e ricarica la lista per riflettere subito le modifiche al
disco.

I form di "Nuovo agente" e "Modifica system prompt" sono completi e pronti
all'uso, ma l'agent-server (v4.0.2) non espone endpoint write per gli
agenti. Quando il server risponde con `405`, l'UI mostra un avviso "feature
non disponibile su questa versione del server" + lo YAML / body candidato
pronto da copiare su disco (poi premere Reload per registrare). Quando il
backend espone gli endpoint, il form salverà direttamente senza modifiche
al codice.

### JOBS — CRUD completo

| Azione | Endpoint | Stato |
| --- | --- | --- |
| **+ Nuovo job** | `POST /clodia/jobs` | ✅ |
| **Modifica** (lista + dettaglio) | `PATCH /clodia/jobs/{id}` | ✅ |
| **Elimina** (lista + dettaglio, con conferma) | `DELETE /clodia/jobs/{id}` | ✅ |
| **Esegui ora** (lista + dettaglio) | `POST /clodia/jobs/{id}/run` | ✅ |

Il form di create/edit (`JobFormDialog.svelte`) rispecchia esattamente lo
schema OpenAPI (`JobCreate` / `JobUpdate`):

- `name` (1–200), `cron_expr` (1–200), `prompt` (≥1) — required
- `enabled` (default `true`)

La `PATCH` invia **solo i campi modificati** (diff rispetto allo snapshot
iniziale), non l'intero job. Le DELETE chiedono conferma esplicita con un
`<ConfirmDialog>` rosso. Tutti i bottoni si disabilitano durante l'invio per
evitare doppi-submit.

### Live state globale

`src/lib/stores/events-stream.ts` apre **una sola** `EventSource` verso
`GET /clodia/events` per la vita della SPA (lease nel root layout) e
multiplexa gli eventi:

- `agent_activity` → throttled refresh di `consumer-status` + bump dei
  jobs (consente di vedere gli agenti partire/fermarsi e le card spostarsi
  tra le lane senza aspettare il prossimo poll)
- `chat_*` → bump di un `chatLifecycleTick` (a cui le pagine possono
  abbonarsi se vogliono reagire alla creazione/eliminazione di chat)

**SSE vs polling — scelta finale:**

- AGENTS: SSE drive del `consumer-status` (refresh entro 500ms da
  `agent_activity`) + polling di backup ogni 7s.
- JOBS: SSE non emette eventi `job_*` (il server pubblica solo
  `agent_activity` quando un job parte una chat), quindi usiamo polling
  ogni 7s + bump immediato dopo ogni CRUD action.
- CHATS: usa la SSE per il flusso di token (già nella fase 6/base) — non
  cambiato.
- DAEMONS: nessun evento publish-side, resta polling 5s (invariato).

Backoff sull'errore SSE: 1s / 2s / 5s. La connessione si riapre
automaticamente.

### Polish UX

- **Toaster globale** (`src/lib/components/Toaster.svelte`, store
  `src/lib/stores/toasts.ts`) — push `toastSuccess` / `toastError` /
  `toastInfo` da qualunque pagina. Auto-dismiss (3.5s success, 4.5s info,
  8s error), × per chiudere prima, slide-in 160ms.
- **Modale generica** (`src/lib/components/Modal.svelte`) con slot
  `title` / default body / `actions`, lock dello scroll, Esc + click sul
  backdrop per chiudere, focus trap.
- **ConfirmDialog** (`src/lib/components/ConfirmDialog.svelte`) con
  styling `destructive` per le azioni distruttive.
- **Disabilita-durante-submit** su tutti i bottoni write (creazione,
  modifica, eliminazione, run).
- **Loading state**: skeletons già presenti nella base, spinner inline sui
  bottoni durante l'azione.
- **Empty state** rivisti (lista agenti vuota, lista jobs vuota — entrambi
  con CTA per la creazione).
- **Error handling**: ogni write action ha sia toast d'errore (persistente
  fino al click) sia, dove necessario, error panel inline dentro al
  form/dialog. Mai swallowing silenzioso.

## File nuovi

```
src/lib/agentTemplates.ts                  # 3 template starter per Nuovo agente
src/lib/stores/toasts.ts                   # store toast globale
src/lib/stores/events-stream.ts            # SSE multiplexer + reference count
src/lib/stores/jobs.ts                     # polling store JOBS (7s, visibility-aware)
src/lib/components/Toaster.svelte          # rendering toast stack
src/lib/components/Modal.svelte            # modale generica
src/lib/components/ConfirmDialog.svelte    # conferma sì/no
src/lib/components/JobFormDialog.svelte    # form crea/modifica job
src/lib/components/NewAgentDialog.svelte   # form crea agente (3 template)
```

## File modificati

```
src/lib/api/client.ts                      # apiPatch + reloadAgents/createAgent/
                                           # updateAgent/createJob/updateJob/
                                           # deleteJob/runJob
src/lib/api/types.ts                       # AgentReloadResponse, AgentTemplate,
                                           # JobCreate, JobUpdate, JobRunResponse
src/lib/stores/consumer-status.ts          # refreshConsumerStatusThrottled
src/routes/+layout.svelte                  # SSE lease + Toaster mount + bridge
src/routes/agents/+page.svelte             # + Nuovo agente + Reload registry
src/routes/agents/[name]/+page.svelte      # editor system prompt (degrades)
src/routes/jobs/+page.svelte               # CRUD + run + conferma elimina
src/routes/jobs/[id]/+page.svelte          # Esegui/Modifica/Elimina + dialogs
```

## Endpoint chiamati in fase 8

| Verb | Path | Origine in fase 8 |
| --- | --- | --- |
| GET | `/clodia/events` | `src/lib/stores/events-stream.ts` (singleton SSE) |
| POST | `/api/agents/reload` | bottone "Reload registry" nella lista agenti |
| POST | `/api/agents` *(405 oggi)* | dialog "+ Nuovo agente" |
| PATCH | `/api/agents/{name}` *(405 oggi)* | editor System Prompt nel dettaglio agente |
| POST | `/clodia/jobs` | "+ Nuovo job" |
| PATCH | `/clodia/jobs/{id}` | "Modifica" job (lista + dettaglio) |
| DELETE | `/clodia/jobs/{id}` | "Elimina" job (con conferma) |
| POST | `/clodia/jobs/{id}/run` | "Esegui ora" (lista + dettaglio) |

## Limiti noti

1. **`POST /api/agents`** e **`PATCH /api/agents/{name}`** non sono esposti
   dall'agent-server v4.0.2. L'UI è pronta e degrade chiaramente con
   istruzioni copy-to-disk + il body candidato pronto da copiare. Niente
   silent failure. La sezione *Reload* funziona ed è la via canonica per
   registrare nuovi agenti creati a mano sul disco.

2. **`/clodia/events`** non emette eventi `job_*`. La lista jobs si
   aggiorna via polling 7s + bump immediato dopo le CRUD. Va bene per
   l'use case attuale; se in futuro il server emette eventi job-lifecycle,
   basta aggiungere un branch nel listener del layout.

3. Il system prompt body resta esposto via API solo come *filename*
   (`system_prompt: "system-prompt.md"`). L'editor mostra il filename, il
   path assoluto, e — quando l'utente prova a salvare — il body candidato
   da copiare a mano. Stessa nota di fase 4.

## Build / check

```bash
npm run check    # 0 errors, 0 warnings (svelte-check su 278 file)
npm run build    # ✓ built in ~2-5s — adapter-static → ./build/ pronto per il deploy
```
