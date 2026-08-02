import { useEffect } from 'react'
import { PRIVACY_HTML, TERMS_HTML } from '@/data/legal'

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const html = kind === 'terms' ? TERMS_HTML : implementedPrivacyPolicy(PRIVACY_HTML)

  useEffect(() => {
    document.title = kind === 'terms' ? 'Terms of Service' : 'Privacy Policy'
  }, [kind])

  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

function implementedPrivacyPolicy(html: string) {
  return html
    .replace(
      'Within 30 days, the MD files, the memory stream, the matching index, and attachments are removed from the operational database in a way that cannot be recovered.',
      'When deletion is confirmed, the MD files, memory stream, matching index, and profile are removed from the operational database immediately and cannot be recovered.',
    )
    .replace(
      'Those 30 days are a grace period for accidental deletion. Cancel inside the window and everything comes back; ask for immediate destruction with no grace period and it is handled that way.',
      'Deletion is permanent. Export your memory stream before confirming deletion if you want to keep a copy.',
    )
    .replace(
      'Copies sitting in backups are erased as the backup rotation reaches them, and the last copy is gone within 90 days.',
      'Backup retention depends on the production hosting policy and is published here before production data is accepted.',
    )
    .replace(
      'access to MDs and memory streams is limited to the smallest number of staff whose work requires it, and every access is logged.',
      'access to MDs and memory streams is limited to the smallest number of staff whose work requires it, and every paid passage delivery is logged.',
    )
}

export default LegalPage
