/**
 * L'aritmetica che decide fra «vedilo intero» e «scorrilo».
 *
 * Non è un test del browser: è un test della SOGLIA, che è la parte che si può
 * sbagliare ragionando. La prima versione contava le schermate e mandava a
 * scorrere una cover 1200×1500 — proprio il caso per cui il fit esisteva.
 * L'ha trovata questo file prima che lo facesse qualcuno guardando lo schermo.
 *
 * La costante qui e quella in `src/lib/artifact-frame.ts` devono restare
 * uguali: se cambia una sola, questo file smette di verificare ciò che gira.
 *
 *     node scripts/check-artifact-fit.mjs
 */
const Z = 0.45;   // = MIN_ZOOM_INTERO in src/lib/artifact-frame.ts
function zoom(w, h, iw, ih) {
  let z = Math.min(iw / w, 1);
  const zi = Math.min(z, ih / h);
  if (zi >= Z) z = zi;
  return z;
}
const casi = [
  ["cover 1200×1500, schermo intero", 1200, 1500, 1024, 720, "intera"],
  ["diagramma 2000×800", 2000, 800, 1024, 720, "intero"],
  ["pagina A4 di testo", 1200, 1700, 1024, 720, "scorre"],
  ["documento 10 pagine, pannello", 1200, 15000, 360, 260, "scorre"],
  ["documento 10 pagine, schermo intero", 1200, 15000, 1024, 720, "scorre"],
  ["slide 16:9 1920×1080", 1920, 1080, 1024, 720, "intera"],
];
let ko = 0;
for (const [nome, w, h, iw, ih, atteso] of casi) {
  const z = zoom(w, h, iw, ih);
  const entra = h * z <= ih + 1;
  const esito = entra ? "intera" : "scorre";
  const ok = (atteso === "scorre") === (esito === "scorre");
  console.log(`${ok ? "ok  " : "KO  "} ${nome}: zoom ${z.toFixed(2)} → ${esito} (atteso ${atteso})`);
  if (!ok) ko++;
}
console.log(ko ? `FALLITI: ${ko}` : "tutti i casi come atteso");
if (ko) process.exit(1);
