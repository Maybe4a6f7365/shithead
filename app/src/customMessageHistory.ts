import { isValidChatText, normalizeChatText } from './engine/protocol'

/** Keep the reaction menu useful without retaining an unbounded chat log. */
export const MAX_RECENT_CUSTOM_MESSAGES = 5

/**
 * Add one accepted custom message to a unique, most-recent-first list.
 *
 * The helper applies the same canonicalization as the wire protocol so a
 * visually identical message cannot occupy several history slots. Invalid
 * input is ignored defensively even though callers normally pass a trusted
 * server echo or an already-validated local message.
 */
export function addRecentCustomMessage(
  current: readonly string[],
  rawText: string,
): string[] {
  if (!isValidChatText(rawText)) return [...current].slice(0, MAX_RECENT_CUSTOM_MESSAGES)

  const text = normalizeChatText(rawText)
  return [text, ...current.filter(message => message !== text)]
    .slice(0, MAX_RECENT_CUSTOM_MESSAGES)
}
