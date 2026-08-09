// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LandingScreen } from '../LandingScreen'

afterEach(cleanup)

function expectExternalDescription(button: HTMLElement) {
  const ids = button.getAttribute('aria-describedby')?.trim().split(/\s+/).filter(Boolean) ?? []
  expect(ids.length).toBeGreaterThan(0)

  for (const id of ids) {
    const description = document.getElementById(id)
    expect(description).not.toBeNull()
    expect(description?.textContent?.trim()).not.toBe('')
    expect(button.contains(description)).toBe(false)
  }
}

describe('landing screen', () => {
  it('keeps its mode actions concise, described, and functional', () => {
    const onPlayOnline = vi.fn()
    const onPassAndPlay = vi.fn()
    render(<LandingScreen onPlayOnline={onPlayOnline} onPassAndPlay={onPassAndPlay} />)

    const online = screen.getByRole('button', { name: 'Online' })
    const offline = screen.getByRole('button', { name: 'Offline' })

    expect(within(online).getByText('Online', { exact: true })).toBeTruthy()
    expect(within(offline).getByText('Offline', { exact: true })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Play online' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Pass & play/i })).toBeNull()
    expectExternalDescription(online)
    expectExternalDescription(offline)

    fireEvent.click(online)
    fireEvent.click(offline)
    expect(onPlayOnline).toHaveBeenCalledTimes(1)
    expect(onPassAndPlay).toHaveBeenCalledTimes(1)
  })

  it('keeps every information destination reachable', () => {
    render(<LandingScreen onPlayOnline={() => {}} onPassAndPlay={() => {}} />)

    const navigation = screen.getByRole('navigation', { name: 'Information' })
    for (const name of ['Rules', 'About', 'Privacy', 'Impressum']) {
      const control = screen.getByRole('button', { name })
      expect(navigation.contains(control)).toBe(true)
    }
  })

  it('moves focus into About, closes on Escape, and restores its trigger', async () => {
    render(<LandingScreen onPlayOnline={() => {}} onPassAndPlay={() => {}} />)

    const trigger = screen.getByRole('button', { name: 'About' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Shithead' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Shithead' })).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})
