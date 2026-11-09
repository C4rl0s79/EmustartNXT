import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'

// Text input that works from the couch: with a controller, pressing A opens an on-screen
// keyboard; with a physical keyboard the field is typed into directly. The D-pad's ←/→ moves the
// field's cursor (nav/input.ts); the on-screen keyboard types at that cursor and moves it with LT / RT.

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit?: (v: string) => void
  placeholder?: string
  label: string
  type?: 'text' | 'password'
  className?: string
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  navKey?: string
  /** false = not reachable with arrows / D-pad (opened by a dedicated button instead) */
  nav?: boolean
}

export function TextField({ value, onChange, onSubmit, placeholder, label, type = 'text', className, inputRef, navKey, nav = true }: Props) {
  const own = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? own
  const [osk, setOsk] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const open = (): void => setOsk(el.selectionStart ?? el.value.length)
    el.addEventListener('lumen-osk', open)
    return () => el.removeEventListener('lumen-osk', open)
  }, [ref])

  return (
    <>
      <input
        ref={ref}
        className={`field ${className ?? ''}`}
        data-nav={nav || undefined}
        data-key={navKey}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit?.(value)
          }
        }}
      />
      {osk !== null && (
        <OnScreenKeyboard
          label={label}
          initial={value}
          initialCaret={osk}
          secret={type === 'password'}
          onChange={onChange}
          onClose={(submit, v, caret) => {
            setOsk(null)
            // the field's cursor where the keyboard left it (focus comes back after the dialog closes)
            setTimeout(() => ref.current?.setSelectionRange(caret, caret), 0)
            if (submit) onSubmit?.(v)
          }}
        />
      )}
    </>
  )
}

const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '-'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', ':'],
  ['ą', 'ć', 'ę', 'ł', 'ń', 'ó', 'ś', 'ź', 'ż', "'"]
]

export function OnScreenKeyboard({
  label,
  initial,
  initialCaret,
  secret,
  onChange,
  onClose
}: {
  label: string
  initial: string
  /** where typing starts (default: the end) */
  initialCaret?: number
  secret: boolean
  onChange: (v: string) => void
  onClose: (submit: boolean, v: string, caret: number) => void
}) {
  const [ed, setEd] = useState(() => ({ text: initial, caret: Math.max(0, Math.min(initialCaret ?? initial.length, initial.length)) }))
  const text = ed.text
  const [shift, setShift] = useState(false)
  // the current text and cursor between renders (several keys before React renders again); every change goes
  // through apply(), which tells the field outside any state updater
  const edRef = useRef(ed)
  edRef.current = ed
  const apply = (next: { text: string; caret: number }): void => {
    const changed = next.text !== edRef.current.text
    edRef.current = next
    setEd(next)
    if (changed) onChange(next.text)
  }
  // an edit at the cursor: insert (k) or delete the character before it (k = null)
  const edit = (k: string | null): void => {
    const e = edRef.current
    if (k === null && e.caret === 0) return
    apply(
      k === null
        ? { text: e.text.slice(0, e.caret - 1) + e.text.slice(e.caret), caret: e.caret - 1 }
        : { text: e.text.slice(0, e.caret) + k + e.text.slice(e.caret), caret: e.caret + k.length }
    )
  }
  const type = (k: string): void => {
    edit(shift ? k.toLocaleUpperCase('pl') : k)
    if (shift) setShift(false)
  }
  const backspace = (): boolean => {
    edit(null)
    return true
  }
  const caretBy = (d: number): boolean => {
    const e = edRef.current
    apply({ ...e, caret: Math.max(0, Math.min(e.text.length, e.caret + d)) })
    return true
  }
  const clear = (): void => apply({ text: '', caret: 0 })
  const editRef = useRef(edit)
  editRef.current = edit

  // physical keys also work while the OSK is open: letters, space, Backspace; Enter submits (a
  // controller's A goes through the input layer instead and presses the focused key)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.altKey) {
        e.stopImmediatePropagation()
        e.preventDefault()
        onClose(true, edRef.current.text, edRef.current.caret)
        return
      }
      const isChar = e.key.length === 1 && !e.ctrlKey && !e.altKey
      if (!isChar && e.key !== 'Backspace') return
      e.stopImmediatePropagation()
      e.preventDefault()
      editRef.current(e.key === 'Backspace' ? null : e.key)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <Modal
      title={label}
      onClose={() => onClose(false, text, ed.caret)}
      className="osk"
      handlers={{
        x: backspace,
        y: () => {
          type(' ')
          return true
        },
        lb: () => {
          setShift((s) => !s)
          return true
        },
        lt: () => caretBy(-1),
        rt: () => caretBy(1),
        menu: () => {
          onClose(true, text, ed.caret)
          return true
        }
      }}
      hints={[
        { action: 'confirm', label: 'Wpisz' },
        { action: 'x', label: 'Usuń' },
        { action: 'y', label: 'Spacja' },
        { action: 'lb', label: 'Wielkie litery' },
        { action: 'lt', label: 'Kursor ←' },
        { action: 'rt', label: 'Kursor →' },
        { action: 'menu', label: 'Gotowe' },
        { action: 'back', label: 'Zamknij' }
      ]}
    >
      <div className="osk__display">
        {secret ? '•'.repeat(ed.caret) : text.slice(0, ed.caret)}
        <span className="osk__caret" />
        {secret ? '•'.repeat(text.length - ed.caret) : text.slice(ed.caret)}
      </div>
      <div className="osk__keys">
        {ROWS.map((row, r) => (
          <div className="osk__row" key={r}>
            {row.map((k, i) => (
              <button key={k} className="osk__key" data-nav data-autofocus={r === 1 && i === 0 ? true : undefined} onClick={() => type(k)}>
                {shift ? k.toLocaleUpperCase('pl') : k}
              </button>
            ))}
          </div>
        ))}
        <div className="osk__row">
          <button className={`osk__key osk__key--wide ${shift ? 'is-on' : ''}`} data-nav onClick={() => setShift((s) => !s)}>
            ⇧ Shift
          </button>
          <button className="osk__key osk__key--space" data-nav onClick={() => type(' ')}>
            Spacja
          </button>
          <button className="osk__key osk__key--wide" data-nav onClick={backspace}>
            ⌫ Usuń
          </button>
          <button className="osk__key osk__key--wide" data-nav onClick={clear}>
            Wyczyść
          </button>
          <button className="osk__key osk__key--wide osk__key--done" data-nav onClick={() => onClose(true, text, ed.caret)}>
            Gotowe
          </button>
        </div>
      </div>
    </Modal>
  )
}
