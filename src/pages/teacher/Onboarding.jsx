import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import './Onboarding.css';

const EMOJI_OPTIONS = ['👨‍🏫', '👩‍🏫', '🦁', '🐯', '🦅', '🚀', '⭐', '🎯', '🔥', '💡', '🎓', '📚'];

export default function Onboarding() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        gender: '',
        phone_number: '',
        assigned_grades: [],
        user_emoji: '👨‍🏫',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleGradeToggle = (grade) => {
        setFormData(prev => ({
            ...prev,
            assigned_grades: prev.assigned_grades.includes(grade)
                ? prev.assigned_grades.filter(g => g !== grade)
                : [...prev.assigned_grades, grade]
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        if (!user?.id) {
            setError("No active user session found. Please try refreshing or logging in again.");
            setLoading(false);
            return;
        }

        try {
            console.log('Submitting onboarding for user:', user.id, formData);
            const { error: upsertError } = await supabase
                .from('teachers')
                .upsert({
                    id: user.id,
                    ...formData,
                    onboarding_completed: true,
                    updated_at: new Date().toISOString(),
                });

            if (upsertError) {
                console.error('Onboarding upsert error:', upsertError);
                throw upsertError;
            }

            console.log('Onboarding saved successfully in Supabase');

            // Navigate to assessments
            // We use a slightly longer delay to ensure DB consistency before navigation
            setTimeout(() => {
                navigate('/teacher/assessments');
            }, 1000);

        } catch (err) {
            console.error('Onboarding catch block:', err);
            setError(err.message || "An unexpected error occurred during setup.");
            setLoading(false);
        }
    };

    return (
        <div className="onboarding-page">
            <div className="onboarding-container">
                <div className="onboarding-header">
                    <h1>Welcome to Project: Genius!</h1>
                    <p>Let's set up your teacher profile</p>
                </div>

                {error && (
                    <div className="error-message">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="onboarding-form">
                    {/* Name Fields */}
                    <div className="form-row">
                        <div className="form-group">
                            <label className="label" htmlFor="first_name">
                                First Name
                            </label>
                            <input
                                id="first_name"
                                name="first_name"
                                type="text"
                                className="input"
                                placeholder="Stephen"
                                value={formData.first_name}
                                onChange={handleChange}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="label" htmlFor="last_name">
                                Last Name
                            </label>
                            <input
                                id="last_name"
                                name="last_name"
                                type="text"
                                className="input"
                                placeholder="Kapambwe"
                                value={formData.last_name}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    </div>

                    {/* Gender */}
                    <div className="form-group">
                        <label className="label" htmlFor="gender">
                            Gender
                        </label>
                        <select
                            id="gender"
                            name="gender"
                            className="input"
                            value={formData.gender}
                            onChange={handleChange}
                            required
                        >
                            <option value="">Select gender</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                            <option value="other">Prefer not to say</option>
                        </select>
                    </div>

                    {/* Phone Number */}
                    <div className="form-group">
                        <label className="label" htmlFor="phone_number">
                            Phone Number
                        </label>
                        <input
                            id="phone_number"
                            name="phone_number"
                            type="tel"
                            className="input"
                            placeholder="+260 XXX XXX XXX"
                            value={formData.phone_number}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    {/* Assigned Grades */}
                    <div className="form-group">
                        <label className="label">
                            Assigned Grades
                        </label>
                        <div className="grade-grid">
                            {['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'].map((grade) => (
                                <button
                                    key={grade}
                                    type="button"
                                    className={`grade-button ${formData.assigned_grades.includes(grade) ? 'active' : ''}`}
                                    onClick={() => handleGradeToggle(grade)}
                                >
                                    {grade}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Emoji Picker */}
                    <div className="form-group">
                        <label className="label">
                            Choose Your Character
                        </label>
                        <div className="emoji-grid">
                            {EMOJI_OPTIONS.map((emoji) => (
                                <button
                                    key={emoji}
                                    type="button"
                                    className={`emoji-button ${formData.user_emoji === emoji ? 'active' : ''}`}
                                    onClick={() => setFormData(prev => ({ ...prev, user_emoji: emoji }))}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary btn-block btn-large"
                        disabled={loading || formData.assigned_grades.length === 0}
                    >
                        {loading ? 'Setting up...' : 'Complete Setup'}
                    </button>
                </form>
            </div>
        </div>
    );
}
