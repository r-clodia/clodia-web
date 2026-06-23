<script lang="ts">
	/**
	 * A small pill / dot indicating a lifecycle state.
	 *
	 * Originally built for agents (idle/running/unknown). Extended additively
	 * to also cover job-style outcomes (success/failed) so the JOBS section
	 * can reuse the same visual vocabulary. Unrecognised strings fall back
	 * to neutral rendering.
	 */
	import type { AgentRunState, JobStatus } from '$lib/api/types';

	/**
	 * Accepted lifecycle states. Strings outside this union render
	 * neutrally. The vocabulary spans three subsystems:
	 *  - agents: `idle`, `running`
	 *  - jobs:   `success`, `failed`
	 *  - daemons:`up`, `down`, `degraded` (`unknown` shared as fallback)
	 */
	type DotState =
		| AgentRunState
		| JobStatus
		| 'unknown'
		| 'up'
		| 'down'
		| 'degraded'
		| 'disconnected';

	export let state: DotState | string = 'unknown';
	export let withLabel: boolean = true;

	const KNOWN: ReadonlyArray<DotState> = [
		'idle',
		'running',
		'success',
		'failed',
		'up',
		'down',
		'degraded',
		'disconnected',
		'unknown'
	];

	$: normalised = (KNOWN.includes(state as DotState) ? state : 'unknown') as DotState;

	$: title =
		normalised === 'running'
			? 'Running'
			: normalised === 'idle'
			? 'Idle'
			: normalised === 'success'
			? 'Last run succeeded'
			: normalised === 'failed'
			? 'Last run failed'
			: normalised === 'up'
			? 'Up'
			: normalised === 'down'
			? 'Down'
			: normalised === 'degraded'
			? 'Degraded'
			: normalised === 'disconnected'
			? 'Provider non collegato'
			: 'Status unknown';

	$: label = normalised === 'unknown' ? (typeof state === 'string' && state ? state : '—') : normalised;
</script>

<span class="pill {normalised}" title={title} aria-label={title}>
	<span class="dot" aria-hidden="true"></span>
	{#if withLabel}
		<span class="label">{label}</span>
	{/if}
</span>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px 3px 6px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: rgba(255, 255, 255, 0.02);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
		line-height: 1;
		white-space: nowrap;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--fg-muted);
		box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.2);
	}
	.pill.running {
		color: var(--success);
		border-color: rgba(92, 184, 138, 0.45);
		background: rgba(92, 184, 138, 0.08);
	}
	.pill.running .dot {
		background: var(--success);
		box-shadow: 0 0 0 2px rgba(92, 184, 138, 0.18);
		animation: pulse 1.4s ease-in-out infinite;
	}
	.pill.idle .dot {
		background: #6c7382;
	}
	.pill.success {
		color: var(--success);
		border-color: rgba(92, 184, 138, 0.45);
		background: rgba(92, 184, 138, 0.08);
	}
	.pill.success .dot {
		background: var(--success);
		box-shadow: 0 0 0 2px rgba(92, 184, 138, 0.18);
	}
	.pill.failed {
		color: var(--danger);
		border-color: rgba(232, 93, 117, 0.55);
		background: rgba(232, 93, 117, 0.08);
	}
	.pill.failed .dot {
		background: var(--danger);
		box-shadow: 0 0 0 2px rgba(232, 93, 117, 0.18);
	}
	.pill.up {
		color: var(--success);
		border-color: rgba(92, 184, 138, 0.45);
		background: rgba(92, 184, 138, 0.08);
	}
	.pill.up .dot {
		background: var(--success);
		box-shadow: 0 0 0 2px rgba(92, 184, 138, 0.18);
		animation: pulse 1.4s ease-in-out infinite;
	}
	.pill.down {
		color: var(--danger);
		border-color: rgba(232, 93, 117, 0.55);
		background: rgba(232, 93, 117, 0.08);
	}
	.pill.down .dot {
		background: var(--danger);
		box-shadow: 0 0 0 2px rgba(232, 93, 117, 0.18);
	}
	.pill.degraded {
		color: #d6a85a;
		border-color: rgba(214, 168, 90, 0.55);
		background: rgba(214, 168, 90, 0.08);
	}
	.pill.degraded .dot {
		background: #d6a85a;
		box-shadow: 0 0 0 2px rgba(214, 168, 90, 0.18);
	}
	.pill.disconnected {
		color: #d6a85a;
		border-color: rgba(214, 168, 90, 0.5);
		background: rgba(214, 168, 90, 0.07);
	}
	.pill.disconnected .dot {
		background: #d6a85a;
		box-shadow: 0 0 0 2px rgba(214, 168, 90, 0.18);
	}
	.pill.unknown {
		opacity: 0.7;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.55;
			transform: scale(1.15);
		}
	}
</style>
