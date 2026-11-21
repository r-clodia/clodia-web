/**
 * The context-reset marker of a channel (`resetChannelContext` posts it as a
 * `system` message). Read in ONE place by the topic page and the helpdesk
 * widget, so the two never disagree on where the current conversation starts.
 */
import type { ChannelMessage } from '$lib/api/client';

export const CONTEXT_RESET_MARKER = '__CLODIA_CONTEXT_RESET__';

export function isContextReset(m: Pick<ChannelMessage, 'kind' | 'text'>): boolean {
	return m.kind === 'system' && (m.text || '').trim() === CONTEXT_RESET_MARKER;
}

/** The messages after the most recent reset, markers dropped; `reset` says
 *  whether a reset exists at all (the caller shows «Nuova conversazione»). */
export function sinceLastReset(items: ChannelMessage[]): { messages: ChannelMessage[]; reset: boolean } {
	const idx = items.findLastIndex(isContextReset);
	const current = idx >= 0 ? items.slice(idx + 1) : items;
	return { messages: current.filter((m) => !isContextReset(m)), reset: idx >= 0 };
}
