/**
 * src/utils/visionTelemetry.js
 * 
 * Stage Self-Verification & Feedback Loop
 * 
 * This module aggregates telemetry from Stages 0-D and computes 
 * overall script confidence + automated review flags.
 * 
 * Zero dependencies. Pure data transformation.
 */

export function computeScriptTelemetry(pageRegistrationResult, omrResponse, mergedAnswers, totalExpected) {
    const omrResults = omrResponse?.omrResults || [];
    const page_confidence = pageRegistrationResult?.page_confidence ?? 0;
    const blur_score = pageRegistrationResult?.blur_score ?? 1000;
    const is_blurry = pageRegistrationResult?.is_blurry ?? false;
    const layout_confidence = omrResponse?.layoutResult?.regions?.length > 0 ? 0.9 : 0.4;

    // OMR Clear Rate: proportion of OMR questions classified as "clear"
    const omrClearCount = omrResults.filter(r => r.status === 'clear').length;
    const omrAmbiguousCount = omrResults.filter(r => r.status === 'ambiguous').length;
    const omrTotalAttempted = omrResults.length;

    const omr_clear_rate = omrTotalAttempted > 0 ? omrClearCount / omrTotalAttempted : 1.0;
    const ambiguity_rate = omrTotalAttempted > 0 ? omrAmbiguousCount / omrTotalAttempted : 0;

    // Fallback Rate: how many questions fell through to the VLM
    const fallbackCount = mergedAnswers.filter(a => a._meta?.source === 'ocr' || a._meta?.source === 'vlm').length;
    const fallback_rate = totalExpected > 0 ? fallbackCount / totalExpected : 0;

    // Overall confidence heuristic
    // Penalize for low page registration, blur, high fallback, high ambiguity
    let final_script_confidence = 0.98;
    final_script_confidence -= (1 - page_confidence) * 0.15;
    final_script_confidence -= (is_blurry ? 0.2 : 0);
    final_script_confidence -= fallback_rate * 0.2;
    final_script_confidence -= ambiguity_rate * 0.15;
    final_script_confidence -= (1 - omr_clear_rate) * 0.1;
    final_script_confidence = Math.max(0, Math.min(1, final_script_confidence));

    // Automated Review Flags
    const review_flags = [];

    if (page_confidence < 0.6) {
        review_flags.push({
            code: 'LOW_PAGE_CONFIDENCE',
            severity: 'HIGH',
            message: `Page not cleanly detected (${Math.round(page_confidence * 100)}%). Perspective warp may be skipped. All results may be misaligned.`
        });
    }

    if (is_blurry) {
        review_flags.push({
            code: 'IMAGE_BLURRY',
            severity: 'HIGH',
            message: `Detected motion or focus blur (Score: ${Math.round(blur_score)}). Results may be unreliable.`
        });
    }

    if (omr_clear_rate < 0.7 && omrTotalAttempted > 0) {
        review_flags.push({
            code: 'LOW_OMR_CLEAR_RATE',
            severity: 'MEDIUM',
            message: `Only ${Math.round(omr_clear_rate * 100)}% of OMR questions were read with high confidence. Possible faint pencil, bad lighting, or unusual bubble format.`
        });
    }

    if (fallback_rate > 0.25) {
        review_flags.push({
            code: 'HIGH_FALLBACK_RATE',
            severity: 'MEDIUM',
            message: `${Math.round(fallback_rate * 100)}% of questions fell back to AI. Large fallback rates may indicate a layout the deterministic engine can't handle.`
        });
    }

    if (ambiguity_rate > 0.15) {
        review_flags.push({
            code: 'HIGH_AMBIGUITY_RATE',
            severity: 'MEDIUM',
            message: `${Math.round(ambiguity_rate * 100)}% of OMR questions were ambiguous. Student may have shaded multiple answers or erased.`
        });
    }

    // Entropy check: if too many consecutive blank answers in the middle, flag
    const blankInMiddle = detectBlankRunInMiddle(mergedAnswers, totalExpected);
    if (blankInMiddle) {
        review_flags.push({
            code: 'BLANK_RUN_DETECTED',
            severity: 'HIGH',
            message: 'Detected a run of 5+ consecutive blank answers in the middle of the script. Possible missed page or image alignment issue.'
        });
    }

    return {
        page_confidence,
        blur_score,
        is_blurry,
        layout_confidence,
        omr_clear_rate,
        fallback_rate,
        ambiguity_rate,
        final_script_confidence,
        omr_questions_total: omrTotalAttempted,
        fallback_questions_total: fallbackCount,
        review_flags,
        needs_human_review: review_flags.some(f => f.severity === 'HIGH'),
    };
}

/**
 * Detect a run of 5+ consecutive blank/unanswered in the middle of the script
 * (ignoring first and last 20% of questions each side)
 */
function detectBlankRunInMiddle(answers, total) {
    if (!answers || answers.length === 0) return false;
    const start = Math.floor(total * 0.2);
    const end = Math.floor(total * 0.8);
    let runLen = 0;

    for (let i = start; i < Math.min(answers.length, end); i++) {
        const a = answers[i];
        const isBlank = !a.student_answer || a.student_answer === 'Unanswered' || a.student_answer === '';
        if (isBlank) {
            runLen++;
            if (runLen >= 5) return true;
        } else {
            runLen = 0;
        }
    }
    return false;
}

/**
 * Formats telemetry for display in the AI Debug Panel
 */
export function formatTelemetryForUI(telemetry) {
    if (!telemetry) return null;
    return {
        pageConfidence: `${Math.round(telemetry.page_confidence * 100)}%`,
        blurScore: telemetry.blur_score,
        isBlurry: telemetry.is_blurry,
        layoutConfidence: `${Math.round(telemetry.layout_confidence * 100)}%`,
        omrClearRate: `${Math.round(telemetry.omr_clear_rate * 100)}%`,
        fallbackRate: `${Math.round(telemetry.fallback_rate * 100)}%`,
        ambiguityRate: `${Math.round(telemetry.ambiguity_rate * 100)}%`,
        finalScriptConfidence: `${Math.round(telemetry.final_script_confidence * 100)}%`,
        needsHumanReview: telemetry.needs_human_review,
        reviewFlags: telemetry.review_flags,
    };
}
