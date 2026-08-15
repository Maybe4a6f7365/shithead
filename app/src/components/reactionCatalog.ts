import type {
  BroadcastId,
  EmoteId,
  OndraMessageId,
  PlayerLeftMessageId,
} from '../engine/protocol'

export interface ReactionOption {
  id: EmoteId
  label: string
  asset: string
}

const reaction = (id: EmoteId, label: string): ReactionOption => ({
  id,
  label,
  asset: `/reactions/${id}.svg`,
})

/**
 * Product copy stays separate from the stable wire ids. The art is locally
 * bundled so a reaction never falls back to a platform-dependent glyph.
 */
export const REACTION_OPTIONS: readonly ReactionOption[] = [
  reaction('thumbs-up', 'Nice'),
  reaction('laugh', 'Laughing'),
  reaction('wow', 'Shocked'),
  reaction('fire', 'Fire'),
  reaction('sad', 'Sad'),
  reaction('cry', 'Sobbing'),
  reaction('heart', 'Love it'),
  reaction('clap', 'Applause'),
  reaction('angry', 'Angry'),
  reaction('rage', 'Raging'),
  reaction('middle-finger', 'Middle finger, medium-dark skin tone'),
  reaction('clown', 'Clown'),
  reaction('skull', 'Dead'),
  reaction('poop', 'Well, shit'),
  reaction('eyes', 'Watching'),
  reaction('peach', 'Peach'),
  reaction('foot', 'Toes'),
  reaction('melting', 'Melting'),
  reaction('exploding-head', 'Mind blown'),
  reaction('pleading', 'Please'),
  reaction('unamused', 'Unimpressed'),
  reaction('raised-eyebrow', 'Really?'),
  reaction('thinking', 'Thinking'),
  reaction('shushing', 'Shush'),
  reaction('zipper-mouth', 'My lips are sealed'),
  reaction('partying', 'Party'),
  reaction('smiling-devil', 'Mischief'),
  reaction('salute', 'Respect'),
] as const

export const REACTION_BY_ID = Object.fromEntries(
  REACTION_OPTIONS.map(option => [option.id, option]),
) as Record<EmoteId, ReactionOption>

export interface BroadcastOption {
  id: BroadcastId
  text: string
  label: string
}

export const BROADCAST_OPTIONS: readonly BroadcastOption[] = [
  { id: 'double-middle-finger', text: '╭∩╮( •̀_•́ )╭∩╮', label: 'Double salute' },
  { id: 'kiss-my-ass', text: 'kiss my ( ㅅ )', label: 'Kiss my' },
  { id: 'upside-down-fuck', text: 'ʞɔnɟ', label: 'Upside down' },
  { id: 'lenny', text: '( ͠° ͟ʖ ͡°)', label: 'Lenny face' },
  { id: 'karma', text: '☘Karma☠', label: 'Karma' },
  { id: 'shrug', text: '¯\\_(ツ)_/¯', label: 'Shrug' },
  { id: 'womp-womp', text: '𝖜𝖔𝖒𝖕 𝖜𝖔𝖒𝖕', label: 'Womp womp' },
  { id: 'kill-me', text: '𝓴𝓲𝓵𝓵 𝓶𝒆', label: 'Kill me' },
  { id: 'take-it', text: 'Take it.', label: 'Take it' },
] as const

export const BROADCAST_BY_ID = Object.fromEntries(
  BROADCAST_OPTIONS.map(option => [option.id, option]),
) as Record<BroadcastId, BroadcastOption>

export const PLAYER_LEFT_COPY: Record<PlayerLeftMessageId, string> = {
  'bye-little-shits': 'said bye little shits ✌︎︎',
}

export const ONDRA_COPY: Record<OndraMessageId, string> = {
  'ondra-faster': '😫FASTER💦',
  'ondra-love-toes': 'I love toes🦶🏻',
  'ondra-fuck-me': 'ᶠᶸᶜᵏMe𓀐𓂸',
  'ondra-farts-cutely': '*farts cutely🎀*',
  'ondra-alpha': 'i am ᎪᏞᏢᎻᎪㅤ!!!!',
  'ondra-spank-me': '🍑Spank Me',
}
