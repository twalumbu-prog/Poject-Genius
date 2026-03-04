import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { ArrowLeft, Mic, Square, Play, RefreshCw, CheckCircle, User, BookOpen, Clock, AlertCircle } from 'lucide-react';
import './ReadingSession.css';

export default function ReadingSession() {
    const { passageId } = useParams();
    const { user } = useAuth();
    const navigate = useNavigate();

    const [passage, setPassage] = useState(null);
    const [pupils, setPupils] = useState([]);
    const [selectedPupil, setSelectedPupil] = useState(null);
    const [loading, setLoading] = useState(true);

    const [step, setStep] = useState('select-pupil'); // 'select-pupil' | 'ready' | 'recording' | 'processing'
    const [isRecording, setIsRecording] = useState(false);
    const [audioBlob, setAudioBlob] = useState(null);
    const [timer, setTimer] = useState(0);
    const timerRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);

    useEffect(() => {
        fetchInitialData();
    }, [passageId]);

    async function fetchInitialData() {
        try {
            const [passageRes, pupilsRes] = await Promise.all([
                supabase.from('reading_passages').select('*').eq('id', passageId).single(),
                supabase.from('pupils').select('*').order('name')
            ]);

            if (passageRes.error) throw passageRes.error;
            if (pupilsRes.error) throw pupilsRes.error;

            setPassage(passageRes.data);
            setPupils(pupilsRes.data);
        } catch (err) {
            console.error('Error fetching data:', err);
        } finally {
            setLoading(false);
        }
    }

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                setAudioBlob(blob);
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);
            setStep('recording');
            setTimer(0);
            timerRef.current = setInterval(() => {
                setTimer(prev => prev + 1);
            }, 1000);
        } catch (err) {
            console.error('Error starting recording:', err);
            alert('Could not access microphone. Please check permissions.');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
            setIsRecording(false);
            clearInterval(timerRef.current);
            setStep('processing');
            handleUploadAndProcess();
        }
    };

    const handleUploadAndProcess = async () => {
        try {
            // 1. Wait for blob if not ready
            let blob = audioBlob;
            if (!blob) {
                // Small delay to ensure onstop finished
                await new Promise(resolve => setTimeout(resolve, 500));
                blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            }

            // 2. Upload to Storage
            const timestamp = Date.now();
            const filePath = `${user.id}/${selectedPupil.id}/${passageId}_${timestamp}.webm`;

            const { error: uploadError } = await supabase.storage
                .from('reading-audio')
                .upload(filePath, blob);

            if (uploadError) throw uploadError;

            // 3. Call Edge Function
            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-reading-assessment`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    },
                    body: JSON.stringify({
                        mode: 'process_reading', // Using a specific mode for analysis
                        audioUrl: filePath,
                        passageText: passage.text,
                        passageId: passage.id,
                        pupilId: selectedPupil.id,
                        teacherId: user.id,
                        geminiKey: import.meta.env.VITE_GEMINI_API_KEY
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'AI processing failed');
            }
            const data = await response.json();

            // 4. Redirect to results
            navigate(`/teacher/reading/results/${data.sessionId}`);

        } catch (err) {
            console.error('Processing Error:', err);
            alert(`Analysis failed: ${err.message}`);
            setStep('ready'); // Go back to ready so they can retry
        }
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (loading) return <div className="loading">Loading session...</div>;

    return (
        <div className="reading-session-page">
            <div className="session-container">
                <button className="back-button" onClick={() => navigate('/teacher/assessments')}>
                    <ArrowLeft size={20} />
                    Exit Session
                </button>

                {step === 'select-pupil' && (
                    <div className="step-card select-pupil-card slide-in">
                        <h2>Select Student</h2>
                        <p>Who is reading today?</p>
                        <div className="pupil-grid">
                            {pupils.map(p => (
                                <button
                                    key={p.id}
                                    className={`pupil-btn ${selectedPupil?.id === p.id ? 'selected' : ''}`}
                                    onClick={() => setSelectedPupil(p)}
                                >
                                    <div className="pupil-avatar">
                                        {p.name.charAt(0)}
                                    </div>
                                    <div className="pupil-info">
                                        <span className="name">{p.name}</span>
                                        <span className="grade">{p.grade}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                        <button
                            className="btn btn-primary btn-block mt-xl"
                            disabled={!selectedPupil}
                            onClick={() => setStep('ready')}
                        >
                            Confirm Selection
                        </button>
                    </div>
                )}

                {step === 'ready' && (
                    <div className="step-card ready-card slide-in">
                        <div className="pupil-highlight">
                            <User size={48} />
                            <h3>Ready to Test: {selectedPupil.name}</h3>
                            <span className="badge">{selectedPupil.grade}</span>
                        </div>

                        <div className="passage-preview">
                            <div className="preview-header">
                                <BookOpen size={18} />
                                <span>{passage.title}</span>
                            </div>
                            <p className="preview-text">{passage.text.substring(0, 150)}...</p>
                        </div>

                        <div className="instructions">
                            <h4>How it works:</h4>
                            <ul>
                                <li>Press 'Start Recording' when the student begins.</li>
                                <li>The student should read the text aloud clearly.</li>
                                <li>Press 'Stop' when they finish the passage.</li>
                            </ul>
                        </div>

                        <button className="btn btn-primary btn-block btn-large start-btn" onClick={startRecording}>
                            <Mic size={24} />
                            Start Recording
                        </button>
                    </div>
                )}

                {step === 'recording' && (
                    <div className="recording-interface slide-in">
                        <div className="recording-header">
                            <div className="timer">
                                <Clock size={16} />
                                <span>{formatTime(timer)}</span>
                            </div>
                            <div className="recording-indicator">
                                <div className="dot"></div>
                                <span>Recording {selectedPupil.name}...</span>
                            </div>
                        </div>

                        <div className="passage-display card">
                            <h1>{passage.title}</h1>
                            <div className="passage-text">
                                {passage.text}
                            </div>
                        </div>

                        <button className="stop-btn" onClick={stopRecording}>
                            <Square size={32} fill="white" />
                            <span>Stop Reading</span>
                        </button>
                    </div>
                )}

                {step === 'processing' && (
                    <div className="step-card processing-card slide-in">
                        <div className="processing-loader">
                            <RefreshCw size={64} className="spin" />
                        </div>
                        <h2>Analysing Performance</h2>
                        <p>The AI is listening to {selectedPupil.name}'s recording and calculating fluency metrics...</p>
                        <div className="processing-steps">
                            <div className="proc-step done">
                                <CheckCircle size={16} />
                                <span>Uploading audio</span>
                            </div>
                            <div className="proc-step active">
                                <RefreshCw size={16} className="spin" />
                                <span>AI Transcription & Alignment</span>
                            </div>
                            <div className="proc-step pending">
                                <Clock size={16} />
                                <span>Generating Diagnostics</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
