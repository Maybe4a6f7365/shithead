// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LandingScreen } from '../LandingScreen'

afterEach(() => {
  cleanup()
  document.head.querySelector('meta[name="build-commit"]')?.remove()
})

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
  it('exposes the three game actions with exact names and working callbacks', () => {
    const onPlayOnline = vi.fn()
    const onPassAndPlay = vi.fn()
    render(<LandingScreen onPlayOnline={onPlayOnline} onPassAndPlay={onPassAndPlay} />)

    const online = screen.getByRole('button', { name: 'Play Online' })
    const offline = screen.getByRole('button', { name: 'Play Offline' })
    const rules = screen.getByRole('button', { name: 'Rules' })

    expect(screen.getByRole('heading', { level: 1, name: 'SHITHEAD' })).toBeTruthy()
    expectExternalDescription(online)
    expectExternalDescription(offline)

    fireEvent.click(online)
    fireEvent.click(offline)
    expect(onPlayOnline).toHaveBeenCalledTimes(1)
    expect(onPassAndPlay).toHaveBeenCalledTimes(1)

    fireEvent.click(rules)
    expect(screen.getByRole('dialog', { name: 'Rules' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close rules' }))
    expect(screen.queryByRole('dialog', { name: 'Rules' })).toBeNull()
  })

  it('keeps footer destinations reachable and opens both legal sheets', () => {
    render(<LandingScreen onPlayOnline={() => {}} onPassAndPlay={() => {}} />)

    const navigation = screen.getByRole('navigation', { name: 'Information' })
    for (const name of ['About', 'Privacy', 'Impressum']) {
      const control = screen.getByRole('button', { name })
      expect(navigation.contains(control)).toBe(true)
    }

    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }))
    expect(screen.getByRole('dialog', { name: 'Privacy' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Privacy' }))
    expect(screen.queryByRole('dialog', { name: 'Privacy' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Impressum' }))
    expect(screen.getByRole('dialog', { name: 'Impressum' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Impressum' }))
    expect(screen.queryByRole('dialog', { name: 'Impressum' })).toBeNull()
  })

  it('does not expose prototype status or build details', () => {
    const buildMeta = document.createElement('meta')
    buildMeta.name = 'build-commit'
    buildMeta.content = 'deadbee'
    document.head.append(buildMeta)

    render(<LandingScreen onPlayOnline={() => {}} onPassAndPlay={() => {}} />)

    expect(screen.queryByText('Ready to deal')).toBeNull()
    expect(screen.queryByText('Choose game mode')).toBeNull()
    expect(screen.queryByText('deadbee')).toBeNull()
    expect(screen.queryByLabelText('Build deadbee')).toBeNull()
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
