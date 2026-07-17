<script lang="ts">
	import { onMount } from 'svelte';
	import {
		apiGet,
		API_BASE_URL,
		ApiError,
		reloadAgents,
		getAdminState,
		getCertRequests,
		deleteCertRequest,
		createHumanAgent,
		type CertRequest
	} from '$lib/api/client';
	import type { Agent, AgentsListResponse } from '$lib/api/types';
	import { session } from '$lib/auth/session';
	import AgentTable from '$lib/components/AgentTable.svelte';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import NewAgentDialog from '$lib/components/NewAgentDialog.svelte';
	import { toastSuccess, toastError, toastInfo } from '$lib/stores/toasts';

	type ListState =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; agents: ReadonlyArray<Agent>; errors: Record<string, string> }
		| { kind: 'error'; message: string; status?: number };

	let state: ListState = { kind: 'idle' };
	let reloading = false;
	let newAgentOpen = false;

	async function load() {
		state = { kind: 'loading' };
		try {
			const data = await apiGet<AgentsListResponse>('/api/agents');
			const agents = Array.isArray(data?.agents) ? data.agents : [];
			state = { kind: 'ok', agents, errors: data?.errors ?? {} };
		} catch (err) {
			if (err instanceof ApiError) {
				state = { kind: 'error', message: err.message, status: err.status };
			} else if (err instanceof Error) {
				state = { kind: 'error', message: err.message };
			} else {
				state = { kind: 'error', message: String(err) };
			}
		}
	}

	async function reloadAll() {
		await load();
	}

	async function onReloadRegistry() {
		if (reloading) return;
		reloading = true;
		try {
			const r = await reloadAgents();
			const errCount = Object.keys(r.errors || {}).length;
			if (errCount > 0) {
				toastError(
					`Reload: ${r.loaded} agenti caricati, ${errCount} con errori`,
					Object.keys(r.errors).join(', ')
				);
			} else {
				toastSuccess(`Reload OK · ${r.loaded} agenti registrati`);
			}
			await load();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toastError('Reload fallito', msg);
		} finally {
			reloading = false;
		}
	}

	function onCreated(_e: CustomEvent<Agent>) {
		toastInfo('Lista agenti aggiornata');
		void load();
	}

	// --- Richieste di accesso (cert-request) — solo admin ---
	let isAdmin = false;
	let certReqs: CertRequest[] = [];
	let reqClearance: Record<string, string> = {};
	let busyReq = '';

	async function refreshRequests() {
		try {
			const st = await getAdminState();
			isAdmin = !!$session && st.admins.includes($session.principal);
		} catch {
			isAdmin = false;
		}
		if (!isAdmin) {
			certReqs = [];
			return;
		}
		try {
			certReqs = await getCertRequests();
			for (const r of certReqs) if (!reqClearance[r.id]) reqClearance[r.id] = 'SEAL-0';
		} catch {
			certReqs = [];
		}
	}

	async function approveRequest(r: CertRequest) {
		if (busyReq) return;
		busyReq = r.id;
		try {
			// la `contact` della richiesta diventa email/telegram dell'umano
			const c = (r.contact || '').trim();
			const isEmail = c.includes('@');
			await createHumanAgent({
				name: r.name,
				pubkey: r.pubkey,
				clearance: reqClearance[r.id] || 'SEAL-0',
				email: isEmail ? c : undefined,
				telegram: !isEmail && c ? c : undefined
			});
			await deleteCertRequest(r.id);
			toastSuccess(`Approvato: ${r.name}`, `clearance ${reqClearance[r.id] || 'SEAL-0'}`);
			await Promise.all([load(), refreshRequests()]);
		} catch (e) {
			toastError('Approvazione fallita', e instanceof ApiError || e instanceof Error ? e.message : String(e));
		} finally {
			busyReq = '';
		}
	}

	async function rejectRequest(r: CertRequest) {
		if (busyReq) return;
		busyReq = r.id;
		try {
			await deleteCertRequest(r.id);
			toastInfo(`Richiesta di ${r.name} rifiutata`);
			await refreshRequests();
		} catch (e) {
			toastError('Rifiuto fallito', e instanceof ApiError || e instanceof Error ? e.message : String(e));
		} finally {
			busyReq = '';
		}
	}

	onMount(() => {
		void load();
		void refreshRequests();
	});

	function runStateFor(_name: string): 'idle' | 'running' | 'unknown' {
		// Lo stato "running" era derivato dall'inbox-consumer (rimosso).
		return 'idle';
	}

	// Stable display ordering: by display_name, then name.
	function sortAgents(a: ReadonlyArray<Agent>): Agent[] {
		return [...a].sort((x, y) => {
			const lx = (x.display_name || x.name).toLowerCase();
			const ly = (y.display_name || y.name).toLowerCase();
			return lx.localeCompare(ly);
		});
	}
</script>

