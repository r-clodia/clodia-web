<script lang="ts">
	/**
	 * Badge «STALE»: il job non gira da più di quanto la sua cadenza consenta
	 * (issue clodia-platform#287).
	 *
	 * Sta ACCANTO allo {@link StatusDot}, non al suo posto. «L'ultimo run è andato
	 * bene» e «l'ultimo run è di tre giorni fa» sono due fatti veri insieme: il
	 * 24 ago 2026 i due backup ISO 27001 A.8.13 erano fermi da 68 e 355 ore con
	 * `last_status: ok`, ed è la coppia delle due affermazioni a raccontare cos'è
	 * successo — sostituirne una perderebbe l'unica riga che dice com'era finita
	 * l'ultima volta che il job era partito davvero.
	 *
	 * Il giudizio arriva già fatto dal server (`stale`/`stale_reason`, calcolati
	 * in lettura da `_with_freshness`): qui non si ricalcola nulla dal
	 * `last_run`. Una seconda regola nel client darebbe una seconda risposta alla
	 * stessa domanda, e la webui direbbe «fresco» mentre i log dicono «stale».
	 *
	 * Colore: ambra, la stessa famiglia di `.pill.missed` e `.pill.blocked` — un
	 * job fermo chiede attenzione, non segnala una rottura, e il rosso di
	 * `failed` è già preso da «è partito ed è andato male». Il colore non è mai
	 * l'unico canale: la parola STALE resta a schermo e il motivo per esteso sta
	 * in `title`/`aria-label`.
	 */

	/** Il motivo in chiaro dal server, es. «ultimo run 2026-08-21T22:00:00+00:00:
	 *  68.1 ore senza run, ma la cadenza è ogni 1440 min». */
	export let reason: string | null | undefined = null;

	$: label = reason
		? `Job fermo: ${reason}`
		: 'Job fermo: nessun run da più di quanto la cadenza consenta';
</script>

<span class="stale" title={label} aria-label={label}>
	<span class="dot" aria-hidden="true"></span>
	<span class="label">STALE</span>
</span>

<style>
	/* Stessa forma della pill di StatusDot: i due segni stanno affiancati e
	   devono leggersi come una cosa sola. `--warn` non è definita in nessun
	   foglio — la convenzione del repo è `var(--warn, <fallback>)`, come in
	   TrifectaBadge e in `.pill.missed`. */
	.stale {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px 3px 6px;
		border-radius: 999px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		line-height: 1;
		white-space: nowrap;
		cursor: help;
		color: var(--warn, #e0a800);
		border: 1px solid rgba(224, 168, 0, 0.5);
		background: rgba(224, 168, 0, 0.08);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--warn, #e0a800);
		box-shadow: 0 0 0 2px rgba(224, 168, 0, 0.18);
	}
</style>
