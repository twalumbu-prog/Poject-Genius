import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Camera, Upload, Loader, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import { applyDocScanFilter } from '../../utils/imageProcessing';
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
    const [pupils, setPupils] = useState([]);
    const [reviewData, setReviewData] = useState(null);
    const [scannedImage, setScannedImage] = useState(null);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('script'); // 'script' or 'answers' for mobile
    const [videoRef, setVideoRef] = useState(null);
    const [showLightbox, setShowLightbox] = useState(false);

    useEffect(() => {
        fetchTestData();
        fetchPupils();
    }, [testId]);

    async function fetchPupils() {
        try {
            const { data, error } = await supabase
                .from('pupils')
                .select('*')
                .order('name');
            if (error) throw error;
            setPupils(data);
        } catch (error) {
            console.error('Error fetching pupils:', error);
        }
    }

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
            const rawBase64 = await base64Promise;

            setProcessingStatus('Enhancing image for better AI accuracy...');
            const filteredBase64 = await applyDocScanFilter(rawBase64);
            const base64Image = filteredBase64;

            // 1. Call AI Marking Edge Function
            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-test-ai`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    },
                    body: JSON.stringify({
                        mode: 'mark_script',
                        image: base64Image,
                        markingScheme: markingScheme.questions,
                        geminiKey: import.meta.env.VITE_GEMINI_API_KEY
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || errorData.error || `Error ${response.status}`);
            }

            const data = await response.json();

            const { studentName, answers: studentAnswers } = data;

            setScannedImage(base64Image);
            setReviewData({
                studentName: studentName || '',
                studentAnswers: markingScheme.questions.map(q => {
                    const aiAns = studentAnswers.find(a => a.question_number === q.question_number);
                    return {
                        question_number: q.question_number,
                        student_answer: aiAns?.student_answer || '',
                        is_correct: aiAns ? aiAns.is_correct : false,
                        feedback: aiAns?.feedback || (aiAns ? '' : 'Missing from extraction'),
                        confidence: aiAns?.confidence || 'Low',
                        topic: q.topic
                    };
                })
            });
        } catch (error) {
            console.error('AI Processing Error:', error);
            alert(`AI Marking failed: ${error.message}`);
        } finally {
            setIsProcessing(false);
            setProcessingStatus('');
        }
    };

    const handleSaveResult = async () => {
        if (!reviewData) return;

        try {
            setIsProcessing(true);
            setProcessingStatus('Saving results...');

            const { studentName, studentAnswers } = reviewData;

            // 1. Calculate Stats
            const correctCount = studentAnswers.filter(a => a.is_correct).length;
            const score = correctCount;
            const percentage = (correctCount / markingScheme.questions.length) * 100;

            // 2. Save or Get Pupil
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

            // 3. Save Result
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


            // 4. Generate Topic Analysis
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
            setReviewData(null);
        } catch (error) {
            console.error('Error saving result:', error);
            alert(`Error saving: ${error.message}`);
        } finally {
            setIsProcessing(false);
            setProcessingStatus('');
        }
    };

    const updateReviewAnswer = (index, field, value) => {
        const newAnswers = [...reviewData.studentAnswers];
        const updatedAns = { ...newAnswers[index], [field]: value };

        // Re-evaluate correctness if student_answer changed
        if (field === 'student_answer') {
            const questionNumber = updatedAns.question_number;
            const originalQ = markingScheme.questions.find(q => q.question_number === questionNumber);
            if (originalQ) {
                updatedAns.is_correct = value.trim().toUpperCase() === originalQ.correct_answer.trim().toUpperCase();
            }
        }

        newAnswers[index] = updatedAns;
        setReviewData({ ...reviewData, studentAnswers: newAnswers });
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
                <datalist id="pupil-list">
                    {pupils.map(p => <option key={p.id} value={p.name} />)}
                </datalist>
            </div>

            {isCameraOpen && (
                <div className="camera-modal">
                    <div className="camera-content">
                        <div className="camera-header">
                            <h3>Document Scanner</h3>
                            <button className="btn-close" onClick={() => {
                                if (videoRef && videoRef.srcObject) {
                                    videoRef.srcObject.getTracks().forEach(track => track.stop());
                                }
                                setIsCameraOpen(false);
                            }}>×</button>
                        </div>
                        <div className="video-wrapper">
                            <video
                                ref={el => {
                                    setVideoRef(el);
                                    if (el && !el.srcObject) {
                                        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
                                            .then(stream => { el.srcObject = stream; el.play(); })
                                            .catch(err => console.error("Camera error:", err));
                                    }
                                }}
                                autoPlay
                                playsInline
                            />
                            <div className="scanner-overlay">
                                <div className="scanner-frame"></div>
                            </div>
                        </div>
                        <div className="camera-footer">
                            <button className="btn btn-primary btn-capture" onClick={async () => {
                                if (!videoRef) return;

                                const canvas = document.createElement('canvas');
                                const videoWidth = videoRef.videoWidth;
                                const videoHeight = videoRef.videoHeight;

                                // Calculate the A4 Crop Box (Matching .scanner-frame CSS: 80% width, 70% height)
                                const cropWidth = videoWidth * 0.8;
                                const cropHeight = videoHeight * 0.7;
                                const cropX = (videoWidth - cropWidth) / 2;
                                const cropY = (videoHeight - cropHeight) / 2;

                                canvas.width = cropWidth;
                                canvas.height = cropHeight;

                                const ctx = canvas.getContext('2d');
                                // Draw only the cropped portion
                                ctx.drawImage(videoRef, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

                                const rawBase64 = canvas.toDataURL('image/jpeg', 0.9);

                                // Stop camera
                                if (videoRef.srcObject) {
                                    videoRef.srcObject.getTracks().forEach(track => track.stop());
                                }
                                setIsCameraOpen(false);

                                // Process as if it was uploaded
                                try {
                                    setIsProcessing(true);
                                    setProcessingStatus('Crunching handwriting...');
                                    const filteredBase64 = await applyDocScanFilter(rawBase64);

                                    // Trigger AI marking directly
                                    setProcessingStatus('Analyzing script with AI...');
                                    const response = await fetch(
                                        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-test-ai`,
                                        {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                                                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                                            },
                                            body: JSON.stringify({
                                                mode: 'mark_script',
                                                image: filteredBase64,
                                                markingScheme: markingScheme.questions,
                                                geminiKey: import.meta.env.VITE_GEMINI_API_KEY
                                            })
                                        }
                                    );

                                    if (!response.ok) throw new Error("AI failed");
                                    const data = await response.json();

                                    setScannedImage(filteredBase64);
                                    setReviewData({
                                        studentName: data.studentName || '',
                                        studentAnswers: markingScheme.questions.map(q => {
                                            const aiAns = data.answers.find(a => a.question_number === q.question_number);
                                            return {
                                                question_number: q.question_number,
                                                student_answer: aiAns?.student_answer || '',
                                                is_correct: aiAns ? aiAns.is_correct : false,
                                                feedback: aiAns?.feedback || (aiAns ? '' : 'Missing from extraction'),
                                                confidence: aiAns?.confidence || 'Low',
                                                topic: q.topic
                                            };
                                        })
                                    });
                                } catch (error) {
                                    alert(`Scan failed: ${error.message}`);
                                } finally {
                                    setIsProcessing(false);
                                    setProcessingStatus('');
                                }
                            }}>
                                <Camera size={24} />
                                Capture Script
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {!reviewData && !results && (
                <div className="mark-options">
                    <div className="mark-option-card" onClick={() => setIsCameraOpen(true)}>
                        <div className="option-icon">
                            <Camera size={48} strokeWidth={1.5} />
                        </div>
                        <h3>Scan Script</h3>
                        <p>Use your camera to scan student answer sheet</p>
                    </div>
                    <div className="mark-option-card" onClick={triggerFileUpload}>
                        <div className="option-icon">
                            <Upload size={48} strokeWidth={1.5} />
                        </div>
                        <h3>Upload Image</h3>
                        <p>Upload a photo or PDF from your gallery</p>
                    </div>
                </div>
            )}

            {reviewData && !results && (
                <div className="review-interface">
                    <div className="review-header">
                        <h2>Review Extraction</h2>
                        <div className="review-tabs">
                            <button
                                className={`tab-btn ${activeTab === 'script' ? 'active' : ''}`}
                                onClick={() => setActiveTab('script')}
                            >
                                View Script
                            </button>
                            <button
                                className={`tab-btn ${activeTab === 'answers' ? 'active' : ''}`}
                                onClick={() => setActiveTab('answers')}
                            >
                                Verify Answers
                            </button>
                        </div>
                        <div className="review-actions">
                            <button className="btn btn-secondary" onClick={() => setReviewData(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSaveResult}>Confirm & Save</button>
                        </div>
                    </div>

                    <div className={`review-content mobile-tab-${activeTab}`}>
                        <div className="review-image-pane">
                            <h3>Scanned Script</h3>
                            <p className="hint-text">Click image to enlarge</p>
                            <div className="image-container" onClick={() => setShowLightbox(true)}>
                                <img src={scannedImage} alt="Scanned Script" />
                            </div>
                        </div>

                        <div className="review-data-pane">
                            <div className="student-info-review">
                                <label>Student Name</label>
                                <input
                                    type="text"
                                    list="pupil-list"
                                    value={reviewData.studentName}
                                    onChange={(e) => setReviewData({ ...reviewData, studentName: e.target.value })}
                                    placeholder="Enter student name"
                                    className="student-name-input"
                                />
                            </div>

                            <h3>Verification</h3>
                            <div className="review-answers-list">
                                {reviewData.studentAnswers.map((ans, idx) => (
                                    <div key={idx} className={`review-item ${ans.confidence === 'Low' || !ans.student_answer ? 'review-warning' : ''}`}>
                                        <div className="review-item-header">
                                            <span className="q-circle">Q{ans.question_number}</span>
                                            <span className={`status-badge ${ans.is_correct ? 'correct' : 'incorrect'}`}>
                                                {ans.is_correct ? 'Correct' : 'Incorrect'}
                                            </span>
                                        </div>
                                        <div className="review-item-body">
                                            <div className="field-group">
                                                <label>Extracted Answer</label>
                                                <input
                                                    type="text"
                                                    value={ans.student_answer}
                                                    onChange={(e) => updateReviewAnswer(idx, 'student_answer', e.target.value)}
                                                />
                                            </div>
                                            {ans.feedback && (
                                                <div className="review-note">
                                                    <strong>AI Note:</strong> {ans.feedback}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {results && (
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
                        <div className="ai-loader-container">
                            <div className="ai-ring"></div>
                            <div className="ai-ring"></div>
                            <div className="ai-ring"></div>
                            <Sparkles size={32} className="ai-loader-icon" />
                        </div>
                        <h3>{processingStatus}</h3>
                        <p>High-accuracy AI vision analysis in progress...</p>
                    </div>
                </div>
            )}

            {showLightbox && (
                <div className="lightbox-overlay" onClick={() => setShowLightbox(false)}>
                    <div className="lightbox-content" onClick={e => e.stopPropagation()}>
                        <button className="lightbox-close" onClick={() => setShowLightbox(false)}>×</button>
                        <img src={scannedImage} alt="Full Screen Scan" />
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
