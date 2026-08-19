/**
 * Il testo in streaming che un messaggio persistito ha reso permanente
 * (clodia-platform#250, sopra #243).
 *
 * Con le bolle per blocco il backend chiude un blocco, lo POSTA come messaggio
 * vero, e continua a streammare il blocco successivo nello stesso turno. Il
 * frontend accumula tutti i delta di quel turno in un unico buffer, e riceve
 * l'avviso del messaggio persistito con un poll asincrono: quando la risposta
 * del poll arriva, nel buffer c'è già l'inizio del blocco DOPO.
 *
 * Azzerare il buffer intero — ciò che si faceva prima — cancellava anche quella
 * coda, che nessuno ristreamerà: la bolla live restava senza testo, veniva
 * smontata dal filtro «solo chi ha del testo», e rinasceva al delta seguente.
 * Un lampeggio per blocco, per agente; con più agenti che chiudono blocchi in
 * contemporanea, il lampeggio continuo segnalato da Davide il 18 ago.
 *
 * Qui si toglie dal buffer SOLO il pezzo diventato permanente e si tiene la
 * coda, così la bolla non passa mai per lo stato vuoto e non c'è unmount.
 *
 * Modulo JS e non TS di proposito: `scripts/check-live-bubble-continuity.mjs`
 * lo importa e lo esegue davvero, invece di riscriverne una copia che può
 * divergere da ciò che gira (`allowJs`/`checkJs` sono attivi, i tipi JSDoc
 * passano da svelte-check come quelli di un `.ts`).
 */

/**
 * Toglie dal buffer live il testo appena persistito, conservando la coda.
 *
 * @param {string} reply     buffer live accumulato dai delta
 * @param {string} persisted testo del messaggio persistito (già `strip`ato dal backend)
 * @returns {string} ciò che resta da mostrare come "live"
 *
 * Il confronto è per SOTTOSTRINGA e non per prefisso stretto perché fra due
 * blocchi lo stream porta un separatore (`_BlockFilter`) che il messaggio
 * persistito non ha. Se il testo non si ritrova nel buffer — buffer più corto
 * del messaggio (delta persi, pagina aperta a metà turno), o messaggio che non
 * viene da questo stream (post via tool) — si torna al comportamento vecchio,
 * cioè si svuota: meglio una bolla in meno che lo stesso testo due volte.
 */
export function consumePersisted(reply, persisted) {
	if (!reply) return '';
	const testo = (persisted || '').trim();
	if (!testo) return reply;
	const at = reply.indexOf(testo);
	if (at < 0) return '';
	return reply.slice(at + testo.length).replace(/^\s+/, '');
}

/**
 * Come `consumePersisted`, per tutti i messaggi arrivati in un solo giro di
 * poll: un turno può chiuderne più di uno fra due poll, e vanno consumati
 * NELL'ORDINE in cui sono stati pubblicati.
 *
 * @param {string} reply
 * @param {readonly string[]} persistedTexts
 * @returns {string}
 */
export function consumePersistedAll(reply, persistedTexts) {
	let resto = reply;
	for (const testo of persistedTexts) {
		if (!resto) return '';
		resto = consumePersisted(resto, testo);
	}
	return resto;
}
