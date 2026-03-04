/* src/workers/oprPipeline/bubbleProcessor.js */

export function detectCandidates(warpedImageData, gridModel) {
    const { width, height, data } = warpedImageData;
    const candidates = [];

    // For each expected intersection in the grid, we look for a bubble
    gridModel.rows.forEach(row => {
        // Multi-column support: use columns specific to this row/block
        const cols = row.columns || gridModel.cols;
        cols.forEach(col => {
            // Sample a patch around the expected center
            const centerX = col.x;
            const centerY = row.y;
            const patchSize = 30; // 30x30 patch

            const stats = analyzePatch(data, width, height, centerX, centerY, patchSize);

            candidates.push({
                bubble_id: `r${row.y}c${col.x}`,
                q_num: row.question_number,
                label: col.label,
                x: centerX,
                y: centerY,
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

function analyzePatch(data, w, h, cx, cy, size) {
    let sum = 0;
    let darkPixels = 0;
    const half = Math.floor(size / 2);
    // Dark threshold is relative to 255. In a dark room, paper might be 150.
    const darkThreshold = 140;

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
