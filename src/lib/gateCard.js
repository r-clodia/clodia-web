/**
 * Stato di una card di gate: **una card, una richiesta**.
 *
 * Il marcatore in chat porta `agent|instance|verb`, e quella tripla NON
 * identifica una richiesta: l'argomento non ne fa parte. Sette tentativi di
 * `egress.allow` verso destinazioni diverse sono sette messaggi, sette card e
 * una sola tripla.
 *
 * Il 17 ago 2026 è costato sette round a vuoto (clodia-platform#232): l'esito
 * della PRIMA decisione era ricordato sotto la tripla, quindi ogni card
 * successiva nasceva già «decisa» — nessun bottone da premere, mentre il
 * gateway aspettava e l'agente andava in timeout. L'ottavo tentativo, identico
 * ai precedenti, è passato solo perché la pagina era stata ricaricata e quella
 * memoria vive nella pagina.
 *
 * Il difetto grave non è lo stallo, è la frase: una card che dice «approvato»
 * per una richiesta che nessuno ha approvato. Chi guarda si fida di ciò che
 * legge, e quello che legge non è vero. Da qui la regola del dubbio, invertita
 * rispetto a prima: **se non sappiamo, si mostrano i bottoni.** Un bottone di
 * troppo costa un rifiuto leggibile dal backend; un esito inventato costa una
 * decisione di sicurezza che non è stata presa.
 *
 * L'identità di una card è quindi l'**id del messaggio** che la porta: è
 * l'unica cosa, in ciò che la pagina riceve, che sta in corrispondenza uno-a-uno
 * con la richiesta.
 */

/**
 * @typedef {Object} StatoGate
 * @property {Record<string,string>} decisi  esiti presi in questa pagina, per id di MESSAGGIO
 * @property {Set<string>} aperti            triple ancora in coda, da `/api/gate/pending`
 * @property {number} listaTs                quando è arrivata quella lista (ms epoch); 0 = mai
 */

/**
 * @param {StatoGate} stato
 * @param {{ id: string, ts?: string }} msg   il messaggio che porta la card
 * @param {{ id: string }} gate               la tripla letta dal marcatore
 * @returns {'decisa'|'chiusa'|'da-decidere'}
 */
export function gateCardState(stato, msg, gate) {
	// 1. L'esito preso su QUESTA card. L'unico che possiamo attribuire con
	//    certezza a questa richiesta, perché l'abbiamo visto succedere qui.
	if (stato.decisi[msg.id]) return 'decisa';

	// 2. Lista pendenti mai arrivata: non è una lista vuota. Si mostrano i
	//    bottoni — concludere «chiuso» da un'assenza è come chiamare «negato» un
	//    guasto di rete.
	if (!stato.listaTs) return 'da-decidere';

	// 3. C'è una richiesta in coda con questa tripla: qualcosa da decidere
	//    esiste. Può non essere nata da questo messaggio — la tripla non
	//    distingue — ma approvare concede il VERBO, quindi la decisione che si
	//    prende è la stessa. Il backend verifica il titolo su tutte le pendenti.
	if (stato.aperti.has(gate.id)) return 'da-decidere';

	// 4. La coda non contiene la tripla, ma la lista è più VECCHIA del messaggio:
	//    non poteva conoscere questa richiesta. È la finestra fra il messaggio e
	//    il poll successivo — pochi secondi in cui la vecchia logica diceva «già
	//    deciso» a una richiesta appena nata.
	const ts = msg.ts ? Date.parse(msg.ts) : NaN;
	if (Number.isNaN(ts) || ts > stato.listaTs) return 'da-decidere';

	// 5. La coda era aggiornata e questa tripla non c'era: deciso altrove, o
	//    scaduto. Si dice, invece di riproporre bottoni che il backend rifiuta.
	return 'chiusa';
}

/**
 * Registra l'esito di una decisione, e lo attribuisce alla **card** su cui è
 * stata presa.
 *
 * Sta qui accanto a `gateCardState` di proposito: la chiave con cui si SCRIVE e
 * quella con cui si LEGGE devono essere la stessa cosa, e finché le due
 * operazioni vivevano in punti diversi della pagina «la stessa cosa» era la
 * tripla — cioè N richieste sotto un esito solo. Tenerle vicine è ciò che rende
 * il difetto visibile a un controllo eseguibile invece che a un incidente.
 *
 * @param {Record<string,string>} decisi
 * @param {{ id: string }} msg
 * @param {string} esito
 * @returns {Record<string,string>} una nuova mappa (la reattività vuole un nuovo oggetto)
 */
export function recordDecision(decisi, msg, esito) {
	return { ...decisi, [msg.id]: esito };
}

/**
 * La DESTINAZIONE di un gate di confine, per mostrarla sulla card.
 *
 * I verbi di destinazione arrivano come `egress:<canale>:<uri>` (per esempio
 * `egress:email:mailto:hr@x.io`): l'URI è dentro il verbo, e la card lo
 * stampava tutto attaccato in un `<code>`. Chi approva ha diritto di leggere
 * **verso cosa** sta aprendo, non solo che si tratta di «egress».
 *
 * Per un gate su un'AZIONE (`egress.allow`, `topic.put`) la destinazione non
 * c'è: l'argomento non viaggia nel marcatore. Qui si restituisce `null` e non
 * si inventa niente — la card mostra il verbo e basta. Portare l'argomento
 * dentro il marcatore è lavoro del gateway, ed è il residuo dichiarato di #232.
 *
 * @param {string} verb
 * @returns {{ direzione: string, canale: string, dest: string } | null}
 */
export function gateDestination(verb) {
	const m = /^(egress|ingress):([^:]+):(.+)$/.exec(verb || '');
	if (!m) return null;
	return { direzione: m[1], canale: m[2], dest: m[3] };
}
