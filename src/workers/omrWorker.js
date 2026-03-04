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

                // B.0 Compute page-level darkness calibration
                const pageCalibration = computePageCalibration(imageData.data, width, imageData.height);

                // B.0.1 LEARN GRID MODEL (Enterprise Grade)
                // Filter for high-confidence OMR rows to derive the geometric expected model
                const omrRegions = layoutResult.regions.filter(r => r.type === 'omr' && r.confidence > 0.6);
                const gridModel = learnGridModel(omrRegions);

                for (const roi of layoutResult.regions) {
                    if (roi.type === 'omr') {
                        // B.1.1 GEOMETRIC ENFORCEMENT: 
                        // If circles are missing, use gridModel to re-project them.
                        const enforcedROI = enforceGridGeometry(roi, gridModel);

                        const result = processOMRQuestion(imageData, width, enforcedROI, pageCalibration);
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
    const bubbleMetrics = [];
    const bubbles = roi.circleBlobs || [];
    const { thresholds } = pageCalibration;

    for (let i = 0; i < bubbles.length && i < optionsArray.length; i++) {
        const bubble = bubbles[i];
        const letter = optionsArray[i];

        // Bubble Interior Masking
        const bw = bubble.maxX - bubble.minX;
        const bh = bubble.maxY - bubble.minY;
        const padX = Math.round(bw * 0.25);
        const padY = Math.round(bh * 0.25);

        const inMinX = bubble.minX + padX;
        const inMaxX = bubble.maxX - padX;
        const inMinY = bubble.minY + padY;
        const inMaxY = bubble.maxY - padY;

        if (inMaxX <= inMinX || inMaxY <= inMinY) {
            bubbleMetrics.push({ letter, ratio: 0, meanIntensity: 255 });
            continue;
        }

        const metrics = sampleBubbleInterior(data, fullWidth, inMinX, inMaxX, inMinY, inMaxY, thresholds.dark_luma);
        bubbleMetrics.push({ letter, ...metrics });
    }

    // B.1.2 LOCAL Z-SCORE SCORING (Pressure Invariant)
    // Compute row statistics for relative darkness comparison
    const intensities = bubbleMetrics.map(m => m.meanIntensity);
    const rowMean = intensities.reduce((a, b) => a + b, 0) / intensities.length;
    const rowStd = Math.sqrt(intensities.map(x => Math.pow(x - rowMean, 2)).reduce((a, b) => a + b, 0) / intensities.length) || 1;

    const fillRatios = {};
    const zScores = {};
    for (const m of bubbleMetrics) {
        fillRatios[m.letter] = m.ratio;
        // Z-Score: More negative = Darker than neighbors. 
        // We invert it so higher = darker/stronger answer.
        zScores[m.letter] = (rowMean - m.meanIntensity) / rowStd;
    }

    return decideBubbleAnswer(roi.inferred_question_number, fillRatios, zScores, thresholds, roi.confidence);
}

// ─── B.2 INTERIOR SAMPLING (DETAILED) ────────────────────────────────────

function sampleBubbleInterior(data, fullWidth, minX, maxX, minY, maxY, darkLumaThreshold) {
    let darkCount = 0;
    let totalCount = 0;
    let sumIntensity = 0;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const idx = (y * fullWidth + x) * 4;
            const luma = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
            if (luma < darkLumaThreshold) darkCount++;
            sumIntensity += luma;
            totalCount++;
        }
    }
    return {
        ratio: totalCount > 0 ? darkCount / totalCount : 0,
        meanIntensity: totalCount > 0 ? sumIntensity / totalCount : 255
    };
}

// ─── B.3 STRICT DECISION LOGIC ────────────────────────────────────────────

