import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTeacherProfile } from '../../hooks/useTeacherProfile';
import TopBar from '../../components/teacher/TopBar';
import BottomNav from '../../components/teacher/BottomNav';
import './TeacherLayout.css';

export default function TeacherLayout() {
    const { user, loading: authLoading } = useAuth();
    const { teacher, loading: profileLoading, refetch } = useTeacherProfile(user?.id);

    const isLoading = authLoading || profileLoading;

    if (isLoading) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <p>Loading your workspace...</p>
            </div>
        );
    }

    // If teacher profile doesn't exist or onboarding not completed, redirect to onboarding page
    if (!teacher || !teacher.onboarding_completed) {
        console.log('Teacher not onboarded, redirecting...', { teacher });
        return <Navigate to="/teacher/onboarding" replace />;
    }

    return (
        <div className="teacher-layout">
            <TopBar teacher={teacher} />
            <main className="teacher-main">
                <Outlet />
            </main>
            <BottomNav />
        </div>
    );
}
