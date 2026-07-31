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
  { to: '/', label: 'New question', Icon: MessageSquarePlus, end: true },
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/memory', label: 'My memory', Icon: Notebook },
  { to: '/coverage', label: 'Coverage', Icon: Radar },
  { to: '/whitepaper', label: 'Whitepaper', Icon: FileText },
]
