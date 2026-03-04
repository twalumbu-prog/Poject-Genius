/**
 * Stage D Hybrid Answer Merger
 * Responsible for unifying deterministic OMR results with AI OCR results
 * into a single unified array. Priorities: Clear OMR > Confident OCR > Manual Review.
 */

export function mergeHybridAnswers(omrResults, ocrApiResult, markingScheme) {
    if (!markingScheme || !Array.isArray(markingScheme)) {
        throw new Error("[HybridMerger] markingScheme is required");
    }

    console.log("[HybridMerger] Commencing unification of OMR and OCR results");

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
                omrMap.set(ans.question_number, ans);
            }
        });
    }

    const ocrMap = new Map();
    if (ocrApiResult && ocrApiResult.results && ocrApiResult.results[0] && Array.isArray(ocrApiResult.results[0].answers)) {
        ocrApiResult.results[0].answers.forEach(ans => {
            if (ans && ans.question_number != null) {
                ocrMap.set(ans.question_number, ans);
            }
        });
    }

    for (const schemeItem of markingScheme) {
        let qNumStr = String(schemeItem.question_number).trim();
        let qNum = parseInt(qNumStr.match(/\d+/)?.[0] || "0", 10);

        if (qNum === 0) continue;

        const omrAns = omrMap.get(qNum);
        const ocrAns = ocrMap.get(qNum);

        // Priority 1: Clear OMR
        if (omrAns && omrAns.status === 'clear') {
            const isCorrect = (omrAns.detected_answer === schemeItem.correct_answer);
            unifiedAnswers.push({
                question_number: qNum,
                answer_type: 'hybrid_omr',
                student_answer: omrAns.detected_answer,
                is_correct: isCorrect,
                confidence: omrAns.confidence > 0.8 ? 'High' : 'Medium',
                feedback: isCorrect ? '' : 'Incorrect bubble shaded.',
                _debug: { source: 'OMR_Engine', ...omrAns }
            });
            debugStats.omr_used++;
            continue;
        }

        // Priority 2: Confident OCR (VLM Fallback)
        if (ocrAns && ocrAns.student_answer !== "Unanswered") {
            unifiedAnswers.push({
                ...ocrAns, // Inherit whatever the VLM decided
                answer_type: ocrAns.answer_type || 'hybrid_ocr',
                _debug: { source: 'OCR_Engine', fallback_reason: omrAns ? omrAns.status : 'ocr-layout-routed' }
            });
            debugStats.ocr_used++;

            if (ocrAns.confidence === 'Low') debugStats.manual_review_flagged++;
            continue;
        }

        // Priority 3: Definite Blank from OMR
        if (omrAns && omrAns.status === 'blank') {
            unifiedAnswers.push({
                question_number: qNum,
                answer_type: 'hybrid_omr',
                student_answer: 'Unanswered',
                is_correct: false,
                confidence: 'High', // We are highly confident it is blank
                feedback: 'No bubbles shaded.',
                _debug: { source: 'OMR_Engine', ...omrAns }
            });
            debugStats.unanswered++;
            continue;
        }

        // Priority 4: Complete Failure / Unanswered OCR
        unifiedAnswers.push({
            question_number: qNum,
            answer_type: 'unknown',
            student_answer: 'Unanswered',
            is_correct: false,
            confidence: 'Low',
            feedback: 'Missing from page or completely unreadable.',
            _debug: { source: 'Fallback' }
        });
        debugStats.unanswered++;
    }

    // Build final unified payload matching the expected UI shape
    const studentMeta = (ocrApiResult && ocrApiResult.results && ocrApiResult.results[0]) ?
        {
            studentName: ocrApiResult.results[0].studentName || "Unknown",
            student_id: ocrApiResult.results[0].student_id || "",
            grade: ocrApiResult.results[0].grade || ""
        } :
        { studentName: "Unknown", student_id: "", grade: "" };

    return {
        results: [{
            ...studentMeta,
            answers: unifiedAnswers
        }],
        _debugMeta: {
            ...debugStats,
            edge_meta: ocrApiResult ? ocrApiResult._debugMeta : null
        }
    };
}
