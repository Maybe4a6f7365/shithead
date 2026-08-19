import { describe, expect, it } from 'vitest'
import {
  addRecentCustomMessage,
  MAX_RECENT_CUSTOM_MESSAGES,
} from './customMessageHistory'

describe('custom message history', () => {
  it('stores canonical messages most-recent-first without mutating the input', () => {
    const current = ['Older message']
    const next = addRecentCustomMessage(current, '  Héllo   table 👋  ')

    expect(next).toEqual(['Héllo table 👋', 'Older message'])
    expect(current).toEqual(['Older message'])
  })

  it('promotes an existing message instead of duplicating it', () => {
    expect(addRecentCustomMessage(['Second', 'First', 'Third'], ' First ')).toEqual([
      'First',
      'Second',
      'Third',
    ])
  })

  it('ignores invalid text and caps the unique history', () => {
    expect(addRecentCustomMessage(['Keep me'], '\u200b\u2060')).toEqual(['Keep me'])

    const messages = Array.from(
      { length: MAX_RECENT_CUSTOM_MESSAGES + 2 },
      (_, index) => `Message ${index + 1}`,
    )
    const history = messages.reduce<string[]>(
      (current, message) => addRecentCustomMessage(current, message),
      [],
    )

    expect(history).toEqual(['Message 7', 'Message 6', 'Message 5', 'Message 4', 'Message 3'])
  })
})
