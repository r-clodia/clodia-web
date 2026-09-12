#!/usr/bin/env node
/**
 * La member list di una collection RAG si legge a schermo, e non mente sui suoi
 * vuoti (clodia-platform#341, backend clodia-logic#413).
 *
 * `GET /clodia/datastores` porta su ogni riga di `rag_collections` — attiva o
 * orfana — tre campi CALCOLATI dai grant `rag_read`/`rag_write` dei seed:
 * `seeds_read`, `seeds_write`, `seeds_bypass`. Il backend li manda SEMPRE tutti
 * e tre, anche vuoti, e li ordina già per nome.
 *
 * Qui la resa può sbagliare in quattro modi, e nessuno di loro è un errore di
 * tipo — compilano tutti, e tre su quattro dicono a schermo una cosa falsa:
 *
 *   1. non renderla affatto: la pagina Databases tace su chi raggiunge quei
 *      dati, che è esattamente ciò che la #341 chiede di mostrare;
 *   2. rendere `[]` come un vuoto ambiguo (una cella bianca, un «—»): qui la
 *      lista è calcolata, quindi `[]` è una RISPOSTA — «nessun seed dichiara
 *      quel grant» — e va scritta. È la differenza con il `seeds:` di un
 *      datastore, che arriva dal manifest e quando manca vuol dire «non
 *      dichiarato»;
 *   3. mettere il bypass in mezzo ai membri, o ometterlo: chi copre `rag.*`
 *      (sysadmin, il provisioner dei pack) entra senza essere in lista. Una
 *      `seeds_read` vuota accanto a `seeds_bypass: ["sysadmin"]` NON significa
 *      «nessuno la legge», e mostrarlo come membro direbbe il falso opposto;
 *   4. fondere lettura e scrittura in un elenco solo, o riordinarle in UI: chi
 *      ingesta non è chi consulta, e una lista che cambia posizione a ogni
 *      reload si legge come un cambio di autorizzazioni.
 *
 * Perché una guard e non un test: in questo repo la resa non ha DOM da
 * asserire, e il difetto peggiore della famiglia (il punto 1) non fallisce —
 * RIMUOVE. Non c'è niente da interrogare quando la sezione non esiste.
 *
 * LIMITE DICHIARATO: guarda il TESTO del componente, non il DOM reso. Una
 * riscrittura che ottiene lo stesso silenzio per un'altra strada (un componente
 * estratto, una variabile intermedia) passa verde. Copre le forme difettose
 * letterali, non ogni modo di tacere.
 *
 *     node scripts/check-rag-member-list.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const PAGINA = 'src/routes/databases/+page.svelte';
const TIPI = 'src/lib/api/types.ts';
const CAMPI = ['seeds_read', 'seeds_write', 'seeds_bypass'];
const guasti = [];

const src = leggiSorgente(PAGINA, guasti, 'member list delle collection RAG');
if (src !== null) {
	const codice = senzaCommenti(src);

	// 1. I tre campi arrivano a schermo. Senza questo non c'è niente da valutare.
	for (const campo of CAMPI) {
		if (!codice.includes(campo)) {
			guasti.push(
				`${PAGINA}: la riga della collection non rende \`${campo}\` — ` +
					`la pagina tace su chi raggiunge quei dati (clodia-platform#341)`
			);
		}
	}

	// 2. Il vuoto CALCOLATO è scritto, non lasciato in bianco — e il testo deve
	//    stare DENTRO il ramo della lista vuota. Cercarlo nel file e basta
	//    passerebbe verde per la nota in fondo alla pagina, che lo nomina ma non
	//    lo rende su nessuna riga (la trappola tautologica di clodia-web#178).
	const ramoVuoto = /length\s*===\s*0\s*\}[\s\S]{0,200}?[Nn]essun seed dichiarato/.test(codice);
	if (!ramoVuoto) {
		guasti.push(
			`${PAGINA}: il ramo della lista vuota non scrive «nessun seed dichiarato» — ` +
				`una \`seeds_read\`/\`seeds_write\` vuota è una risposta calcolata, ` +
				`non una cella da lasciare in bianco`
		);
	}

	// 3. Il bypass è una riga a parte ed è ETICHETTATO come tale: chi lo legge
	//    deve sapere che quei seed passano senza essere in lista.
	if (!/passano comunque/i.test(codice)) {
		guasti.push(
			`${PAGINA}: \`seeds_bypass\` non dice che quei seed passano comunque — ` +
				`senza etichetta si legge come un terzo gruppo di membri`
		);
	}

	// 4. Due assi distinti, non un elenco unico. Due controlli, perché i modi di
	//    perdere la distinzione sono due: fondere le liste, o smettere di dire
	//    quale è quale (un solo gruppo etichettato «Seed»).
	const fusione =
		/\.\.\.[^;\n]{0,80}seeds_read[^;\n]{0,80}\.\.\.[^;\n]{0,80}seeds_write/.test(codice) ||
		/seeds_write[^;\n]{0,80}\.\.\.[^;\n]{0,80}seeds_read/.test(codice) ||
		/seeds_(?:read|write)[^;\n]{0,40}\.concat\(/.test(codice);
	if (fusione) {
		guasti.push(
			`${PAGINA}: lettura e scrittura finiscono in un elenco unico — ` +
				`chi ingesta non è chi consulta, vanno resi come due gruppi`
		);
	}
	for (const etichetta of ['Lettura', 'Scrittura']) {
		if (!new RegExp(`'${etichetta}'|"${etichetta}"|>${etichetta}<`).test(codice)) {
			guasti.push(
				`${PAGINA}: nessun gruppo etichettato «${etichetta}» — i due assi vanno nominati, ` +
					`altrimenti a schermo restano due liste di seed indistinguibili`
			);
		}
	}

	// 5. L'ordine è già stabile lato backend (seed per nome): riordinarlo qui
	//    farebbe ballare le liste fra un reload e l'altro.
	for (const [intero] of codice.matchAll(
		/seeds_(?:read|write|bypass)[^;\n]{0,120}?\.(?:sort|reverse)\s*\(/g
	)) {
		guasti.push(
			`${PAGINA}: «${intero.trim().slice(0, 90)}» riordina in UI una lista già ordinata per ` +
				`nome dal backend — una lista che cambia posizione si legge come un cambio di ` +
				`autorizzazioni`
		);
	}
}

// 6. Il payload è tipizzato: senza i campi nel tipo, la resa del punto 1 non
//    compila (o compila su `any`) e il guard proteggerebbe una pagina che non
//    riceve niente.
const tipi = leggiSorgente(TIPI, guasti, 'RagCollectionEntry.seeds_*');
if (tipi !== null) {
	const codice = senzaCommenti(tipi);
	for (const campo of CAMPI) {
		if (!new RegExp(`\\b${campo}\\??\\s*:`).test(codice)) {
			guasti.push(`${TIPI}: \`RagCollectionEntry\` non dichiara \`${campo}\``);
		}
	}
}

if (guasti.length) {
	console.error('member list delle collection RAG:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(
	'member list delle collection RAG: letture e scritture distinte, vuoti scritti, bypass a parte ✓'
);