function decideBubbleAnswer(questionNumber, fillRatios, zScores, thresholds, roiConfidence) {
    const letters = Object.keys(fillRatios);

    if (letters.length === 0) {
        return { question_number: questionNumber, detected_answer: null, method: 'omr', confidence: 0, fill_ratios: {}, status: 'blank' };
    }

    // PRIMARY SIGNAL: Z-Score (Relative darkness in row)
    // SECONDARY SIGNAL: Fill Ratio (Absolute ink presence)
    letters.sort((a, b) => {
        // Tie-breaker using fill ratio if Z-scores are extremely close
        if (Math.abs(zScores[b] - zScores[a]) < 0.15) return fillRatios[b] - fillRatios[a];
        return zScores[b] - zScores[a];
    });

    const bestLetter = letters[0];
    const secondLetter = letters[1];

    const max_ratio = fillRatios[bestLetter];
    const max_z = zScores[bestLetter];

    const second_ratio = letters.length > 1 ? fillRatios[secondLetter] : 0;
    const second_z = letters.length > 1 ? zScores[secondLetter] : 0;

    const margin = max_ratio - second_ratio;
    const z_margin = max_z - second_z;

    let status = 'ambiguous';
    let answer = null;
    let confidence = 0;

    // Strict Conditions:
    const isBlank = max_ratio < thresholds.blank_fill && max_z < 0.8;
    const isVeryStrong = max_z > 2.0 && z_margin > 1.2;
    const isClearByRatio = max_ratio >= thresholds.clear_fill && margin >= thresholds.clear_margin;

    // Confusion guards
    const isMultiFilled = letters.filter(l => fillRatios[l] > thresholds.blank_fill * 1.5 || zScores[l] > 1.0).length > 1;
    const isMarginNarrow = z_margin < 0.7;

    if (isBlank) {
        status = 'blank';
    } else if (isMultiFilled && !isVeryStrong) {
        status = 'ambiguous';
    } else if (isVeryStrong || (isClearByRatio && !isMarginNarrow)) {
        status = 'clear';
        answer = bestLetter;
        // Compute confidence based on both signals
        confidence = Math.min(1.0, 0.5 + (z_margin * 0.2) + (margin * 1.5));
    } else if (max_z > 1.5 && z_margin > 0.8) {
        // High relative darkness even if low absolute ratio (faint mark)
        status = 'clear';
        answer = bestLetter;
        confidence = 0.55;
    }

    return {
        question_number: questionNumber,
        detected_answer: answer,
        method: 'omr',
        confidence,
        fill_ratios: fillRatios,
        z_scores: zScores,
        status,
        _telemetry: {
            max_ratio: parseFloat(max_ratio.toFixed(4)),
            max_z: parseFloat(max_z.toFixed(2)),
            z_margin: parseFloat(z_margin.toFixed(2)),
            roi_confidence: parseFloat(roiConfidence.toFixed(3)),
        }
    };
}

// ─── B.4 GRID MODELING (ENTERPRISE GRADE) ────────────────────────────────

function learnGridModel(omrRegions) {
    if (omrRegions.length < 2) return null;

    const widths = [];
    const gaps = [];
    const heights = [];

    for (const r of omrRegions) {
        heights.push(r.height);
        const circles = r.circleBlobs || [];
        if (circles.length > 1) {
            for (let i = 0; i < circles.length; i++) {
                widths.push(circles[i].maxX - circles[i].minX);
                if (i > 0) gaps.push(circles[i].minX - circles[i - 1].maxX);
            }
        }
    }

    const median = (arr) => {
        if (arr.length === 0) return 0;
        arr.sort((a, b) => a - b);
        return arr[Math.floor(arr.length / 2)];
    };

    return {
        avg_width: median(widths) || 25,
        avg_gap: median(gaps) || 15,
        avg_height: median(heights) || 35,
        total_options: 4 // Standard for this project
    };
}

function enforceGridGeometry(roi, model) {
    if (!model || !roi.circleBlobs || roi.circleBlobs.length === model.total_options) {
        return roi;
    }

    // Force projection if bubbles are missing
    const circles = [...roi.circleBlobs].sort((a, b) => a.minX - b.minX);
    const newCircles = [];

    // Heuristic: Use the leftmost circle as an anchor
    const anchor = circles[0];
    const unitStep = model.avg_width + model.avg_gap;

    for (let i = 0; i < model.total_options; i++) {
        // Assume first circle is option A (index 0) or close to it
        // This is a simplification; a more robust one aligns circles to best-fit X-positions
        const expectedX = anchor.minX + i * unitStep;

        // Find if we have a circle near expectedX
        const matched = circles.find(c => Math.abs(c.minX - expectedX) < model.avg_width * 0.6);
        if (matched) {
            newCircles.push(matched);
        } else {
            // RE-PROJECT MISSING BUBBLE
            newCircles.push({
                minX: expectedX,
                maxX: expectedX + model.avg_width,
                minY: roi.y,
                maxY: roi.y + model.avg_height
            });
        }
    }

    return { ...roi, circleBlobs: newCircles };
}
