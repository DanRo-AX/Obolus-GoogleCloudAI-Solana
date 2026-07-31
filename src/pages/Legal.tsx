import { useEffect } from 'react'
import { PRIVACY_HTML, TERMS_HTML } from '@/data/legal'

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const html = kind === 'terms' ? TERMS_HTML : PRIVACY_HTML

  useEffect(() => {
    document.title = kind === 'terms' ? 'Terms of Service' : 'Privacy Policy'
  }, [kind])

  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

export default LegalPage
