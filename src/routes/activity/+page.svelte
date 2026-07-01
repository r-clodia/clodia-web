<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		ApiError,
		getActivitySummary,
		getRuntimeSessions,
		type AgentActivitySummaryRow,
		type RuntimeSession
	} from '$lib/api/client';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';

	let sessions: RuntimeSession[] = [];
	let leaderboard: AgentActivitySummaryRow[] = [];
	let err = '';
	let loading = true;
	let poll: ReturnType<typeof setInterval> | null = null;

	async function load() {
		try {
			[sessions, leaderboard] = await Promise.all([
				getRuntimeSessions(),
				getActivitySummary()
			]);
			err = '';
		} catch (e) {
			err = e instanceof ApiError || e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
		poll = setInterval(load, 4000);
	});
	onDestroy(() => {
		if (poll) clearInterval(poll);
	});

	const STATE_LABEL: Record<string, string> = {
		running: 'in esecuzione',
		idle: 'inattivo',
		blocked: 'bloccato',
		stopped: 'fermo'
	};

	function fmtTs(ts?: string | null): string {
		if (!ts) return '—';
		try {
			return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
		} catch {
			return ts;
		}
	}
	function fmtTok(n: number): string {
		if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
		return String(n ?? 0);
	}
	function sortLeaderboard(rows: AgentActivitySummaryRow[]): AgentActivitySummaryRow[] {
		return [...rows].sort((a, b) =>
			(b.runs - a.runs) ||
			((b.tokens_in + b.tokens_out) - (a.tokens_in + a.tokens_out)) ||
			a.agent.localeCompare(b.agent)
		);
	}

	function topicHref(s: RuntimeSession): string | null {
		if (s.context_kind === 'dm' || !s.topic) return null;
		const match = String(s.topic).trim().match(/^(SEAL-[0-4])\/(.+)$/i);
		if (!match) return null;
		const [, tier, name] = match;
		return `/topics/${encodeURIComponent(tier.toUpperCase())}/${encodeURIComponent(name)}`;
	}

	$: running = sessions.filter((s) => s.state === 'running').length;
	$: blocked = sessions.filter((s) => s.state === 'blocked').length;
	$: totalRuns = leaderboard.reduce((sum, a) => sum + (a.runs || 0), 0);
</script>

<svelte:head><title>Agents Activity — Clodia</title></svelte:head>

