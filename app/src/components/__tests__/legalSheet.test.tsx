// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LandingScreen } from '../LandingScreen'

afterEach(cleanup)

describe('landing legal information', () => {
  it('opens a factual privacy notice from the bottom navigation', () => {
    render(<LandingScreen onPlayOnline={() => {}} onPassAndPlay={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }))
    expect(screen.getByRole('dialog', { name: 'Privacy' })).toBeTruthy()
    expect(screen.getByText(/rotating resume token/i)).toBeTruthy()
    expect(screen.getByText(/does not include advertising, analytics, or user-tracking/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /cloudflare privacy policy/i })).toBeTruthy()
  })

  it('publishes a DDG-conform Impressum with the operator and a postal contact block', async () => {
    render(<LandingScreen onPlayOnline={() => {}} onPassAndPlay={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Impressum' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Impressum' })).toBeTruthy()
    expect(screen.getByText(/angaben gemäß § 5 ddg/i)).toBeTruthy()
    expect(screen.getAllByText(/josé manuel matas villavicencio/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/muffendorferstr\s*32/i)).toBeTruthy()
    expect(screen.getByText(/53177 bonn/i)).toBeTruthy()
    expect(screen.getByText(/deutschland/i)).toBeTruthy()
    expect(screen.getByText(/verantwortlich nach § 18/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'kontakt@schalt-werk.com' }).getAttribute('href')).toBe('mailto:kontakt@schalt-werk.com')
    expect(screen.getAllByRole('link', { name: /schalt-werk\.com/i }).map((a) => a.getAttribute('href'))).toContain('https://schalt-werk.com')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Impressum' })).toBeNull())
    expect(trigger).toBe(document.activeElement)
  })

  it('keeps keyboard focus inside the legal dialog', () => {
    render(<LandingScreen onPlayOnline={() => {}} onPassAndPlay={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }))

    const closeIcon = screen.getByRole('button', { name: 'Close Privacy' })
    const closeAction = screen.getByRole('button', { name: 'Close' })
    closeAction.focus()
    const forwardTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(forwardTab)
    expect(forwardTab.defaultPrevented).toBe(true)
    expect(closeIcon).toBe(document.activeElement)

    const backwardTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(backwardTab)
    expect(backwardTab.defaultPrevented).toBe(true)
    expect(closeAction).toBe(document.activeElement)
  })
})
