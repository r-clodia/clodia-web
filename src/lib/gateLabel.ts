/**
 * Come si legge un gate in chiaro: cosa chiede l'agente e su che cosa.
 *
 * La chiave di un gate non è sempre un verbo: `topic-access:<tier>/<name>` è
 * l'accesso a una stanza, `copybrain:<seed>` il prestito dei verbi di un altro
 * seed per uno spawn (clodia-platform#393). La stessa logica era ripetuta a mano
 * in quattro punti; un prefisso nuovo ne avrebbe aggiornati alcuni e non altri.
 */
export type GateLabel = { azione: string; oggetto: string };

export function gateLabel(verb: string): GateLabel {
	const v = verb || '';
	if (v.startsWith('topic-access:')) {
		return { azione: 'vuole accedere al topic', oggetto: v.slice('topic-access:'.length) };
	}
	if (v.startsWith('copybrain:')) {
		// Il consenso vale per lo spawn che lo chiede, fino alla sua fine: dirlo qui
		// è ciò che permette di decidere sapendo quanto dura il sì.
		return {
			azione: 'vuole assumere, per questo spawn e fino alla sua fine, i verbi di',
			oggetto: '@' + v.slice('copybrain:'.length)
		};
	}
	return { azione: 'vuole usare', oggetto: v };
}
