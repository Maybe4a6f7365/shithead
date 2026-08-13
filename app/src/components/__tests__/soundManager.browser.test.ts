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
  it('maps the turn cue and ignores sound names without shipped assets', async () => {
    const { emitSound, installBrowserAudioBackend } = await import('../soundManager')

    installBrowserAudioBackend()
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

  it('maps both selectable ADHD sounds and stops a loop idempotently', async () => {
    const { startLoopingSound, stopSound } = await import('../soundManager')

    startLoopingSound('turn_attention_beat')
    const audio = AudioStub.instances[0]
    expect(audio.src).toBe('/audio/attention-alert.mp3')
    expect(audio.loop).toBe(true)
    expect(audio.volume).toBe(0.25)
    expect(audio.play).toHaveBeenCalledOnce()

    stopSound('turn_attention_beat')
    stopSound('turn_attention_beat')
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(audio.loop).toBe(false)
    expect(audio.currentTime).toBe(0)

    startLoopingSound('turn_attention_blast')
    expect(AudioStub.instances[1].src).toBe('/audio/attention-blast.mp3')
    expect(AudioStub.instances[1].volume).toBe(0.22)
    expect(AudioStub.instances[1].loop).toBe(true)
  })

  it('swallows rejected and synchronous play failures', async () => {
    const { emitSound, installBrowserAudioBackend, startLoopingSound } = await import('../soundManager')
    installBrowserAudioBackend()

    AudioStub.rejectPlay = true
    expect(() => emitSound('turn_yours')).not.toThrow()
    await Promise.resolve()
    expect(AudioStub.instances[0].loop).toBe(false)

    AudioStub.throwOnPlay = true
    expect(() => startLoopingSound('turn_attention_beat')).not.toThrow()
    expect(AudioStub.instances[1].loop).toBe(false)
  })

  it('mutes every sound path and immediately stops an active loop', async () => {
    const {
      emitSound,
      installBrowserAudioBackend,
      setSoundMuted,
      startLoopingSound,
    } = await import('../soundManager')
    installBrowserAudioBackend()

    startLoopingSound('turn_attention_beat')
    const alarm = AudioStub.instances[0]
    setSoundMuted(true)
    expect(alarm.pause).toHaveBeenCalledOnce()
    expect(alarm.loop).toBe(false)

    emitSound('turn_yours')
    startLoopingSound('turn_attention_beat')
    expect(AudioStub.instances).toHaveLength(1)
    expect(alarm.play).toHaveBeenCalledOnce()

    setSoundMuted(false)
    emitSound('turn_yours')
    expect(AudioStub.instances[1].src).toBe('/audio/turn-notification.mp3')
  })
})
