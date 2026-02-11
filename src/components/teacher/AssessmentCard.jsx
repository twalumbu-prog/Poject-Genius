import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, CheckCircle, Circle, AlertCircle } from 'lucide-react';
import './AssessmentCard.css';

export default function AssessmentCard({ stream, test }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const navigate = useNavigate();

    // If this is a standalone test
    if (test) {
        return (
            <div
                className="assessment-card test-card"
                onClick={() => navigate(`/teacher/test/${test.id}`)}
            >
                <div className="card-header">
                    <div className="card-title">
                        <h3>{test.subject}</h3>
                        <p className="card-subtitle">{test.title}</p>
                    </div>
                    <div className="status-badge">
                        {getStatusBadge(test.status)}
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
        <div className="assessment-card stream-card">
            <div
                className="card-header clickable"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="card-title">
                    <h3>{stream.title}</h3>
                    <p className="card-subtitle">{totalTests} {totalTests === 1 ? 'test' : 'tests'}</p>
                </div>
                <div className="card-actions">
                    <div className="status-badge">
                        {getStatusBadge(stream.status)}
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
