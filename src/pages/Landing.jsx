import { useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import './Landing.css';

export default function Landing() {
    const navigate = useNavigate();

    return (
        <div className="landing-page">
            <div className="landing-container">
                <div className="landing-header">
                    <div className="logo">
                        <GraduationCap size={48} strokeWidth={2} />
                    </div>
                    <h1 className="app-title">Project: Genius</h1>
                    <p className="app-description">
                        AI-powered assessment and marking platform for modern education
                    </p>
                </div>

                <div className="landing-actions">
                    <div className="action-card">
                        <h2>Teacher Portal</h2>
                        <p>Create assessments, mark tests, and analyze student performance</p>
                        <div className="action-buttons">
                            <button
                                className="btn btn-primary btn-large"
                                onClick={() => navigate('/login/teacher')}
                            >
                                Login as Teacher
                            </button>
                            <button
                                className="btn btn-secondary"
                                onClick={() => navigate('/signup/teacher')}
                            >
                                Sign Up
                            </button>
                        </div>
                    </div>

                    <div className="action-card">
                        <h2>Admin Portal</h2>
                        <p>Manage teachers, oversee assessments, and system administration</p>
                        <div className="action-buttons">
                            <button
                                className="btn btn-primary btn-large"
                                onClick={() => navigate('/login/admin')}
                            >
                                Login as Admin
                            </button>
                            <button
                                className="btn btn-secondary"
                                onClick={() => navigate('/signup/admin')}
                            >
                                Sign Up
                            </button>
                        </div>
                    </div>
                </div>

                <div className="landing-footer">
                    <p>Twalumbu Education Center</p>
                </div>
            </div>
        </div>
    );
}
