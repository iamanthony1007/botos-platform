import { lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { DataCacheProvider } from './lib/DataCache'

// Public pages are eager: they are the first paint for logged-out visitors and
// must not wait on a chunk fetch.
import Landing from './pages/Landing'
import Login from './pages/Login'
import AcceptInvite from './pages/AcceptInvite'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Waitlist from './pages/Waitlist'
import HowItWorks from './pages/HowItWorks'

// Dashboard is lazy: a public visitor should not download the authenticated app
// (or its heavy deps like mammoth in Documents) just to see the landing page.
const Layout = lazy(() => import('./components/Layout'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Inbox = lazy(() => import('./pages/Inbox'))
const Tester = lazy(() => import('./pages/Tester'))
const TrainBot = lazy(() => import('./pages/TrainBot'))
const Learnings = lazy(() => import('./pages/Learnings'))
const PromptEditor = lazy(() => import('./pages/PromptEditor'))
const Documents = lazy(() => import('./pages/Documents'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Settings = lazy(() => import('./pages/Settings'))
const UserManagement = lazy(() => import('./pages/UserManagement'))

function Loading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--tx2)', fontSize: '0.9rem' }}>
      Loading...
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace />
  return children
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (user) return <Navigate to="/dashboard" replace />
  return children
}

function PermissionRoute({ permission, children }) {
  const { can, loading } = useAuth()
  if (loading) return null
  if (!can(permission)) return <Navigate to="/dashboard" replace />
  return children
}

function App() {
  return (
    <AuthProvider>
      <DataCacheProvider>
        <Router>
          <Suspense fallback={<Loading />}>
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
              <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
              <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/accept-invite" element={<AcceptInvite />} />
              <Route path="/waitlist" element={<Waitlist />} />
              <Route path="/how-it-works" element={<HowItWorks />} />

              {/* Protected dashboard routes */}
              <Route path="/dashboard" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route index element={<Dashboard />} />
                <Route path="settings"  element={<PermissionRoute permission="settings_admin"><Settings /></PermissionRoute>} />
                <Route path="inbox"     element={<PermissionRoute permission="inbox"><Inbox /></PermissionRoute>} />
                <Route path="tester"    element={<PermissionRoute permission="bot_tester"><Tester /></PermissionRoute>} />
                <Route path="train"     element={<PermissionRoute permission="train_bot"><TrainBot /></PermissionRoute>} />
                <Route path="learnings" element={<PermissionRoute permission="learnings"><Learnings /></PermissionRoute>} />
                <Route path="prompt"    element={<PermissionRoute permission="prompt_editor"><PromptEditor /></PermissionRoute>} />
                <Route path="documents" element={<PermissionRoute permission="documents"><Documents /></PermissionRoute>} />
                <Route path="analytics" element={<PermissionRoute permission="analytics"><Analytics /></PermissionRoute>} />
                <Route path="users"     element={<PermissionRoute permission="user_management"><UserManagement /></PermissionRoute>} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Router>
      </DataCacheProvider>
    </AuthProvider>
  )
}

export default App
