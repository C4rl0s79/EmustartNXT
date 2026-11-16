import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import './deck.css'
import { DeckApp } from './DeckApp'
import { installPerfWatch } from '../lib/perf'

// The Deck window's page (renderer/deck.html): the same preload API and store as the main window,
// its own small interface — the dock over the desktop.
installPerfWatch('deck') // czujnik zacięć Decka → log Lumena (main/hangWatch.ts, etap 9a)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeckApp />
  </StrictMode>
)
