import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Camera, Upload, Loader, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import './Page.css';

export default function MarkTest() {
    const { testId } = useParams();
    const navigate = useNavigate();
    const [test, setTest] = useState(null);
    const [markingScheme, setMarkingScheme] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStatus, setProcessingStatus] = useState('');
    const [results, setResults] = useState(null);
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

            const { data: schemeData, error: schemeError } = await supabase
                .from('marking_schemes')
                .select('*')
                .eq('test_id', testId)
                .single();

            if (schemeError && schemeError.code !== 'PGRST116') throw schemeError;

            setTest(testData);
            setMarkingScheme(schemeData);
        } catch (error) {
            console.error('Error fetching test data:', error);
        } finally {
            setLoading(false);
        }
    }

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file || !markingScheme) return;

        try {
            setIsProcessing(true);
            setProcessingStatus('Analyzing script with AI...');

            // Convert to base64
            const reader = new FileReader();
            const base64Promise = new Promise((resolve) => {
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(file);
            });
            const base64Image = await base64Promise;

            // 1. Call AI Marking Edge Function
            const { data, error: invokeError } = await supabase.functions.invoke('process-test-ai', {
                body: {
                    mode: 'mark_script',
                    image: base64Image,
                    markingScheme: markingScheme.questions
                }
            });

            if (invokeError) throw invokeError;
            if (data.error) throw new Error(data.error);

            const { studentName, answers: studentAnswers } = data;

            // 2. Calculate Stats
            const correctCount = studentAnswers.filter(a => a.is_correct).length;
            const score = correctCount;
            const percentage = (correctCount / markingScheme.questions.length) * 100;

            // 3. Save or Get Pupil
            let pupilId;
            const { data: existingPupil } = await supabase
                .from('pupils')
                .select('id')
                .eq('name', studentName)
                .maybeSingle();

            if (existingPupil) {
                pupilId = existingPupil.id;
            } else {
                const { data: newPupil, error: pError } = await supabase
                    .from('pupils')
                    .insert({ name: studentName })
                    .select()
                    .single();
                if (pError) throw pError;
                pupilId = newPupil.id;
            }

            // 4. Save Result
            const { data: result, error: resError } = await supabase
                .from('results')
                .upsert({
                    test_id: testId,
                    pupil_id: pupilId,
                    answers: studentAnswers,
                    score,
                    percentage
                })
                .select()
                .single();

            if (resError) throw resError;

            // 5. Generate Topic Analysis
            const topicPerformance = {};
            markingScheme.questions.forEach(q => {
                if (!topicPerformance[q.topic]) {
                    topicPerformance[q.topic] = {
                        correct: 0, total: 0,
                        easy_correct: 0, easy_total: 0,
                        average_correct: 0, average_total: 0,
                        hard_correct: 0, hard_total: 0,
                    };
                }
                const tp = topicPerformance[q.topic];
                tp.total++;

                const difficulty = q.difficulty || 'average';
                tp[`${difficulty}_total`]++;

                const studentAns = studentAnswers.find(a => a.question_number === q.question_number);
                if (studentAns?.is_correct) {
                    tp.correct++;
                    tp[`${difficulty}_correct`]++;
                }
            });

            const analysisEntries = Object.entries(topicPerformance).map(([topic, data]) => ({
                result_id: result.id,
                topic,
                total_questions: data.total,
                correct_answers: data.correct,
                percentage: (data.correct / data.total) * 100,
                easy_total: data.easy_total,
                easy_correct: data.easy_correct,
                average_total: data.average_total,
                average_correct: data.average_correct,
                hard_total: data.hard_total,
                hard_correct: data.hard_correct,
            }));

            // Clean up old analysis for this result
            await supabase.from('topic_analysis').delete().eq('result_id', result.id);

            const { error: analysisError } = await supabase
                .from('topic_analysis')
                .insert(analysisEntries);

            if (analysisError) throw analysisError;

            setResults({ studentName, score, percentage, correctCount, studentAnswers });
            alert(`Successfully marked script for ${studentName}! Score: ${correctCount}/${markingScheme.questions.length}`);
        } catch (error) {
            console.error('AI Processing Error:', error);
            alert(`AI Marking failed: ${error.message}`);
        } finally {
            setIsProcessing(false);
            setProcessingStatus('');
        }
    };

    const triggerFileUpload = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,application/pdf';
        input.onchange = handleFileUpload;
        input.click();
    };

    if (loading) return <div className="loading-container">Loading marking data...</div>;

    if (!markingScheme) {
        return (
            <div className="page page-with-container">
                <button className="back-button" onClick={() => navigate(`/teacher/test/${testId}`)}>
                    <ArrowLeft size={20} />
                    Back to Test
                </button>
                <div className="empty-state">
                    <AlertCircle size={48} className="icon-error" />
                    <h2>No Marking Scheme Found</h2>
                    <p>You must create or generate a marking scheme before you can mark student scripts.</p>
                    <button className="btn btn-primary" onClick={() => navigate(`/teacher/stream/${test.test_stream_id}/setup`)}>
                        Go to Setup
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="page page-with-container">
            <button className="back-button" onClick={() => navigate(`/teacher/test/${testId}`)}>
                <ArrowLeft size={20} />
                Back to Test
            </button>

            <div className="page-header">
                <h1>Mark {test.subject}</h1>
                <p className="subtitle">Upload student scripts for automatic marking</p>
            </div>

            {!results ? (
                <div className="mark-options">
                    <div className="mark-option-card" onClick={triggerFileUpload}>
                        <div className="option-icon">
                            <Camera size={48} strokeWidth={1.5} />
                        </div>
                        <h3>Scan or Upload Script</h3>
                        <p>Take a photo or upload a scanned student answer sheet</p>
                    </div>
                </div>
            ) : (
                <div className="success-banner-large" style={{ textAlign: "left", alignItems: "flex-start" }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                        <CheckCircle size={48} className="icon-success" />
                        <h2 style={{ margin: 0 }}>Marking Complete!</h2>
                    </div>

                    <div className="result-summary-box" style={{ width: '100%', marginBottom: '24px' }}>
                        <p><strong>Student:</strong> {results.studentName}</p>
                        <p><strong>Total Score:</strong> {results.score} / {markingScheme.questions.length}</p>
                        <p><strong>Percentage:</strong> {results.percentage.toFixed(1)}%</p>
                    </div>

                    <h3 style={{ marginBottom: '16px' }}>Detailed Breakdown</h3>
                    <div className="answers-breakdown" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
                        {results.studentAnswers && results.studentAnswers.map((ans, idx) => (
                            <div key={idx} style={{
                                padding: '12px',
                                border: `1px solid ${ans.is_correct ? '#10b981' : '#ef4444'}`,
                                borderRadius: '8px',
                                backgroundColor: ans.is_correct ? '#ecfdf5' : '#fef2f2'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <strong>Q{ans.question_number}</strong>
                                    <span style={{
                                        padding: '2px 8px',
                                        borderRadius: '12px',
                                        fontSize: '0.8rem',
                                        backgroundColor: ans.confidence === 'Low' ? '#fef08a' : (ans.confidence === 'Medium' ? '#bfdbfe' : '#bbf7d0'),
                                        color: '#374151'
                                    }}>
                                        {ans.confidence} Confidence
                                    </span>
                                </div>
                                <div style={{ marginBottom: '4px' }}>
                                    Student Answer: <strong style={{ color: ans.is_correct ? '#059669' : '#dc2626' }}>{ans.student_answer || 'None'}</strong>
                                </div>
                                {!ans.is_correct && ans.feedback && (
                                    <div style={{ fontSize: '0.9rem', color: '#4b5563', marginTop: '8px', padding: '8px', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: '4px' }}>
                                        <strong>AI Note:</strong> {ans.feedback}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="banner-actions" style={{ marginTop: '24px', width: '100%', display: 'flex', gap: '12px' }}>
                        <button className="btn btn-primary" onClick={() => setResults(null)}>
                            Mark Another Script
                        </button>
                        <button className="btn btn-secondary" onClick={() => navigate(`/teacher/test/${testId}`)}>
                            View All Results
                        </button>
                    </div>
                </div>
            )}

            {isProcessing && (
                <div className="processing-overlay">
                    <div className="processing-content">
                        <div className="ai-icon-pulse">
                            <Sparkles size={48} />
                        </div>
                        <h3>{processingStatus}</h3>
                        <p>Using OpenAI Vision for high-accuracy handwriting analysis...</p>
                    </div>
                </div>
            )}

            <div className="info-box">
                <h4>💡 Production Hint</h4>
                <p>
                    For best results, ensure:
                </p>
                <ul>
                    <li>Student name is clearly written after "Name:"</li>
                    <li>Answers are numbered (1. A, 2. B, etc.)</li>
                    <li>The image is clear and well-lit</li>
                </ul>
            </div>
        </div>
    );
}
