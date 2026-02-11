import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Upload, CheckCircle, Circle, Sparkles, Save } from 'lucide-react';
import './TestStreamSetup.css';

export default function TestStreamSetup() {
    const { streamId } = useParams();
    const navigate = useNavigate();
    const [stream, setStream] = useState(null);
    const [tests, setTests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploadingTest, setUploadingTest] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);

    useEffect(() => {
        fetchStreamData();
    }, [streamId]);

    async function fetchStreamData() {
        try {
            const { data: streamData, error: streamError } = await supabase
                .from('test_streams')
                .select('*')
                .eq('id', streamId)
                .single();

            if (streamError) throw streamError;

            const { data: testsData, error: testsError } = await supabase
                .from('tests')
                .select('*')
                .eq('test_stream_id', streamId)
                .order('subject');

            if (testsError) throw testsError;

            setStream(streamData);
            setTests(testsData || []);
        } catch (error) {
            console.error('Error fetching stream:', error);
        } finally {
            setLoading(false);
        }
    }

    const handleTestPaperUpload = async (testId, file) => {
        if (!file) return;

        setUploadingTest(testId);
        setUploadProgress(0);

        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${testId}-${Math.random().toString(36).substring(2)}.${fileExt}`;
            const filePath = `${fileName}`;

            // Upload to Supabase Storage
            const { error: uploadError, data } = await supabase.storage
                .from('test-papers')
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) throw uploadError;

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('test-papers')
                .getPublicUrl(filePath);

            // Update test status and record URL
            const { error: updateError } = await supabase
                .from('tests')
                .update({
                    status: 'uploaded',
                    test_paper_url: publicUrl
                })
                .eq('id', testId);

            if (updateError) throw updateError;

            fetchStreamData();
            alert('Test paper uploaded successfully!');
        } catch (error) {
            console.error('Error uploading test paper:', error);
            alert(`Upload failed: ${error.message}`);
        } finally {
            setUploadingTest(null);
            setUploadProgress(0);
        }
    };

    const triggerFileUpload = (testId) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,.doc,.docx';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                handleTestPaperUpload(testId, file);
            }
        };
        input.click();
    };

    const handleGenerateMarkingScheme = async (testId) => {
        // Mock AI generation for MVP
        setUploadingTest(testId);

        // Simulate AI processing
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Create mock marking scheme
        const mockScheme = {
            test_id: testId,
            questions: [
                { question_number: 1, correct_answer: 'A', topic: 'Algebra', subtopic: 'Linear Equations', learning_outcome: 'Solve basic equations' },
                { question_number: 2, correct_answer: 'B', topic: 'Geometry', subtopic: 'Shapes', learning_outcome: 'Identify shapes' },
                { question_number: 3, correct_answer: 'C', topic: 'Algebra', subtopic: 'Variables', learning_outcome: 'Understand variables' },
            ],
            topic_summary: {
                'Algebra': 2,
                'Geometry': 1,
            }
        };

        const { error: schemeError } = await supabase
            .from('marking_schemes')
            .insert(mockScheme);

        if (schemeError) {
            console.error('Error creating marking scheme:', schemeError);
        }

        // Update test status
        const { error } = await supabase
            .from('tests')
            .update({ status: 'scheme_ready' })
            .eq('id', testId);

        if (error) {
            console.error('Error updating test:', error);
        } else {
            fetchStreamData();
        }

        setUploadingTest(null);
        alert('Marking scheme generated successfully! (Mock AI for MVP)');
    };

    if (loading) {
        return <div className="loading-container">Loading...</div>;
    }

    if (!stream) {
        return <div className="loading-container">Test stream not found</div>;
    }

    return (
        <div className="test-stream-setup-page">
            <div className="page-container">
                <button className="back-button" onClick={() => navigate('/teacher/assessments')}>
                    <ArrowLeft size={20} />
                    Back to Assessments
                </button>

                <div className="page-header">
                    <h1>{stream.title}</h1>
                    <p>Setup tests for each subject</p>
                </div>

                <div className="tests-setup-list">
                    {tests.map((test) => (
                        <div key={test.id} className="test-setup-card">
                            <div className="test-setup-header">
                                <h3>{test.subject}</h3>
                                <div className="status-badge">
                                    {test.status === 'scheme_ready' && (
                                        <span className="badge badge-success">Ready</span>
                                    )}
                                    {test.status === 'uploaded' && (
                                        <span className="badge badge-warning">Needs Scheme</span>
                                    )}
                                    {test.status === 'pending' && (
                                        <span className="badge">Pending</span>
                                    )}
                                </div>
                            </div>

                            <div className="checklist">
                                <div className={`checklist-item ${test.status !== 'pending' ? 'completed' : ''}`}>
                                    <div className="checklist-icon">
                                        {test.status !== 'pending' ? (
                                            <CheckCircle size={20} className="icon-success" />
                                        ) : (
                                            <Circle size={20} className="icon-pending" />
                                        )}
                                    </div>
                                    <div className="checklist-content">
                                        <h4>Upload Test Paper</h4>
                                        <p>Upload PDF or link Google Doc</p>
                                    </div>
                                    {test.status === 'pending' && (
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => triggerFileUpload(test.id)}
                                            disabled={uploadingTest === test.id}
                                        >
                                            <Upload size={16} />
                                            {uploadingTest === test.id ? 'Uploading...' : 'Upload'}
                                        </button>
                                    )}
                                </div>

                                <div className={`checklist-item ${test.status === 'scheme_ready' ? 'completed' : ''}`}>
                                    <div className="checklist-icon">
                                        {test.status === 'scheme_ready' ? (
                                            <CheckCircle size={20} className="icon-success" />
                                        ) : (
                                            <Circle size={20} className="icon-pending" />
                                        )}
                                    </div>
                                    <div className="checklist-content">
                                        <h4>Create Marking Scheme</h4>
                                        <p>AI-generated or manual upload</p>
                                    </div>
                                    {test.status === 'uploaded' && (
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={() => handleGenerateMarkingScheme(test.id)}
                                            disabled={uploadingTest === test.id}
                                        >
                                            <Sparkles size={16} />
                                            {uploadingTest === test.id ? 'Generating...' : 'Generate with AI'}
                                        </button>
                                    )}
                                    {test.status === 'scheme_ready' && (
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => navigate(`/teacher/test/${test.id}/review`)}
                                        >
                                            <Save size={16} />
                                            Review Scheme
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {tests.every(t => t.status === 'scheme_ready') && (
                    <div className="completion-banner">
                        <CheckCircle size={24} />
                        <div>
                            <h3>All tests are ready!</h3>
                            <p>You can now start marking student scripts</p>
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={() => navigate('/teacher/assessments')}
                        >
                            Done
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
