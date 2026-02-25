import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import './PerformanceGraph.css';

const TARGET_PERCENTAGE = 90;

export default function PerformanceGraph({ attempts }) {
    // attempts = [{ percentage, date, testTitle }, ...]
    // sorted chronologically (oldest first)
    const [showStats, setShowStats] = useState(false);

    if (!attempts || attempts.length === 0) {
        return (
            <div className="graph-empty">
                <BarChart3 size={32} />
                <p>No attempts recorded yet</p>
            </div>
        );
    }

    const maxBars = attempts.length;
    const barWidth = Math.max(20, Math.min(36, 300 / maxBars));
    const graphHeight = 200;

    // Stats calculations
    const scores = attempts.map(a => a.percentage);
    const highest = Math.max(...scores);
    const average = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
    const latest = scores[scores.length - 1];

    // Incremental improvement: average delta between consecutive attempts
    let totalDelta = 0;
    let deltaCount = 0;
    for (let i = 1; i < scores.length; i++) {
        totalDelta += scores[i] - scores[i - 1];
        deltaCount++;
    }
    const avgImprovement = deltaCount > 0 ? (totalDelta / deltaCount).toFixed(1) : 0;

    // Practice frequency formally calculated as Attempts/Week
    const firstDate = attempts[0].date ? new Date(attempts[0].date) : null;
    const lastDate = attempts[attempts.length - 1].date ? new Date(attempts[attempts.length - 1].date) : null;
    let attemptsPerWeek = '0.0';

    if (firstDate && lastDate && attempts.length > 1) {
        const daysDiff = Math.max(1, Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24)));
        const weeks = Math.max(1, daysDiff / 7);
        attemptsPerWeek = (attempts.length / weeks).toFixed(1);
    } else if (attempts.length === 1) {
        attemptsPerWeek = '1.0'; // Default for a single attempt
    }

    // Pattern-based commentary
    let commentary = '';
    const speed = Number(attemptsPerWeek);

    if (attempts.length < 2) {
        commentary = 'Just starting out. Consistency is key to improvement!';
    } else if (speed >= 3 && Number(avgImprovement) > 0) {
        commentary = '🔥 High intensity practice! The frequent attempts are clearly paying off.';
    } else if (speed < 1 && Number(avgImprovement) < 0) {
        commentary = '🧊 Practice has slowed down. Regular weekly practice helps maintain concepts.';
    } else if (Number(avgImprovement) > 5) {
        commentary = '🚀 Rapidly improving! Great momentum.';
    } else if (Number(avgImprovement) > 0) {
        commentary = '📈 Steadily improving. Keep it up!';
    } else if (Number(avgImprovement) === 0) {
        commentary = '📊 Consistent performer. Try pushing beyond your comfort zone.';
    } else if (Number(avgImprovement) > -5) {
        commentary = '📉 Slight dip recently. Focus on reviewing weak areas.';
    } else {
        commentary = '⚠️ Scores are declining. Consider revisiting fundamentals.';
    }

    if (latest >= 90) {
        commentary = '🌟 ' + commentary + ' Currently at target level!';
    }

    return (
        <div className="perf-graph-wrapper">
            <div className="graph-header">
                <span className="graph-title">Attempts</span>
                <button
                    className={`btn-stats ${showStats ? 'active' : ''}`}
                    onClick={() => setShowStats(!showStats)}
                >
                    Stats
                </button>
            </div>

            <div className="graph-scroll-container">
                <div className="graph-container" style={{ minWidth: `${maxBars * (barWidth + 6) + 50}px` }}>
                    {/* Y-axis labels */}
                    <div className="y-axis">
                        {[100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0].map(val => (
                            <span key={val} className={`y-label ${val === TARGET_PERCENTAGE ? 'target-label' : ''}`}>
                                {val}%
                            </span>
                        ))}
                    </div>

                    {/* Chart area */}
                    <div className="chart-area">
                        {/* Grid lines */}
                        {[100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0].map(val => (
                            <div
                                key={val}
                                className={`grid-line ${val === TARGET_PERCENTAGE ? 'target-line' : ''}`}
                                style={{ bottom: `${(val / 100) * graphHeight}px` }}
                            >
                                {val === TARGET_PERCENTAGE && (
                                    <span className="target-tag">{TARGET_PERCENTAGE}%</span>
                                )}
                            </div>
                        ))}

                        {/* Bars */}
                        <div className="bars-row">
                            {attempts.map((attempt, i) => {
                                const total = attempt.totalQuestions || 1;
                                const easyH = ((attempt.easy_correct || 0) / total) * graphHeight;
                                const avgH = ((attempt.average_correct || 0) / total) * graphHeight;
                                const hardH = ((attempt.hard_correct || 0) / total) * graphHeight;

                                const pct = Math.min(100, Math.max(0, attempt.percentage));
                                const meetsTarget = pct >= TARGET_PERCENTAGE;

                                return (
                                    <div key={i} className="bar-wrapper" style={{ width: `${barWidth}px` }}>
                                        <div
                                            className={`bar-stacked ${meetsTarget ? 'at-target' : ''}`}
                                            title={`${Math.round(pct)}% — ${attempt.testTitle || `Attempt ${i + 1}`}\nEasy: ${attempt.easy_correct}/${attempt.easy_total}\nAverage: ${attempt.average_correct}/${attempt.average_total}\nHard: ${attempt.hard_correct}/${attempt.hard_total}`}
                                        >
                                            <div className="bar-segment hard" style={{ height: `${hardH}px` }} />
                                            <div className="bar-segment average" style={{ height: `${avgH}px` }} />
                                            <div className="bar-segment easy" style={{ height: `${easyH}px` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="graph-legend">
                <div className="legend-item">
                    <span className="legend-dot easy"></span>
                    <span>Easy</span>
                </div>
                <div className="legend-item">
                    <span className="legend-dot average"></span>
                    <span>Average</span>
                </div>
                <div className="legend-item">
                    <span className="legend-dot hard"></span>
                    <span>Hard</span>
                </div>
            </div>

            {/* Stats panel */}
            {showStats && (
                <div className="stats-panel">
                    <div className="stats-grid">
                        <div className="stat-box">
                            <span className="stat-box-value best">{highest}%</span>
                            <span className="stat-box-label">Highest</span>
                        </div>
                        <div className="stat-box">
                            <span className="stat-box-value">{average}%</span>
                            <span className="stat-box-label">Average</span>
                        </div>
                        <div className="stat-box">
                            <span className={`stat-box-value ${Number(avgImprovement) > 0 ? 'positive' : Number(avgImprovement) < 0 ? 'negative' : ''}`}>
                                {Number(avgImprovement) > 0 ? '+' : ''}{avgImprovement}%
                            </span>
                            <span className="stat-box-label">Avg Change</span>
                        </div>
                        <div className="stat-box">
                            <span className="stat-box-value frequency">{attemptsPerWeek}</span>
                            <span className="stat-box-label">Trials/wk</span>
                        </div>
                    </div>
                    <div className="commentary-box">
                        {commentary}
                    </div>
                </div>
            )}
        </div>
    );
}
