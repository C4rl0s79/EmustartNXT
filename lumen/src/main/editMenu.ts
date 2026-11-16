import { Menu, type MenuItemConstructorOptions, type WebContents } from 'electron'

/**
 * Prawy przycisk myszy w oknie Lumena: Wytnij / Kopiuj / Wklej / Zaznacz wszystko — w polach tekstowych
 * i przy zaznaczonym tekście (opisy, wartości, adresy). Electron sam takiego menu nie ma, a pasek menu okna jest
 * wyłączony (Menu.setApplicationMenu(null)). Gdzie nie ma czego kopiować ani wklejać, menu się nie pokazuje.
 * Same skróty Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A działają w polach bez tego menu (Chromium).
 */
export function attachEditMenu(wc: WebContents): void {
  wc.on('context-menu', (_e, p) => {
    const f = p.editFlags
    const items: MenuItemConstructorOptions[] = p.isEditable
      ? [
          { label: 'Wytnij', role: 'cut', enabled: f.canCut },
          { label: 'Kopiuj', role: 'copy', enabled: f.canCopy },
          { label: 'Wklej', role: 'paste', enabled: f.canPaste },
          { type: 'separator' },
          { label: 'Zaznacz wszystko', role: 'selectAll', enabled: f.canSelectAll }
        ]
      : p.selectionText.trim()
        ? [{ label: 'Kopiuj', role: 'copy', enabled: f.canCopy }]
        : []
    if (items.length) Menu.buildFromTemplate(items).popup()
  })
}
