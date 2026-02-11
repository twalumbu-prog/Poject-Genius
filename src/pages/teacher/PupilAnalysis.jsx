import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, TrendingUp, TrendingDown, CheckCircle, XCircle } from 'lucide-react';
import { formatPercentage } from '../../utils/formatters';
import './Page.css';

export default function PupilAnalysis() {
    const { pupilId, testId } = useParams();
    const navigate = useNavigate();
    const [pupil, setPupil] = useState(null);
    const [result, setResult] = useState(null);
    const [topicAnalysis, setTopicAnalysis] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAnalysisData();
    }, [pupilId, testId]);

    async function fetchAnalysisData() {
        try {
            const { data: pupilData, error: pupilError } = await supabase
                .from('pupils')
                .select('*')
                .eq('id', pupilId)
                .single();

            if (pupilError) throw pupilError;

            const { data: resultData, error: resultError } = await supabase
                .from('results')
                .select('*')
                .eq('pupil_id', pupilId)
                .eq('test_id', testId)
                .single();

            if (resultError) throw resultError;

            const { data: topicsData, error: topicsError } = await supabase
                .from('topic_analysis')
                .select('*')
                .eq('result_id', resultData.id)
                .order('percentage', { ascending: false });

            if (topicsError) throw topicsError;

            setPupil(pupilData);
            setResult(resultData);
            setTopicAnalysis(topicsData || []);
        } catch (error) {
            console.error('Error fetching analysis:', error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="loading-container">Loading...</div>;
    }

    if (!pupil || !result) {
        return <div className="loading-container">Data not found</div>;
    }

    return (
        <div className="page page-with-container">
            <button className="back-button" onClick={() => navigate(`/teacher/test/${testId}`)}>
                <ArrowLeft size={20} />
                Back to Results
            </button>

            <div className="page-header">
                <h1>{pupil.name}</h1>
                <div className="overall-score">
                    <span className="score-label">Overall Score</span>
                    <span className="score-value">{formatPercentage(result.percentage)}</span>
                </div>
            </div>

            <div className="analysis-section">
                <h2>Topic Performance</h2>
                {topicAnalysis.length > 0 ? (
                    <div className="topics-list">
                        {topicAnalysis.map((topic) => (
                            <div key={topic.id} className="topic-card">
                                <div className="topic-header">
                                    <h3>{topic.topic}</h3>
                                    <div className="topic-score">
                                        {topic.percentage >= 70 ? (
                                            <TrendingUp size={20} className="trend-up" />
                                        ) : topic.percentage < 50 ? (
                                            <TrendingDown size={20} className="trend-down" />
                                        ) : null}
                                        <span>{formatPercentage(topic.percentage)}</span>
                                    </div>
                                </div>
                                <div className="topic-details">
                                    <span>{topic.correct_answers} / {topic.total_questions} questions correct</span>
                                </div>
                                <div className="progress-bar">
                                    <div
                                        className={`progress-fill ${topic.percentage >= 70 ? 'good' : topic.percentage < 50 ? 'poor' : 'average'
                                            }`}
                                        style={{ width: `${topic.percentage}%` }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="no-data">No topic analysis available yet</p>
                )}
            </div>

            {result.answers && result.answers.length > 0 && (
                <div className="analysis-section">
                    <h2>Detailed Answer Breakdown</h2>
                    <div className="table-container">
                        <table className="analysis-table">
                            <thead>
                                <tr>
                                    <th>Q#</th>
                                    <th>Your Answer</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.answers.sort((a, b) => a.question_number - b.question_number).map((answer) => (
                                    <tr key={answer.question_number} className={answer.is_correct ? 'row-correct' : 'row-wrong'}>
                                        <td className="col-q-num">{answer.question_number}</td>
                                        <td className="col-answer">{answer.student_answer}</td>
                                        <td className="col-status">
                                            {answer.is_correct ? (
                                                <div className="status-badge correct">
                                                    <CheckCircle size={16} />
                                                    <span>Correct</span>
                                                </div>
                                            ) : (
                                                <div className="status-badge wrong">
                                                    <XCircle size={16} />
                                                    <span>Wrong</span>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
