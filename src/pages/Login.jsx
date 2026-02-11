import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { signIn, signInWithGoogle } from '../lib/auth';
import { Mail, Lock, ArrowLeft } from 'lucide-react';
import './Auth.css';

export default function Login() {
    const { role } = useParams(); // 'teacher' or 'admin'
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

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

        // Redirect based on role after successful login
        if (role === 'admin') {
            navigate('/admin');
        } else {
            navigate('/teacher');
        }
    };

    const handleGoogleLogin = async () => {
        setError(null);
        const { error: googleError } = await signInWithGoogle();
        if (googleError) {
            setError(googleError.message);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-container">
                <button className="back-button" onClick={() => navigate('/')}>
                    <ArrowLeft size={20} />
                    Back
                </button>

                <div className="auth-header">
                    <h1>Welcome Back</h1>
                    <p>Sign in to your {role} account</p>
                </div>

                {error && (
                    <div className="error-message">
                        {error}
                    </div>
                )}

                <form onSubmit={handleLogin} className="auth-form">
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

                    <button
                        type="submit"
                        className="btn btn-primary btn-block"
                        disabled={loading}
                    >
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                <div className="auth-divider">
                    <span>or</span>
                </div>

                <button
                    onClick={handleGoogleLogin}
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
                    Don't have an account?{' '}
                    <Link to={`/signup/${role}`}>Sign up</Link>
                </div>
            </div>
        </div>
    );
}
