/* src/workers/oprPipeline/qualityGate.js */

export function checkQuality(imageData) {
    const { data, width, height } = imageData;

    // 1. Grayscale conversion for analysis
    const gray = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        gray[j] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }

    // 2. Laplacian Variance Blur Detection
    const blurScore = computeLaplacianVariance(gray, width, height);

    // 3. Glare Detection (High-saturation white clusters)
    const glareScore = detectGlare(data, width, height);

    const ACCEPTABLE_BLUR = 80; // Standard threshold
    const MAX_GLARE_RATIO = 0.05; // 5% of pixels

    let accepted = true;
    let reason = '';

    if (blurScore < ACCEPTABLE_BLUR) {
        accepted = false;
        reason = 'Image too blurry';
    } else if (glareScore > MAX_GLARE_RATIO) {
        accepted = false;
        reason = 'Excessive glare detected';
    }

    return {
        accepted,
        reason_if_rejected: reason,
        focus_score: Math.round(blurScore),
        glare_score: parseFloat(glareScore.toFixed(4)),
        page_confidence: 1.0 // Placeholder for completeness check
    };
}

function computeLaplacianVariance(gray, w, h) {
    let sum = 0;
    let sumSq = 0;
    const n = (w - 2) * (h - 2);

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
            sum += lap;
            sumSq += lap * lap;
        }
    }
    const mean = sum / n;
    return (sumSq / n) - (mean * mean);
}

function detectGlare(data, w, h) {
    let brightCount = 0;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // Glare is often pure white (255, 255, 255)
        if (r > 240 && g > 240 && b > 240) {
            brightCount++;
        }
    }
    return brightCount / (w * h);
}
