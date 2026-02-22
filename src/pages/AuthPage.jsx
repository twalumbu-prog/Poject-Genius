import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn, signUp, signInWithGoogle } from '../lib/auth';
import { Mail, Lock, GraduationCap, School } from 'lucide-react';
import './Auth.css';

export default function AuthPage() {
    const navigate = useNavigate();
    const [activeRole, setActiveRole] = useState('teacher');
    const [mode, setMode] = useState('login'); // 'login' or 'signup'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const resetForm = () => {
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setError(null);
    };

    const switchRole = (role) => {
        setActiveRole(role);
        resetForm();
    };

    const switchMode = (newMode) => {
        setMode(newMode);
        setError(null);
        setPassword('');
        setConfirmPassword('');
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        const { data, error: loginError } = await signIn(email, password);

        if (loginError) {
            setError(loginError.message);
            setLoading(false);
            return;
        }

        if (activeRole === 'admin') {
            navigate('/admin');
        } else {
            navigate('/teacher');
        }
    };

    const handleSignup = async (e) => {
        e.preventDefault();
        setError(null);

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        setLoading(true);

        const { data, error: signupError, confirmationRequired } = await signUp(email, password, activeRole);

        if (signupError) {
            setError(signupError.message);
            setLoading(false);
            return;
        }

        if (confirmationRequired) {
            setError(null);
            alert('Sign up successful! Please check your email to confirm your account before logging in.');
            setMode('login');
            setLoading(false);
            return;
        }

        if (activeRole === 'teacher') {
            navigate('/teacher/onboarding');
        } else {
            navigate('/admin');
        }
    };

    const handleGoogleAuth = async () => {
        setError(null);
        const { error: googleError } = await signInWithGoogle();
        if (googleError) {
            setError(googleError.message);
        }
    };

    const isLogin = mode === 'login';

    return (
        <div className="auth-page">
            <div className="auth-container">
                {/* Branding */}
                <div className="auth-brand">
                    Project Genius
                </div>

                {/* Role Tabs */}
                <div className="role-tabs">
                    <button
                        className={`role-tab ${activeRole === 'teacher' ? 'active' : ''}`}
                        onClick={() => switchRole('teacher')}
                    >
                        <GraduationCap size={18} />
                        Teacher
                    </button>
                    <button
                        className={`role-tab ${activeRole === 'admin' ? 'active' : ''}`}
                        onClick={() => switchRole('admin')}
                    >
                        <School size={18} />
                        School
                    </button>
                </div>

                {/* Header */}
                <div className="auth-header">
                    <h1>{isLogin ? 'Welcome Back' : 'Create Account'}</h1>
                </div>

                {error && (
                    <div className="error-message">
                        {error}
                    </div>
                )}

                <form onSubmit={isLogin ? handleLogin : handleSignup} className="auth-form">
                    <div className="form-group">
                        <label className="label" htmlFor="email">
                            <Mail size={16} />
                            Email Address
                        </label>
                        <input
                            id="email"
                            type="email"
                            className="input"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label className="label" htmlFor="password">
                            <Lock size={16} />
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            className="input"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    {!isLogin && (
                        <div className="form-group">
                            <label className="label" htmlFor="confirm-password">
                                <Lock size={16} />
                                Confirm Password
                            </label>
                            <input
                                id="confirm-password"
                                type="password"
                                className="input"
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                            />
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary btn-block"
                        disabled={loading}
                    >
                        {loading
                            ? (isLogin ? 'Signing in...' : 'Creating account...')
                            : (isLogin ? 'Sign In' : 'Create Account')
                        }
                    </button>
                </form>

                <div className="auth-divider">
                    <span>or</span>
                </div>

                <button
                    onClick={handleGoogleAuth}
                    className="btn btn-secondary btn-block google-button"
                >
                    <svg width="18" height="18" viewBox="0 0 18 18">
                        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
                        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
                        <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" />
                        <path fill="#EA4335" d="M9 3.582c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.582 9 3.582z" />
                    </svg>
                    Continue with Google
                </button>

                <div className="auth-footer">
                    {isLogin ? (
                        <>Don't have an account?{' '}<button className="auth-link" onClick={() => switchMode('signup')}>Sign up</button></>
                    ) : (
                        <>Already have an account?{' '}<button className="auth-link" onClick={() => switchMode('login')}>Sign in</button></>
                    )}
                </div>
            </div>
        </div>
    );
}
