/** Helper sui NOMI degli agent, condivisi fra componenti e rotte. */

/** Seed noti dell'istanza, per disambiguare il taglio di `nome-N`. */
let seeds = new Set<string>();

/**
 * Registra i seed noti (dal payload `/api/agents`). Serve a `seedName`: il
 * taglio di `-N` è ambiguo di suo, perché i nomi dei seed contengono trattini.
 * `security-engineer-1` va tagliato dopo `engineer`, non dopo `security`, e
 * senza sapere quali seed esistono non lo si può decidere.
 *
 * Si tiene qui e non in un prop perché `seedName` è chiamata da `AgentAvatar`,
 * che è annidato ovunque: passare la lista lungo tutta la gerarchia per una
 * riscrittura di nome sarebbe più codice in più posti dello stesso problema.
 */
export function setKnownSeeds(names: Iterable<string>): void {
	seeds = new Set(names);
}

/**
 * Il SEED dietro l'etichetta di uno spawn.
 *
 *   `clodia-124`        → `clodia`      (numero di SPAWN, progressivo per seed)
 *   `fullstack-dev#2`   → `fullstack-dev` (ordinale di CANALE, forma storica)
 *   `clodia`            → `clodia`
 *
 * Le due forme convivono di proposito: `-N` è ciò che si mostra (identità vera,
 * mai riusata), `#N` sta scritto nei messaggi già inviati e nella memoria degli
 * agenti, quindi va ancora capito — smettere di capirlo trasformerebbe una
 * menzione storica in un tag che non risolve.
 *
 * `-N` si taglia SOLO se il prefisso è un seed noto: altrimenti un agente
 * chiamato `tomato-2` diventerebbe l'istanza 2 di un `tomato` inesistente. È la
 * stessa regola di `channels._split_ord` lato backend, che consulta il registry.
 * Senza seed registrati non si indovina: si taglia solo `#N`.
 *
 * Vive qui perché la stessa riscrittura serve in tre punti (avatar, badge
 * multi-spawn, autore del messaggio): tre copie sono tre posti in cui il giorno
 * che l'ordinale cambia forma uno resta indietro.
 */
export function seedName(name: string | null | undefined): string {
	const n = (name || '').replace(/#\d+$/, '');
	const m = n.match(/^(.+)-\d+$/);
	if (m && seeds.has(m[1])) return m[1];
	return n;
}
