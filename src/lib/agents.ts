/** Helper sui NOMI degli agent, condivisi fra componenti e rotte. */

/**
 * Il SEED dietro una label di istanza multi-spawn: `fullstack-dev#2` →
 * `fullstack-dev` (issue clodia-platform#94). Un nome senza ordinale torna
 * uguale a sé stesso.
 *
 * Vive qui perché la stessa riscrittura serviva in tre punti (avatar, badge
 * multi-spawn, autore del messaggio): tre copie della stessa regex sono tre
 * posti in cui il giorno che l'ordinale cambia forma resta uno indietro.
 */
export function seedName(name: string | null | undefined): string {
	return (name || '').replace(/#\d+$/, '');
}
