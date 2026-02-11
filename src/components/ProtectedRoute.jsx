import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function ProtectedRoute({ children, requiredRole }) {
    const { isAuthenticated, role, loading } = useAuth();

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <p>Verifying access...</p>
            </div>
        );
    }

    if (!isAuthenticated) {
        console.log('ProtectedRoute: Not authenticated, redirecting to home');
        return <Navigate to="/" replace />;
    }

    if (requiredRole && role !== requiredRole) {
        console.log(`ProtectedRoute: Role mismatch (got ${role}, expected ${requiredRole}), redirecting to home`);
        return <Navigate to="/" replace />;
    }

    return children;
}
