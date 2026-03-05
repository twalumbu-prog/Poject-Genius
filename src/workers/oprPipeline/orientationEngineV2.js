export function evaluateOrientationV2(imageData) {
    const t0 = performance.now();
    // 1. Generate Candidates
    const candidates = [
        { angle: 0, image: imageData },
        { angle: 90, image: rotateImageDataFast(imageData, 90) },
        { angle: 180, image: rotateImageDataFast(imageData, 180) },
        { angle: 270, image: rotateImageDataFast(imageData, 270) }
    ];

    // 2. Evaluate Signals for each candidate
    const results = candidates.map(candidate => {
        // We downscale for fast evaluation of grid and components
        const smallImg = downscaleImageFast(candidate.image, 400);

        const gridScore = computeGridScore(smallImg);
        const ocrScore = computeHeaderOCRProxyScore(smallImg);
        const edgeScore = computeHeaderEdgeDensityScore(smallImg);
        const numberColumnScore = computeNumberColumnScore(smallImg);

        const totalScore = (0.35 * gridScore) + (0.30 * ocrScore) + (0.20 * edgeScore) + (0.15 * numberColumnScore);

        return {
            angle: candidate.angle,
            image: candidate.image,
            scores: { gridScore, ocrScore, edgeScore, numberColumnScore, totalScore }
        };
    });

    // 3. Select Best Orientation
    results.sort((a, b) => b.scores.totalScore - a.scores.totalScore);
    const bestCandidate = results[0];

    const t1 = performance.now();
    console.log(`[Orientation V2] Evaluated in ${Math.round(t1 - t0)}ms. Best angle: ${bestCandidate.angle}° (score: ${bestCandidate.scores.totalScore.toFixed(2)})`);
    console.table(results.map(r => ({
        angle: r.angle,
        ...r.scores
    })));

    return {
        correctedImage: bestCandidate.image,
        rotationApplied: bestCandidate.angle,
        orientationConfidence: bestCandidate.scores.totalScore,
        orientationScores: results.map(r => ({ angle: r.angle, scores: r.scores }))
    };
}

// --- SIGNAL SCORING FUNCTIONS ---

/**
 * Signal 1: Bubble Grid Alignment (Weight: 0.35)
 * Looks for strong horizontal rows of repeating elements (bubbles)
 * in the lower 70% of the page.
 */
function computeGridScore(smallImg) {
    const { width, height, data } = smallImg;
    const startY = Math.floor(height * 0.3); // skip header

    // Create horizontal projection profile of dark pixels
    const hProfile = new Float32Array(height);
    for (let y = startY; y < height; y++) {
        let darkCount = 0;
        for (let x = 0; x < width; x++) {
            const luma = getLuma(data, (y * width + x) * 4);
            if (luma < 150) darkCount++;
        }
        hProfile[y] = darkCount;
    }

    // Count sharp peaks in the profile which signify cleanly spaced horizontal rows
    let peakCount = 0;
    let totalPeakEnergy = 0;
    const avgDark = average(hProfile.slice(startY));

    for (let y = startY + 2; y < height - 2; y++) {
        if (hProfile[y] > avgDark * 1.5 &&
            hProfile[y] > hProfile[y - 1] &&
            hProfile[y] > hProfile[y + 1]) {
            peakCount++;
            totalPeakEnergy += hProfile[y];
            y += 3; // skip immediate neighborhood
        }
    }

    // ECZ sheets usually have 20 rows per block, 3 blocks vertically (or 60 rows total)
    // Sideways orientation will have ~15 columns which becomes 15 rows, far fewer than 60.
    const idealPeaks = 60;
    const peakScore = Math.min(1.0, peakCount / idealPeaks);
    const consistencyScore = totalPeakEnergy > 0 ? Math.min(1.0, (peakCount * 20) / totalPeakEnergy) : 0;

    return (peakScore * 0.7) + (consistencyScore * 0.3);
}

/**
 * Signal 2: Header OCR Readability Proxy (Weight: 0.30)
 * Tesseract is not available in the worker. We use a structural heuristic:
 * Printed text forms distinct, very thin, highly dense horizontal bands
 * in the top 20% of the image.
 */
