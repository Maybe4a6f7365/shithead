// ============================================================================
// Announcer — visually-hidden aria-live regions (DESIGN.md §6.6).
// polite: turns, plays, pickups. assertive: errors + connection loss only.
// Rapid AI turns collapse: max 1 polite announcement per second; interim
// events queue and merge.
// ============================================================================
import { useEffect, useRef, useState } from 'react'

export function useAnnouncer() {
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  const lastPoliteAt = useRef(0)
  const queued = useRef<string[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sayPolite = (text: string) => {
    const now = Date.now()
    if (now - lastPoliteAt.current >= 1000) {
      lastPoliteAt.current = now
      setPolite(text)
      return
    }
    // Collapse rapid events (AI chains) into a merged announcement.
    queued.current.push(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const merged = queued.current.splice(0).join('; ')
      if (merged) {
        lastPoliteAt.current = Date.now()
        setPolite(merged)
      }
    }, 1000 - (now - lastPoliteAt.current))
  }

  const sayAssertive = (text: string) => setAssertive(text)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return { polite, assertive, sayPolite, sayAssertive }
}

export function Announcer({ polite, assertive }: { polite: string; assertive: string }) {
  return (
    <>
      <div id="announcer" aria-live="polite" role="status" className="visually-hidden">{polite}</div>
      <div aria-live="assertive" role="alert" className="visually-hidden">{assertive}</div>
    </>
  )
}
