import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, FileCheck, Settings, Plus, Sparkles, FileText } from 'lucide-react';
import { formatPercentage, formatRank } from '../../utils/formatters';
import './Page.css';

export default function TestDetails() {
    const { testId } = useParams();
    const navigate = useNavigate();
    const [test, setTest] = useState(null);
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchTestData();
    }, [testId]);

    async function fetchTestData() {
        try {
            const { data: testData, error: testError } = await supabase
                .from('tests')
                .select('*, test_streams(*)')
                .eq('id', testId)
                .single();

            if (testError) throw testError;

            const { data: resultsData, error: resultsError } = await supabase
                .from('results')
                .select('*, pupils(*)')
                .eq('test_id', testId)
                .order('percentage', { ascending: false });

            if (resultsError) throw resultsError;

            setTest(testData);
            setResults(resultsData || []);
        } catch (error) {
            console.error('Error fetching test:', error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="loading-container">Loading...</div>;
    }

    if (!test) {
        return <div className="loading-container">Test not found</div>;
    }

    const hasResults = results.length > 0;
    const canMark = test.status === 'scheme_ready' || test.status === 'marking' || test.status === 'completed';

    return (
        <div className="page page-with-container">
            <button className="back-button" onClick={() => navigate('/teacher/assessments')}>
                <ArrowLeft size={20} />
                Back
            </button>

            <div className="page-header">
                <h1>{test.subject}</h1>
                {test.test_streams && (
                    <p className="subtitle">{test.test_streams.title}</p>
                )}
            </div>

            <div className="test-actions-bar">
                <div className="action-buttons">
                    {test.test_paper_url && (
                        <a
                            href={test.test_paper_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary"
                        >
                            <FileText size={18} />
                            View Test Paper
                        </a>
                    )}
                    <button
                        className="btn btn-secondary"
                        onClick={() => navigate(`/teacher/test/${testId}/review`)}
                    >
                        <Settings size={18} />
                        Adjust Marking Scheme
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={() => navigate(`/teacher/test/${testId}/mark`)}
                    >
                        <Plus size={18} />
                        Mark Scripts
                    </button>
                </div>
            </div>

            {!hasResults && (
                <div className="empty-state">
                    <div className="empty-icon">
                        <Sparkles size={64} strokeWidth={1.5} />
                    </div>
                    <h2>Ready to Mark?</h2>
                    <p>Scan your student scripts or upload image files to begin automatic marking.</p>
                </div>
            )}

            {hasResults && (
                <div className="results-container">

                    <div className="results-list">
                        <h2 className="results-header">Student Results</h2>
                        {results.map((result, index) => (
                            <div
                                key={result.id}
                                className="result-card"
                                onClick={() => navigate(`/teacher/pupil/${result.pupil_id}/analysis/${testId}`)}
                            >
                                <div className={`result-rank ${index === 0 ? 'rank-first' : ''}`}>
                                    {formatRank(index + 1)}
                                </div>
                                <div className="result-info">
                                    <h3>{result.pupils.name}</h3>
                                    <p>{result.answers?.length || 0} questions answered</p>
                                </div>
                                <div className="result-score">
                                    <div className="score-percentage">
                                        {formatPercentage(result.percentage)}
                                    </div>
                                    <div className="score-fraction">
                                        {result.score} marks
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
