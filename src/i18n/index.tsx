import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { KO } from './ko'

/**
 * Two languages, keyed by the English string itself.
 *
 * The alternative — inventing an id for every line — would mean touching every
 * component twice and reading `t('sidebar.nav.openCalls')` in the source
 * instead of the words that ship. Keying on English keeps the file readable,
 * makes a missing translation degrade to English rather than to a key, and
 * lets the Korean dictionary be written and reviewed as a plain two-column
 * document.
 *
 * The cost is that editing an English string silently drops its translation.
 * That is the right trade while the copy is still moving.
 */

export type Lang = 'en' | 'ko'

const STORAGE_KEY = 'obolus:lang:v1'

/**
 * Phrases that must never be split across a line.
 *
 * A price range is read as one token — "0.50 to 2.00 USDC" wrapping after "to" makes
 * the reader parse two numbers before realising they were a range. Applied
 * after lookup, not to the source strings, so the English keys the Korean
 * dictionary is keyed on stay plain ASCII spaces.
 */
const NBSP = '\u00A0'
function tighten(s: string) {
  return s
    .replace(/([\d,.]+)\s+to\s+([\d,.]+)\s+USDC/g, `$1${NBSP}to${NBSP}$2${NBSP}USDC`)
}

type LangValue = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (en: string) => string
}

const LangContext = createContext<LangValue | null>(null)

function initial(): Lang {
  if (typeof window === 'undefined') return 'en'
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved === 'ko' || saved === 'en') return saved
  return navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial)

  useEffect(() => {
    document.documentElement.lang = lang
    // Korean needs its own tracking and weight; CSS keys off this attribute.
    document.documentElement.dataset.lang = lang
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      window.localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* storage disabled — the choice just will not survive a reload */
    }
  }, [])

  const t = useCallback(
    (en: string) => tighten(lang === 'ko' ? (KO[en] ?? en) : en),
    [lang],
  )

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

// oxlint-disable-next-line react/only-export-components -- colocated context hook.
export function useLang() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used inside <LangProvider>')
  return ctx
}

/** Shorthand for the common case of only needing the translator. */
// oxlint-disable-next-line react/only-export-components -- colocated context hook.
export function useT() {
  return useLang().t
}
