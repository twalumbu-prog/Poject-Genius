import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';

// Public pages
import AuthPage from './pages/AuthPage';

// Teacher pages
import TeacherOnboarding from './pages/teacher/Onboarding';
import TeacherLayout from './pages/teacher/TeacherLayout';
import Assessments from './pages/teacher/Assessments';
import Students from './pages/teacher/Students';
import Analysis from './pages/teacher/Analysis';
import CreateTestStream from './pages/teacher/CreateTestStream';
import TestStreamSetup from './pages/teacher/TestStreamSetup';
import TestDetails from './pages/teacher/TestDetails';
import MarkTest from './pages/teacher/MarkTest';
import PupilAnalysis from './pages/teacher/PupilAnalysis';
import AITestGenerator from './pages/teacher/AITestGenerator';
import MarkingSchemeReview from './pages/teacher/MarkingSchemeReview';
import StudentProfile from './pages/teacher/StudentProfile';
import ReportCardView from './pages/teacher/ReportCardView';

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard';

function App() {
  const { isAuthenticated, role, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '1rem',
      }}>
        <div className="spinner"></div>
        <span style={{
          fontSize: 'var(--font-size-base)',
          fontWeight: 'var(--font-weight-semibold)',
          color: 'var(--color-accent-primary)',
        }}>Loading...</span>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        {/* Auth page is now the root */}
        <Route path="/" element={<AuthPage />} />

        {/* Teacher routes */}
        <Route
          path="/teacher/onboarding"
          element={
            <ProtectedRoute requiredRole="teacher">
              <TeacherOnboarding />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher"
          element={
            <ProtectedRoute requiredRole="teacher">
              <TeacherLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/teacher/assessments" replace />} />
          <Route path="assessments" element={<Assessments />} />
          <Route path="students" element={<Students />} />
          <Route path="analysis" element={<Analysis />} />
        </Route>
        <Route
          path="/teacher/generate-test"
          element={
            <ProtectedRoute requiredRole="teacher">
              <AITestGenerator />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/create-stream"
          element={
            <ProtectedRoute requiredRole="teacher">
              <CreateTestStream />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/stream/:streamId/setup"
          element={
            <ProtectedRoute requiredRole="teacher">
              <TestStreamSetup />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/test/:testId"
          element={
            <ProtectedRoute requiredRole="teacher">
              <TestDetails />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/test/:testId/review"
          element={
            <ProtectedRoute requiredRole="teacher">
              <MarkingSchemeReview />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/test/:testId/mark"
          element={
            <ProtectedRoute requiredRole="teacher">
              <MarkTest />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/pupil/:pupilId/analysis/:testId"
          element={
            <ProtectedRoute requiredRole="teacher">
              <PupilAnalysis />
            </ProtectedRoute>
          }
        />

        <Route
          path="/teacher/student/:pupilId"
          element={
            <ProtectedRoute requiredRole="teacher">
              <StudentProfile />
            </ProtectedRoute>
          }
        />

        <Route
          path="/teacher/student/:pupilId/report"
          element={
            <ProtectedRoute requiredRole="teacher">
              <ReportCardView />
            </ProtectedRoute>
          }
        />

        {/* Admin routes */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminDashboard />
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
