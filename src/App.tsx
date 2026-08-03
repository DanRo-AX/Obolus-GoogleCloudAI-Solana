import { lazy, Suspense, useEffect } from 'react'
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

const AdminDisputes = lazy(() => import('@/pages/AdminDisputes'))
const Chat = lazy(() => import('@/pages/Chat'))
const Coverage = lazy(() => import('@/pages/Coverage'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Home = lazy(() => import('@/pages/Home'))
const LegalPage = lazy(() =>
  import('@/pages/Legal').then((module) => ({ default: module.LegalPage })),
)
const Login = lazy(() => import('@/pages/Login'))
const Memory = lazy(() => import('@/pages/Memory'))
const Onboarding = lazy(() => import('@/pages/Onboarding'))
const Pricing = lazy(() => import('@/pages/Pricing'))
const Shelf1 = lazy(() => import('@/pages/Shelf1'))
const Survey = lazy(() => import('@/pages/Survey'))

const TITLES: Record<string, string> = {
  '/': 'OPENSHELF — The internet, as a database',
  '/dashboard': 'Dashboard · OPENSHELF',
  '/memory': 'My memory · OPENSHELF',
  '/onboarding': 'Set up your account · OPENSHELF',
  '/coverage': 'Coverage · OPENSHELF',
  '/pricing': 'Pricing · OPENSHELF',
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
          <Suspense fallback={<div className="min-h-screen bg-background" />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<Home />} />
                <Route path="/chat/:id" element={<Chat />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/memory" element={<Memory />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/answer/:orderId" element={<Survey />} />
                <Route path="/admin/disputes" element={<AdminDisputes />} />
                <Route path="/coverage" element={<Coverage />} />
                <Route
                  path="/shelf"
                  element={<Navigate to="/coverage" replace />}
                />
                <Route path="/pricing" element={<Pricing />} />
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
          </Suspense>
        </TooltipProvider>
      </UiProvider>
    </Router>
  )
}
