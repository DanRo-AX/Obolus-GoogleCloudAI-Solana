import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Activity, Database, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { AuthUnavailable } from '@/components/AuthUnavailable'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/primitives'
import { useT } from '@/i18n'
import {
  ADMIN_TABLE_PAGE_SIZE,
  getAdminTable,
  type AdminTablePage,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

type TableTab = { path: string; label: string }

/**
 * Admin hub reachable from 내 문서 (Memory) for administrator wallets only.
 * Surfaces the existing operations + disputes consoles and a read-only viewer
 * over curated database tables. Every table read is admin-gated and redacted on
 * the server; this page is a thin, generic renderer over that contract and does
 * no gating of its own beyond a courtesy redirect.
 */
export default function Admin() {
  const t = useT()
  const { account, authReady, authError, retryAuth } = useUi()

  const tables = useMemo<TableTab[]>(
    () => [
      { path: 'users', label: t('Users') },
      { path: 'balances', label: t('Balances') },
      { path: 'open-calls', label: t('Open calls') },
      { path: 'settlements', label: t('Settlements') },
      { path: 'prepaid-accounts', label: t('Prepaid accounts') },
      { path: 'dispute-events', label: t('Dispute events') },
    ],
    [t],
  )

  const [activePath, setActivePath] = useState('users')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<AdminTablePage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (path: string, nextOffset: number) => {
      setLoading(true)
      setError(null)
      try {
        setPage(await getAdminTable(path, nextOffset))
      } catch (cause) {
        setPage(null)
        setError(
          cause instanceof Error ? cause.message : t('Could not load this table.'),
        )
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    if (account?.role === 'admin') void load(activePath, offset)
  }, [account?.role, activePath, offset, load])

  const selectTable = useCallback((path: string) => {
    setActivePath(path)
    setOffset(0)
  }, [])

  if (authReady && authError && !account) {
    return <AuthUnavailable message={authError} onRetry={retryAuth} />
  }
  if (authReady && account?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }

  const activeLabel =
    tables.find((table) => table.path === activePath)?.label ?? activePath
  const rowCount = page?.rows.length ?? 0
  const rangeLabel = rowCount > 0 ? `${offset + 1}–${offset + rowCount}` : '0'

  return (
    <div className="page-enter flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              <h1 className="font-sans text-base font-medium">
                {t('Admin console')}
              </h1>
              <span className="rounded-[3px] border border-border bg-card px-2 py-1 font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground">
                {t('Read only')}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t(
                'Operations dashboards and read-only viewers over key database tables. Access is restricted to administrator wallets and enforced on the server.',
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="monoMuted" size="monoSm">
              <Link to="/admin/operations">
                <Activity className="size-3.5" />
                {t('Operations')}
              </Link>
            </Button>
            <Button asChild variant="monoMuted" size="monoSm">
              <Link to="/admin/disputes">
                <ShieldCheck className="size-3.5" />
                {t('Review queue')}
              </Link>
            </Button>
          </div>
        </header>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">{t('Database viewer')}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {tables.map((table) => (
              <Chip
                key={table.path}
                active={table.path === activePath}
                onClick={() => selectTable(table.path)}
              >
                {table.label}
              </Chip>
            ))}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="overflow-x-auto rounded-[6px] border border-border bg-card">
            {loading && !page ? (
              <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('Loading…')}
              </div>
            ) : page && page.columns.length ? (
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {page.columns.map((column) => (
                      <th
                        key={column}
                        className="whitespace-nowrap px-3 py-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className="border-b border-border/60 last:border-0"
                    >
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className="max-w-[22rem] truncate px-3 py-2 font-mono text-[12px] tabular-nums"
                          title={renderCell(cell)}
                        >
                          {renderCell(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-6 text-sm text-muted-foreground">
                {t('No rows.')}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              {activeLabel} · {rangeLabel}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="monoMuted"
                size="monoSm"
                disabled={loading}
                onClick={() => void load(activePath, offset)}
              >
                <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
                {t('Refresh')}
              </Button>
              <Button
                variant="monoMuted"
                size="monoSm"
                disabled={loading || offset === 0}
                onClick={() =>
                  setOffset((value) => Math.max(0, value - ADMIN_TABLE_PAGE_SIZE))
                }
              >
                {t('Previous')}
              </Button>
              <Button
                variant="mono"
                size="monoSm"
                disabled={loading || !page?.hasMore}
                onClick={() => setOffset((value) => value + ADMIN_TABLE_PAGE_SIZE)}
              >
                {t('Next')}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function renderCell(cell: string | number | boolean | null): string {
  if (cell === null) return '—'
  if (typeof cell === 'boolean') return cell ? 'true' : 'false'
  return String(cell)
}