<header class="head">
	<div>
		<h1>Agents Activity</h1>
		<p class="hint">Sessioni agente live — come <code>top</code> / Activity Monitor. Aggiornamento ogni 4s.</p>
	</div>
	<div class="stat">
		<span class="pill run">{running} in esecuzione</span>
		{#if blocked}<span class="pill blk">{blocked} bloccati</span>{/if}
		<span class="pill tot">{sessions.length} sessioni</span>
	</div>
</header>

{#if err}<div class="err">{err}</div>{/if}

<div class="activity-grid">
	<section class="panel live-panel">
		<div class="panel-head">
			<h2>Spawn live</h2>
			<span class="panel-count">{sessions.length} righe</span>
		</div>
		{#if loading}
			<p class="muted">Caricamento…</p>
		{:else if sessions.length === 0}
			<p class="muted">Nessuna sessione agente attiva in questo momento.</p>
		{:else}
			<div class="table-wrap">
				<table class="tbl">
					<thead>
						<tr>
							<th>Agente</th><th>Contesto</th><th>Stato</th>
							<th class="num">Token in</th><th class="num">Token out</th><th class="num">Run</th>
							<th>Ultima attività</th><th>Runtime</th>
						</tr>
					</thead>
					<tbody>
						{#each sessions as s (s.chat_id)}
							<tr>
								<td class="ag"><AgentAvatar name={s.agent} size={22} /><span>{s.agent}</span></td>
								<td>
									{#if s.topic}
										{@const href = topicHref(s)}
										{#if href}
											<a class="ctx ctx-link" href={href}>{s.context_kind === 'dm' ? '✉︎' : '#'} {s.topic}</a>
										{:else}
											<span class="ctx">{s.context_kind === 'dm' ? '✉︎' : '#'} {s.topic}</span>
										{/if}
									{:else}
										<span class="muted">—</span>
									{/if}
								</td>
								<td><span class="state {s.state}">{STATE_LABEL[s.state] ?? s.state}</span></td>
								<td class="num">{fmtTok(s.tokens_in)}</td>
								<td class="num">{fmtTok(s.tokens_out)}</td>
								<td class="num">{s.runs}</td>
								<td>{fmtTs(s.last_activity)}</td>
								<td><span class="rt">{s.runtime ?? '—'}</span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="panel leaderboard-panel">
		<div class="panel-head">
			<h2>Agent seed leaderboard</h2>
			<span class="panel-count">{totalRuns} run all-time</span>
		</div>
		{#if loading}
			<p class="muted">Caricamento…</p>
		{:else if leaderboard.length === 0}
			<p class="muted">Nessun agent seed disponibile.</p>
		{:else}
			<div class="table-wrap">
				<table class="tbl">
					<thead>
						<tr>
							<th>#</th><th>Agent seed</th>
							<th class="num">Token in</th><th class="num">Token out</th><th class="num">Run</th>
							<th>Ultimo evento</th>
						</tr>
					</thead>
					<tbody>
						{#each sortLeaderboard(leaderboard) as a, i (a.agent)}
							<tr>
								<td class="rank">{i + 1}</td>
								<td class="ag"><AgentAvatar name={a.agent} size={22} /><span>{a.agent}</span></td>
								<td class="num">{fmtTok(a.tokens_in)}</td>
								<td class="num">{fmtTok(a.tokens_out)}</td>
								<td class="num">{a.runs}</td>
								<td>
									<span class="rt">{a.last_event_type ?? '—'}</span>
									<span class="last-ts">{fmtTs(a.last_event_ts)}</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<style>
	.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
	.hint { margin: 4px 0 0; color: var(--fg-muted); font-size: 12px; }
	.stat { display: flex; gap: 8px; }
	.pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border); color: var(--fg-muted); }
	.pill.run { color: #4caf6a; border-color: rgba(76,175,106,.5); }
	.pill.blk { color: #e8a23a; border-color: rgba(232,162,58,.5); }
	.err { color: var(--danger, #e85d75); font-size: 12px; margin-bottom: 10px; }
	.muted { color: var(--fg-muted); font-size: 13px; }
	.activity-grid { display: grid; grid-template-rows: minmax(240px, 1fr) minmax(240px, 1fr); gap: 18px; min-height: calc(100vh - 190px); }
	.panel { min-height: 0; display: flex; flex-direction: column; border-top: 1px solid var(--border); padding-top: 12px; }
	.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 8px; }
	.panel h2 { margin: 0; font-size: 14px; line-height: 1.2; text-transform: uppercase; letter-spacing: 0.05em; }
	.panel-count { color: var(--fg-muted); font-size: 12px; }
	.table-wrap { min-height: 0; overflow: auto; }
	.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
	.tbl th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-muted); padding: 6px 10px; border-bottom: 1px solid var(--border); }
	.tbl th.num, .tbl td.num { text-align: right; font-variant-numeric: tabular-nums; }
	.tbl td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); }
	.ag { display: flex; align-items: center; gap: 8px; font-weight: 600; }
	.rank { color: var(--fg-muted); font-variant-numeric: tabular-nums; width: 36px; }
	.ctx { font-family: var(--mono); font-size: 12px; }
	.ctx-link { color: var(--accent); text-decoration: none; }
	.ctx-link:hover { text-decoration: underline; }
	.rt { font-size: 11px; color: var(--fg-muted); }
	.last-ts { margin-left: 8px; color: var(--fg-muted); font-size: 11px; }
	.state { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
	.state.running { background: rgba(76,175,106,.16); color: #4caf6a; }
	.state.idle { background: rgba(96,165,250,.14); color: #60a5fa; }
	.state.blocked { background: rgba(232,162,58,.18); color: #e8a23a; }
	.state.stopped { background: rgba(140,140,140,.16); color: var(--fg-muted); }
</style>
