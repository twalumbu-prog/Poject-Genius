import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import PerformanceGraph from '../../components/teacher/PerformanceGraph';
import './StudentProfile.css';

const STATUS_CONFIG = {
    excellent: { label: 'Excellent', className: 'status-excellent' },
    good: { label: 'Good', className: 'status-good' },
    average: { label: 'Average', className: 'status-average' },
    weak: { label: 'Weak', className: 'status-weak' },
    struggling: { label: 'Struggling', className: 'status-struggling' },
};

function getTopicStatus(avgPercentage) {
    if (avgPercentage >= 90) return 'excellent';
    if (avgPercentage >= 70) return 'good';
    if (avgPercentage >= 50) return 'average';
    if (avgPercentage >= 30) return 'weak';
    return 'struggling';
}

export default function StudentProfile() {
    const { pupilId } = useParams();
    const navigate = useNavigate();
    const [pupil, setPupil] = useState(null);
    const [subjectData, setSubjectData] = useState({});
    const [subjects, setSubjects] = useState([]);
    const [activeSubject, setActiveSubject] = useState(null);
    const [expandedTopic, setExpandedTopic] = useState(null);
    const [showMoreSubjects, setShowMoreSubjects] = useState(false);
    const [loading, setLoading] = useState(true);

    const VISIBLE_TABS = 3;

    useEffect(() => {
        fetchData();
    }, [pupilId]);

    async function fetchData() {
        try {
            // Fetch pupil info
            const { data: pupilData, error: pupilError } = await supabase
                .from('pupils')
                .select('*')
                .eq('id', pupilId)
                .single();
            if (pupilError) throw pupilError;

            // Fetch all results for this pupil, joining test info
            const { data: resultsData, error: resultsError } = await supabase
                .from('results')
                .select(`
                    id,
                    test_id,
                    score,
                    percentage,
                    created_at,
                    tests (
                        id,
                        subject,
                        title
                    )
                `)
                .eq('pupil_id', pupilId)
                .order('created_at', { ascending: true });
            if (resultsError) throw resultsError;

            // Fetch all topic_analysis for all of these results
            const resultIds = (resultsData || []).map(r => r.id);
            let topicRows = [];
            if (resultIds.length > 0) {
                const { data: topicData, error: topicError } = await supabase
                    .from('topic_analysis')
                    .select('*')
                    .in('result_id', resultIds)
                    .order('created_at', { ascending: true });
                if (topicError) throw topicError;
                topicRows = topicData || [];
            }

            // Build a map: result_id -> result (with test info)
            const resultMap = {};
            (resultsData || []).forEach(r => {
                resultMap[r.id] = r;
            });

            // Group by subject -> topic -> [{ percentage, date, testTitle }]
            const grouped = {};
            topicRows.forEach(ta => {
                const result = resultMap[ta.result_id];
                if (!result || !result.tests) return;
                const subject = result.tests.subject;
                const topic = ta.topic;

                if (!grouped[subject]) grouped[subject] = {};
                if (!grouped[subject][topic]) grouped[subject][topic] = [];

                grouped[subject][topic].push({
                    percentage: Number(ta.percentage),
                    date: result.created_at,
                    testTitle: result.tests.title,
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

            const subjectList = Object.keys(grouped).sort();

            setPupil(pupilData);
            setSubjectData(grouped);
            setSubjects(subjectList);
            setActiveSubject(subjectList[0] || null);
        } catch (error) {
            console.error('Error fetching student profile:', error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <span style={{ color: 'var(--color-accent-primary)', fontWeight: 700 }}>Loading profile...</span>
            </div>
        );
    }

    if (!pupil) {
        return <div className="loading-container">Student not found</div>;
    }

    const currentTopics = activeSubject ? subjectData[activeSubject] || {} : {};
    const topicEntries = Object.entries(currentTopics).sort((a, b) => {
        // Sort by average percentage descending
        const avgA = a[1].reduce((s, v) => s + v.percentage, 0) / a[1].length;
        const avgB = b[1].reduce((s, v) => s + v.percentage, 0) / b[1].length;
        return avgB - avgA;
    });

    const visibleSubjects = subjects.slice(0, VISIBLE_TABS);
    const moreSubjects = subjects.slice(VISIBLE_TABS);

    return (
        <div className="student-profile-page">
            {/* Top nav */}
            <div className="profile-nav">
                <span className="profile-brand">Project Genius</span>
            </div>

            {/* Back */}
            <div className="profile-back-row">
                <button className="back-button" onClick={() => navigate('/teacher/students')}>
                    <ArrowLeft size={20} />
                    Back
                </button>
            </div>

            {/* Student Name */}
            <div className="profile-identity">
                <h1 className="profile-name">{pupil.name}</h1>
                {pupil.grade && <p className="profile-grade">{pupil.grade}</p>}
            </div>

            {/* Subject Tabs */}
            {subjects.length > 0 && (
                <div className="subject-tabs-row">
                    {visibleSubjects.map(subj => (
                        <button
                            key={subj}
                            className={`subject-tab ${activeSubject === subj ? 'active' : ''}`}
                            onClick={() => { setActiveSubject(subj); setExpandedTopic(null); }}
                        >
                            {subj}
                        </button>
                    ))}
                    {moreSubjects.length > 0 && (
                        <div className="more-subjects-wrapper">
                            <button
                                className={`subject-tab more-tab ${showMoreSubjects ? 'active' : ''}`}
                                onClick={() => setShowMoreSubjects(!showMoreSubjects)}
                            >
                                +{moreSubjects.length} More...
                            </button>
                            {showMoreSubjects && (
                                <div className="more-dropdown">
                                    {moreSubjects.map(subj => (
                                        <button
                                            key={subj}
                                            className={`more-dropdown-item ${activeSubject === subj ? 'active' : ''}`}
                                            onClick={() => {
                                                setActiveSubject(subj);
                                                setExpandedTopic(null);
                                                setShowMoreSubjects(false);
                                            }}
                                        >
                                            {subj}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Topic Cards */}
            {subjects.length === 0 && (
                <div className="profile-empty">
                    <p>No topic-level analysis available yet.</p>
                    <p className="profile-empty-sub">Analyze a test with topics to see performance data here.</p>
                </div>
            )}

            <div className="topics-accordion">
                {topicEntries.map(([topicName, attempts]) => {
                    const avg = Math.round(attempts.reduce((s, a) => s + a.percentage, 0) / attempts.length);
                    const status = getTopicStatus(avg);
                    const config = STATUS_CONFIG[status];
                    const isOpen = expandedTopic === topicName;

                    return (
                        <div key={topicName} className={`topic-accordion-card ${isOpen ? 'open' : ''}`}>
                            <button
                                className="topic-accordion-header"
                                onClick={() => setExpandedTopic(isOpen ? null : topicName)}
                            >
                                <span className="topic-accordion-name">{topicName}</span>
                                <span className={`topic-status-badge ${config.className}`}>
                                    {config.label}
                                </span>
                                {isOpen ? <ChevronUp size={20} /> : <ChevronRight size={20} />}
                            </button>
                            {isOpen && (
                                <div className="topic-accordion-body">
                                    <PerformanceGraph attempts={attempts} />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
