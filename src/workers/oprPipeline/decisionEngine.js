/* src/workers/oprPipeline/decisionEngine.js */

export function decideRows(classifiedBubbles, totalQuestions) {
    const results = [];
    const rows = {};

    // 1. Group by question number
    classifiedBubbles.forEach(b => {
        if (!rows[b.q_num]) rows[b.q_num] = [];
        rows[b.q_num].push(b);
    });

    // 2. Process each row
    for (let qNum = 1; qNum <= totalQuestions; qNum++) {
        const bubbles = rows[qNum] || [];
        const filled = bubbles.filter(b => b.state === 'FILLED');

        let detected_answer = '';
        let status = 'blank';
        let confidence = 0.95;

        if (filled.length === 1) {
            detected_answer = filled[0].label;
            status = 'clear';
            confidence = filled[0].confidence;
        } else if (filled.length > 1) {
            status = 'multi';
            detected_answer = filled.map(f => f.label).join(',');
            confidence = 0.4;
        } else {
            // Check for erasure suspect if blank
            const suspects = bubbles.filter(b => b.state === 'ERASURE_SUSPECT');
            if (suspects.length > 0) {
                status = 'ambiguous';
                confidence = 0.5;
            }
        }

        results.push({
            question_number: qNum,
            detected_answer,
            status,
            confidence,
            method: 'opr'
        });
    }

    return results;
}

export function validateSheet(rowResults) {
    const total = rowResults.length;
    if (total === 0) return { valid: false, reason: 'NO_RESULTS' };

    const blankCount = rowResults.filter(r => r.status === 'blank').length;
    const multiCount = rowResults.filter(r => r.status === 'multi').length;
    const avgConfidence = rowResults.reduce((acc, r) => acc + r.confidence, 0) / total;

    const streak = detectStreak(rowResults);

    let needs_review = false;
    const issues = [];

    if (blankCount / total > 0.5) {
        needs_review = true;
        issues.push('HIGH_BLANK_RATE');
    }
    if (streak > 5) {
        needs_review = true;
        issues.push('LONG_ANSWER_STREAK');
    }
    if (avgConfidence < 0.7) {
        needs_review = true;
        issues.push('LOW_AGGREGATE_CONFIDENCE');
    }

    return {
        valid: !needs_review,
        needs_review,
        issues,
        blank_rate: blankCount / total,
        avg_confidence: avgConfidence
    };
}

function detectStreak(results) {
    let maxStreak = 0;
    let currentStreak = 0;
    let lastAns = '';

    results.forEach(r => {
        if (r.detected_answer && r.detected_answer === lastAns) {
            currentStreak++;
            maxStreak = Math.max(maxStreak, currentStreak);
        } else {
            currentStreak = 1;
            lastAns = r.detected_answer;
        }
    });

    return maxStreak;
}
