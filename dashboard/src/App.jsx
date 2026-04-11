import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Inbox from './pages/Inbox'
import Tester from './pages/Tester'
import TrainBot from './pages/TrainBot'
import Learnings from './pages/Learnings'
import PromptEditor from './pages/PromptEditor'
import Documents from './pages/Documents'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import UserManagement from './pages/UserManagement'
import AcceptInvite from './pages/AcceptInvite'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--tx2)', fontSize: '0.9rem' }}>
      Loading...
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return children
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--tx2)', fontSize: '0.9rem' }}>
      Loading...
    </div>
  )
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
      <Router>
        <Routes>
          {/* Public routes — redirect to dashboard if already logged in */}
          <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/accept-invite" element={<AcceptInvite />} />

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
      </Router>
    </AuthProvider>
  )
}

export default App