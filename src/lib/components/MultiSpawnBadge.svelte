<script lang="ts">
	/**
	 * Badge 👯 del participant multi-spawn (issue clodia-platform#210).
	 *
	 * Un seed con `multi_spawn: true` materializza N istanze concorrenti nello
	 * stesso topic, ognuna con ordinale (`@fullstack-dev#2`). Senza questo segno
	 * un participant che risponde come quattro istanze è disegnato esattamente
	 * come uno che risponde una volta sola: non si sa se `@nome#2` indirizzi
	 * qualcosa, e due risposte con due label dallo stesso participant restano
	 * senza spiegazione nella stanza.
	 *
	 * Componente unico perché il badge va in ogni elenco di participant (lista
	 * topic, sidebar del canale, autore del messaggio, registry agent): una
	 * copia per elenco è il modo in cui il prossimo elenco nasce senza badge.
	 *
	 * Accessibilità: l'emoji non è mai l'unico canale — `role="img"` +
	 * `aria-label` danno il testo che il `title` mostra col mouse.
	 */
	import { seedName } from '$lib/agents';

	/** Nome del participant (accetta anche la label istanza `nome#2`). */
	export let name: string;
	/** Cap di istanze concorrenti (`max_spawns`). null/assente = non dichiarato. */
	export let maxSpawns: number | null | undefined = null;

	$: seed = seedName(name);
	$: label =
		`lavora con istanze multiple (@${seed}#1, @${seed}#2, …)` +
		(maxSpawns && maxSpawns > 0 ? ` — fino a ${maxSpawns} spawn concorrenti` : '');
</script>

<span class="multi-spawn" role="img" aria-label={label} title={label}>👯</span>

<style>
	.multi-spawn {
		display: inline-block;
		font-size: 0.9em;
		line-height: 1;
		cursor: help;
	}
</style>
