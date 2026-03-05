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
    // Layer 3 (Normalization) centers paper luma at 128.
    // Dark = significantly darker than 128. 
    const dynamicDarkThreshold = 110;
    console.log(`[OPR Candidates] Normalized baseline assumption: 128, darkThreshold: ${dynamicDarkThreshold}`);

    gridModel.rows.forEach(row => {
        const cols = row.columns || gridModel.cols;
        const rowPitch = row.pitch || 40; // from geometryEngine

        cols.forEach(col => {
            // -- LOCAL CENTERING (Snap-to-darkest) --
            // The grid might be slightly off. We look in a small radius (±8px) 
            // for the darkest point and center there.
            const refined = findLocalDarkest(data, width, height, col.x, row.y, 8);
            const centerX = refined.x;
            const centerY = refined.y;

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
                origX: col.x, // keep for debug
                origY: row.y, // keep for debug
                patchSize,
                stats
            });
        });
    });

    return candidates;
}

/**
 * Finds the darkest local point in a search radius using a weighted centroid.
 * Helps bubbles "snap" to the actual filled circle even if the grid is misaligned.
 */
function findLocalDarkest(data, w, h, cx, cy, radius) {
    let minLuma = 255;
    let bestX = cx;
    let bestY = cy;

    // Phase 1: Coarse search for the darkest region
    for (let dy = -radius; dy <= radius; dy += 2) {
        for (let dx = -radius; dx <= radius; dx += 2) {
            const tx = Math.floor(cx + dx);
            const ty = Math.floor(cy + dy);
            if (tx < 1 || tx >= w - 1 || ty < 1 || ty >= h - 1) continue;

            const idx = (ty * w + tx) * 4;
            const luma = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;

            if (luma < minLuma) {
                minLuma = luma;
                bestX = tx;
                bestY = ty;
            }
        }
    }

    // Phase 2: Refine using centroid of dark pixels in a 5x5 window
    // This gives us sub-pixel-like "snapping" to the center of the ink blob
    let sumX = 0, sumY = 0, sumW = 0;
    const searchSize = 4;
    for (let dy = -searchSize; dy <= searchSize; dy++) {
        for (let dx = -searchSize; dx <= searchSize; dx++) {
            const tx = bestX + dx;
            const ty = bestY + dy;
            if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;

            const idx = (ty * w + tx) * 4;
            const luma = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;

            // Weight is "darkness" (inverse of luma)
            const weight = Math.pow(Math.max(0, 255 - luma), 2);
            sumX += tx * weight;
            sumY += ty * weight;
            sumW += weight;
        }
    }

    if (sumW > 0) {
        return { x: Math.round(sumX / sumW), y: Math.round(sumY / sumW) };
    }
    return { x: Math.round(bestX), y: Math.round(bestY) };
}



export function classifyStates(candidates) {
    // 1. Group candidates by Row (Question Number)
    const rows = {};
    candidates.forEach(c => {
        if (!rows[c.q_num]) rows[c.q_num] = [];
        rows[c.q_num].push(c);
    });

    const results = [];

    // 2. Process each row statistically
    Object.values(rows).forEach(rowCandidates => {
        // Calculate Row Mean and StdDev of bubble intensities
        const intensities = rowCandidates.map(c => c.stats.mean);
        const rowMean = intensities.reduce((a, b) => a + b, 0) / intensities.length;
        const rowSqDiffs = intensities.map(v => Math.pow(v - rowMean, 2));
        const rowStd = Math.sqrt(rowSqDiffs.reduce((a, b) => a + b, 0) / intensities.length);

        // Standard OMR Z-Score logic: 
        // A filled bubble is a significant outlier from the row's own baseline.
        rowCandidates.forEach(c => {
            const zScore = rowStd > 2 ? (rowMean - c.stats.mean) / rowStd : 0;
            // Because we ignore outlines (Inner-Circle Masking), fillRatio for empty bubbles will be < 0.05.
            const fillRatio = c.stats.sampleCount > 0 ? c.stats.darkPixels / c.stats.sampleCount : 0;

            let state = 'EMPTY';
            let confidence = 0.95;

            // Z-Score >= 1.5 is the standard OMR "Significant Outlier" signal
            if (zScore >= 1.5 && fillRatio > 0.2) {
                state = 'FILLED';
                confidence = Math.min(0.99, 0.75 + (zScore / 5));
            } else if (zScore >= 1.0 || (fillRatio > 0.1 && rowMean - c.stats.mean > 15)) {
                state = 'ERASURE_SUSPECT';
                confidence = 0.5;
            }

            // Updated Z-Score logic with improved signal
            // Because we ignore outlines, fillRatio for empty bubbles will be < 0.05.

            results.push({
                ...c,
                state,
                zScore: Math.round(zScore * 100) / 100,
                fillRatio: Math.round(fillRatio * 100) / 100,
                confidence
            });
        });
    });

    return results;
}


function analyzePatch(data, w, h, cx, cy, size, darkThreshold = 140) {
    let sum = 0;
    let darkPixels = 0;
    const half = Math.floor(size / 2);
    let sampleCount = 0;

    // INNER-CIRCLE MASKING:
    // We only sample pixels within 75% of the radius.
    // This completely ignores the printed bubble outline, ensuring "Empty" bubbles
    // have near-zero dark pixels.
    const radiusSq = Math.pow(size * 0.38, 2);

    for (let y = cy - half; y < cy + half; y++) {
        for (let x = cx - half; x < cx + half; x++) {
            if (x < 0 || x >= w || y < 0 || y >= h) continue;

            const dx = x - cx;
            const dy = y - cy;
            const distSq = dx * dx + dy * dy;

            if (distSq <= radiusSq) {
                const i = (y * w + x) * 4;
                const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                sum += luma;
                if (luma < darkThreshold) darkPixels++;
                sampleCount++;
            }
        }
    }

    if (sampleCount === 0) return { mean: 255, darkPixels: 0 };

    return {
        mean: sum / sampleCount,
        darkPixels,
        sampleCount
    };
}

