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
 * Finds the darkest local point in a search radius.
 * Helps bubbles "snap" to the actual filled circle if the grid is slightly misaligned.
 */
function findLocalDarkest(data, w, h, cx, cy, radius) {
    let minLuma = 255;
    let bestX = cx;
    let bestY = cy;

    // We don't check EVERY pixel, just a sparse grid within the radius
    for (let dy = -radius; dy <= radius; dy += 2) {
        for (let dx = -radius; dx <= radius; dx += 2) {
            const tx = Math.round(cx + dx);
            const ty = Math.round(cy + dy);
            if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;

            // Sample a tiny 3x3 window mean at this shift
            let sum = 0;
            let count = 0;
            for (let sy = -1; sy <= 1; sy++) {
                for (let sx = -1; sx <= 1; sx++) {
                    const idx = ((ty + sy) * w + (tx + sx)) * 4;
                    if (idx >= 0 && idx < data.length) {
                        sum += data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
                        count++;
                    }
                }
            }
            const mean = sum / count;
            if (mean < minLuma) {
                minLuma = mean;
                bestX = tx;
                bestY = ty;
            }
        }
    }
    return { x: bestX, y: bestY };
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
            const fillRatio = c.stats.darkPixels / (c.patchSize * c.patchSize);

            let state = 'EMPTY';
            let confidence = 0.95;

            // Z-Score > 1.8 is a strong signal for "Filled" relative to row
            if (zScore > 1.8 && fillRatio > 0.3) {
                state = 'FILLED';
                confidence = Math.min(0.99, 0.7 + (zScore / 5));
            } else if (zScore > 1.0 || (fillRatio > 0.15 && rowMean - c.stats.mean > 25)) {
                state = 'ERASURE_SUSPECT';
                confidence = 0.5;
            }

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

