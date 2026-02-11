import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { Plus, FileText, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AssessmentCard from '../../components/teacher/AssessmentCard';
import './Assessments.css';

export default function Assessments() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [testStreams, setTestStreams] = useState([]);
    const [standaloneTests, setStandaloneTests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateMenu, setShowCreateMenu] = useState(false);

    useEffect(() => {
        fetchAssessments();
    }, [user]);

    async function fetchAssessments() {
        if (!user) return;
        try {
            // Fetch test streams with their tests
            const { data: streams, error: streamError } = await supabase
                .from('test_streams')
                .select(`
          *,
          tests (*)
        `)
                .eq('teacher_id', user.id)
                .order('created_at', { ascending: false });

            if (streamError) throw streamError;

            // Fetch standalone tests (not part of any stream)
            const { data: standalone, error: standaloneError } = await supabase
                .from('tests')
                .select('*')
                .eq('teacher_id', user.id)
                .is('test_stream_id', null)
                .order('created_at', { ascending: false });

            if (standaloneError) throw standaloneError;

            setTestStreams(streams || []);
            setStandaloneTests(standalone || []);
        } catch (error) {
            console.error('Error fetching assessments:', error);
        } finally {
            setLoading(false);
        }
    }

    const handleCreateStream = () => {
        setShowCreateMenu(false);
        navigate('/teacher/create-stream');
    };

    const handleCreateTest = () => {
        setShowCreateMenu(false);
        // TODO: Implement standalone test creation
        alert('Standalone test creation coming soon!');
    };

    const hasAssessments = testStreams.length > 0 || standaloneTests.length > 0;

    if (loading) {
        return (
            <div className="loading-container">
                Loading assessments...
            </div>
        );
    }

    return (
        <div className="assessments-page">
            <div className="page-header">
                <h1>Assessments</h1>
            </div>

            {!hasAssessments ? (
                <div className="empty-state">
                    <div className="empty-icon">
                        <FileText size={64} strokeWidth={1.5} />
                    </div>
                    <h2>No assessments yet</h2>
                    <p>Create your first test or test stream to get started</p>
                    <div className="empty-actions">
                        <button className="btn btn-primary" onClick={handleCreateStream}>
                            <Plus size={20} />
                            Create Test Stream
                        </button>
                        <button className="btn btn-secondary" onClick={handleCreateTest}>
                            <Plus size={20} />
                            Create Single Test
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="assessments-list">
                        {testStreams.map((stream) => (
                            <AssessmentCard key={stream.id} stream={stream} />
                        ))}
                        {standaloneTests.map((test) => (
                            <AssessmentCard key={test.id} test={test} />
                        ))}
                    </div>

                    {/* Floating Action Button */}
                    <div className="fab-container">
                        <button
                            className="fab"
                            onClick={() => setShowCreateMenu(!showCreateMenu)}
                        >
                            <Plus size={24} />
                        </button>

                        {showCreateMenu && (
                            <div className="fab-menu">
                                <button className="fab-menu-item" onClick={handleCreateStream}>
                                    <Plus size={18} />
                                    Create Test Stream
                                </button>
                                <button className="fab-menu-item" onClick={() => navigate('/teacher/generate-test')}>
                                    <Sparkles size={18} />
                                    Generate with AI
                                </button>
                                <button className="fab-menu-item" onClick={handleCreateTest}>
                                    <Plus size={18} />
                                    Create Single Test
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
