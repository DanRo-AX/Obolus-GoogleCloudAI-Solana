import { useEffect } from 'react'
import {
  Navigate,
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
} from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import { Splash } from '@/components/Splash'
import { TooltipProvider } from '@/components/ui/primitives'
import { UiProvider } from '@/state/ui'
import Chat from '@/pages/Chat'
import Dashboard from '@/pages/Dashboard'
import Home from '@/pages/Home'
import { LegalPage } from '@/pages/Legal'
import Login from '@/pages/Login'
import Memory from '@/pages/Memory'
import Pricing from '@/pages/Pricing'
import Shelf from '@/pages/Shelf'
import Shelf1 from '@/pages/Shelf1'
import Survey from '@/pages/Survey'

const TITLES: Record<string, string> = {
  '/': 'OPENSHELF — The internet, as a database',
  '/dashboard': 'Dashboard · OPENSHELF',
  '/memory': 'My memory · OPENSHELF',
  '/shelf': 'Shelves · OPENSHELF',
  '/pricing': 'Pricing · OPENSHELF',
  '/shelf-1': 'SHELF-1 · OPENSHELF',
  '/terms': 'Terms · OPENSHELF',
  '/privacy': 'Privacy · OPENSHELF',
  '/login': 'OPENSHELF',
}

function DocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = TITLES[pathname] ?? 'OPENSHELF — The internet, as a database'
  }, [pathname])
  return null
}

export default function App() {
  return (
    <Router>
      <UiProvider>
        <TooltipProvider>
          <DocumentTitle />
          <Splash />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/chat/:id" element={<Chat />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/memory" element={<Memory />} />
              <Route path="/answer/:orderId" element={<Survey />} />
              <Route path="/shelf" element={<Shelf />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/shelf-1" element={<Shelf1 />} />
              <Route path="/terms" element={<LegalPage kind="terms" />} />
              <Route path="/privacy" element={<LegalPage kind="privacy" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </TooltipProvider>
      </UiProvider>
    </Router>
  )
}
