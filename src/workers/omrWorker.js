/* src/workers/omrWorker.js */
import { classifyQuestionRegions } from '../utils/questionClassifier.js';

/**
 * Stage B Deterministic OMR Engine Web Worker
 * Production-Grade Hardened Version with:
 * - Bubble interior masking (erose border ring)
 * - Page-adaptive fill thresholds (global_darkness_index)
 * - Strict multi-signal ambiguity detection
 * - Full telemetry per-question output
 */

self.onmessage = async (e) => {
    const { messageType } = e.data;

    if (messageType === 'PROCESS_OMR') {
        try {
            const { imageBitmap, markingSchemeCount, id } = e.data;

            // 1. Stage A: Layout Classification (deskew, column detection, bubble grouping)
            const layoutResult = await classifyQuestionRegions(imageBitmap, markingSchemeCount);

            const omrResults = [];

            // 2. Execute Stage B on confidently structured pure-OMR regions
            if (layoutResult.layout === 'hybrid-grid' || layoutResult.layout === 'single-column') {
                const imageData = layoutResult.correctedImageData;
                const width = imageData.width;

                // B.0 Compute page-level darkness calibration (for adaptive thresholds)
                const pageCalibration = computePageCalibration(imageData.data, width, imageData.height);

                for (const roi of layoutResult.regions) {
                    if (roi.type === 'omr' && roi.confidence > 0.5) {
                        const result = processOMRQuestion(imageData, width, roi, pageCalibration);
                        omrResults.push(result);
                    }
                }
            }

            // Cleanup
            imageBitmap.close();

            self.postMessage({
                id,
                success: true,
                layoutResult,
                omrResults
            });

        } catch (error) {
            console.error('[omrWorker] Failed:', error);
            self.postMessage({ id: e.data.id, success: false, error: error.message });
        }
    }
};

// ─── B.0 PAGE CALIBRATION ─────────────────────────────────────────────────

/**
 * Compute page-level ink vs background statistics for adaptive thresholds.
 * Subsamples pixels (every 8th for speed) to compute:
 * - mean_background: expected brightness of blank paper
 * - global_darkness_index: normalized scale of how dark marks are vs paper
 */
function computePageCalibration(data, width, height) {
    const STEP = 8;
    let lightsum = 0, lightcount = 0;
    let darksum = 0, darkcount = 0;

    for (let y = 0; y < height; y += STEP) {
        for (let x = 0; x < width; x += STEP) {
            const idx = (y * width + x) * 4;
            const luma = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
            if (luma > 200) {
                lightsum += luma; lightcount++;
            } else if (luma < 80) {
                darksum += luma; darkcount++;
            }
        }
    }

    const mean_background = lightcount > 0 ? lightsum / lightcount : 240;
    const mean_mark = darkcount > 0 ? darksum / darkcount : 40;

    // Global darkness index: range 0..1 where 1 means very high contrast (ideal)
    const global_darkness_index = Math.min(1, (mean_background - mean_mark) / 200);

    // Derive adaptive thresholds
    // In good lighting: clear threshold = ~0.22, margin = ~0.08
    // In low contrast (faint pencil): relax thresholds
    const thresholds = {
        dark_luma: mean_background - (mean_background - mean_mark) * 0.5,
        clear_fill: Math.max(0.12, 0.22 - (1 - global_darkness_index) * 0.08),
        clear_margin: Math.max(0.05, 0.08 - (1 - global_darkness_index) * 0.04),
        blank_fill: Math.max(0.05, 0.10 - (1 - global_darkness_index) * 0.04),
        ambiguous_margin: Math.max(0.04, 0.08 - (1 - global_darkness_index) * 0.03),
    };

    return { mean_background, mean_mark, global_darkness_index, thresholds };
}

// ─── B.1 OMR QUESTION PROCESSOR ───────────────────────────────────────────

const optionsArray = ['A', 'B', 'C', 'D', 'E'];

