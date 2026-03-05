/* src/workers/oprPipeline/bubbleProcessor.js */

export function detectCandidates(warpedImageData, gridModel) {
    const { width, height, data } = warpedImageData;
    const candidates = [];

    // Compute global paper brightness for adaptive threshold
    let lumaSum = 0, lumaCount = 0;
    for (let i = 0; i < data.length; i += 16) { // every 4th pixel
        const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        if (l > 180) { lumaSum += l; lumaCount++; } // only bright (paper) pixels
    }
    const paperLuma = lumaCount > 0 ? lumaSum / lumaCount : 240;
    // Dark = anything significantly darker than paper
    const dynamicDarkThreshold = Math.max(80, paperLuma - 60);
    console.log(`[OPR Candidates] Paper baseline: ${Math.round(paperLuma)}, darkThreshold: ${Math.round(dynamicDarkThreshold)}`);

    gridModel.rows.forEach(row => {
        const cols = row.columns || gridModel.cols;
        const rowPitch = row.pitch || 40; // from geometryEngine

        cols.forEach(col => {
            const centerX = col.x;
            const centerY = row.y;

            // Adaptive patch: use half the tighter of row-pitch or column-pitch
            // Clamped between 12 (minimum useful) and 28 (max before overlap risk)
            const colPitch = col.colPitch || 30;
            const patchSize = Math.round(Math.min(
                Math.max(12, rowPitch * 0.65),
                Math.max(12, colPitch * 0.65),
                28
            ));

            const stats = analyzePatch(data, width, height, centerX, centerY, patchSize, dynamicDarkThreshold);

            candidates.push({
                bubble_id: `r${row.y}c${col.x}`,
                q_num: row.question_number,
                label: col.label,
                x: centerX,
                y: centerY,
                patchSize, // expose for debugging
                stats
            });
        });
    });

    return candidates;
}


export function classifyStates(candidates) {
    // 1. Compute global "paper" baseline from empty-looking patches
    const baselineIntensities = candidates.map(c => c.stats.mean).sort((a, b) => a - b);
    const paperWhite = baselineIntensities[Math.floor(baselineIntensities.length * 0.75)]; // 75th percentile is paper
    console.log(`[OPR Classification] Detected Paper Baseline: ${Math.round(paperWhite)}`);

    // 2. Compute adaptive thresholds
    const filledDelta = 65; // Minimum darkness delta from paper to be "filled"
    const erasureDelta = 35; // Minimum darkness delta to be "erasure"

    return candidates.map(c => {
        const delta = paperWhite - c.stats.mean;
        const fillRatio = c.stats.darkPixels / (30 * 30);

        let state = 'EMPTY';
        let confidence = 0.95;

        if (delta > filledDelta && fillRatio > 0.35) {
            state = 'FILLED';
        } else if (delta > erasureDelta && fillRatio > 0.15) {
            state = 'ERASURE_SUSPECT';
            confidence = 0.6;
        } else {
            state = 'EMPTY';
        }

        return {
            ...c,
            state,
            delta,
            fillRatio,
            confidence
        };
    });
}

function analyzePatch(data, w, h, cx, cy, size, darkThreshold = 140) {
    let sum = 0;
    let darkPixels = 0;
    const half = Math.floor(size / 2);

    for (let y = cy - half; y < cy + half; y++) {
        for (let x = cx - half; x < cx + half; x++) {
            if (x < 0 || x >= w || y < 0 || y >= h) continue;
            const i = (y * w + x) * 4;
            const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            sum += luma;
            if (luma < darkThreshold) darkPixels++;
        }
    }

    return {
        mean: sum / (size * size),
        darkPixels
    };
}