function computeHeaderOCRProxyScore(smallImg) {
    const { width, height, data } = smallImg;
    const headerH = Math.floor(height * 0.2);

    // Compute horizontal projection of edges in the header
    const hProfile = new Float32Array(headerH);
    for (let y = 0; y < headerH - 1; y++) {
        let edges = 0;
        for (let x = 0; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            const p = getLuma(data, idx);
            const px = getLuma(data, idx + 4);
            if (Math.abs(p - px) > 30) edges++;
        }
        hProfile[y] = edges;
    }

    let textLineCount = 0;
    const avgEdges = average(hProfile) || 1;

    // Look for text lines (blocks of high-density edges)
    for (let y = 1; y < headerH - 1; y++) {
        if (hProfile[y] > avgEdges * 2.0 && hProfile[y] > hProfile[y - 1]) {
            textLineCount++;
            y += 4; // skip thickness of a font line
        }
    }

    // A good header has 3-8 clear distinct text lines (Title, Instructions, Name, etc)
    if (textLineCount >= 3 && textLineCount <= 12) return 1.0;
    if (textLineCount > 12) return 0.5; // too noisy
    return textLineCount / 3.0; // partial
}

/**
 * Signal 3: Header Edge Density (Weight: 0.20)
 * Reuses the robust Sobel edge margin from V1. 
 * The top 15% should have significantly more edges than the bottom 15%.
 */
function computeHeaderEdgeDensityScore(smallImg) {
    const { width, height, data } = smallImg;
    const marginY = Math.floor(height * 0.15);

    let topEdges = 0, bottomEdges = 0;

    for (let y = 0; y < marginY - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            const p = getLuma(data, idx);
            const py = getLuma(data, idx + width * 4);
            if (Math.abs(p - py) > 25) topEdges++;
        }
    }

    for (let y = height - marginY; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            const p = getLuma(data, idx);
            const py = getLuma(data, idx + width * 4);
            if (Math.abs(p - py) > 25) bottomEdges++;
        }
    }

    const totalEdges = topEdges + bottomEdges;
    if (totalEdges === 0) return 0;

    // Normalised score: 1.0 if top has 100% of the edges, 0.5 if equal, 0 if bottom has 100%
    return topEdges / totalEdges;
}

/**
 * Signal 4: Question Number Column Score (Weight: 0.15)
 * Question numbers are usually aligned vertically on the left 20% of the page
 * starting below the header.
 */
function computeNumberColumnScore(smallImg) {
    const { width, height, data } = smallImg;
    const marginX = Math.floor(width * 0.2);
    const startY = Math.floor(height * 0.3);

    // Vertical projection profile of the left margin
    const vProfile = new Float32Array(marginX);
    for (let x = 0; x < marginX; x++) {
        let darkCount = 0;
        for (let y = startY; y < height; y++) {
            const luma = getLuma(data, (y * width + x) * 4);
            if (luma < 128) darkCount++;
        }
        vProfile[x] = darkCount;
    }

    // Numbers form a distinct vertical column spike in the profile
    let maxSpike = 0;
    for (let x = 0; x < marginX; x++) {
        if (vProfile[x] > maxSpike) maxSpike = vProfile[x];
    }

    const avgDark = average(vProfile) || 1;
    const spikeRatio = maxSpike / avgDark;

    // A strong vertical column will spike at least 3x the average of the empty margin space
    return Math.min(1.0, spikeRatio / 5.0);
}

// --- UTILITIES ---

function getLuma(data, idx) {
    return data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
}

function average(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function rotateImageDataFast(imageData, degrees) {
    const { width, height, data } = imageData;
    let newW = width, newH = height;

    degrees = ((degrees % 360) + 360) % 360;
    if (degrees === 0) return imageData;

    if (degrees === 90 || degrees === 270) {
        newW = height;
        newH = width;
    }

    const newData = new Uint8ClampedArray(newW * newH * 4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let nx, ny;
            if (degrees === 90) { nx = height - 1 - y; ny = x; }
            else if (degrees === 270) { nx = y; ny = width - 1 - x; }
            else if (degrees === 180) { nx = width - 1 - x; ny = height - 1 - y; }

            const si = (y * width + x) * 4;
            const di = (ny * newW + nx) * 4;

            newData[di] = data[si];     // R
            newData[di + 1] = data[si + 1]; // G
            newData[di + 2] = data[si + 2]; // B
            newData[di + 3] = data[si + 3]; // A
        }
    }
    return new ImageData(newData, newW, newH);
}

function downscaleImageFast(imageData, targetWidth) {
    const { width, height, data } = imageData;
    const scale = targetWidth / width;
    if (scale >= 1.0) return imageData; // Don't upscale

    const targetHeight = Math.round(height * scale);
    const newData = new Uint8ClampedArray(targetWidth * targetHeight * 4);

    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            const srcX = Math.floor(x / scale);
            const srcY = Math.floor(y / scale);
            const si = (srcY * width + srcX) * 4;
            const di = (y * targetWidth + x) * 4;

            newData[di] = data[si];
            newData[di + 1] = data[si + 1];
            newData[di + 2] = data[si + 2];
            newData[di + 3] = data[si + 3];
        }
    }
    return new ImageData(newData, targetWidth, targetHeight);
}
