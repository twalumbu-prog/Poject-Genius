import { useState, useEffect } from 'react';
import { X, ChevronRight, FileText, Check, Layers, List } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './ReportCardModal.css';

export default function ReportCardModal({ isOpen, onClose, pupilId, subjects, onGenerate }) {
    const [activeTab, setActiveTab] = useState('stream'); // 'stream' or 'custom'
    const [streams, setStreams] = useState([]);
    const [tests, setTests] = useState([]);
    const [selectedStreamId, setSelectedStreamId] = useState('');
    const [selectedTestIds, setSelectedTestIds] = useState([]);
    const [includeCharts, setIncludeCharts] = useState(true);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isOpen) {
            fetchConfigData();
        }
    }, [isOpen, pupilId]);

    async function fetchConfigData() {
        try {
            setLoading(true);
            // 1. Fetch all test streams
            const { data: streamsData } = await supabase
                .from('test_streams')
                .select('*')
                .order('created_at', { ascending: false });

            // 2. Fetch all tests this student has results for
            const { data: resultsData } = await supabase
                .from('results')
                .select('test_id, tests(*)')
                .eq('pupil_id', pupilId);

            const uniqueTests = [];
            const testIds = new Set();
            (resultsData || []).forEach(r => {
                if (r.tests && !testIds.has(r.test_id)) {
                    testIds.add(r.test_id);
                    uniqueTests.push(r.tests);
                }
            });

            setStreams(streamsData || []);
            setTests(uniqueTests);
        } catch (error) {
            console.error('Error fetching modal config:', error);
        } finally {
            setLoading(false);
        }
    }

    if (!isOpen) return null;

    const handleToggleTest = (id) => {
        if (selectedTestIds.includes(id)) {
            setSelectedTestIds(selectedTestIds.filter(tid => tid !== id));
        } else {
            setSelectedTestIds([...selectedTestIds, id]);
        }
    };

    const handleGenerate = () => {
        const config = {
            mode: activeTab,
            includeCharts,
            streamId: activeTab === 'stream' ? selectedStreamId : null,
            testIds: activeTab === 'custom' ? selectedTestIds : []
        };
        onGenerate(config);
    };

    const isReady = activeTab === 'stream' ? !!selectedStreamId : selectedTestIds.length > 0;

    return (
        <div className="modal-overlay">
            <div className="modal-content report-modal">
                <div className="modal-header">
                    <div className="modal-title-row">
                        <FileText className="modal-title-icon" />
                        <h2>Create Report Card</h2>
                    </div>
                    <button className="modal-close" onClick={onClose}>
                        <X size={24} />
                    </button>
                </div>

                <div className="modal-tabs">
                    <button
                        className={`modal-tab ${activeTab === 'stream' ? 'active' : ''}`}
                        onClick={() => setActiveTab('stream')}
                    >
                        <Layers size={18} />
                        Test Stream
                    </button>
                    <button
                        className={`modal-tab ${activeTab === 'custom' ? 'active' : ''}`}
                        onClick={() => setActiveTab('custom')}
                    >
                        <List size={18} />
                        Custom Selection
                    </button>
                </div>

                <div className="modal-body">
                    {loading ? (
                        <div className="modal-loading">
                            <div className="spinner"></div>
                            <p>Loading options...</p>
                        </div>
                    ) : (
                        <>
                            {activeTab === 'stream' ? (
                                <div className="config-section">
                                    <label className="config-label">Select a Test Stream</label>
                                    <p className="config-hint">Includes all results from this stream.</p>
                                    <div className="stream-grid">
                                        {streams.map(stream => (
                                            <button
                                                key={stream.id}
                                                className={`stream-select-card ${selectedStreamId === stream.id ? 'selected' : ''}`}
                                                onClick={() => setSelectedStreamId(stream.id)}
                                            >
                                                <div className="card-check">
                                                    {selectedStreamId === stream.id && <Check size={14} />}
                                                </div>
                                                <div className="stream-info">
                                                    <span className="stream-name">{stream.name}</span>
                                                    <span className="stream-meta">{stream.term} • {stream.year}</span>
                                                </div>
                                            </button>
                                        ))}
                                        {streams.length === 0 && (
                                            <p className="empty-msg">No test streams found.</p>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="config-section">
                                    <label className="config-label">Select Specific Tests</label>
                                    <p className="config-hint">Choose which assessments to include in the report.</p>
                                    <div className="test-selection-list">
                                        {tests.map(test => (
                                            <div
                                                key={test.id}
                                                className={`test-select-item ${selectedTestIds.includes(test.id) ? 'selected' : ''}`}
                                                onClick={() => handleToggleTest(test.id)}
                                            >
                                                <div className="test-check">
                                                    {selectedTestIds.includes(test.id) && <Check size={14} />}
                                                </div>
                                                <div className="test-info">
                                                    <span className="test-title">{test.title}</span>
                                                    <span className="test-subject">{test.subject}</span>
                                                </div>
                                            </div>
                                        ))}
                                        {tests.length === 0 && (
                                            <p className="empty-msg">No tests available for this student.</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="config-options">
                                <label className="option-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={includeCharts}
                                        onChange={(e) => setIncludeCharts(e.target.checked)}
                                    />
                                    <span className="checkbox-custom"></span>
                                    Include Topic Performance Charts
                                </label>
                            </div>
                        </>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="btn-cancel" onClick={onClose}>Cancel</button>
                    <button
                        className="btn-generate"
                        disabled={!isReady || loading}
                        onClick={handleGenerate}
                    >
                        Generate Report
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
}
