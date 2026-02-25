import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Printer, Download, Mail } from 'lucide-react';
import PerformanceGraph from '../../components/teacher/PerformanceGraph';
import './ReportCardView.css';

export default function ReportCardView() {
    const { pupilId } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [pupil, setPupil] = useState(null);
    const [results, setResults] = useState([]);
    const [topicData, setTopicData] = useState({});
    const [loading, setLoading] = useState(true);

    const mode = searchParams.get('mode');
    const includeCharts = searchParams.get('includeCharts') === 'true';
    const streamId = searchParams.get('streamId');
    const testIdsRaw = searchParams.get('testIds');
    const testIds = testIdsRaw ? testIdsRaw.split(',') : [];

    useEffect(() => {
        fetchReportData();
    }, [pupilId, mode, streamId, testIdsRaw]);

    async function fetchReportData() {
        try {
            setLoading(true);
            // 1. Fetch pupil
            const { data: pupilData } = await supabase
                .from('pupils')
                .select('*')
                .eq('id', pupilId)
                .single();

            // 2. Fetch results and tests
            let query = supabase
                .from('results')
                .select('*, tests(*)')
                .eq('pupil_id', pupilId);

            if (mode === 'stream' && streamId) {
                // Get all tests in this stream
                const { data: streamTests } = await supabase
                    .from('tests')
                    .select('id')
                    .eq('test_stream_id', streamId);
                const sIds = (streamTests || []).map(t => t.id);
                query = query.in('test_id', sIds);
            } else if (mode === 'custom' && testIds.length > 0) {
                query = query.in('test_id', testIds);
            }

            const { data: resData } = await query.order('created_at', { ascending: true });

            // 3. Fetch topic analysis if charts enabled
            let groupedTopics = {};
            if (includeCharts && resData?.length > 0) {
                const resIds = resData.map(r => r.id);
                const { data: topicAnalysis } = await supabase
                    .from('topic_analysis')
                    .select('*')
                    .in('result_id', resIds)
                    .order('created_at', { ascending: true });

                const resultMap = {};
                resData.forEach(r => { resultMap[r.id] = r; });

                (topicAnalysis || []).forEach(ta => {
                    const res = resultMap[ta.result_id];
                    if (!res || !res.tests) return;
                    const subject = res.tests.subject;
                    const topic = ta.topic;

                    if (!groupedTopics[subject]) groupedTopics[subject] = {};
                    if (!groupedTopics[subject][topic]) groupedTopics[subject][topic] = [];

                    groupedTopics[subject][topic].push({
                        percentage: Number(ta.percentage),
                        date: res.created_at,
                        testTitle: res.tests.title,
                        totalQuestions: ta.total_questions,
                        correctAnswers: ta.correct_answers,
                        easy_total: ta.easy_total,
                        easy_correct: ta.easy_correct,
                        average_total: ta.average_total,
                        average_correct: ta.average_correct,
                        hard_total: ta.hard_total,
                        hard_correct: ta.hard_correct,
                    });
                });
            }

            setPupil(pupilData);
            setResults(resData || []);
            setTopicData(groupedTopics);
        } catch (error) {
            console.error('Error fetching report data:', error);
        } finally {
            setLoading(false);
        }
    }

    const handlePrint = () => {
        window.print();
    };

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <p>Preparing report card...</p>
            </div>
        );
    }

    // Group results by subject for the table
    const subjectSummary = {};
    results.forEach(res => {
        const sub = res.tests.subject;
        if (!subjectSummary[sub]) {
            subjectSummary[sub] = { tests: [], totalPct: 0, count: 0 };
        }
        subjectSummary[sub].tests.push(res);
        subjectSummary[sub].totalPct += res.percentage;
        subjectSummary[sub].count++;
    });

    const today = new Date().toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
    });

    return (
        <div className="report-card-page">
            <div className="report-controls no-print">
                <button className="back-button" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                    Back
                </button>
                <div className="report-actions">
                    <button className="btn btn-secondary" onClick={handlePrint}>
                        <Printer size={18} />
                        Print / Download PDF
                    </button>
                    <button className="btn btn-primary" disabled>
                        <Mail size={18} />
                        Email to Parent
                    </button>
                </div>
            </div>

            <div className="report-printable-area">
                <header className="report-header">
                    <div className="school-branding">
                        <div className="logo-placeholder">PG</div>
                        <div className="school-info">
                            <h1>Project Genius Academy</h1>
                            <p>Excellence in Personalized Education</p>
                        </div>
                    </div>
                    <div className="report-meta">
                        <div className="meta-item">
                            <span className="meta-label">Date:</span>
                            <span className="meta-value">{today}</span>
                        </div>
                        <div className="meta-item">
                            <span className="meta-label">Academic Year:</span>
                            <span className="meta-value">2025/2026</span>
                        </div>
                    </div>
                </header>

                <section className="student-profile-section">
                    <div className="student-info-grid">
                        <div className="info-box">
                            <label>Student Name</label>
                            <p>{pupil?.name}</p>
                        </div>
                        <div className="info-box">
                            <label>Grade / Level</label>
                            <p>{pupil?.grade || 'N/A'}</p>
                        </div>
                        <div className="info-box">
                            <label>Student ID</label>
                            <p>#{pupil?.id.split('-')[0].toUpperCase()}</p>
                        </div>
                    </div>
                </section>

                <section className="performance-summary">
                    <h3>Academic Performance Summary</h3>
                    <table className="report-table">
                        <thead>
                            <tr>
                                <th>Subject</th>
                                <th>Assessments</th>
                                <th>Average Score</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(subjectSummary).map(([sub, data]) => {
                                const avg = Math.round(data.totalPct / data.count);
                                let statusClass = 'status-average';
                                let statusText = 'Average';
                                if (avg >= 90) { statusClass = 'status-excellent'; statusText = 'Excellent'; }
                                else if (avg >= 70) { statusClass = 'status-good'; statusText = 'Good'; }
                                else if (avg < 50) { statusClass = 'status-weak'; statusText = 'Weak'; }

                                return (
                                    <tr key={sub}>
                                        <td><strong>{sub}</strong></td>
                                        <td>{data.count} test(s)</td>
                                        <td>{avg}%</td>
                                        <td>
                                            <span className={`status-pill ${statusClass}`}>
                                                {statusText}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </section>

                {includeCharts && Object.keys(topicData).length > 0 && (
                    <section className="topic-analysis-section">
                        <h3>Detailed Topic Analysis</h3>
                        <p className="section-hint">Historical performance breakdown across selected topics and subjects.</p>

                        {Object.entries(topicData).map(([subject, topics]) => (
                            <div key={subject} className="subject-chart-group">
                                <h4 className="subject-title">{subject}</h4>
                                <div className="charts-grid">
                                    {Object.entries(topics).map(([topicName, attempts]) => (
                                        <div key={topicName} className="report-chart-container">
                                            <h5 className="topic-title">{topicName}</h5>
                                            <PerformanceGraph attempts={attempts} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </section>
                )}

                <footer className="report-footer">
                    <div className="signature-line">
                        <div className="signature-box">
                            <div className="line"></div>
                            <span>Class Teacher's Signature</span>
                        </div>
                        <div className="signature-box">
                            <div className="line"></div>
                            <span>Head Teacher's Signature</span>
                        </div>
                    </div>
                    <div className="footer-bottom">
                        <p>This report was generated by Project Genius AI Education System.</p>
                        <p>© 2026 Project Genius All Rights Reserved.</p>
                    </div>
                </footer>
            </div>
        </div>
    );
}
