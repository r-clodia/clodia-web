<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { ApiError, getRuntimeSessions, type RuntimeSession } from '$lib/api/client';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';

	let sessions: RuntimeSession[] = [];
	let err = '';
	let loading = true;
	let poll: ReturnType<typeof setInterval> | null = null;

	async function load() {
		try {
			sessions = await getRuntimeSessions();
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

	function topicHref(s: RuntimeSession): string | null {
		if (s.context_kind === 'dm' || !s.topic) return null;
		const match = String(s.topic).trim().match(/^(SEAL-[0-4])\/(.+)$/i);
		if (!match) return null;
		const [, tier, name] = match;
		return `/topics/${encodeURIComponent(tier.toUpperCase())}/${encodeURIComponent(name)}`;
	}

	$: running = sessions.filter((s) => s.state === 'running').length;
	$: blocked = sessions.filter((s) => s.state === 'blocked').length;
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

{#if loading}
	<p class="muted">Caricamento…</p>
{:else if sessions.length === 0}
	<p class="muted">Nessuna sessione agente attiva in questo momento.</p>
{:else}
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
{/if}

<style>
	.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
	.hint { margin: 4px 0 0; color: var(--fg-muted); font-size: 12px; }
	.stat { display: flex; gap: 8px; }
	.pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border); color: var(--fg-muted); }
	.pill.run { color: #4caf6a; border-color: rgba(76,175,106,.5); }
	.pill.blk { color: #e8a23a; border-color: rgba(232,162,58,.5); }
	.err { color: var(--danger, #e85d75); font-size: 12px; margin-bottom: 10px; }
	.muted { color: var(--fg-muted); font-size: 13px; }
	.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
	.tbl th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-muted); padding: 6px 10px; border-bottom: 1px solid var(--border); }
	.tbl th.num, .tbl td.num { text-align: right; font-variant-numeric: tabular-nums; }
	.tbl td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); }
	.ag { display: flex; align-items: center; gap: 8px; font-weight: 600; }
	.ctx { font-family: var(--mono); font-size: 12px; }
	.ctx-link { color: var(--accent); text-decoration: none; }
	.ctx-link:hover { text-decoration: underline; }
	.rt { font-size: 11px; color: var(--fg-muted); }
	.state { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
	.state.running { background: rgba(76,175,106,.16); color: #4caf6a; }
	.state.idle { background: rgba(96,165,250,.14); color: #60a5fa; }
	.state.blocked { background: rgba(232,162,58,.18); color: #e8a23a; }
	.state.stopped { background: rgba(140,140,140,.16); color: var(--fg-muted); }
</style>