<header class="head">
	<div>
		<h1>Agents</h1>
		<p class="hint">
			GET <code>{API_BASE_URL}/api/agents</code>
		</p>
	</div>
	<div class="head-actions">
		<button
			type="button"
			class="action-secondary"
			on:click={() => (newAgentOpen = true)}
			disabled={reloading}
		>
			+ Nuovo agente
		</button>
		<button
			type="button"
			class="action-secondary"
			on:click={onReloadRegistry}
			disabled={reloading || state.kind === 'loading'}
			title="POST /api/agents/reload — re-scansiona /clodia/agents/*"
		>
			{#if reloading}
				<span class="spinner" aria-hidden="true"></span>
				Reload…
			{:else}
				Reload registry
			{/if}
		</button>
		<button type="button" on:click={reloadAll} disabled={state.kind === 'loading'}>
			{state.kind === 'loading' ? 'Loading…' : 'Refresh list'}
		</button>
	</div>
</header>

{#if isAdmin && certReqs.length}
	<section class="reqs">
		<h2 class="reqs-h">Richieste di accesso <span class="reqs-n">{certReqs.length}</span></h2>
		<ul class="reqs-list">
			{#each certReqs as r (r.id)}
				<li class="req">
					<AgentAvatar name={r.name} size={28} />
					<span class="req-id">
						<span class="req-name">{r.name}</span>
						{#if r.contact}<span class="req-contact">{r.contact}</span>{/if}
					</span>
					<label class="req-clear">clearance
						<select bind:value={reqClearance[r.id]}>
							<option value="SEAL-0">SEAL-0 · Public</option>
							<option value="SEAL-1">SEAL-1 · Internal</option>
							<option value="SEAL-2">SEAL-2 · Confidential</option>
							<option value="SEAL-3">SEAL-3 · Restricted</option>
							<option value="SEAL-4">SEAL-4 · Sovereign</option>
						</select>
					</label>
					<button type="button" class="req-ok" on:click={() => approveRequest(r)} disabled={busyReq === r.id}>
						{busyReq === r.id ? '…' : 'Approva'}
					</button>
					<button type="button" class="req-no" on:click={() => rejectRequest(r)} disabled={busyReq === r.id}>Rifiuta</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if state.kind === 'loading' || state.kind === 'idle'}
	<div class="rows-skel" aria-busy="true">
		{#each Array(8) as _}
			<div class="row-skel">
				<Skeleton width="32px" height="32px" radius="50%" />
				<Skeleton width="18%" height="13px" />
				<Skeleton width="12%" height="11px" />
				<Skeleton width="14%" height="11px" />
				<Skeleton width="38%" height="11px" />
			</div>
		{/each}
	</div>
{:else if state.kind === 'error'}
	<div class="status error">
		<strong>Failed to load agents{state.status ? ` (HTTP ${state.status})` : ''}.</strong>
		<div class="error-msg">{state.message}</div>
		<div class="error-hint">
			Check that the agent-server is reachable at <code>{API_BASE_URL}</code>. Override via
			<code>PUBLIC_API_BASE_URL</code>.
		</div>
		<button class="retry" type="button" on:click={reloadAll}>Retry</button>
	</div>
{:else if state.agents.length === 0}
	<div class="status empty">
		<strong>Nessun agente registrato.</strong>
		<p class="hint">
			La cartella <code>/clodia/agents/*</code> è vuota o nessuna definizione è valida. Crea un
			agente col bottone in alto o copia un <code>agent.yaml</code> sul disco e premi
			<code>Reload registry</code>.
		</p>
	</div>
{:else}
	<AgentTable agents={sortAgents(state.agents)} {runStateFor} on:changed={load} />

	{#if Object.keys(state.errors).length > 0}
		<details class="errs">
			<summary>Loader warnings ({Object.keys(state.errors).length})</summary>
			<pre>{JSON.stringify(state.errors, null, 2)}</pre>
		</details>
	{/if}
{/if}

<NewAgentDialog
	open={newAgentOpen}
	agents={state.kind === 'ok' ? state.agents : []}
	on:close={() => (newAgentOpen = false)}
	on:created={onCreated}
/>

<style>
	.reqs { margin: 0 0 20px; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); background: rgba(255,107,61,0.04); border-radius: 10px; padding: 12px 14px; }
	.reqs-h { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg); display: flex; align-items: center; gap: 8px; }
	.reqs-n { background: var(--accent); color: var(--accent-fg); font-size: 11px; font-weight: 700; border-radius: 999px; padding: 1px 8px; }
	.reqs-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.req { display: flex; align-items: center; gap: 10px; padding: 8px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; }
	.req-id { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
	.req-name { font-weight: 600; font-size: 13px; }
	.req-contact { font-size: 11px; color: var(--fg-muted); }
	.req-clear { font-size: 11px; color: var(--fg-muted); display: inline-flex; align-items: center; gap: 5px; }
	.req-clear select { background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 12px; padding: 4px 6px; border-radius: 6px; }
	.req-ok { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font: inherit; font-weight: 700; font-size: 12px; padding: 6px 12px; border-radius: 7px; cursor: pointer; }
	.req-no { background: transparent; border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 12px; padding: 6px 11px; border-radius: 7px; cursor: pointer; }
	.req-ok:disabled, .req-no:disabled { opacity: .5; cursor: not-allowed; }

	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 22px;
		flex-wrap: wrap;
	}
	.head-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.hint {
		margin: 4px 0 0;
		color: var(--fg-muted);
		font-size: 12px;
	}
	.action-secondary {
		background: transparent;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.action-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.spinner {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.rows-skel {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--card-bg);
		overflow: hidden;
	}
	.row-skel {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 12px;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
	}
	.row-skel:last-child {
		border-bottom: none;
	}
	.status {
		padding: 16px 18px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card-bg);
	}
	.status.error {
		border-color: rgba(232, 93, 117, 0.6);
		background: rgba(232, 93, 117, 0.08);
	}
	.status.empty {
		border-style: dashed;
		text-align: center;
		padding: 36px 24px;
	}
	.status.empty .hint {
		max-width: 560px;
		margin-left: auto;
		margin-right: auto;
	}
	.error-msg {
		margin-top: 8px;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--danger);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.error-hint {
		margin-top: 10px;
		font-size: 12px;
		color: var(--fg-muted);
	}
	.retry {
		margin-top: 12px;
	}
	.errs {
		margin-top: 18px;
		color: var(--fg-muted);
		font-size: 12px;
	}
	.errs summary {
		cursor: pointer;
		margin-bottom: 8px;
	}
</style>
