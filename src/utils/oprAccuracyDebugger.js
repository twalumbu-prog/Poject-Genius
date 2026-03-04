/* src/utils/oprAccuracyDebugger.js */

export function logAccuracyComparison(scriptId, legacyResults, oprResults) {
    if (!legacyResults || !oprResults) return;

    console.group(`[OPR Accuracy Debugger] Script: ${scriptId}`);

    const total = Math.max(legacyResults.length, oprResults.length);
    let matches = 0;
    const mismatches = [];

    for (let i = 0; i < total; i++) {
        const leg = legacyResults[i] || {};
        const opr = oprResults[i] || {};

        const qNum = leg.question_number || opr.question_number || (i + 1);
        const legAns = leg.detected_answer || '';
        const oprAns = opr.detected_answer || '';

        if (legAns === oprAns) {
            matches++;
        } else {
            mismatches.push({
                q: qNum,
                legacy: legAns || '(blank)',
                opr: oprAns || '(blank)',
                status: legAns === oprAns ? 'MATCH' : 'DIFF'
            });
        }
    }

    const accuracy = (matches / total) * 100;
    console.log(`Accuracy vs Legacy: ${accuracy.toFixed(2)}% (${matches}/${total})`);

    if (mismatches.length > 0) {
        console.table(mismatches);
    } else {
        console.log('✅ 100% Match with Legacy Engine');
    }

    console.groupEnd();

    return {
        accuracy,
        matchCount: matches,
        totalCount: total,
        mismatches
    };
}
