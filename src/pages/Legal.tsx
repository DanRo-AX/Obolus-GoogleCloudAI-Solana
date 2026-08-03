import { useEffect } from 'react'
import {
  AI_LIQUIDITY_PRIVACY_NOTICE_HTML,
  AI_LIQUIDITY_PRIVACY_NOTICE_HTML_KO,
  PRIVACY_HTML,
  PRIVACY_HTML_KO,
  TERMS_HTML,
  TERMS_HTML_KO,
} from '@/data/legal'
import { useLang } from '@/i18n'

/**
 * Legal copy is pre-built HTML, so t() cannot reach inside it — the language
 * switch happens one level up, by picking a whole document.
 */
export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const { lang } = useLang()
  const ko = lang === 'ko'

  const html =
    kind === 'terms'
      ? ko
        ? TERMS_HTML_KO
        : TERMS_HTML
      : ko
        ? PRIVACY_HTML_KO
        : PRIVACY_HTML

  const notice = ko
    ? AI_LIQUIDITY_PRIVACY_NOTICE_HTML_KO
    : AI_LIQUIDITY_PRIVACY_NOTICE_HTML

  useEffect(() => {
    document.title = ko
      ? kind === 'terms'
        ? '이용약관'
        : '개인정보 처리방침'
      : kind === 'terms'
        ? 'Terms of Service'
        : 'Privacy Policy'
  }, [kind, ko])

  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {kind === 'privacy' ? (
        <div dangerouslySetInnerHTML={{ __html: notice }} />
      ) : null}
    </div>
  )
}

export default LegalPage
