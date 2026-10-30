/**
 * Which installed pack an MCP server pasted in «Add MCP server» belongs to
 * (clodia-platform#641).
 *
 * A zip-imported pack declares its MCP servers but the gateway leaves them
 * `pending` until an admin mounts them FOR that pack (`POST /tools/mcp` with
 * `pack`). The gateway is the one that decides (the pack must be installed and
 * its manifest must name every server); this module only proposes the choice.
 *
 * Pure derivations, in `.js` so the guard script can execute them.
 */

/** @typedef {{name: string, disabled?: boolean,
 *             plugins?: ReadonlyArray<{missing?: boolean, mcp_servers?: ReadonlyArray<{name: string}>}>}} PackLike */

/**
 * The server names in a pasted mcp.json, or `[]` while it does not parse.
 * @param {string} text
 * @returns {string[]}
 */
export function nomiServerMcp(text) {
	try {
		const j = JSON.parse(text);
		const servers = j && typeof j === 'object' ? j.mcpServers : null;
		if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
		return Object.keys(servers);
	} catch {
		return [];
	}
}

/**
 * The MCP server names a pack declares through its plugins. Connector
 * relay/pairing backends are not in the pack listing: for those the gateway
 * still decides, and the page falls back to listing every pack.
 * @param {PackLike} p
 * @returns {Set<string>}
 */
export function serverDichiarati(p) {
	const out = new Set();
	for (const pl of p.plugins ?? []) {
		if (!pl || pl.missing) continue;
		for (const s of pl.mcp_servers ?? []) if (s?.name) out.add(String(s.name));
	}
	return out;
}

/**
 * The packs to offer for these server names, and the one to preselect.
 *
 * - Disabled packs are left out: the gateway treats them as absent.
 * - When some pack declares at least one of the names, only those packs are
 *   offered; the one declaring ALL of them is preselected when it is unique.
 * - When none does (no names yet, or servers declared only as a connector
 *   backend), every installed pack is offered and nothing is preselected.
 * @param {ReadonlyArray<PackLike>} packs
 * @param {string[]} nomi
 * @returns {{opzioni: {name: string, dichiara: string[]}[], preselezione: string}}
 */
export function packPerServer(packs, nomi) {
	const attivi = (packs ?? []).filter((p) => p && p.name && !p.disabled);
	const conNomi = attivi.map((p) => {
		const d = serverDichiarati(p);
		return { name: p.name, dichiara: nomi.filter((n) => d.has(n)) };
	});
	const candidati = conNomi.filter((p) => p.dichiara.length > 0);
	if (candidati.length === 0) {
		return { opzioni: conNomi.map((p) => ({ name: p.name, dichiara: [] })), preselezione: '' };
	}
	const completi = candidati.filter((p) => nomi.length > 0 && p.dichiara.length === nomi.length);
	return { opzioni: candidati, preselezione: completi.length === 1 ? completi[0].name : '' };
}

/**
 * The body of `POST /tools/mcp`: `pack` only when one was chosen.
 * @param {unknown} config
 * @param {string} pack
 */
export function corpoRegistrazione(config, pack) {
	return pack ? { config, pack } : { config };
}
