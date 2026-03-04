/**
 * Stage D Hybrid Answer Merger — Production-Grade Upgrade
 * 
 * Merge Priority:
 * 1. Clear OMR (deterministic, high confidence pixel math result)
 * 2. High-confidence OCR (VLM result where confidence != Low)
 * 3. VLM fallback (any VLM result, even low confidence)
 * 4. Definite Blank from OMR (pixel math clearly saw no fill)
 * 5. Unknown / Review Needed
 * 
 * Validation Pass (New):
 * - Ensures exactly N answers (one per scheme question)
 * - Detects duplicate question numbers in merged result
 * - Detects impossible patterns (all same answer, all blank)
 * - Computes overall_script_confidence
 */

export function mergeHybridAnswers(omrResults, ocrApiResult, markingScheme) {
    if (!markingScheme || !Array.isArray(markingScheme)) {
        throw new Error("[HybridMerger] markingScheme is required");
    }

    const unifiedAnswers = [];
    const debugStats = {
        omr_used: 0,
        ocr_used: 0,
        unanswered: 0,
        manual_review_flagged: 0
    };

    // Fast lookup maps
    const omrMap = new Map();
    if (omrResults && Array.isArray(omrResults)) {
        omrResults.forEach(ans => {
            if (ans && ans.question_number != null) {
                omrMap.set(Number(ans.question_number), ans);
            }
        });
    }

    const ocrMap = new Map();
    // Support both results[0].answers and flat `answers` array
    const ocrAnswers = ocrApiResult?.results?.[0]?.answers || ocrApiResult?.answers || [];
    ocrAnswers.forEach(ans => {
        if (ans && ans.question_number != null) {
            ocrMap.set(Number(ans.question_number), ans);
        }
    });

    for (const schemeItem of markingScheme) {
        const qNumStr = String(schemeItem.question_number).trim();
        const qNum = parseInt(qNumStr.match(/\d+/)?.[0] || "0", 10);
        if (qNum === 0) continue;

        const omrAns = omrMap.get(qNum);
        const ocrAns = ocrMap.get(qNum);

        // Priority 1: Clear OMR
        if (omrAns && omrAns.status === 'clear' && omrAns.confidence >= 0.55) {
            const isCorrect = (omrAns.detected_answer === schemeItem.correct_answer);
            unifiedAnswers.push({
                question_number: qNum,
                answer_type: 'hybrid_omr',
                student_answer: omrAns.detected_answer,
                is_correct: isCorrect,
                confidence: omrAns.confidence >= 0.80 ? 'High' : 'Medium',
                feedback: isCorrect ? '' : 'Incorrect bubble shaded.',
                _meta: { source: 'omr' },
                _debug: { source: 'OMR_Engine', ...omrAns }
            });
            debugStats.omr_used++;
            continue;
        }

        // Priority 2: High-confidence OCR
        if (ocrAns && ocrAns.student_answer && ocrAns.student_answer !== 'Unanswered' && ocrAns.confidence !== 'Low') {
            unifiedAnswers.push({
                ...ocrAns,
                question_number: qNum,
                answer_type: ocrAns.answer_type || 'hybrid_ocr',
                _meta: { source: 'ocr' },
                _debug: { source: 'OCR_Engine_HighConf', fallback_reason: omrAns ? omrAns.status : 'ocr-routed' }
            });
            debugStats.ocr_used++;
            continue;
        }

        // Priority 3: VLM fallback (any result, even Low confidence)
        if (ocrAns && ocrAns.student_answer && ocrAns.student_answer !== 'Unanswered') {
            unifiedAnswers.push({
                ...ocrAns,
                question_number: qNum,
                answer_type: ocrAns.answer_type || 'hybrid_ocr',
                _meta: { source: 'vlm' },
                _debug: { source: 'OCR_Engine_LowConf', fallback_reason: omrAns ? omrAns.status : 'ocr-fallback' }
            });
            debugStats.ocr_used++;
            debugStats.manual_review_flagged++;
            continue;
        }

        // Priority 4: Definite Blank from OMR
        if (omrAns && omrAns.status === 'blank') {
            unifiedAnswers.push({
                question_number: qNum,
                answer_type: 'hybrid_omr',
                student_answer: 'Unanswered',
                is_correct: false,
                confidence: 'High',
                feedback: 'No bubbles shaded.',
                _meta: { source: 'omr_blank' },
                _debug: { source: 'OMR_Engine_Blank', ...omrAns }
            });
            debugStats.unanswered++;
            continue;
        }

        // Priority 5: Complete Failure / Review Needed
        unifiedAnswers.push({
            question_number: qNum,
            answer_type: 'unknown',
            student_answer: 'Unanswered',
            is_correct: false,
            confidence: 'Low',
            feedback: 'Missing from page or completely unreadable.',
            _meta: { source: 'fallback' },
            _debug: { source: 'Fallback' }
        });
        debugStats.unanswered++;
    }

    // ─── VALIDATION PASS ─────────────────────────────────────────────────────

    const expected = markingScheme.length;
    const actual = unifiedAnswers.length;

    // Duplicate detection
    const seenQNums = new Set();
    const duplicates = [];
    for (const a of unifiedAnswers) {
        if (seenQNums.has(a.question_number)) {
            duplicates.push(a.question_number);
        }
        seenQNums.add(a.question_number);
    }

    // Impossible pattern: all the same answer
    const answerValues = unifiedAnswers.map(a => a.student_answer).filter(a => a !== 'Unanswered');
    const allSameAnswer = answerValues.length > 2 && new Set(answerValues).size === 1;

    // Too many blanks (> 80% unanswered suggests page issue)
    const blankRatio = debugStats.unanswered / expected;
    const tooManyBlanks = blankRatio > 0.8;

    // Compute overall script confidence
    const omrConfidences = omrResults?.filter(r => r.status === 'clear').map(r => r.confidence) || [];
    const avgOmrConf = omrConfidences.length > 0 ? omrConfidences.reduce((a, b) => a + b, 0) / omrConfidences.length : 0;
    const highOcrRate = ocrAnswers.filter(a => a.confidence === 'High').length / Math.max(ocrAnswers.length, 1);
    const overall_confidence = Math.min(1,
        (avgOmrConf * 0.5) + (highOcrRate * 0.3) + ((1 - blankRatio) * 0.2)
    );

    // Student meta from OCR result
    const studentMeta = ocrApiResult?.results?.[0] || {};

    return {
        results: [{
            studentName: studentMeta.studentName || "Unknown",
            student_id: studentMeta.student_id || "",
            grade: studentMeta.grade || "",
            answers: unifiedAnswers
        }],
        _debugMeta: {
            ...debugStats,
            validation: {
                expected_count: expected,
                actual_count: actual,
                count_match: expected === actual,
                duplicates,
                all_same_answer: allSameAnswer,
                too_many_blanks: tooManyBlanks,
                blank_ratio: parseFloat(blankRatio.toFixed(3)),
                overall_confidence: parseFloat(overall_confidence.toFixed(3)),
            }
        }
    };
}
