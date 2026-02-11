import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Check } from 'lucide-react';
import './CreateTestStream.css';

const SUBJECTS = [
    'Mathematics',
    'English',
    'Science',
    'Social Studies',
    'Religious Education',
    'Creative & Technology Studies',
    'Physical Education',
];

export default function CreateTestStream() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [streamTitle, setStreamTitle] = useState('');
    const [selectedSubjects, setSelectedSubjects] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const toggleSubject = (subject) => {
        setSelectedSubjects(prev =>
            prev.includes(subject)
                ? prev.filter(s => s !== subject)
                : [...prev, subject]
        );
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            // Create test stream
            const { data: stream, error: streamError } = await supabase
                .from('test_streams')
                .insert({
                    teacher_id: user.id,
                    title: streamTitle,
                    status: 'pending',
                })
                .select()
                .single();

            if (streamError) throw streamError;

            // Create tests for each selected subject
            const tests = selectedSubjects.map(subject => ({
                test_stream_id: stream.id,
                teacher_id: user.id,
                title: `${streamTitle} - ${subject}`,
                subject: subject,
                status: 'pending',
            }));

            const { error: testsError } = await supabase
                .from('tests')
                .insert(tests);

            if (testsError) throw testsError;

            // Navigate to stream setup page
            navigate(`/teacher/stream/${stream.id}/setup`);
        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    };

    return (
        <div className="create-stream-page">
            <div className="page-container">
                <button className="back-button" onClick={() => navigate('/teacher/assessments')}>
                    <ArrowLeft size={20} />
                    Back to Assessments
                </button>

                <div className="page-header">
                    <h1>Create Test Stream</h1>
                    <p>Group multiple subject tests into a single assessment period</p>
                </div>

                {error && (
                    <div className="error-message">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="create-form">
                    <div className="form-group">
                        <label className="label" htmlFor="stream-title">
                            Test Stream Title
                        </label>
                        <input
                            id="stream-title"
                            type="text"
                            className="input"
                            placeholder="e.g., Term 1 Mid-Term"
                            value={streamTitle}
                            onChange={(e) => setStreamTitle(e.target.value)}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">
                            Select Subjects
                            <span className="label-help">
                                ({selectedSubjects.length} selected)
                            </span>
                        </label>
                        <div className="subjects-grid">
                            {SUBJECTS.map((subject) => (
                                <button
                                    key={subject}
                                    type="button"
                                    className={`subject-button ${selectedSubjects.includes(subject) ? 'active' : ''}`}
                                    onClick={() => toggleSubject(subject)}
                                >
                                    <span className="checkbox-icon">
                                        {selectedSubjects.includes(subject) && <Check size={18} />}
                                    </span>
                                    {subject}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary btn-block btn-large"
                        disabled={loading || selectedSubjects.length === 0 || !streamTitle}
                    >
                        {loading ? 'Creating...' : `Create Stream with ${selectedSubjects.length} ${selectedSubjects.length === 1 ? 'Subject' : 'Subjects'}`}
                    </button>
                </form>
            </div>
        </div>
    );
}
