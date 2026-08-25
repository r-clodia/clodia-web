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

/**
 * Sotto quale chiave della mappa live va sottratto un messaggio persistito
 * (clodia-platform#294).
 *
 * Le due parti parlano DUE VOCABOLARI, come già altrove nella piattaforma
 * (#260, #286, #257, e la nota su `activeWorking` in questa stessa pagina):
 *   - la mappa live è indicizzata per SPAWN (`fullstack-dev-71`), perché la
 *     chiave arriva dall'evento `spawn_label` del turno;
 *   - l'autore di un messaggio persistito è il SEED (`fullstack-dev`) ogni
 *     volta che il testo è stato pubblicato via tool gateway — il backend
 *     confronta per seed apposta (`_new_ai_messages`).
 * Cercare l'autore grezzo dentro una mappa per spawn non trova niente: la
 * sottrazione non avviene, il buffer resta col testo già persistito dentro, e
 * la riconciliazione torna a smontare/rimontare la bolla. Cioè il lampeggio di
 * #250 che rientra dalla porta di servizio.
 *
 * `seedOf` si riceve dal chiamante invece di importare `$lib/agents`: quella
 * funzione ha bisogno dei seed noti registrati a runtime (`setKnownSeeds`), e
 * riceverla permette al guard di eseguire QUESTA funzione davvero.
 *
 * Con più spawn dello stesso seed vivi insieme (`multi_spawn`, #94) il seed non
 * basta a scegliere: si guarda quale buffer contiene davvero il testo appena
 * persistito. Se resta ambiguo — o non lo contiene nessuno — si torna `null` e
 * NON si tocca niente: sottrarre dal buffer sbagliato cancellerebbe il testo di
 * un altro spawn, che nessuno ristreamerà. Meglio una bolla che sfarfalla di
 * una risposta che sparisce.
 *
 * @param {Record<string, {reply?: string}>} live      mappa live, per SPAWN
 * @param {string} autore                              autore del messaggio persistito (seed o spawn)
 * @param {(n: string) => string} seedOf               riduzione nome → seed
 * @param {readonly string[]} [persistiti]             testi appena persistiti, per disambiguare
 * @returns {string|null} la chiave da aggiornare, o `null` se non si può decidere
 */
export function resolveLiveKey(live, autore, seedOf, persistiti = []) {
	if (!autore || !live) return null;
	if (live[autore]) return autore; // stesso vocabolario: niente da tradurre
	const seed = seedOf(autore);
	const candidati = Object.keys(live).filter((k) => seedOf(k) === seed);
	if (candidati.length <= 1) return candidati[0] ?? null;
	// multi_spawn: decide il testo, non il nome.
	const testo = (persistiti.find((t) => (t || '').trim()) || '').trim();
	if (!testo) return null;
	const conTesto = candidati.filter((k) => (live[k]?.reply || '').includes(testo));
	return conTesto.length === 1 ? conTesto[0] : null;
}
