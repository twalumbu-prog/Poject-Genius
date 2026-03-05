/* src/workers/oprPipeline/decisionEngine.js */

export function decideRows(classifiedBubbles, totalQuestions) {
    const results = [];
    const rows = {};

    // 1. Group by question number
    classifiedBubbles.forEach(b => {
        if (!b || b.q_num === undefined) return;
        if (!rows[b.q_num]) rows[b.q_num] = [];
        rows[b.q_num].push(b);
    });

    // 2. Process each row using a HYBRID approach:
    //    A) Per-row relative comparison (darkest option in row = most likely filled)
    //    B) Cross-validate with global classification state
    for (let qNum = 1; qNum <= totalQuestions; qNum++) {
        const bubbles = rows[qNum] || [];

        let detected_answer = '';
        let status = 'blank';
        let confidence = 0.95;

        if (bubbles.length === 0) {
            results.push({ question_number: qNum, detected_answer, status, confidence, method: 'opr' });
            continue;
        }

        // ── RELATIVE COMPARISON: compare raw patch means within this row ──
        // Sort options by mean luma (ascending = darkest first)
        const sorted = [...bubbles].sort((a, b) => a.stats.mean - b.stats.mean);
        const darkest = sorted[0];
        const secondDarkest = sorted[1];

        // Compute row-local paper baseline: the brightest option in this row
        const rowPaperMean = sorted[sorted.length - 1].stats.mean;

        // The darkest option's delta from the row's own paper baseline
        const rowDelta = rowPaperMean - darkest.stats.mean;

        // Margin between darkest and second-darkest (how much it stands out)
        const margin = secondDarkest ? (secondDarkest.stats.mean - darkest.stats.mean) : 999;

        // Relative fill ratio using actual patchSize
        const ps = darkest.patchSize || 15;
        const relativeFillRatio = darkest.stats.darkPixels / (ps * ps);

        console.log(`[OPR Row ${qNum}] darkest=${darkest.label}(mean=${Math.round(darkest.stats.mean)}) margin=${Math.round(margin)} rowDelta=${Math.round(rowDelta)} fillRatio=${relativeFillRatio.toFixed(2)}`);

        // ── DECISION THRESHOLDS (tunable) ──
        const MIN_ROW_DELTA = 20;    // darkest must be >=20 luma darker than row's own paper
        const MIN_MARGIN = 5;        // must stand out >=5 luma from next option (lowered from 8)
        const MIN_FILL_RATIO = 0.20; // at least 20% of the patch must be "ink"

        // Check global pre-classified states for cross-validation
        const globalFilled = bubbles.filter(b => b.state === 'FILLED');
        const globalSuspects = bubbles.filter(b => b.state === 'ERASURE_SUSPECT');

        if (rowDelta >= MIN_ROW_DELTA && margin >= MIN_MARGIN && relativeFillRatio >= MIN_FILL_RATIO) {
            // Confident single answer detected by relative method
            detected_answer = darkest.label;
            status = 'clear';
            // Boost confidence if global classification agrees
            if (globalFilled.length === 1 && globalFilled[0].label === darkest.label) {
                confidence = 0.97;
            } else if (globalFilled.length === 1 && globalFilled[0].label !== darkest.label) {
                confidence = 0.70; // Disagreement - lower confidence
            } else {
                confidence = 0.85;
            }
        } else if (globalFilled.length === 1) {
            // Global classification found exactly one filled - trust it
            detected_answer = globalFilled[0].label;
            status = 'clear';
            confidence = globalFilled[0].confidence;
        } else if (globalFilled.length > 1) {
            // Multiple globally filled: use relative to pick the one that stands out most
            const bestGlobalFilled = globalFilled.reduce((best, b) =>
                b.stats.mean < best.stats.mean ? b : best
            );
            // Check if one is significantly darker than the others
            const globalSorted = globalFilled.sort((a, b) => a.stats.mean - b.stats.mean);
            const globalMargin = globalSorted.length > 1 ? globalSorted[1].stats.mean - globalSorted[0].stats.mean : 999;
            if (globalMargin >= MIN_MARGIN) {
                detected_answer = bestGlobalFilled.label;
                status = 'clear';
                confidence = 0.75;
            } else {
                status = 'multi';
                detected_answer = globalFilled.map(f => f.label).join(',');
                confidence = 0.4;
            }
        } else if (globalSuspects.length > 0) {
            status = 'ambiguous';
            confidence = 0.5;
        } else if (rowDelta >= MIN_ROW_DELTA * 0.6 && relativeFillRatio >= MIN_FILL_RATIO * 0.7) {
            // Soft match - one option is darker but not meeting all thresholds
            detected_answer = darkest.label;
            status = 'ambiguous';
            confidence = 0.55;
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
