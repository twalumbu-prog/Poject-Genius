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

        // Grid Score is the primary "Ground Truth" for OMR. If gridScore is low, 
        // we penalize other signals to avoid being tricked by sideways text/shadows.
        const structuralConfidence = gridScore > 0.4 ? 1.0 : 0.4;
        const totalScore = structuralConfidence * ((0.45 * gridScore) + (0.25 * ocrScore) + (0.15 * edgeScore) + (0.15 * numberColumnScore));

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
        gridScore: r.scores.gridScore.toFixed(2),
        ocrScore: r.scores.ocrScore.toFixed(2),
        edgeScore: r.scores.edgeScore.toFixed(2),
        colScore: r.scores.numberColumnScore.toFixed(2),
        total: r.scores.totalScore.toFixed(2)
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
 * Signal 1: Bubble Grid Alignment (Weight: 0.45)
 */
function computeGridScore(smallImg) {
    const { width, height, data } = smallImg;
    const startY = Math.floor(height * 0.3); // skip header
    const profileH = height - startY;

    // Create horizontal projection profile of dark pixels
    const hProfile = new Float32Array(profileH);
    for (let y = 0; y < profileH; y++) {
        let darkCount = 0;
        const py = y + startY;
        for (let x = 0; x < width; x++) {
            const luma = getLuma(data, (py * width + x) * 4);
            if (luma < 150) darkCount++;
        }
        hProfile[y] = darkCount;
    }

    // Count sharp peaks in the profile which signify cleanly spaced horizontal rows
    let peakCount = 0;
    const avgDark = average(hProfile) || 1;

    for (let y = 2; y < profileH - 2; y++) {
        // Vertical peaks of ink correspond to bubble rows
        if (hProfile[y] > avgDark * 1.3 &&
            hProfile[y] > hProfile[y - 1] &&
            hProfile[y] > hProfile[y + 1]) {
            peakCount++;
            y += 4; // skip thickness of a bubble
        }
    }

    // ECZ sheets physically have 20 rows of questions (01-20).
    // Even though there are 60 questions, they are in 3 columns sharing the same 20 Y-points.
    const idealPeaks = 20;
    const tolerance = 5; // allow 15-25 peaks

    if (peakCount >= (idealPeaks - tolerance) && peakCount <= (idealPeaks + tolerance)) {
        return 1.0;
    }

    // Gradual falloff
    return Math.max(0, 1.0 - Math.abs(peakCount - idealPeaks) / 20);
}

/**
 * Signal 2: Header OCR Readability Proxy (Weight: 0.25)
 * Looks for WIDE text strings at the top.
 */
function computeHeaderOCRProxyScore(smallImg) {
    const { width, height, data } = smallImg;
    const headerH = Math.floor(height * 0.2);

    let textLines = 0;

    for (let y = 5; y < headerH - 5; y += 3) {
        let lineEdges = 0;
        let leftBound = width, rightBound = 0;

        for (let x = 0; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            const p = getLuma(data, idx);
            const px = getLuma(data, idx + 4);
            if (Math.abs(p - px) > 40) {
                lineEdges++;
                if (x < leftBound) leftBound = x;
                if (x > rightBound) rightBound = x;
            }
        }

        // A valid header line (Title, Instructions) is geographically WIDE.
        // Sideways question numbers are geographically NARROW.
        const lineWidth = rightBound - leftBound;
        if (lineEdges > 15 && lineWidth > (width * 0.4)) {
            textLines++;
        }
    }

    // Upright ECZ sheet should have 3-10 wide text lines in the header margin
    if (textLines >= 2 && textLines <= 12) return 1.0;
    return Math.min(1.0, textLines / 2);
}

/**
 * Signal 3: Header Edge Density (Weight: 0.15)
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
            if (Math.abs(p - py) > 30) topEdges++;
        }
    }

    for (let y = height - marginY; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            const p = getLuma(data, idx);
            const py = getLuma(data, idx + width * 4);
            if (Math.abs(p - py) > 30) bottomEdges++;
        }
    }

    if (topEdges + bottomEdges === 0) return 0;
    return topEdges > bottomEdges * 1.5 ? 1.0 : (topEdges / (topEdges + bottomEdges));
}

/**
 * Signal 4: Question Number Column Score (Weight: 0.15)
 * Numbers form a vertical column, but they are NOT dense like bubbles.
 */
function computeNumberColumnScore(smallImg) {
    const { width, height, data } = smallImg;
    const leftMargin = Math.floor(width * 0.15);
    const startY = Math.floor(height * 0.3);

    // Vertical profile of the left margin
    const vProfile = new Float32Array(leftMargin);
    for (let x = 0; x < leftMargin; x++) {
        let darkest = 0;
        for (let y = startY; y < height - 5; y++) {
            const luma = getLuma(data, (y * width + x) * 4);
            if (luma < 140) darkest++;
        }
        vProfile[x] = darkest;
    }

    let colSpike = 0;
    for (let x = 0; x < leftMargin; x++) {
        if (vProfile[x] > colSpike) colSpike = vProfile[x];
    }

    // A vertical column of numbers is distinct but has gaps.
    // A vertical column of bubbles is much denser.
    const expectedHeight = height - startY;
    const density = colSpike / expectedHeight;

    // Numbers usually take up 40-70% of the vertical space in their column (due to gaps between digits)
    // Bubble columns take up >85% (they are solid blocks in projection).
    if (density > 0.35 && density < 0.8) return 1.0;
    if (density >= 0.8) return 0.2; // Likely a bubble column, not numbers
    return 0;
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
