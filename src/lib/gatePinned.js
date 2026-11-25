/**
 * The undecided gates of a room, pinned at the top of its chat (owner, 25 Nov
 * 2026, clodia-platform#736): a request nobody has answered must stay in view,
 * not scroll away with the conversation. Pure, in `.js` so the guard script can
 * execute it.
 */

/**
 * @typedef {{ agent: string, instance?: string, verb: string, chat?: string | null,
 *             mode?: string, reason?: string, at?: number }} PendingRequest
 */

/**
 * The pending requests asked from THIS room, oldest first, each with the
 * `agent|instance|verb` id the gate cards use.
 * @param {PendingRequest[] | null | undefined} requests  `/api/gate/pending`
 * @param {string} tier
 * @param {string} name
 */
export function pinnedGates(requests, tier, name) {
	const prefix = `chan:${tier}:${name}:`;
	return (requests || [])
		.filter((q) => q && typeof q.chat === 'string' && q.chat.startsWith(prefix))
		.map((q) => ({
			id: `${q.agent}|${q.instance || '-'}|${q.verb}`,
			agent: q.agent,
			instance: q.instance || '-',
			verb: q.verb,
			mode: q.mode === 'async' ? 'async' : 'sync',
			reason: String(q.reason || ''),
			at: Number(q.at || 0)
		}))
		.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/**
 * The three answers of an ASYNC gate (a courier send): deny, authorise in
 * this channel, authorise in all channels — the last only for an admin, who
 * alone may write the global list.
 * @param {boolean} isAdmin
 * @returns {{ label: string, cell: { who: 'all', where: 'chat' | 'global' } }[]}
 */
export function asyncChoices(isAdmin) {
	return [
		{ label: 'Autorizza nel canale', cell: { who: /** @type {'all'} */ ('all'), where: /** @type {'chat'} */ ('chat') } },
		...(isAdmin ? [{ label: 'Autorizza in tutti i canali', cell: { who: /** @type {'all'} */ ('all'), where: /** @type {'global'} */ ('global') } }] : [])
	];
}
