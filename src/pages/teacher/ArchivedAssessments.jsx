import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { FileText, ArrowLeft, Archive } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AssessmentCard from '../../components/teacher/AssessmentCard';
import './Assessments.css';

export default function ArchivedAssessments() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [testStreams, setTestStreams] = useState([]);
    const [standaloneTests, setStandaloneTests] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchArchivedAssessments();
    }, [user]);

    async function fetchArchivedAssessments() {
        if (!user) return;
        try {
            // Fetch archived test streams
            const { data: streams, error: streamError } = await supabase
                .from('test_streams')
                .select(`
          *,
          tests (*)
        `)
                .eq('teacher_id', user.id)
                .eq('is_archived', true)
                .order('created_at', { ascending: false });

            if (streamError) throw streamError;

            // Fetch archived standalone tests
            const { data: standalone, error: standaloneError } = await supabase
                .from('tests')
                .select('*')
                .eq('teacher_id', user.id)
                .is('test_stream_id', null)
                .eq('is_archived', true)
                .order('created_at', { ascending: false });

            if (standaloneError) throw standaloneError;

            setTestStreams(streams || []);
            setStandaloneTests(standalone || []);
        } catch (error) {
            console.error('Error fetching archived assessments:', error);
        } finally {
            setLoading(false);
        }
    }

    const hasAssessments = testStreams.length > 0 || standaloneTests.length > 0;

    if (loading) {
        return (
            <div className="loading-container">
                Loading archived assessments...
            </div>
        );
    }

    return (
        <div className="assessments-page">
            <div className="page-header">
                <button
                    className="btn btn-icon"
                    onClick={() => navigate('/teacher/assessments')}
                    style={{ marginBottom: 'var(--spacing-md)' }}
                >
                    <ArrowLeft size={20} />
                    Back to Assessments
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                    <Archive size={32} />
                    <h1>Archived Tests</h1>
                </div>
            </div>

            {!hasAssessments ? (
                <div className="empty-state">
                    <div className="empty-icon">
                        <Archive size={64} strokeWidth={1.5} />
                    </div>
                    <h2>No archived tests</h2>
                    <p>When you archive a test, it will appear here.</p>
                </div>
            ) : (
                <div className="assessments-list">
                    {testStreams.map((stream) => (
                        <AssessmentCard
                            key={stream.id}
                            stream={stream}
                            onAction={fetchArchivedAssessments}
                            isArchivedView={true}
                        />
                    ))}
                    {standaloneTests.map((test) => (
                        <AssessmentCard
                            key={test.id}
                            test={test}
                            onAction={fetchArchivedAssessments}
                            isArchivedView={true}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
