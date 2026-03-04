import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { SyllabusService } from '../../lib/syllabusService';
import { ArrowLeft, Sparkles, Wand2, BookOpen, Layers, Check, Calculator, PieChart } from 'lucide-react';
import './AITestGenerator.css';

const SUBJECTS = [
    'Mathematics',
    'English',
    'Science',
    'Social Studies',
    'Religious Education',
    'Creative & Technology Studies',
    'Physical Education',
];

const GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];

export default function AITestGenerator() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        subject: '',
        grade: '',
        selectedTopics: [], // Array of topic objects {id, name, count}
        totalQuestions: 10,
        difficulty: 'Average',
    });
    const [genPhase, setGenPhase] = useState(0);
    const [availableTopics, setAvailableTopics] = useState([]);
    const [topicsLoading, setTopicsLoading] = useState(false);

    // Fetch topics from live DB whenever subject or grade changes
    const fetchTopicsFromDB = async (subject, grade) => {
        if (!subject || !grade) { setAvailableTopics([]); return; }
        setTopicsLoading(true);
        try {
            // 1. Find the matching subject ID
            const { data: subjectRows } = await supabase
                .from('subjects')
                .select('id')
                .ilike('name', subject)
                .limit(1);

            if (!subjectRows?.length) { setAvailableTopics([]); return; }

            // 2. Fetch topics for that subject + grade, ordered by term then name
            const { data: topicRows } = await supabase
                .from('topics')
                .select('id, name, term, code')
                .eq('subject_id', subjectRows[0].id)
                .eq('grade', grade)
                .order('term', { ascending: true })
                .order('name', { ascending: true });

            setAvailableTopics(topicRows || []);
        } catch (err) {
            console.error('Error fetching topics from DB:', err);
            setAvailableTopics([]);
        } finally {
            setTopicsLoading(false);
        }
    };

    const PHASES = [
        "Consulting the knowledge base...",
        "Drafting curriculum-aligned questions...",
        "Crafting multiple choice options...",
        "Mapping learning outcomes...",
        "Finalizing marking scheme..."
    ];

    useEffect(() => {
        let interval;
        if (loading) {
            interval = setInterval(() => {
                setGenPhase(prev => (prev + 1) % PHASES.length);
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [loading]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => {
            const newData = { ...prev, [name]: value };

            // Reset topics if subject or grade changes
            if (name === 'subject' || name === 'grade') {
                newData.selectedTopics = [];
                const newSubject = name === 'subject' ? value : prev.subject;
                const newGrade = name === 'grade' ? value : prev.grade;
                fetchTopicsFromDB(newSubject, newGrade);
            }

            // Distribute questions if total changes
            if (name === 'totalQuestions') {
                const total = parseInt(value) || 0;
                if (prev.selectedTopics.length > 0) {
                    const baseCount = Math.floor(total / prev.selectedTopics.length);
                    let remainder = total % prev.selectedTopics.length;

                    newData.selectedTopics = prev.selectedTopics.map((t, idx) => ({
                        ...t,
                        count: baseCount + (idx < remainder ? 1 : 0)
                    }));
                }
            }

            return newData;
        });
    };

    const handleTopicToggle = (topic) => {
        setFormData(prev => {
            const isSelected = prev.selectedTopics.find(t => t.id === topic.id);
            let newTopics;

            if (isSelected) {
                newTopics = prev.selectedTopics.filter(t => t.id !== topic.id);
            } else {
                newTopics = [...prev.selectedTopics, { ...topic, count: 0 }];
            }

            // Redistribute questions
            if (newTopics.length > 0) {
                const total = parseInt(prev.totalQuestions) || 0;
                const baseCount = Math.floor(total / newTopics.length);
                let remainder = total % newTopics.length;

                newTopics = newTopics.map((t, idx) => ({
                    ...t,
                    count: baseCount + (idx < remainder ? 1 : 0)
                }));
            }

            return { ...prev, selectedTopics: newTopics };
        });
    };

    const handleTopicCountChange = (topicId, count) => {
        const newCount = parseInt(count) || 0;
        setFormData(prev => ({
            ...prev,
            selectedTopics: prev.selectedTopics.map(t =>
                t.id === topicId ? { ...t, count: newCount } : t
            )
        }));
    };

    const getTotalAssigned = () => {
        return formData.selectedTopics.reduce((sum, t) => sum + (t.count || 0), 0);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            console.log('Generating test with AI (Enhanced Mode)...', formData);

            const MAX_CONCURRENCY = 3;
            const OPTIMAL_BATCH_SIZE = 10;
            const totalRequired = parseInt(formData.totalQuestions);

            // 1. Prepare Batches
            let requestBatches = [];
            if (availableTopics.length > 0) {
                // Topic Distribution Mode
                let currentBatchTopics = [];
                let currentBatchCount = 0;
                let remainingTopics = formData.selectedTopics.filter(t => t.count > 0).map(t => ({ ...t }));

                while (remainingTopics.length > 0) {
                    let space = OPTIMAL_BATCH_SIZE - currentBatchCount;
                    if (space <= 0) {
                        requestBatches.push(currentBatchTopics);
                        currentBatchTopics = [];
                        currentBatchCount = 0;
                        space = OPTIMAL_BATCH_SIZE;
                    }

                    let topic = remainingTopics[0];
                    let take = Math.min(topic.count, space);
                    currentBatchTopics.push({ ...topic, count: take });
                    currentBatchCount += take;
                    topic.count -= take;
                    if (topic.count <= 0) remainingTopics.shift();
                }
                if (currentBatchTopics.length > 0) requestBatches.push(currentBatchTopics);
            } else {
                // Manual Topic Mode
                let remaining = totalRequired;
                while (remaining > 0) {
                    const take = Math.min(remaining, OPTIMAL_BATCH_SIZE);
                    requestBatches.push({ count: take, manual: true });
                    remaining -= take;
                }
            }

            // 2. Process Batches with Contextual Awareness
            let allQuestions = [];
            let completedQuestions = 0;
            let existingQuestionTitles = [];

            // Helper for individual batch execution
            const runBatch = async (batch, batchIndex) => {
                const payload = {
                    mode: 'generate_test',
                    testParams: {
                        subject: formData.subject,
                        grade: formData.grade,
                        difficulty: formData.difficulty,
                        existingQuestions: existingQuestionTitles // Pass current context
                    },
                    geminiKey: import.meta.env.VITE_GEMINI_API_KEY
                };

                if (batch.manual) {
                    payload.testParams.topic = formData.topic;
                    payload.testParams.numQuestions = batch.count;
                } else {
                    payload.testParams.topics = batch;
                }

                let retries = 3;
                while (retries > 0) {
                    try {
                        const response = await fetch(
                            `https://gjiuseoqtzhdvxwvktfo.supabase.co/functions/v1/process-test-ai`,
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                                    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                                },
                                body: JSON.stringify(payload)
                            }
                        );

                        if (!response.ok) {
                            let errMessage = `Batch failed: ${response.status}`;
                            try {
                                const errData = await response.json();
                                if (response.status === 429) {
                                    await new Promise(r => setTimeout(r, (errData.retry_after || 15) * 1000));
                                    continue;
                                }
                                errMessage = `Error ${response.status}: ${errData.message || errData.error || JSON.stringify(errData)}`;
                            } catch (parseError) {
                                // If not JSON, it might throwing a generic HTML page or something
                                errMessage = `Error ${response.status}: Failed to parse error response from backend.`;
                            }
                            throw new Error(errMessage);
                        }

                        const data = await response.json();
                        const newQuestions = data.questions || [];

                        // Update context for variety
                        existingQuestionTitles = [...existingQuestionTitles, ...newQuestions.map(q => q.question_text).slice(0, 10)];

                        return newQuestions;
                    } catch (err) {
                        retries--;
                        if (retries === 0) throw err;
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }
            };

            // Execution Strategy: 
            // - If small test: Run all in parallel (max concurrency)
            // - If large test: Run in chunks to build context
            if (requestBatches.length <= MAX_CONCURRENCY) {
                const results = await Promise.all(requestBatches.map((b, i) => runBatch(b, i)));
                allQuestions = results.flat();
            } else {
                // Large test: Process in groups of concurrency limit to pass context forward
                for (let i = 0; i < requestBatches.length; i += MAX_CONCURRENCY) {
                    const currentGroup = requestBatches.slice(i, i + MAX_CONCURRENCY);
                    const groupResults = await Promise.all(currentGroup.map((b, idx) => runBatch(b, i + idx)));
                    allQuestions = [...allQuestions, ...groupResults.flat()];

                    // Update progress
                    setGenPhase(Math.min(4, Math.floor((allQuestions.length / totalRequired) * 4)));
                }
            }

            // 3. Post-process: number questions
            const rawQuestions = allQuestions.slice(0, totalRequired).map((q, index) => ({
                ...q,
                question_number: index + 1
            }));

            // 4. Resolve topic_id / subtopic_id / learning_outcome_id for every question
            //    Strategy:
            //    a) Build a fast-lookup map from the already-known selectedTopic IDs (topic name → topic id)
            //    b) Load the full grade syllabus once (for subtopic + learning_outcome resolution)
            //    c) Per question: resolve topic_id → subtopic_id → learning_outcome_id
            console.log('[TopicLink] Resolving syllabus IDs for', rawQuestions.length, 'questions...');

            // 4a. Build map from selected topic names → {id, subtopics[]}
            const selectedTopicMap = new Map();
            for (const t of formData.selectedTopics) {
                if (t.id && t.name) selectedTopicMap.set(t.name.toLowerCase().trim(), t);
            }

            // 4b. Load full grade syllabus for subtopic + learning_outcome resolution
            let gradeSyllabus = null;
            try {
                gradeSyllabus = await SyllabusService.getSyllabusForGrade(formData.grade);
            } catch (syllabusErr) {
                console.warn('[TopicLink] Could not load grade syllabus, questions will save without IDs:', syllabusErr.message);
            }

            // 4c. Resolve each question
            const finalQuestions = rawQuestions.map(q => {
                const resolved = { ...q };

                // Resolve topic_id: first check the selected topics map (exact/known IDs)
                const topicNameLower = (q.topic || '').toLowerCase().trim();
                let topicId = null;

                // Try the known-selected topics first (most reliable)
                const knownTopic = selectedTopicMap.get(topicNameLower);
                if (knownTopic) {
                    topicId = knownTopic.id;
                } else if (gradeSyllabus) {
                    // Fallback to fuzzy syllabus lookup
                    topicId = SyllabusService.resolveTopic(gradeSyllabus, q.topic, formData.subject);
                }

                resolved.topic_id = topicId || null;

                // Resolve subtopic_id if we have a topic and a subtopic string
                if (topicId && q.subtopic && gradeSyllabus) {
                    resolved.subtopic_id = SyllabusService.resolveSubtopic(gradeSyllabus, q.subtopic, topicId, formData.subject) || null;
                } else {
                    resolved.subtopic_id = null;
                }

                // Resolve learning_outcome_id if we have a subtopic
                if (resolved.subtopic_id && q.learning_outcome && gradeSyllabus) {
                    resolved.learning_outcome_id = SyllabusService.resolveLearningOutcome(gradeSyllabus, q.learning_outcome, resolved.subtopic_id, formData.subject) || null;
                } else {
                    resolved.learning_outcome_id = null;
                }

                if (resolved.topic_id) {
                    console.log(`[TopicLink] Q${q.question_number} "${q.topic}" → topic_id: ${resolved.topic_id}, subtopic_id: ${resolved.subtopic_id}`);
                } else {
                    console.warn(`[TopicLink] Q${q.question_number} "${q.topic}" → could not resolve to any topic ID`);
                }

                return resolved;
            });

            const linkedCount = finalQuestions.filter(q => q.topic_id).length;
            console.log(`[TopicLink] ${linkedCount}/${finalQuestions.length} questions successfully linked to syllabus`);

            // 5. Build topic summary
            const topicSummary = {};
            if (availableTopics.length > 0) {
                formData.selectedTopics.forEach(t => topicSummary[t.name] = t.count);
            } else {
                topicSummary[formData.topic] = formData.totalQuestions;
            }

            if (!user) throw new Error("User session not found");

            // 6. Save test record
            const { data: test, error: testError } = await supabase
                .from('tests')
                .insert({
                    teacher_id: user.id,
                    subject: formData.subject,
                    grade: formData.grade,
                    title: `AI Test: ${formData.subject} - ${formData.grade}`,
                    status: 'scheme_ready',
                })
                .select()
                .single();

            if (testError) throw testError;

            // 7. Save marking scheme with fully resolved questions
            const { error: schemeError } = await supabase
                .from('marking_schemes')
                .insert({
                    test_id: test.id,
                    questions: finalQuestions,
                    topic_summary: topicSummary
                });

            if (schemeError) throw schemeError;

            alert(`Test generated! ${linkedCount}/${finalQuestions.length} questions linked to syllabus topics.`);
            navigate(`/teacher/test/${test.id}`);

        } catch (error) {
            console.error('Error generating test:', error);
            alert(`Generation failed: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="ai-generator-page">
            <div className="page-container">
                <button className="back-button" onClick={() => navigate('/teacher/assessments')}>
                    <ArrowLeft size={20} />
                    Back to Assessments
                </button>

                <div className="page-header">
                    <div className="header-icon">
                        <Sparkles size={32} />
                    </div>
                    <h1>AI Test Generator</h1>
                    <p>Generate high-quality assessments and marking schemes in seconds</p>
                </div>

                <form onSubmit={handleSubmit} className="gen-form">
                    <div className="form-grid">
                        <div className="form-group">
                            <label className="label">
                                <BookOpen size={16} />
                                Subject
                            </label>
                            <select
                                name="subject"
                                className="input"
                                value={formData.subject}
                                onChange={handleChange}
                                required
                            >
                                <option value="">Select subject</option>
                                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="label">
                                <Layers size={16} />
                                Grade level
                            </label>
                            <select
                                name="grade"
                                className="input"
                                value={formData.grade}
                                onChange={handleChange}
                                required
                            >
                                <option value="">Select grade</option>
                                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="form-grid">
                        <div className="form-group">
                            <label className="label">
                                <Calculator size={16} />
                                Total Questions
                            </label>
                            <input
                                name="totalQuestions"
                                type="number"
                                min="1"
                                max="50"
                                className="input"
                                value={formData.totalQuestions}
                                onChange={handleChange}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">Difficulty</label>
                            <select
                                name="difficulty"
                                className="input"
                                value={formData.difficulty}
                                onChange={handleChange}
                                required
                            >
                                <option value="Basic">Basic</option>
                                <option value="Average">Average</option>
                                <option value="Advanced">Advanced</option>
                            </select>
                        </div>
                    </div>

                    {/* Loading indicator while fetching topics from DB */}
                    {formData.subject && formData.grade && topicsLoading && (
                        <div className="topics-loading">
                            <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
                            <span>Loading topics from syllabus...</span>
                        </div>
                    )}

                    {/* Manual Topic Fallback — only shown once fetch is done and nothing found */}
                    {formData.subject && formData.grade && !topicsLoading && availableTopics.length === 0 && (
                        <div className="form-group slide-in-up">
                            <label className="label">Topic or Curriculum Area</label>
                            <input
                                name="topic"
                                type="text"
                                className="input"
                                placeholder="e.g. Fractions, Photosynthesis, Ancient Rome"
                                value={formData.topic || ''}
                                onChange={handleChange}
                                required={availableTopics.length === 0}
                            />
                            <p className="input-hint">
                                No pre-defined syllabus topics found for this subject and grade yet. Enter a topic manually.
                            </p>
                        </div>
                    )}

                    {!topicsLoading && availableTopics.length > 0 && (
                        <div className="topics-selection-section">
                            <h3 className="section-title">
                                <Layers size={18} />
                                Select Topics &amp; Distribution
                            </h3>
                            <div className="topics-grid">
                                {availableTopics.map(topic => {
                                    const isSelected = formData.selectedTopics.find(t => t.id === topic.id);
                                    return (
                                        <div
                                            key={topic.id}
                                            className={`topic-checkbox-card ${isSelected ? 'selected' : ''}`}
                                            onClick={() => handleTopicToggle(topic)}
                                        >
                                            <div className="checkbox-ring">
                                                {isSelected && <div className="checkbox-dot" />}
                                            </div>
                                            <div className="topic-card-info">
                                                <span>{topic.name}</span>
                                                {topic.term && (
                                                    <span className="topic-term-chip">Term {topic.term}</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {formData.selectedTopics.length > 0 && (
                                <div className="distribution-panel">
                                    <div className="panel-header">
                                        <h4><PieChart size={16} /> Question Distribution</h4>
                                        <div className={`count-badge ${getTotalAssigned() !== parseInt(formData.totalQuestions) ? 'error' : 'success'}`}>
                                            {getTotalAssigned()} / {formData.totalQuestions} Assigned
                                        </div>
                                    </div>
                                    <div className="distribution-list">
                                        {formData.selectedTopics.map(topic => (
                                            <div key={topic.id} className="distribution-item">
                                                <span className="dist-name">{topic.name}</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max={formData.totalQuestions}
                                                    value={topic.count}
                                                    onChange={(e) => handleTopicCountChange(topic.id, e.target.value)}
                                                    className="dist-input"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    {getTotalAssigned() !== parseInt(formData.totalQuestions) && (
                                        <p className="validation-error">
                                            Total assigned questions must equal total questions ({formData.totalQuestions}).
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary btn-block btn-large gen-button"
                        disabled={loading || (availableTopics.length > 0 ? (formData.selectedTopics.length === 0 || getTotalAssigned() !== parseInt(formData.totalQuestions)) : !formData.topic)}
                    >
                        {loading ? (
                            <>
                                <div className="magic-loader">
                                    <Sparkles className="magic-sparkle" size={24} />
                                </div>
                                <div className="gen-status-container">
                                    <span className="gen-status-text">{PHASES[genPhase]}</span>
                                    <div className="progress-bar-mini">
                                        <div className="progress-fill" style={{ width: `${((genPhase + 1) / PHASES.length) * 100}%` }}></div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <Wand2 size={20} />
                                Generate Test & Scheme
                            </>
                        )}
                    </button>
                </form>

                <div className="ai-notice">
                    <Check size={16} />
                    <p>AI will generate questions, options, and a complete mapping of learning outcomes for this test.</p>
                </div>
            </div >
        </div >
    );
}
