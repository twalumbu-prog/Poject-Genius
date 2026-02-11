import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Sparkles, Wand2, BookOpen, Layers, Check, Calculator, PieChart } from 'lucide-react';
import { SYLLABUS_DATA, getTopics } from '../../data/ecz_syllabus';
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
                if (name === 'subject') {
                    setAvailableTopics(getTopics(value, prev.grade));
                } else {
                    setAvailableTopics(getTopics(prev.subject, value));
                }
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
            console.log('Generating test with AI (Batch Mode)...', formData);

            // 1. Prepare Batches to avoid huge payloads
            const BATCH_SIZE = 5; // Conservative batch size to ensure high quality and no truncation
            let requestBatches = [];

            if (availableTopics.length > 0) {
                // Topic Distribution Mode
                let currentBatchTopics = [];
                let currentBatchCount = 0;

                // Deep copy to track remaining counts
                let remainingTopics = formData.selectedTopics
                    .filter(t => t.count > 0)
                    .map(t => ({ ...t })); // Clone

                while (remainingTopics.length > 0) {
                    let space = BATCH_SIZE - currentBatchCount;

                    if (space <= 0) {
                        requestBatches.push(currentBatchTopics);
                        currentBatchTopics = [];
                        currentBatchCount = 0;
                        space = BATCH_SIZE;
                    }

                    let topic = remainingTopics[0];
                    let take = Math.min(topic.count, space);

                    // Add to current batch
                    currentBatchTopics.push({ ...topic, count: take });
                    currentBatchCount += take;

                    // Decrement remaining
                    topic.count -= take;
                    if (topic.count <= 0) {
                        remainingTopics.shift();
                    }
                }
                // Add final batch
                if (currentBatchTopics.length > 0) requestBatches.push(currentBatchTopics);

            } else {
                // Manual Topic Mode
                const total = parseInt(formData.totalQuestions);
                let remaining = total;
                while (remaining > 0) {
                    const take = Math.min(remaining, BATCH_SIZE);
                    requestBatches.push({ count: take, manual: true });
                    remaining -= take;
                }
            }

            console.log(`Split into ${requestBatches.length} batches`, requestBatches);

            // 2. Process Batches
            let allQuestions = [];
            let completedBatches = 0;

            // Sequential processing with rate limiting
            for (let i = 0; i < requestBatches.length; i++) {
                const batch = requestBatches[i];
                const isManual = batch.manual || false;

                const payload = {
                    mode: 'generate_test',
                    testParams: {
                        subject: formData.subject,
                        grade: formData.grade,
                        difficulty: formData.difficulty
                    }
                };

                if (isManual) {
                    payload.testParams.topic = formData.topic;
                    payload.testParams.numQuestions = batch.count;
                } else {
                    payload.testParams.topics = batch; // This is the array of topics for this batch
                }

                // Add delay between batches to respect rate limits (except for first batch)
                if (i > 0) {
                    console.log("Waiting 5 seconds for rate limit...");
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }

                // Retry logic for errors
                let retries = 3;
                let success = false;
                let quotaRetries = 2; // Separate counter for quota errors

                while (retries > 0 && !success) {
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
                            const errData = await response.json().catch(() => ({}));

                            // Handle 429 quota exceeded with proper retry delay
                            if (response.status === 429 && quotaRetries > 0) {
                                const retryAfter = errData.retry_after || 15;
                                console.warn(`Quota exceeded. Retrying after ${retryAfter} seconds... (${quotaRetries} quota retries left)`);
                                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                                quotaRetries--;
                                continue;
                            }

                            // Handle 500/503 with standard retry
                            if (response.status === 500 || response.status === 503) {
                                console.warn(`Batch failed with ${response.status}. Retrying... (${retries} left)`);
                                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s on error
                                retries--;
                                if (retries === 0) {
                                    throw new Error(errData.error?.message || errData.message || `Batch failed: ${response.status}`);
                                }
                                continue;
                            }

                            // Other errors - fail immediately
                            throw new Error(errData.error?.message || errData.message || `Batch failed: ${response.status}`);
                        }

                        const aiData = await response.json();

                        if (aiData.questions && Array.isArray(aiData.questions)) {
                            allQuestions = [...allQuestions, ...aiData.questions];
                        }
                        success = true;

                        completedBatches++;
                        // Update progress visually
                        setGenPhase(Math.min(4, Math.floor((completedBatches / requestBatches.length) * 4)));

                    } catch (err) {
                        console.error("Batch attempt failed:", err);
                        if (retries <= 1 && quotaRetries <= 0) throw err; // Throw on last retry
                        if (retries > 1) {
                            await new Promise(resolve => setTimeout(resolve, 10000));
                            retries--;
                        } else {
                            throw err;
                        }
                    }
                }
            }

            // 3. Post-process Questions (Re-numbering)
            const finalQuestions = allQuestions.map((q, index) => ({
                ...q,
                question_number: index + 1
            }));

            // Build topic summary from ORIGINAL distribution (what user asked for)
            const topicSummary = {};
            if (availableTopics.length > 0) {
                formData.selectedTopics.forEach(t => {
                    topicSummary[t.name] = t.count;
                });
            } else {
                topicSummary[formData.topic] = formData.totalQuestions;
            }

            // 4. Save to DB
            if (!user) throw new Error("User session not found");
            const { data: test, error: testError } = await supabase
                .from('tests')
                .insert({
                    teacher_id: user.id,
                    subject: formData.subject,
                    title: `AI Test: ${formData.subject} - ${formData.grade}`,
                    status: 'scheme_ready',
                })
                .select()
                .single();

            if (testError) throw testError;

            const { error: schemeError } = await supabase
                .from('marking_schemes')
                .insert({
                    test_id: test.id,
                    questions: finalQuestions,
                    topic_summary: topicSummary
                });

            if (schemeError) throw schemeError;

            alert('Test generated successfully!');
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

                    {/* Manual Topic Fallback */}
                    {formData.subject && formData.grade && availableTopics.length === 0 && (
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
                                No pre-defined syllabus topics found for this level. Please enter a topic manually.
                            </p>
                        </div>
                    )}

                    {availableTopics.length > 0 && (
                        <div className="topics-selection-section">
                            <h3 className="section-title">
                                <Layers size={18} />
                                Select Topics & Distribution
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
                                            <span>{topic.name}</span>
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
