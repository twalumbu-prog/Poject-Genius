import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Play, Pause, RotateCcw, TrendingUp, CheckCircle, AlertTriangle, Lightbulb, User, Calendar } from 'lucide-react';
import './ReadingResults.css';

export default function ReadingResults() {
    const { sessionId } = useParams();
    const navigate = useNavigate();

    const [session, setSession] = useState(null);
    const [wordAnalysis, setWordAnalysis] = useState([]);
    const [audioUrl, setAudioUrl] = useState('');
    const [loading, setLoading] = useState(true);

    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef(null);

    useEffect(() => {
        fetchSessionData();
    }, [sessionId]);

    async function fetchSessionData() {
        try {
            const { data: sessionData, error: sessionError } = await supabase
                .from('reading_sessions')
                .select('*, reading_passages(*), pupils(*)')
                .eq('id', sessionId)
                .single();

            if (sessionError) throw sessionError;

            const { data: analysisData, error: analysisError } = await supabase
                .from('word_level_analysis')
                .select('*')
                .eq('session_id', sessionId)
                .order('word_index');

            if (analysisError) throw analysisError;

            // Get signed URL for audio
            const { data: urlData, error: urlError } = await supabase.storage
                .from('reading-audio')
                .createSignedUrl(sessionData.audio_url, 3600);

            if (urlError) throw urlError;

            setSession(sessionData);
            setWordAnalysis(analysisData);
            setAudioUrl(urlData.signedUrl);
        } catch (err) {
            console.error('Error fetching results:', err);
        } finally {
            setLoading(false);
        }
    }

    const togglePlayback = () => {
        if (audioRef.current.paused) {
            audioRef.current.play();
            setIsPlaying(true);
        } else {
            audioRef.current.pause();
            setIsPlaying(false);
        }
    };

    const handleTimeUpdate = () => {
        setCurrentTime(audioRef.current.currentTime);
    };

    const handleWordClick = (startTime) => {
        audioRef.current.currentTime = startTime;
        audioRef.current.play();
        setIsPlaying(true);
    };

    if (loading) return <div className="loading">Loading results...</div>;

    const { raw_analysis: analysis, pupils: pupil, reading_passages: passage } = session;

    return (
        <div className="reading-results-page">
            <div className="results-container">
                <div className="results-top-nav">
                    <button className="back-button" onClick={() => navigate('/teacher/assessments')}>
                        <ArrowLeft size={18} />
                        Back to Assessments
                    </button>
                    <div className="session-meta">
                        <div className="meta-item">
                            <User size={14} />
                            <span>{pupil.name}</span>
                        </div>
                        <div className="meta-item">
                            <Calendar size={14} />
                            <span>{new Date(session.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>

                <div className="dashboard-grid">
                    {/* Metrics Section */}
                    <div className="metrics-column">
                        <div className="metric-card">
                            <div className="metric-icon accuracy">
                                <CheckCircle size={24} />
                            </div>
                            <div className="metric-content">
                                <span className="label">Accuracy</span>
                                <span className="value">{session.accuracy_percentage}%</span>
                            </div>
                        </div>

                        <div className="metric-card">
                            <div className="metric-icon wpm">
                                <TrendingUp size={24} />
                            </div>
                            <div className="metric-content">
                                <span className="label">WPM</span>
                                <span className="value">{session.words_per_minute}</span>
                                <span className="sub-label">Words / Minute</span>
                            </div>
                        </div>

                        <div className="metric-card">
                            <div className="metric-icon score">
                                <RotateCcw size={24} />
                            </div>
                            <div className="metric-content">
                                <span className="label">Reading Level</span>
                                <span className="value">{analysis?.reading_level_estimate || 'N/A'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Main Analysis Section */}
                    <div className="analysis-main">
                        <div className="playback-card card">
                            <div className="playback-controls">
                                <button className="play-btn" onClick={togglePlayback}>
                                    {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                                </button>
                                <div className="playback-info">
                                    <span className="title">Oral Reading Recording</span>
                                    <span className="duration">{Math.floor(currentTime)}s / {Math.floor(session.duration_seconds)}s</span>
                                </div>
                                <audio
                                    ref={audioRef}
                                    src={audioUrl}
                                    onTimeUpdate={handleTimeUpdate}
                                    onEnded={() => setIsPlaying(false)}
                                />
                            </div>

                            <div className="transcript-display">
                                {wordAnalysis.map((word, idx) => {
                                    const isActive = currentTime >= word.start_time && currentTime <= word.end_time;
                                    const isError = !word.is_correct;

                                    return (
                                        <span
                                            key={idx}
                                            className={`word-item ${isActive ? 'active' : ''} ${isError ? 'has-error' : ''}`}
                                            onClick={() => handleWordClick(word.start_time)}
                                            title={isError ? `Spoken as: ${word.spoken_word}` : `Accuracy: ${Math.round(word.confidence * 100)}%`}
                                        >
                                            {word.expected_word}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="diagnostics-grid">
                            <div className="diagnostic-card strengths">
                                <div className="card-header">
                                    <CheckCircle size={18} />
                                    <h3>Strengths</h3>
                                </div>
                                <ul>
                                    {analysis?.strengths?.map((s, i) => <li key={i}>{s}</li>)}
                                </ul>
                            </div>

                            <div className="diagnostic-card weaknesses">
                                <div className="card-header">
                                    <AlertTriangle size={18} />
                                    <h3>Areas for Growth</h3>
                                </div>
                                <ul>
                                    {analysis?.weaknesses?.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </div>

                            <div className="diagnostic-card recommendations">
                                <div className="card-header">
                                    <Lightbulb size={18} />
                                    <h3>Recommendations</h3>
                                </div>
                                <ul>
                                    {analysis?.interventions?.map((rec, i) => <li key={i}>{rec}</li>)}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
