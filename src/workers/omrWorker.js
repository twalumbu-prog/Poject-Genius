import { classifyQuestionRegions } from '../utils/questionClassifier.js';

/**
 * Stage B Deterministic OMR Engine Web Worker
 * NO AI. NO VLM. PURE PIXEL MATH.
 */

self.onmessage = async (e) => {
    const { messageType } = e.data;

    if (messageType === 'PROCESS_OMR') {
        try {
            const { imageBitmap, markingSchemeCount, id } = e.data;

            // 1. Pass the bitmap to Stage A for Layout Classification
            const layoutResult = await classifyQuestionRegions(imageBitmap, markingSchemeCount);

            const omrResults = [];

            // 2. Execute Stage B on confidently structured pure-OMR regions
            if (layoutResult.layout === 'hybrid-grid' || layoutResult.layout === 'single-column') {
                const imageData = layoutResult.correctedImageData;
                const width = imageData.width;

                for (const roi of layoutResult.regions) {
                    if (roi.type === 'omr' && roi.confidence > 0.6) {
                        const result = processOMRQuestion(imageData, width, roi);
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

/**
 * Stage B Core Logic: Mathematical Fill Ratio Analysis
 */
function processOMRQuestion(imageData, fullWidth, roi) {
    const optionsArray = ['A', 'B', 'C', 'D', 'E'];
    const data = imageData.data;
    const fillRatios = {};

    // roi.omr_options contains the {minX, maxX, minY, maxY} for each bubble circle 
    // found in Stage A, sorted left to right.
    const bubbles = roi.omr_options;

    for (let i = 0; i < bubbles.length && i < optionsArray.length; i++) {
        const bubble = bubbles[i];
        const letter = optionsArray[i];

        // Calculate the interior bounding box (shave off 20% to avoid the thick printed black border itself)
        const w = bubble.maxX - bubble.minX;
        const h = bubble.maxY - bubble.minY;
        const padX = Math.round(w * 0.2);
        const padY = Math.round(h * 0.2);

        const inMinX = bubble.minX + padX;
        const inMaxX = bubble.maxX - padX;
        const inMinY = bubble.minY + padY; // global Y since roi.omr_options stores global Y from Stage A logic
        const inMaxY = bubble.maxY - padY;

        let darkPixels = 0;
        let totalPixels = 0;

        // Standard threshold for clear pen/pencil
        const threshold = 160;

        for (let y = inMinY; y <= inMaxY; y++) {
            for (let x = inMinX; x <= inMaxX; x++) {
                const idx = (y * fullWidth + x) * 4;
                // Luminance
                const luma = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
                if (luma < threshold) {
                    darkPixels++;
                }
                totalPixels++;
            }
        }

        let ratio = totalPixels > 0 ? darkPixels / totalPixels : 0;

        // --- Light Pencil Retry ---
        // If it looks blank but might just be faint HB pencil, try a softer threshold
        if (ratio > 0.05 && ratio < 0.22) {
            let softDark = 0;
            const softThreshold = 200; // Much lighter gray 
            for (let y = inMinY; y <= inMaxY; y++) {
                for (let x = inMinX; x <= inMaxX; x++) {
                    const idx = (y * fullWidth + x) * 4;
                    const luma = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
                    if (luma < softThreshold) softDark++;
                }
            }
            const softRatio = softDark / totalPixels;
            // Only boost the ratio if the soft threshold reveals significantly more fill
            if (softRatio > ratio * 1.5) {
                ratio = softRatio * 0.8; // conservative boost
            }
        }

        fillRatios[letter] = ratio;
    }

    // 3. Decision Logic
    const letters = Object.keys(fillRatios);
    if (letters.length === 0) {
        return {
            question_number: roi.inferred_question_number,
            detected_answer: null,
            method: "omr",
            confidence: 0,
            fill_ratios: {},
            status: "blank"
        };
    }

    // Sort letters by highest ratio
    letters.sort((a, b) => fillRatios[b] - fillRatios[a]);

    const max_ratio = fillRatios[letters[0]];
    const second_ratio = letters.length > 1 ? fillRatios[letters[1]] : 0;
    const margin = max_ratio - second_ratio;

    let status = "ambiguous";
    let answer = null;
    let confidence = 0;

    // Case 4: Blank
    if (max_ratio < 0.12) {
        status = "blank";
    }
    // Case 1: Clear mark
    else if (max_ratio >= 0.22 && margin >= 0.08) {
        status = "clear";
        answer = letters[0];
        confidence = Math.min(1.0, 0.7 + margin);
    }
    // Case 3: Ambiguous (e.g., student shaded two circles, or scribbled one out)
    else if (margin < 0.08) {
        status = "ambiguous";
    }
    // Edge case: light mark but clear margin
    else if (max_ratio >= 0.12 && margin >= 0.08) {
        status = "clear";
        answer = letters[0];
        confidence = 0.6; // lower confidence because it was light
    }

    return {
        question_number: roi.inferred_question_number,
        detected_answer: answer,
        method: "omr",
        confidence,
        fill_ratios: fillRatios,
        status
    };
}