function processOMRQuestion(imageData, fullWidth, roi, pageCalibration) {
    const data = imageData.data;
    const fillRatios = {};
    const bubbles = roi.omr_options;
    const { thresholds } = pageCalibration;

    for (let i = 0; i < bubbles.length && i < optionsArray.length; i++) {
        const bubble = bubbles[i];
        const letter = optionsArray[i];

        // B.1 Bubble Interior Masking:
        // Erode bubble bounding box inward to ignore the thick printed circle border.
        // 25% erosion gets us past the circle ring into the pure interior.
        const bw = bubble.maxX - bubble.minX;
        const bh = bubble.maxY - bubble.minY;
        const padX = Math.round(bw * 0.25);
        const padY = Math.round(bh * 0.25);

        const inMinX = bubble.minX + padX;
        const inMaxX = bubble.maxX - padX;
        const inMinY = bubble.minY + padY;
        const inMaxY = bubble.maxY - padY;

        if (inMaxX <= inMinX || inMaxY <= inMinY) {
            fillRatios[letter] = 0;
            continue;
        }

        const { darkCount, totalCount } = countInteriorDarkPixels(data, fullWidth, inMinX, inMaxX, inMinY, inMaxY, thresholds.dark_luma);
        const ratio = totalCount > 0 ? darkCount / totalCount : 0;
        fillRatios[letter] = ratio;
    }

    return decideBubbleAnswer(roi.inferred_question_number, fillRatios, thresholds, roi.confidence);
}

// ─── B.2 INTERIOR PIXEL COUNTING ──────────────────────────────────────────

function countInteriorDarkPixels(data, fullWidth, minX, maxX, minY, maxY, darkLumaThreshold) {
    let darkCount = 0;
    let totalCount = 0;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const idx = (y * fullWidth + x) * 4;
            const luma = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
            if (luma < darkLumaThreshold) darkCount++;
            totalCount++;
        }
    }
    return { darkCount, totalCount };
}

// ─── B.3 STRICT DECISION LOGIC ────────────────────────────────────────────

function decideBubbleAnswer(questionNumber, fillRatios, thresholds, roiConfidence) {
    const letters = Object.keys(fillRatios);

    if (letters.length === 0) {
        return { question_number: questionNumber, detected_answer: null, method: 'omr', confidence: 0, fill_ratios: {}, status: 'blank' };
    }

    letters.sort((a, b) => fillRatios[b] - fillRatios[a]);

    const max_ratio = fillRatios[letters[0]];
    const second_ratio = letters.length > 1 ? fillRatios[letters[1]] : 0;
    const margin = max_ratio - second_ratio;

    let status = 'ambiguous';
    let answer = null;
    let confidence = 0;

    // Strict Ambiguity Conditions. ANY of these being true forces ambiguous.
    const isBlank = max_ratio < thresholds.blank_fill;
    const isMarginTooNarrow = margin < thresholds.ambiguous_margin;
    const isMultipleFilled = letters.filter(l => fillRatios[l] > thresholds.blank_fill * 1.5).length > 1;
    const isROIUnconfident = roiConfidence < 0.55;

    if (isBlank) {
        status = 'blank';
    } else if (isROIUnconfident || isMarginTooNarrow || isMultipleFilled) {
        // Force to VLM fallback — do NOT guess
        status = 'ambiguous';
    } else if (max_ratio >= thresholds.clear_fill && margin >= thresholds.clear_margin) {
        status = 'clear';
        answer = letters[0];
        confidence = Math.min(1.0, 0.65 + margin * 2 + roiConfidence * 0.2);
    } else if (max_ratio >= thresholds.blank_fill * 1.5 && margin >= thresholds.clear_margin) {
        // Light mark but decisive margin — lower confidence clear
        status = 'clear';
        answer = letters[0];
        confidence = 0.55;
    }

    return {
        question_number: questionNumber,
        detected_answer: answer,
        method: 'omr',
        confidence,
        fill_ratios: fillRatios,
        status,
        // Telemetry pass-through
        _telemetry: {
            max_ratio: parseFloat(max_ratio.toFixed(4)),
            margin: parseFloat(margin.toFixed(4)),
            is_multi_filled: isMultipleFilled,
            roi_confidence: parseFloat(roiConfidence.toFixed(3)),
        }
    };
}
