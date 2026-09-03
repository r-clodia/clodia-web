/**
 * Quanto spesso ripollare, e quando non ripollare affatto.
 *
 * Il polling del topic esisteva a intervallo FISSO di 5 secondi, quattro
 * chiamate per ciclo, per ogni scheda aperta. Misurato il 3 set 2026 con tre
 * topic aperti: **594 richieste in tre minuti**, ~200 al minuto. Il server le
 * regge senza fatica (25 ms per chiamata, gateway all'11% di CPU) — a pagarle
 * era il BROWSER: la sola scheda di un canale con 397 messaggi scaricava
 * 368.546 caratteri dodici volte al minuto, circa 5,4 MB/min di JSON da
 * parsare, più il markdown di 200 messaggi da ri-renderizzare ogni volta. Con
 * tre schede, per tre.
 *
 * Il polling serve, e non si toglie: è la CINTURA che recupera gli eventi persi
 * dallo stream SSE — una connessione caduta, un turno nato fra due eventi, un
 * agente che lavora in silenzio dentro una tool-call. `active_responders` è la
 * sola cosa che sappia davvero se un turno è finito. Quello che non serve è
 * stringere la cintura ogni cinque secondi su una stanza dove non parla nessuno,
 * e su una scheda che nessuno sta guardando.
 *
 * Tre stati, quindi, invece di un intervallo unico:
 *   - scheda non visibile        -> NON pollare (null)
 *   - turno attivo o appena vivo -> 5 s, come prima
 *   - stanza quieta              -> 30 s, poi 60 s
 *
 * Modulo JS e non TS di proposito, come `$lib/liveReply` e `$lib/turnGrouping`:
 * `scripts/check-polling-adattivo.mjs` lo importa e lo esegue davvero.
 */

/** Ciclo pieno: c'è un turno in corso, o ne è appena finito uno. */
export const POLL_ATTIVO_MS = 5_000;
/** La stanza è ferma da un po': la cintura può allentarsi. */
export const POLL_QUIETE_MS = 30_000;
/** Ferma da molto: una volta al minuto basta a non perdere niente. */
export const POLL_LUNGA_MS = 60_000;

/** Sotto questa soglia dall'ultimo segno di vita si resta reattivi. */
export const SOGLIA_TIEPIDO_MS = 2 * 60_000;
/** Oltre questa, si passa al giro lungo. */
export const SOGLIA_FREDDO_MS = 10 * 60_000;

/**
 * Il prossimo intervallo di polling, in millisecondi, o `null` per non pollare.
 *
 * @param {object} stato
 * @param {boolean} stato.visibile        la scheda è in primo piano?
 * @param {boolean} [stato.turnoAttivo]   un responder sta lavorando adesso?
 * @param {number}  [stato.msDaUltimoSegno] da quanto non arriva un evento/messaggio
 * @returns {number|null}
 */
export function pollDelay({ visibile, turnoAttivo = false, msDaUltimoSegno = 0 }) {
	// Una scheda in background non deve scaricare niente. È il caso che pesava
	// di più — tre topic aperti sono tre cicli completi — e nessuno stava
	// guardando due di quei tre. Al ritorno in primo piano si fa UN refresh
	// immediato (vedi `onVisibile` nella pagina), quindi non si perde nulla:
	// si smette solo di chiedere a chi non guarda.
	if (!visibile) return null;
	// Un turno in corso è l'unico momento in cui cinque secondi sono pochi.
	if (turnoAttivo) return POLL_ATTIVO_MS;
	if (msDaUltimoSegno < SOGLIA_TIEPIDO_MS) return POLL_ATTIVO_MS;
	if (msDaUltimoSegno < SOGLIA_FREDDO_MS) return POLL_QUIETE_MS;
	return POLL_LUNGA_MS;
}

/** Canvas live presente: si vuole vedere cambiare mentre l'agente lo scrive. */
export const ARTIFACT_PRESENTE_MS = 2_000;
/** Canvas assente: non c'è nulla da guardare cambiare. */
export const ARTIFACT_ASSENTE_MS = 20_000;

/**
 * Ogni quanto richiedere l'artefatto del canale.
 *
 * `ArtifactCanvas` chiedeva `files/artifact.html` ogni 2 secondi anche quando
 * quel file non esiste, ed è corretto che lo faccia — è così che il pannello
 * «appare da solo» quando un agente lo produce. Ma su un canale senza artefatto
 * sono 30 richieste al minuto che rispondono 404: nei log dell'agent-server ne
 * ho contate **5073** in tre ore. Due secondi servono a vedere un canvas
 * CAMBIARE; a scoprire che è NATO bastano venti.
 *
 * @param {object} stato
 * @param {boolean} stato.visibile
 * @param {boolean} [stato.esiste]  l'artefatto c'era all'ultimo giro?
 * @returns {number|null}
 */
export function artifactDelay({ visibile, esiste = false }) {
	if (!visibile) return null;
	return esiste ? ARTIFACT_PRESENTE_MS : ARTIFACT_ASSENTE_MS;
}
