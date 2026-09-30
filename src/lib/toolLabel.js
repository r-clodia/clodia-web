/**
 * Etichetta leggibile di una chiamata a tool nel box di ragionamento
 * (clodia-platform#453).
 *
 * Nel box la riga di un tool era il payload grezzo dell'evento SSE:
 *
 *     mcp__clodia-tools__gdrive_list: {"folder_id": "1fILEzsZFi9rdcuRb9c4ywDMDiCAqCMC5", "limit": 50}
 *
 * — un nome con due prefissi di trasporto davanti e un JSON che, su una riga
 * troncata in coda, finisce per mostrare solo il rumore. Qui diventa:
 *
 *     gdrive_list "1fILEzsZFi9rdcuRb9c4ywDMDiCAqCMC5", 50, …
 *
 * cioè i primi due argomenti POSIZIONALI (senza i nomi delle chiavi) e un `…`
 * che dice «il resto c'è, è nel tooltip». La forma estesa non si perde: la
 * funzione la restituisce insieme alla breve, ed è ciò che il componente mette
 * nel `title` della riga.
 *
 * **Perché un analizzatore tollerante e non `JSON.parse`.** Il riassunto arriva
 * da `_summarize_input` in clodia-logic e NON è quasi mai JSON valido:
 *   - se l'input ha una chiave fra `command`/`path`/`file_path`/`query`/`url`/
 *     `content`/`description`, il backend manda quel solo valore, nudo
 *     (`npm run check`, non `{"command": "npm run check"}`);
 *   - altrimenti serializza in JSON ma **taglia a 120 caratteri**, quindi
 *     l'ultima stringa resta aperta e la graffa non si chiude;
 *   - le sessioni codex/opencode mandano `str(dict)` di Python, con gli apici
 *     SINGOLI.
 * `JSON.parse` fallirebbe proprio sui payload lunghi, cioè quelli che hanno più
 * bisogno di essere accorciati, e ricadrebbe sulla riga grezza. Lo scanner qui
 * sotto legge i primi due valori di primo livello e si ferma: non ha bisogno
 * che il testo finisca, né che le virgolette siano quelle giuste.
 *
 * Modulo JS e non TS di proposito, come `liveBox.js` e `liveReply.js`: così
 * `scripts/check-tool-label-succinta.mjs` importa ed ESEGUE questa funzione
 * invece di riscriverne una copia che può divergere.
 */

/** @typedef {{breve: string, esteso: string}} PassoTool */

/** Argomenti mostrati in forma breve. Due, come chiede la issue: il terzo
 *  allungherebbe la riga proprio dove va tenuta corta. */
export const MAX_ARGS = 2;
/** Tetto di un singolo argomento stringa. 48 tiene interi gli id di Drive
 *  (33 caratteri), che sono il caso della segnalazione. */
export const MAX_ARG = 48;

/** Nome del tool senza i prefissi di trasporto: `mcp__clodia-tools__gdrive_list`
 *  → `gdrive_list`. I tool nativi (`Bash`, `Read`, `Task`) passano invariati.
 *  @param {string} tool */
export function nomeTool(tool) {
	const t = String(tool || '').trim();
	if (!t) return 'tool';
	return t.replace(/^mcp__.*?__/, '') || t;
}

/** @param {string} s */
function taglia(s) {
	return s.length > MAX_ARG ? s.slice(0, MAX_ARG) + '…' : s;
}

/**
 * Indice subito dopo il valore che comincia in `i`.
 * Gestisce stringhe (apici doppi o singoli, con escape), contenitori annidati
 * e scalari nudi. Un valore che il troncamento ha lasciato aperto finisce a
 * fine testo: è il comportamento voluto, non un errore da segnalare.
 * @param {string} s
 * @param {number} i
 */
function fineValore(s, i) {
	const c = s[i];
	if (c === '"' || c === "'") {
		let j = i + 1;
		while (j < s.length) {
			if (s[j] === '\\') j += 2;
			else if (s[j] === c) return j + 1;
			else j++;
		}
		return s.length;
	}
	if (c === '{' || c === '[') {
		let profondita = 0;
		let j = i;
		while (j < s.length) {
			const d = s[j];
			if (d === '"' || d === "'") {
				j = fineValore(s, j);
				continue;
			}
			if (d === '{' || d === '[') profondita++;
			else if (d === '}' || d === ']') {
				profondita--;
				if (profondita === 0) return j + 1;
			}
			j++;
		}
		return s.length;
	}
	let j = i;
	while (j < s.length && !',:}]'.includes(s[j])) j++;
	return j;
}

