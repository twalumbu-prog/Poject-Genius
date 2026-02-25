import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Save, Plus, Trash2, CheckCircle, AlertCircle, HelpCircle, Sparkles, Loader, Printer } from 'lucide-react';
import './Page.css';
import './MarkingSchemeReview.css';

export default function MarkingSchemeReview() {
    const { testId } = useParams();
    const navigate = useNavigate();
    const [test, setTest] = useState(null);
    const [markingScheme, setMarkingScheme] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchSchemeData();
    }, [testId]);

    async function fetchSchemeData() {
        try {
            setLoading(true);
            const { data: testData, error: testError } = await supabase
                .from('tests')
                .select('*, test_streams(*)')
                .eq('id', testId)
                .single();

            if (testError) throw testError;

            const { data: schemeData, error: schemeError } = await supabase
                .from('marking_schemes')
                .select('*')
                .eq('test_id', testId)
                .single();

            if (schemeError) {
                if (schemeError.code === 'PGRST116') {
                    // No scheme yet
                    setQuestions([]);
                } else {
                    throw schemeError;
                }
            } else {
                setMarkingScheme(schemeData);
                setQuestions(schemeData.questions || []);
            }

            setTest(testData);
        } catch (err) {
            console.error('Error fetching scheme:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    const handleQuestionChange = (index, field, value) => {
        const newQuestions = [...questions];
        newQuestions[index] = { ...newQuestions[index], [field]: value };
        setQuestions(newQuestions);
    };

    const handleOptionChange = (qIndex, oIndex, value) => {
        const newQuestions = [...questions];
        const newOptions = [...(newQuestions[qIndex].options || ['', '', '', ''])];
        newOptions[oIndex] = value;
        newQuestions[qIndex] = { ...newQuestions[qIndex], options: newOptions };
        setQuestions(newQuestions);
    };

    const addQuestion = () => {
        const nextNum = questions.length > 0 ? Math.max(...questions.map(q => q.question_number)) + 1 : 1;
        setQuestions([...questions, {
            question_number: nextNum,
            question_text: '',
            options: ['', '', '', ''],
            correct_answer: '',
            topic: '',
            difficulty: 'average',
            subtopic: '',
            learning_outcome: ''
        }]);
    };

    const deleteQuestion = (index) => {
        const newQuestions = questions.filter((_, i) => i !== index);
        setQuestions(newQuestions);
    };

    const handleAIUpdate = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        try {
            setGenerating(true);
            setError(null);

            // Convert file to base64 for OpenAI Vision
            const reader = new FileReader();
            const base64Promise = new Promise((resolve) => {
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(file);
            });
            const base64Image = await base64Promise;

            const { data, error: invokeError } = await supabase.functions.invoke('process-test-ai', {
                body: {
                    mode: 'generate_key',
                    image: base64Image,
                    geminiKey: import.meta.env.VITE_GEMINI_API_KEY
                }
            });

            if (invokeError) throw invokeError;
            if (data.error) throw new Error(data.error);

            if (data.questions) {
                setQuestions(data.questions);
            }

            alert('Marking scheme generated from image successfully!');
        } catch (err) {
            console.error('Error generating AI scheme:', err);
            setError(`AI Generation failed: ${err.message}`);
        } finally {
            setGenerating(false);
        }
    };

    const handleFillAnswers = async () => {
        if (questions.length === 0) return;

        try {
            setGenerating(true);
            setError(null);

            const { data, error: invokeError } = await supabase.functions.invoke('process-test-ai', {
                body: {
                    mode: 'solve_questions',
                    testParams: {
                        questions: questions.map(q => ({
                            question_number: q.question_number,
                            question_text: q.question_text,
                            options: q.options
                        })),
                        geminiKey: import.meta.env.VITE_GEMINI_API_KEY
                    }
                }
            });

            if (invokeError) throw invokeError;
            if (data.error) throw new Error(data.error);

            if (data.questions) {
                const updatedQuestions = questions.map(q => {
                    const solved = data.questions.find(s => s.question_number === q.question_number);
                    if (solved) {
                        return {
                            ...q,
                            correct_answer: solved.correct_answer,
                            explanation: solved.explanation || q.explanation
                        };
                    }
                    return q;
                });
                setQuestions(updatedQuestions);
                alert('Answers populated successfully by AI!');
            }
        } catch (err) {
            console.error('Error filling answers:', err);
            setError(`AI Solving failed: ${err.message}`);
        } finally {
            setGenerating(false);
        }
    };

    const triggerAIUpload = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = handleAIUpdate;
        input.click();
    };

    const handlePrint = () => {
        window.print();
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            setError(null);

            // Validate questions
            if (questions.some(q => !q.correct_answer || !q.topic)) {
                throw new Error('All questions must have a correct answer and a topic.');
            }

            const topicSummary = {};
            questions.forEach(q => {
                topicSummary[q.topic] = (topicSummary[q.topic] || 0) + 1;
            });

            if (markingScheme) {
                const { error: updateError } = await supabase
                    .from('marking_schemes')
                    .update({
                        questions,
                        topic_summary: topicSummary
                    })
                    .eq('id', markingScheme.id);

                if (updateError) throw updateError;
            } else {
                const { error: insertError } = await supabase
                    .from('marking_schemes')
                    .insert({
                        test_id: testId,
                        questions,
                        topic_summary: topicSummary
                    });

                if (insertError) throw insertError;

                // Update test status if it was pending
                if (test.status === 'pending' || test.status === 'uploaded') {
                    await supabase.from('tests').update({ status: 'scheme_ready' }).eq('id', testId);
                }
            }

            alert('Marking scheme saved successfully!');
            navigate(`/teacher/test/${testId}`);
        } catch (err) {
            console.error('Error saving scheme:', err);
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="loading-container">Loading marking scheme...</div>;

    if (!test) return <div className="loading-container">Test not found</div>;

    return (
        <div className="page page-with-container review-page">
            <div className="review-header-fixed">
                <button className="back-button" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                    Back
                </button>
                <div className="header-content">
                    <h1>Review Marking Scheme</h1>
                    <p>{test.subject} - {test.title}</p>
                </div>
                <div className="header-actions">
                    <button
                        className="btn btn-secondary ai-btn"
                        onClick={triggerAIUpload}
                        disabled={generating || saving}
                    >
                        {generating ? <Loader size={18} className="spinner" /> : <Sparkles size={18} />}
                        {generating ? 'Analyzing Image...' : 'Generate from Image'}
                    </button>
                    <button
                        className="btn btn-secondary ai-btn"
                        onClick={handleFillAnswers}
                        disabled={generating || saving || questions.length === 0}
                    >
                        {generating ? <Loader size={18} className="spinner" /> : <Sparkles size={18} />}
                        {generating ? 'Solving...' : 'Fill Answers with AI'}
                    </button>
                    <button
                        className="btn btn-secondary print-btn"
                        onClick={handlePrint}
                        disabled={questions.length === 0}
                    >
                        <Printer size={18} />
                        Print Test
                    </button>
                    <button
                        className="btn btn-primary save-btn"
                        onClick={handleSave}
                        disabled={saving || generating}
                    >
                        {saving ? <Loader size={18} className="spinner" /> : <Save size={18} />}
                        Save Changes
                    </button>
                </div>
            </div>

            <div className="review-content">
                {error && (
                    <div className="error-banner">
                        <AlertCircle size={20} />
                        <p>{error}</p>
                    </div>
                )}

                <div className="questions-list">
                    {questions.length === 0 ? (
                        <div className="empty-questions">
                            <HelpCircle size={48} strokeWidth={1} />
                            <p>No questions in this marking scheme yet.</p>
                            <button className="btn btn-secondary" onClick={addQuestion}>
                                <Plus size={18} />
                                Add First Question
                            </button>
                        </div>
                    ) : (
                        questions.map((q, index) => (
                            <div key={index} className="question-edit-card">
                                <div className="question-num">
                                    <span>Q{q.question_number}</span>
                                    <button className="delete-q-btn" onClick={() => deleteQuestion(index)}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                <div className="question-body-edit">
                                    <div className="field-group full-width" data-question={q.question_text || ''}>
                                        <label className="screen-only">Question Text</label>
                                        <textarea
                                            value={q.question_text || ''}
                                            onChange={(e) => handleQuestionChange(index, 'question_text', e.target.value)}
                                            placeholder="Enter the question being asked..."
                                            className="input input-sm textarea-q screen-only"
                                            rows={2}
                                        />
                                        <div className="print-only question-text-print">
                                            {q.question_text}
                                        </div>
                                    </div>

                                    <div className="options-grid-edit">
                                        {['A', 'B', 'C', 'D'].map((letter, oIdx) => (
                                            <div
                                                key={letter}
                                                className="field-group"
                                            >
                                                <label className="screen-only">Option {letter}</label>
                                                <input
                                                    type="text"
                                                    value={q.options?.[oIdx] || ''}
                                                    onChange={(e) => handleOptionChange(index, oIdx, e.target.value)}
                                                    placeholder={`Option ${letter}`}
                                                    className="input input-sm screen-only"
                                                />
                                                <div className="print-only option-text-print">
                                                    <strong>{letter}.</strong> {q.options?.[oIdx]}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="question-fields">
                                    <div className="field-group">
                                        <label>Correct Answer</label>
                                        <select
                                            value={q.correct_answer || ''}
                                            onChange={(e) => handleQuestionChange(index, 'correct_answer', e.target.value)}
                                            className="input input-sm"
                                        >
                                            <option value="">Select</option>
                                            <option value="A">A</option>
                                            <option value="B">B</option>
                                            <option value="C">C</option>
                                            <option value="D">D</option>
                                            <option value="E">E</option>
                                        </select>
                                    </div>
                                    <div className="field-group flex-grow">
                                        <label>Topic</label>
                                        <input
                                            type="text"
                                            value={q.topic || ''}
                                            onChange={(e) => handleQuestionChange(index, 'topic', e.target.value)}
                                            placeholder="e.g. Algebra"
                                            className="input input-sm"
                                        />
                                    </div>
                                    <div className="field-group">
                                        <label>Difficulty</label>
                                        <select
                                            value={q.difficulty || 'average'}
                                            onChange={(e) => handleQuestionChange(index, 'difficulty', e.target.value)}
                                            className="input input-sm"
                                        >
                                            <option value="easy">Easy</option>
                                            <option value="average">Average</option>
                                            <option value="hard">Hard</option>
                                        </select>
                                    </div>
                                    <div className="field-group flex-grow">
                                        <label>Cognitive Level</label>
                                        <input
                                            type="text"
                                            value={q.cognitive_level || ''}
                                            onChange={(e) => handleQuestionChange(index, 'cognitive_level', e.target.value)}
                                            placeholder="e.g. Analysis"
                                            className="input input-sm"
                                        />
                                    </div>
                                    <div className="field-group flex-grow">
                                        <label>Learning Outcome</label>
                                        <input
                                            type="text"
                                            value={q.learning_outcome || ''}
                                            onChange={(e) => handleQuestionChange(index, 'learning_outcome', e.target.value)}
                                            placeholder="e.g. Solving linear equations"
                                            className="input input-sm"
                                        />
                                    </div>
                                </div>
                                <div className="question-fields">
                                    <div className="field-group full-width">
                                        <label>Explanation / Rationale</label>
                                        <textarea
                                            value={q.explanation || ''}
                                            onChange={(e) => handleQuestionChange(index, 'explanation', e.target.value)}
                                            placeholder="Explain why the answer is correct..."
                                            className="input input-sm"
                                            rows={2}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {questions.length > 0 && (
                    <button className="btn btn-secondary add-q-btn-large" onClick={addQuestion}>
                        <Plus size={20} />
                        Add Another Question
                    </button>
                )}
            </div>
        </div>
    );
}

