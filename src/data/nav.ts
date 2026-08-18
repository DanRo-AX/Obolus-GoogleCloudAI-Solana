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
  /**
   * Renders a hairline public/private divider immediately above this item, so
   * the personal shelf reads as a separate group from the public pages.
   */
  dividerBefore?: boolean
}

/**
 * The three screens the meeting locked, plus the shelf catalogue that backs
 * them. Anything outside this list was explicitly ruled out of scope.
 *
 * The public pages come first; "My shelf" is the one private surface, so it
 * sits last behind a divider rather than mixed in with the public group.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Ask', Icon: MessageSquarePlus, end: true },
  { to: '/dashboard', label: 'Open calls', Icon: LayoutDashboard },
  { to: '/coverage', label: 'Thin shelves', Icon: Radar },
  { to: '/whitepaper', label: 'The argument', Icon: FileText },
  { to: '/memory', label: 'My shelf', Icon: Notebook, dividerBefore: true },
]
