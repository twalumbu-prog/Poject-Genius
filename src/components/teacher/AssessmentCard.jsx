import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, CheckCircle, Circle, AlertCircle, Calendar, Archive, Trash2, RotateCcw, MoreVertical } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './AssessmentCard.css';

export default function AssessmentCard({ stream, test, onAction, isArchivedView }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const navigate = useNavigate();

    const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const handleArchive = async (e) => {
        e.stopPropagation();
        const id = stream?.id || test?.id;
        const table = stream ? 'test_streams' : 'tests';

        try {
            const { error } = await supabase
                .from(table)
                .update({ is_archived: true })
                .eq('id', id);

            if (error) throw error;
            if (onAction) onAction();
        } catch (error) {
            console.error('Error archiving assessment:', error);
            alert('Failed to archive assessment');
        }
    };

    const handleRestore = async (e) => {
        e.stopPropagation();
        const id = stream?.id || test?.id;
        const table = stream ? 'test_streams' : 'tests';

        try {
            const { error } = await supabase
                .from(table)
                .update({ is_archived: false })
                .eq('id', id);

            if (error) throw error;
            if (onAction) onAction();
        } catch (error) {
            console.error('Error restoring assessment:', error);
            alert('Failed to restore assessment');
        }
    };

    const handleDelete = async (e) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to permanently delete this? This action cannot be undone.')) return;

        const id = stream?.id || test?.id;
        const table = stream ? 'test_streams' : 'tests';

        try {
            const { error } = await supabase
                .from(table)
                .delete()
                .eq('id', id);

            if (error) throw error;
            if (onAction) onAction();
        } catch (error) {
            console.error('Error deleting assessment:', error);
            alert('Failed to delete assessment');
        }
    };

    // If this is a standalone test
    if (test) {
        return (
            <div
                className={`assessment-card test-card ${isArchivedView ? 'archived' : ''}`}
                onClick={() => !isArchivedView && navigate(`/teacher/test/${test.id}`)}
            >
                <div className="card-header">
                    <div className="card-title">
                        <div className="title-row">
                            <h3>{test.subject}</h3>
                            <div className="creation-date">
                                <Calendar size={12} />
                                <span>{formatDate(test.created_at)}</span>
                            </div>
                        </div>
                        <p className="card-subtitle">{test.title}</p>
                    </div>
                    <div className="card-right">
                        <div className="status-badge">
                            {getStatusBadge(test.status)}
                        </div>
                        <div className="action-buttons">
                            {isArchivedView ? (
                                <>
                                    <button className="icon-btn restore" onClick={handleRestore} title="Restore">
                                        <RotateCcw size={18} />
                                    </button>
                                    <button className="icon-btn delete" onClick={handleDelete} title="Delete Permanently">
                                        <Trash2 size={18} />
                                    </button>
                                </>
                            ) : (
                                <button className="icon-btn archive" onClick={handleArchive} title="Archive">
                                    <Archive size={18} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // If this is a test stream
    const totalTests = stream.tests?.length || 0;
    const completedTests = stream.tests?.filter(t => t.status === 'completed').length || 0;
    const progress = totalTests > 0 ? (completedTests / totalTests) * 100 : 0;

    return (
        <div className={`assessment-card stream-card ${isArchivedView ? 'archived' : ''}`}>
            <div
                className="card-header clickable"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="card-title">
                    <div className="title-row">
                        <h3>{stream.title}</h3>
                        <div className="creation-date">
                            <Calendar size={12} />
                            <span>{formatDate(stream.created_at)}</span>
                        </div>
                    </div>
                    <p className="card-subtitle">{totalTests} {totalTests === 1 ? 'test' : 'tests'}</p>
                </div>
                <div className="card-actions">
                    <div className="status-badge">
                        {getStatusBadge(stream.status)}
                    </div>
                    <div className="action-buttons">
                        {isArchivedView ? (
                            <>
                                <button className="icon-btn restore" title="Restore" onClick={(e) => { e.stopPropagation(); handleRestore(e); }}>
                                    <RotateCcw size={18} />
                                </button>
                                <button className="icon-btn delete" title="Delete Permanently" onClick={(e) => { e.stopPropagation(); handleDelete(e); }}>
                                    <Trash2 size={18} />
                                </button>
                            </>
                        ) : (
                            <button className="icon-btn archive" title="Archive" onClick={(e) => { e.stopPropagation(); handleArchive(e); }}>
                                <Archive size={18} />
                            </button>
                        )}
                    </div>
                    {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </div>
            </div>

            {progress > 0 && (
                <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                </div>
            )}

            {isExpanded && stream.tests && stream.tests.length > 0 && (
                <div className="stream-tests">
                    {stream.tests.map((test) => (
                        <div
                            key={test.id}
                            className="test-item"
                            onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/teacher/test/${test.id}`);
                            }}
                        >
                            <div className="test-info">
                                <h4>{test.subject}</h4>
                                <p className="test-status">{getStatusText(test.status)}</p>
                            </div>
                            <div className="test-badge">
                                {getStatusIcon(test.status)}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {isExpanded && stream.status === 'pending' && (
                <button
                    className="btn btn-secondary btn-block mt-md"
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/teacher/stream/${stream.id}/setup`);
                    }}
                >
                    Setup Tests
                </button>
            )}
        </div>
    );
}

function getStatusBadge(status) {
    const badges = {
        pending: <span className="badge badge-warning">Pending</span>,
        setup: <span className="badge badge-warning">Setup</span>,
        ready: <span className="badge">Ready</span>,
        marking: <span className="badge badge-warning">Marking</span>,
        completed: <span className="badge badge-success">Completed</span>,
        uploaded: <span className="badge">Uploaded</span>,
        scheme_ready: <span className="badge">Ready to Mark</span>,
    };
    return badges[status] || <span className="badge">{status}</span>;
}

function getStatusText(status) {
    const texts = {
        pending: 'Not uploaded',
        uploaded: 'Uploaded',
        scheme_ready: 'Ready to mark',
        marking: 'In progress',
        completed: 'Completed',
    };
    return texts[status] || status;
}

function getStatusIcon(status) {
    if (status === 'completed') {
        return <CheckCircle size={20} className="status-icon success" />;
    } else if (status === 'pending') {
        return <Circle size={20} className="status-icon pending" />;
    } else {
        return <AlertCircle size={20} className="status-icon warning" />;
    }
}
