import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { SyllabusService } from '../../lib/syllabusService';
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp, FileText, Target, BookOpen, Layers, GraduationCap, Hash } from 'lucide-react';
import { SYLLABUS_DATA } from '../../data/ecz_syllabus';
import PerformanceGraph from '../../components/teacher/PerformanceGraph';
import ReportCardModal from '../../components/teacher/ReportCardModal';
import './StudentProfile.css';

const STATUS_CONFIG = {
    excellent: { label: 'Excellent', className: 'status-excellent' },
    good: { label: 'Good', className: 'status-good' },
    average: { label: 'Average', className: 'status-average' },
    weak: { label: 'Weak', className: 'status-weak' },
    struggling: { label: 'Struggling', className: 'status-struggling' },
    unattempted: { label: 'Unattempted', className: 'status-unattempted' },
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
    const [showReportModal, setShowReportModal] = useState(false);
    const [isSubjectOverviewOpen, setIsSubjectOverviewOpen] = useState(true);
    const [loading, setLoading] = useState(true);

    const VISIBLE_TABS = 3;

    useEffect(() => {
        fetchData();
    }, [pupilId]);

    async function fetchData() {
        try {
            // 1. Fetch pupil info
            const { data: pupilData, error: pupilError } = await supabase
                .from('pupils')
                .select('*')
                .eq('id', pupilId)
                .single();
            if (pupilError) throw pupilError;
            setPupil(pupilData);

            if (!pupilData.grade) {
                setLoading(false);
                return;
            }

            // 2. Fetch Structured Syllabus for this grade
            const hierarchy = await SyllabusService.getSyllabusForGrade(pupilData.grade);

            // 3. Fetch all results for this pupil
            const { data: resultsData } = await supabase
                .from('results')
                .select('id, test_id, created_at, tests(subject, title)')
                .eq('pupil_id', pupilId);

            const resultIds = (resultsData || []).map(r => r.id);
            if (resultIds.length === 0) {
                setSubjectData(hierarchy);
                setSubjects(Object.keys(hierarchy));
                setActiveSubject(Object.keys(hierarchy)[0] || null);
                setLoading(false);
                return;
            }

            // 4. Fetch all analysis levels
            const [topicData, subtopicData, loData] = await Promise.all([
                supabase.from('topic_analysis').select('*').in('result_id', resultIds),
                supabase.from('subtopic_analysis').select('*').in('result_id', resultIds),
                supabase.from('learning_outcome_analysis').select('*').in('result_id', resultIds)
            ]);

            // 5. Map Analysis to Hierarchy
            const enrichedHierarchy = JSON.parse(JSON.stringify(hierarchy)); // Deep clone

            Object.keys(enrichedHierarchy).forEach(subject => {
                Object.keys(enrichedHierarchy[subject]).forEach(term => {
                    enrichedHierarchy[subject][term].forEach(topic => {
                        // Attach topic stats
                        topic.attempts = (topicData.data || [])
                            .filter(ta => ta.topic_id === topic.id)
                            .map(ta => ({
                                percentage: Number(ta.percentage),
                                date: ta.created_at,
                                testTitle: resultsData.find(r => r.id === ta.result_id)?.tests?.title,
                                easy_total: ta.easy_total || 0,
                                easy_correct: ta.easy_correct || 0,
                                average_total: ta.average_total || 0,
                                average_correct: ta.average_correct || 0,
                                hard_total: ta.hard_total || 0,
                                hard_correct: ta.hard_correct || 0,
                                totalQuestions: (ta.easy_total || 0) + (ta.average_total || 0) + (ta.hard_total || 0)
                            }));

                        topic.subtopics.forEach(sub => {
                            // Attach subtopic stats
                            sub.attempts = (subtopicData.data || [])
                                .filter(sta => sta.subtopic_id === sub.id)
                                .map(sta => ({
                                    percentage: Number(sta.percentage),
                                    date: sta.created_at,
                                    testTitle: resultsData.find(r => r.id === sta.result_id)?.tests?.title,
                                    easy_total: sta.easy_total || 0,
                                    easy_correct: sta.easy_correct || 0,
                                    average_total: sta.average_total || 0,
                                    average_correct: sta.average_correct || 0,
                                    hard_total: sta.hard_total || 0,
                                    hard_correct: sta.hard_correct || 0,
                                    totalQuestions: (sta.easy_total || 0) + (sta.average_total || 0) + (sta.hard_total || 0)
                                }));

                            sub.learningOutcomes.forEach(lo => {
                                // Attach LO stats
                                lo.attempts = (loData.data || [])
                                    .filter(loa => loa.learning_outcome_id === lo.id)
                                    .map(loa => ({
                                        percentage: Number(loa.percentage),
                                        date: loa.created_at,
                                        testTitle: resultsData.find(r => r.id === loa.result_id)?.tests?.title,
                                        easy_total: loa.easy_total || 0,
                                        easy_correct: loa.easy_correct || 0,
                                        average_total: loa.average_total || 0,
                                        average_correct: loa.average_correct || 0,
                                        hard_total: loa.hard_total || 0,
                                        hard_correct: loa.hard_correct || 0,
                                        totalQuestions: (loa.easy_total || 0) + (loa.average_total || 0) + (loa.hard_total || 0)
                                    }));
                            });
                        });
                    });
                });
            });

            setSubjectData(enrichedHierarchy);
            const allSubjects = Object.keys(enrichedHierarchy).sort();
            setSubjects(allSubjects);
            setActiveSubject(allSubjects[0] || null);

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

    const currentSubjectData = activeSubject ? subjectData[activeSubject] || {} : {};
    const termEntries = Object.entries(currentSubjectData).sort();

    const handleGenerateReport = (config) => {
        setShowReportModal(false);
        const params = new URLSearchParams();
        params.set('mode', config.mode);
        params.set('includeCharts', config.includeCharts);
        if (config.streamId) params.set('streamId', config.streamId);
        if (config.testIds.length > 0) params.set('testIds', config.testIds.join(','));

        navigate(`/teacher/student/${pupilId}/report?${params.toString()}`);
    };

    const visibleSubjects = subjects.slice(0, VISIBLE_TABS);
    const moreSubjects = subjects.slice(VISIBLE_TABS);

    return (
        <div className="student-profile-page container">
            {/* Top nav - keeping it simple but aligned */}
            <div className="profile-nav">
                <span className="profile-brand">Project Genius</span>
            </div>

            {/* Back Row */}
            <div className="profile-back-row">
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/teacher/students')}>
                    <ArrowLeft size={18} />
                    Back to Students
                </button>
            </div>

            {/* Student Header - Focused Identity */}
            <div className="profile-header-meta">
                <div className="profile-identity">
                    <h1 className="profile-name">{pupil.name}</h1>
                    <div className="profile-meta-row">
                        {pupil.grade && (
                            <span className="meta-badge grade-badge">
                                <GraduationCap size={14} />
                                {pupil.grade}
                            </span>
                        )}
                        <span className="meta-badge id-badge">
                            <Hash size={14} />
                            {pupil.student_id || pupil.id.slice(0, 8)}
                        </span>
                    </div>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={() => setShowReportModal(true)}
                >
                    <FileText size={18} />
                    Create Report
                </button>
            </div>

            {/* Subject Tabs - Modern Pill Style */}
            {subjects.length > 0 && (
                <div className="subject-tabs-scroll">
                    <div className="subject-tabs-pills">
                        {subjects.map(subj => (
                            <button
                                key={subj}
                                className={`subject-pill ${activeSubject === subj ? 'active' : ''}`}
                                onClick={() => { setActiveSubject(subj); setExpandedTopic(null); }}
                            >
                                {subj}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {subjects.length === 0 && (
                <div className="profile-empty">
                    {pupil.grade ? (
                        <>
                            <p>No syllabus subjects found in the database.</p>
                            <p className="profile-empty-sub">Please ensure the syllabus is seeded correctly.</p>
                        </>
                    ) : (
                        <>
                            <p>Student grade is not set.</p>
                            <p className="profile-empty-sub">Edit the student's profile to assign a grade and view their full curriculum tracker.</p>
                        </>
                    )}
                </div>
            )}

            {activeSubject && termEntries.length === 0 && (
                <div className="profile-empty" style={{ minHeight: '200px' }}>
                    <p>No topics defined for {activeSubject} in {pupil.grade || 'this grade'}.</p>
                    <p className="profile-empty-sub">Topics will appear here once they are added to the syllabus database.</p>
                </div>
            )}

            {activeSubject && termEntries.length > 0 && (
                <div className={`subject-overview-card ${isSubjectOverviewOpen ? 'open' : ''}`}>
                    <button
                        className="overview-toggle-header"
                        onClick={() => setIsSubjectOverviewOpen(!isSubjectOverviewOpen)}
                    >
                        <div className="overview-header-content">
                            <div className="overview-main-stat">
                                <span className="overview-label">Subject Mastery</span>
                                <span className="overview-value mastery">
                                    {(() => {
                                        let total = 0;
                                        let count = 0;
                                        Object.values(currentSubjectData).forEach(topics => {
                                            topics.forEach(t => {
                                                if (t.attempts?.length > 0) {
                                                    total += t.attempts.reduce((s, a) => s + a.percentage, 0) / t.attempts.length;
                                                    count++;
                                                }
                                            });
                                        });
                                        return count > 0 ? `${Math.round(total / count)}%` : '0%';
                                    })()}
                                </span>
                            </div>
                            <div className="overview-sub-stats">
                                <div className="overview-stat">
                                    <span className="overview-label">Progress</span>
                                    <span className="overview-value sm">
                                        {(() => {
                                            let attempted = 0;
                                            let total = 0;
                                            Object.values(currentSubjectData).forEach(topics => {
                                                topics.forEach(t => {
                                                    total++;
                                                    if (t.attempts?.length > 0) attempted++;
                                                });
                                            });
                                            return `${attempted}/${total} Topics`;
                                        })()}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="overview-chevron">
                            {isSubjectOverviewOpen ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
                        </div>
                    </button>

                    {isSubjectOverviewOpen && (
                        <div className="overview-body">
                            {/* Overall Subject Graph */}
                            {(() => {
                                const allAttempts = [];
                                Object.values(currentSubjectData).forEach(topics => {
                                    topics.forEach(t => {
                                        if (t.attempts) allAttempts.push(...t.attempts);
                                    });
                                });
                                return allAttempts.length > 0 ? (
                                    <div className="overview-chart-wrapper">
                                        <PerformanceGraph attempts={allAttempts.sort((a, b) => new Date(a.date) - new Date(b.date))} />
                                    </div>
                                ) : (
                                    <div className="overview-empty">
                                        <p>Perform assessments to see progress trends here.</p>
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                </div>
            )}

            <div className="syllabus-hierarchy">
                {termEntries.map(([termName, topics]) => (
                    <div key={termName} className="term-section">
                        <div className="term-header">
                            <Layers size={16} />
                            <h3>{termName}</h3>
                        </div>
                        <div className="topics-accordion">
                            {topics.map(topic => {
                                const hasAttempts = topic.attempts && topic.attempts.length > 0;
                                const avg = hasAttempts
                                    ? Math.round(topic.attempts.reduce((s, a) => s + a.percentage, 0) / topic.attempts.length)
                                    : 0;
                                const status = hasAttempts ? getTopicStatus(avg) : 'unattempted';
                                const config = STATUS_CONFIG[status];
                                const isTopicOpen = expandedTopic === topic.id;

                                return (
                                    <div key={topic.id} className={`topic-accordion-card ${isTopicOpen ? 'open' : ''} ${!hasAttempts ? 'unattempted' : ''}`}>
                                        <button
                                            className="topic-accordion-header"
                                            onClick={() => setExpandedTopic(isTopicOpen ? null : topic.id)}
                                        >
                                            <div className="topic-info">
                                                <div className="topic-icon-wrapper">
                                                    <BookOpen size={18} />
                                                </div>
                                                <span className="topic-accordion-name">{topic.name}</span>
                                            </div>
                                            <div className="topic-meta">
                                                <span className={`badge ${hasAttempts ? `badge-${config.label.toLowerCase()}` : 'badge-unattempted'}`}>
                                                    {config.label}
                                                    {hasAttempts && <span className="perc">{avg}%</span>}
                                                </span>
                                                <div className="chevron-icon">
                                                    {isTopicOpen ? <ChevronUp size={18} /> : <ChevronRight size={18} />}
                                                </div>
                                            </div>
                                        </button>

                                        {isTopicOpen && (
                                            <div className="topic-accordion-body">
                                                {hasAttempts && <PerformanceGraph attempts={topic.attempts} />}

                                                <div className="subtopics-list">
                                                    {topic.subtopics.map(sub => {
                                                        const subAvg = sub.attempts?.length
                                                            ? Math.round(sub.attempts.reduce((s, a) => s + a.percentage, 0) / sub.attempts.length)
                                                            : null;

                                                        return (
                                                            <div key={sub.id} className="subtopic-item">
                                                                <div className="subtopic-row">
                                                                    <div className="subtopic-name">
                                                                        <Target size={14} />
                                                                        <span>{sub.name}</span>
                                                                    </div>
                                                                    {subAvg !== null && (
                                                                        <span className={`mini-badge ${getTopicStatus(subAvg)}`}>
                                                                            {subAvg}%
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                <div className="lo-list">
                                                                    {sub.learningOutcomes.map(lo => {
                                                                        const loAvg = lo.attempts?.length
                                                                            ? Math.round(lo.attempts.reduce((s, a) => s + a.percentage, 0) / lo.attempts.length)
                                                                            : null;

                                                                        return (
                                                                            <div key={lo.id} className="lo-item">
                                                                                <p className="lo-desc">{lo.description}</p>
                                                                                {loAvg !== null && (
                                                                                    <div className="lo-bar-bg">
                                                                                        <div
                                                                                            className={`lo-bar-fill ${getTopicStatus(loAvg)}`}
                                                                                            style={{ width: `${loAvg}%` }}
                                                                                        />
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <ReportCardModal
                isOpen={showReportModal}
                onClose={() => setShowReportModal(false)}
                pupilId={pupilId}
                subjects={subjects}
                onGenerate={handleGenerateReport}
            />
        </div>
    );
}
