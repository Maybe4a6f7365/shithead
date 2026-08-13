// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class AudioStub {
  static instances: AudioStub[] = []
  static rejectPlay = false
  static throwOnPlay = false

  readonly src: string
  preload = ''
  loop = false
  currentTime = 12
  volume = 1

  play = vi.fn(() => {
    if (AudioStub.throwOnPlay) throw new Error('play failed')
    if (AudioStub.rejectPlay) return Promise.reject(new Error('autoplay blocked'))
    return Promise.resolve()
  })

  pause = vi.fn()
  addEventListener = vi.fn()

  constructor(src = '') {
    this.src = src
    AudioStub.instances.push(this)
  }
}

beforeEach(() => {
  vi.resetModules()
  AudioStub.instances = []
  AudioStub.rejectPlay = false
  AudioStub.throwOnPlay = false
  vi.stubGlobal('Audio', AudioStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser audio backend', () => {
  it('starts muted, then maps the turn cue and ignores names without assets', async () => {
    const { emitSound, installBrowserAudioBackend, setSoundMuted } = await import('../soundManager')

    installBrowserAudioBackend()
    emitSound('turn_yours')
    expect(AudioStub.instances).toHaveLength(0)

    setSoundMuted(false)
    emitSound('turn_yours')

    expect(AudioStub.instances).toHaveLength(1)
    expect(AudioStub.instances[0].src).toBe('/audio/turn-notification.mp3')
    expect(AudioStub.instances[0].preload).toBe('auto')
    expect(AudioStub.instances[0].volume).toBe(0.55)
    expect(AudioStub.instances[0].loop).toBe(false)
    expect(AudioStub.instances[0].currentTime).toBe(0)
    expect(AudioStub.instances[0].play).toHaveBeenCalledOnce()

    emitSound('deal')
    expect(AudioStub.instances).toHaveLength(1)
  })

  it('maps both selectable ADHD sounds as one-shots and stops playback idempotently', async () => {
    const { emitSound, installBrowserAudioBackend, setSoundMuted, stopSound } = await import('../soundManager')
    installBrowserAudioBackend()
    setSoundMuted(false)

    emitSound('turn_attention_beat')
    const audio = AudioStub.instances[0]
    expect(audio.src).toBe('/audio/attention-alert.mp3')
    expect(audio.loop).toBe(false)
    expect(audio.volume).toBe(0.25)
    expect(audio.play).toHaveBeenCalledOnce()

    stopSound('turn_attention_beat')
    stopSound('turn_attention_beat')
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(audio.loop).toBe(false)
    expect(audio.currentTime).toBe(0)

    emitSound('turn_attention_chime')
    expect(AudioStub.instances[1].src).toBe('/audio/turn-notification.mp3')
    expect(AudioStub.instances[1].volume).toBe(0.55)
    expect(AudioStub.instances[1].loop).toBe(false)
  })

  it('swallows rejected and synchronous play failures', async () => {
    const { emitSound, installBrowserAudioBackend, setSoundMuted } = await import('../soundManager')
    installBrowserAudioBackend()
    setSoundMuted(false)

    AudioStub.rejectPlay = true
    expect(() => emitSound('turn_yours')).not.toThrow()
    await Promise.resolve()
    expect(AudioStub.instances[0].loop).toBe(false)

    AudioStub.throwOnPlay = true
    expect(() => emitSound('turn_attention_beat')).not.toThrow()
    expect(AudioStub.instances[1].loop).toBe(false)
  })

  it('mutes every sound path and immediately stops an active one-shot', async () => {
    const {
      emitSound,
      installBrowserAudioBackend,
      setSoundMuted,
    } = await import('../soundManager')
    installBrowserAudioBackend()
    setSoundMuted(false)

    emitSound('turn_attention_beat')
    const alarm = AudioStub.instances[0]
    setSoundMuted(true)
    expect(alarm.pause).toHaveBeenCalledOnce()
    expect(alarm.loop).toBe(false)

    emitSound('turn_yours')
    emitSound('turn_attention_beat')
    expect(AudioStub.instances).toHaveLength(1)
    expect(alarm.play).toHaveBeenCalledOnce()

    setSoundMuted(false)
    emitSound('turn_yours')
    expect(AudioStub.instances[1].src).toBe('/audio/turn-notification.mp3')
  })

  it('forces a reused browser element back to one-shot playback', async () => {
    const { emitSound, installBrowserAudioBackend, setSoundMuted } = await import('../soundManager')
    installBrowserAudioBackend()
    setSoundMuted(false)

    emitSound('turn_attention_beat')
    const audio = AudioStub.instances[0]
    audio.loop = true

    emitSound('turn_attention_beat')

    expect(audio.loop).toBe(false)
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  it('keeps a newer replay stoppable when an older play promise rejects late', async () => {
    const { emitSound, installBrowserAudioBackend, setSoundMuted, stopSound } = await import('../soundManager')
    installBrowserAudioBackend()
    setSoundMuted(false)

    emitSound('turn_attention_beat')
    const audio = AudioStub.instances[0]
    let rejectOlderPlay!: (reason?: unknown) => void
    audio.play.mockReset()
    audio.play
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOlderPlay = reject }))
      .mockResolvedValueOnce(undefined)

    emitSound('turn_attention_beat')
    emitSound('turn_attention_beat')
    rejectOlderPlay(new Error('older play blocked'))
    await Promise.resolve()
    stopSound('turn_attention_beat')

    expect(audio.pause).toHaveBeenCalledTimes(3)
    expect(audio.currentTime).toBe(0)
  })
})
