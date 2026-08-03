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
import Archive from '@/pages/Archive'
import Memory from '@/pages/Memory'
import Onboarding from '@/pages/Onboarding'
import Coverage from '@/pages/Coverage'
import Shelf1 from '@/pages/Shelf1'
import Survey from '@/pages/Survey'
import AdminDisputes from '@/pages/AdminDisputes'

const TITLES: Record<string, string> = {
  '/': 'OPENSHELF — The internet, as a database',
  '/dashboard': 'Dashboard · OPENSHELF',
  '/archive': 'Archive · OPENSHELF',
  '/memory': 'My memory · OPENSHELF',
  '/onboarding': 'Set up your account · OPENSHELF',
  '/coverage': 'Coverage · OPENSHELF',
  '/whitepaper': 'Whitepaper · OPENSHELF',
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
              <Route path="/archive" element={<Archive />} />
              <Route path="/memory" element={<Memory />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/answer/:orderId" element={<Survey />} />
              <Route path="/admin/disputes" element={<AdminDisputes />} />
              <Route path="/coverage" element={<Coverage />} />
              <Route
                path="/shelf"
                element={<Navigate to="/coverage" replace />}
              />
              <Route path="/whitepaper" element={<Shelf1 />} />
              <Route
                path="/shelf-1"
                element={<Navigate to="/whitepaper" replace />}
              />
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