/** Un valore grezzo nella forma che va in riga.
 *  @param {string} grezzo */
function rendi(grezzo) {
	const g = String(grezzo || '').trim();
	if (!g) return '';
	const c = g[0];
	if (c === '"' || c === "'") {
		const chiuso = g.length > 1 && g[g.length - 1] === c;
		const dentro = g.slice(1, chiuso ? -1 : undefined);
		const pulito = dentro
			.replace(/\\([\\"'])/g, '$1')
			.replace(/\\[nrt]/g, ' ')
			.trim();
		// Stringa lasciata aperta dal taglio a 120 caratteri del backend: la
		// chiudiamo noi, con l'ellissi che dice che manca del testo (a meno che
		// non l'abbia già messa `taglia`).
		const testo = taglia(pulito);
		return `"${testo}${!chiuso && testo === pulito ? '…' : ''}"`;
	}
	// Un contenitore annidato non si srotola: occuperebbe la riga intera e il
	// suo contenuto è esattamente ciò per cui esiste il tooltip.
	if (c === '{') return '{…}';
	if (c === '[') return '[…]';
	return taglia(g);
}

/**
 * I primi `MAX_ARGS` valori di primo livello di un payload `{…}` o `[…]`.
 * `null` se il riassunto non è strutturato (è già un valore solo).
 * @param {string} testo
 * @returns {string[] | null}
 */
function primiValori(testo) {
	const s = String(testo || '').trim();
	const apre = s[0];
	if (apre !== '{' && apre !== '[') return null;
	const chiude = apre === '{' ? '}' : ']';
	const valori = [];
	let i = 1;
	while (i < s.length && valori.length < MAX_ARGS) {
		while (i < s.length && (s[i] === ' ' || s[i] === ',' || s[i] === '\n' || s[i] === '\t')) i++;
		if (i >= s.length || s[i] === chiude) break;
		if (apre === '{') {
			// La chiave si legge e si BUTTA: la issue chiede gli argomenti
			// posizionali, senza nomi. Serve solo per arrivare ai due punti.
			i = fineValore(s, i);
			while (i < s.length && s[i] === ' ') i++;
			if (s[i] !== ':') break; // troncato a metà chiave: niente da mostrare
			i++;
			while (i < s.length && s[i] === ' ') i++;
			if (i >= s.length) break;
		}
		const inizio = i;
		i = fineValore(s, i);
		if (i <= inizio) break;
		const reso = rendi(s.slice(inizio, i));
		if (reso) valori.push(reso);
	}
	return valori;
}

/**
 * Etichetta breve ed estesa di una chiamata a tool.
 *
 * @param {string} tool     nome del tool come arriva dall'evento (`p.tool`)
 * @param {string} [summary] `p.input_summary`, già accorciato dal backend
 * @returns {PassoTool} `breve` per la riga, `esteso` per il tooltip
 */
export function etichettaTool(tool, summary) {
	const nome = nomeTool(tool);
	const grezzo = String(summary ?? '').trim();
	const esteso = grezzo ? `${String(tool || nome)}: ${grezzo}` : String(tool || nome);
	if (!grezzo) return { breve: nome, esteso };

	const valori = primiValori(grezzo);
	if (valori === null) {
		// Riassunto non strutturato: è già IL valore (un comando, un path, una
		// query). Si mostra intero, e l'ellissi compare solo se lo tagliamo —
		// qui, a differenza del caso strutturato, non stiamo nascondendo altro.
		const uno = taglia(grezzo.replace(/\s+/g, ' '));
		return { breve: `${nome} "${uno}"`, esteso };
	}
	if (!valori.length) return { breve: nome, esteso };
	// `…` sempre, sui payload strutturati: anche quando i valori sono due e
	// finiscono lì, i NOMI delle chiavi sono stati tolti. La riga dichiara di
	// essere un estratto; la versione intera è nel tooltip.
	return { breve: `${nome} ${valori.join(', ')}, …`, esteso };
}
