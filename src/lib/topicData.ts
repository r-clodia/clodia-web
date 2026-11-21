/**
 * What a topic may import from the data catalog (clodia-platform#595, #709):
 * one rule, used by the «Dati» panel and by the «Connetti» popup.
 *
 * Data never moves down a level: only resources at or below the topic tier.
 * Never offered: this topic's own index and the index of an archived topic
 * (owner, 26 Oct 2026).
 */
import type { DataCatalogEntry, TopicDataImport } from '$lib/api/client';

/** SEAL rank; legacy P0..P3 map to SEAL-0..3. Unknown → -1. */
export function tierRank(t: string | undefined): number {
	const m = /^(?:SEAL-|P)(\d)$/.exec(t ?? '');
	return m ? Number(m[1]) : -1;
}

export const dataKey = (kind: string, name: string) => `${kind}:${name}`;

/** Catalog entries this topic may hold: its own index and archived topics'
 *  indexes excluded, tier at or below the topic's. Already imported ones are
 *  included only when `withImported`. */
export function importableEntries(
	catalog: DataCatalogEntry[],
	imports: TopicDataImport[],
	indexCollection: string,
	tier: string,
	withImported = false
): DataCatalogEntry[] {
	const imported = new Set(imports.map((i) => dataKey(i.kind, i.name)));
	return catalog.filter(
		(e) => (withImported || !imported.has(dataKey(e.kind, e.name)))
			&& !(e.kind === 'rag' && !!indexCollection && e.name === indexCollection)
			&& e.topic_status !== 'archived'
			&& tierRank(e.tier) >= 0 && tierRank(e.tier) <= tierRank(tier)
	);
}
