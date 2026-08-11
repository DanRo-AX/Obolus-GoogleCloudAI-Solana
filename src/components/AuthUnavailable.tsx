import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

export function AuthUnavailable({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const t = useT()

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-md rounded-[4px] border border-border bg-card p-6 text-center">
        <AlertTriangle className="mx-auto size-5 text-[#B45309]" />
        <h1 className="mt-4 text-base font-medium">
          {t('We could not verify your session')}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t(message)}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t('Your local session was preserved. Retry when the service is reachable.')}
        </p>
        <Button className="mt-5" variant="mono" size="monoSm" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          {t('Retry')}
        </Button>
      </div>
    </div>
  )
}
