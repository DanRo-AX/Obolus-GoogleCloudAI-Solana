import {
  FileText,
  LayoutDashboard,
  Radar,
  MessageSquarePlus,
  Notebook,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavItem = {
  to: string
  label: string
  Icon: LucideIcon
  end?: boolean
}

/**
 * The three screens the meeting locked, plus the shelf catalogue that backs
 * them. Anything outside this list was explicitly ruled out of scope.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Ask', Icon: MessageSquarePlus, end: true },
  { to: '/dashboard', label: 'Open calls', Icon: LayoutDashboard },
  { to: '/memory', label: 'My shelf', Icon: Notebook },
  { to: '/coverage', label: 'Thin shelves', Icon: Radar },
  { to: '/whitepaper', label: 'The argument', Icon: FileText },
]
