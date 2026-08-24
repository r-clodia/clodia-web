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
	 *  - spawns: `blocked`, `error` (albero spawn del topic, issue#99)
	 *  - jobs:   `success`, `error`, `fatal`, `failed`. I tre non-success non
	 *            sono sinonimi: `error` = consegnato ma la qualità può essere
	 *            compromessa, `fatal` = il turno è finito e il lavoro no,
	 *            `failed` = il turno è morto (clodia-platform#206)
	 *  - daemons:`up`, `down`, `degraded` (`unknown` shared as fallback)
	 */
	type DotState =
		| AgentRunState
		| JobStatus
		| 'unknown'
		| 'up'
		| 'down'
		| 'degraded'
		| 'disconnected'
		| 'blocked'
		| 'error';

	export let state: DotState | string = 'unknown';
	export let withLabel: boolean = true;

	const KNOWN: ReadonlyArray<DotState> = [
		'idle',
		'running',
		'success',
		'error',
		'fatal',
		'failed',
		'missed',
		'up',
		'down',
		'degraded',
		'disconnected',
		'blocked',
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
			: normalised === 'missed'
			? 'Il fire non è avvenuto: scartato per misfire'
			: normalised === 'fatal'
			? 'Il turno è finito e il lavoro non è stato fatto'
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
			: normalised === 'blocked'
			? 'Bloccato'
			: normalised === 'error'
			? 'Errore sull’ultimo turno'
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
	/* issue#99 — semaforo dell'albero spawn: arancio = fermo, rosso = errore.
	   Il colore non è mai l'unico canale: la label testuale resta sempre a
	   fianco del pallino (daltonismo/screen reader), e il `title`/`aria-label`
	   della pill descrive lo stato per esteso. */
	.pill.blocked {
		color: #e8a23a;
		border-color: rgba(232, 162, 58, 0.55);
		background: rgba(232, 162, 58, 0.08);
	}
	.pill.blocked .dot {
		background: #e8a23a;
		box-shadow: 0 0 0 2px rgba(232, 162, 58, 0.18);
	}
	.pill.error {
		color: var(--danger);
		border-color: rgba(232, 93, 117, 0.55);
		background: rgba(232, 93, 117, 0.08);
	}
	.pill.error .dot {
		background: var(--danger);
		box-shadow: 0 0 0 2px rgba(232, 93, 117, 0.18);
	}
	/* `fatal` prende il rosso pieno di `failed`: sono i due casi in cui non c'è
	   nulla da consegnare, e chi guarda la lista deve vederli allo stesso modo.
	   `error` NON viene ritoccato di proposito: la stessa parola marca anche gli
	   spawn («errore sull'ultimo turno»), e cambiarle colore qui avrebbe
	   ridipinto un sottosistema che questa modifica non riguarda. La differenza
	   fra error e fatal la porta l'etichetta, che è già il nome dello stato. */
	/* `missed` NON e' rosso come `failed`: quello e' un run partito e andato male,
	   questo e' un run che non e' mai iniziato. Un backup scartato mentre la
	   macchina dormiva chiede attenzione, non segnala una rottura — e distinguere
	   le due cose a colpo d'occhio e' il punto di clodia-platform#273, dove il
	   difetto era proprio che il registro non diceva la differenza.
	   `--warn` non e' definita in nessun foglio: la convenzione del repo e'
	   `var(--warn, <fallback>)`, come in TrifectaBadge. */
	.pill.missed {
		color: var(--warn, #e0a800);
		border-color: rgba(224, 168, 0, 0.5);
		background: rgba(224, 168, 0, 0.08);
	}
	.pill.missed .dot {
		background: var(--warn, #e0a800);
		box-shadow: 0 0 0 2px rgba(224, 168, 0, 0.18);
	}
	.pill.fatal {
		color: var(--danger);
		border-color: rgba(232, 93, 117, 0.55);
		background: rgba(232, 93, 117, 0.08);
	}
	.pill.fatal .dot {
		background: var(--danger);
		box-shadow: 0 0 0 2px rgba(232, 93, 117, 0.18);
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
