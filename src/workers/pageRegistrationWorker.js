/* src/workers/pageRegistrationWorker.js */

self.onmessage = async (e) => {
    if (e.data.type === 'PROCESS_PAGE') {
        const { imageBitmap } = e.data;
        const result = processPage(imageBitmap);
        self.postMessage({ type: 'PAGE_REGISTERED', ...result });
    }
};

function processPage(imageBitmap) {
    const t0 = performance.now();
    const width = imageBitmap.width;
    const height = imageBitmap.height;

    // 0.0 Downscale for fast edge detection & contour finding
    // We want the long edge to be roughly 600px
    const MAX_DIM = 600;
    const scale = Math.min(1.0, MAX_DIM / Math.max(width, height));
    const sw = Math.round(width * scale);
    const sh = Math.round(height * scale);

    const smallCanvas = new OffscreenCanvas(sw, sh);
    const sCtx = smallCanvas.getContext('2d', { willReadFrequently: true });
    sCtx.drawImage(imageBitmap, 0, 0, sw, sh);
    const smallImgData = sCtx.getImageData(0, 0, sw, sh);

    // 0.1 Blur Detection (Variance of Laplacian)
    const gray = computeGrayscale(smallImgData);
    const blurScore = computeLaplacianVariance(gray, sw, sh);
    const isBlurry = blurScore < 100; // Threshold 100 is standard for mobile blur

    const blurred = gaussianBlur(gray, sw, sh);
    const edges = computeSobel(blurred, sw, sh);

    // 0.2 Largest Contour Detection
    const contours = findContours(edges, sw, sh);
    let bestQuad = null;
    let maxArea = 0;

    for (const contour of contours) {
        // Find 4 corners (extreme points of x+y and x-y)
        const quad = extractQuadCorners(contour);
        if (!quad) continue;

        // 0.3 Quadrilateral Validation
        const validation = validateQuad(quad, sw, sh, edges);
        if (validation.valid && validation.area > maxArea) {
            maxArea = validation.area;
            bestQuad = {
                points: quad,
                confidence: validation.confidence,
                area: validation.area
            };
        }
    }

    // 0.4 Perspective Warp
    if (bestQuad && bestQuad.confidence >= 0.65) {
        // Scale quad points back to original image size
        const originalQuad = bestQuad.points.map(p => ({
            x: p.x / scale,
            y: p.y / scale
        }));

        console.log(`[Stage 0] High confidence page detected (${Math.round(bestQuad.confidence * 100)}%). Warping...`);

        // Define standard output size (e.g. A4 aspect roughly 1:1.414)
        const PORTRAIT_H = 1800;
        const PORTRAIT_W = Math.round(1800 / 1.414); // ~1273

        // Check if the physical quad is wider than it is tall (landscape capture)
        const [tl, tr, br, bl] = originalQuad;
        const widthT = Math.hypot(tr.x - tl.x, tr.y - tl.y);
        const heightL = Math.hypot(bl.x - tl.x, bl.y - tl.y);

        const isLandscapeQuad = widthT > heightL;
        const targetW = isLandscapeQuad ? PORTRAIT_H : PORTRAIT_W;
        const targetH = isLandscapeQuad ? PORTRAIT_W : PORTRAIT_H;

        // Draw original full size to get pixels
        const fullCanvas = new OffscreenCanvas(width, height);
        const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
        fullCtx.drawImage(imageBitmap, 0, 0);
        const fullImgData = fullCtx.getImageData(0, 0, width, height);

        const warpedImageData = warpPerspective(fullImgData, originalQuad, targetW, targetH);

        // --- Stage 0.5: Orientation Correction ---
        const correctedImageData = detectAndFixRotation(warpedImageData);

        const t1 = performance.now();
        return {
            page_detected: true,
            page_confidence: bestQuad.confidence,
            blur_score: Math.round(blurScore),
            is_blurry: isBlurry,
            quad_points: originalQuad,
            warpedImageData: correctedImageData,
            processingTimeMs: Math.round(t1 - t0)
        };
    } else {
        console.warn("[Stage 0] No high-confidence page bounds found. Bypassing warp.");
        const t1 = performance.now();
        return {
            page_detected: false,
            page_confidence: bestQuad ? bestQuad.confidence : 0,
            blur_score: Math.round(blurScore),
            is_blurry: isBlurry,
            quad_points: null,
            warpedImageData: null,
            processingTimeMs: Math.round(t1 - t0)
        };
    }
}

// --- Image Math Utilities ---

function computeGrayscale(imageData) {
    const d = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        gray[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    }
    return gray;
}

function gaussianBlur(gray, width, height) {
    // 3x3 approx blur
    const out = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            const sum = gray[i] * 4 +
                gray[i - 1] * 2 + gray[i + 1] * 2 +
                gray[i - width] * 2 + gray[i + width] * 2 +
                gray[i - width - 1] + gray[i - width + 1] +
                gray[i + width - 1] + gray[i + width + 1];
            out[i] = sum / 16;
        }
    }
    return out;
}

function computeLaplacianVariance(gray, w, h) {
    // 3x3 Laplacian Kernel
    // [ 0,  1, 0]
    // [ 1, -4, 1]
    // [ 0,  1, 0]
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
    const variance = (sumSq / n) - (mean * mean);
    return variance;
}

function computeSobel(gray, width, height) {
    const edge = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            const gx = -1 * gray[i - width - 1] + 1 * gray[i - width + 1] +
                -2 * gray[i - 1] + 2 * gray[i + 1] +
                -1 * gray[i + width - 1] + 1 * gray[i + width + 1];

            const gy = -1 * gray[i - width - 1] - 2 * gray[i - width] - 1 * gray[i - width + 1] +
                1 * gray[i + width - 1] + 2 * gray[i + width] + 1 * gray[i + width + 1];

            const mag = Math.abs(gx) + Math.abs(gy); // fast approx
            edge[i] = mag > 100 ? 255 : 0; // strict threshold for strong paper edges
        }
    }
    return edge;
}

// Minimal 8-neighbor Moore tracer
function findContours(edgeMap, width, height) {
    const visited = new Uint8Array(width * height);
    const contours = [];

    const dx = [1, 1, 0, -1, -1, -1, 0, 1];
    const dy = [0, 1, 1, 1, 0, -1, -1, -1];

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            if (edgeMap[idx] === 255 && visited[idx] === 0) {
                const contour = [];
                let currX = x;
                let currY = y;
                let dir = 7;

                const startX = currX;
                const startY = currY;
                let limit = 5000;

                while (limit-- > 0) {
                    contour.push({ x: currX, y: currY });
                    visited[currY * width + currX] = 1;

                    let nextDir = -1;
                    // Scan 8 neighbors starting from left-behind
                    for (let i = 0; i < 8; i++) {
                        const testDir = (dir + 5 + i) % 8;
                        const nx = currX + dx[testDir];
                        const ny = currY + dy[testDir];
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            if (edgeMap[ny * width + nx] === 255) {
                                nextDir = testDir;
                                break;
                            }
                        }
                    }

                    if (nextDir === -1) break; // isolated

                    currX += dx[nextDir];
                    currY += dy[nextDir];
                    dir = nextDir;

                    if (currX === startX && currY === startY) break; // looped
                }
                if (contour.length > 50) { // minimum length to be a document
                    contours.push(contour);
                }
            }
        }
    }
    return contours;
}

function extractQuadCorners(contour) {
    if (contour.length < 4) return null;
    let tl = contour[0], tr = contour[0], bl = contour[0], br = contour[0];
    let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;

    for (let i = 0; i < contour.length; i++) {
        const p = contour[i];
        const sum = p.x + p.y;
        const diff = p.x - p.y;

        if (sum < minSum) { minSum = sum; tl = p; }
        if (sum > maxSum) { maxSum = sum; br = p; }
        if (diff < minDiff) { minDiff = diff; bl = p; }
        if (diff > maxDiff) { maxDiff = diff; tr = p; }
    }
    // Return sorted: Top-Left, Top-Right, Bottom-Right, Bottom-Left
    return [tl, tr, br, bl];
}

function validateQuad(quad, width, height, edges) {
    const [tl, tr, br, bl] = quad;

    // 1. Area via Shoelace (must be ≥ 35% of image)
    const area = 0.5 * Math.abs(
        (tl.x * tr.y - tr.x * tl.y) +
        (tr.x * br.y - br.x * tr.y) +
        (br.x * bl.y - bl.x * br.y) +
        (bl.x * tl.y - tl.x * bl.y)
    );
    const imgArea = width * height;
    if (area < imgArea * 0.35) return { valid: false };

    // 2. Corner Orthogonality (Rectangularity)
    // Check angles at corners (should be near 90°)
    const angleAt = (p1, p2, p3) => {
        const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
        const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
        const dot = v1.x * v2.x + v1.y * v2.y;
        const mag1 = Math.hypot(v1.x, v1.y);
        const mag2 = Math.hypot(v2.x, v2.y);
        if (mag1 === 0 || mag2 === 0) return 0;
        return Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2)))) * (180 / Math.PI);
    };

    const a1 = angleAt(bl, tl, tr);
    const a2 = angleAt(tl, tr, br);
    const a3 = angleAt(tr, br, bl);
    const a4 = angleAt(br, bl, tl);

    // Sum of deviations from 90 deg
    const dev = (Math.abs(90 - a1) + Math.abs(90 - a2) + Math.abs(90 - a3) + Math.abs(90 - a4)) / 4;
    const orthoSCORE = Math.max(0, 1.0 - dev / 45); // score 1.0 at perfect 90, 0.0 at 45 deg deviation

    if (dev > 25) return { valid: false }; // Too skewed to be a legit page

    // 3. Aspect Ratio
    const dTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const dBot = Math.hypot(br.x - bl.x, br.y - bl.y);
    const dLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const dRight = Math.hypot(br.x - tr.x, br.y - tr.y);

    const avgW = (dTop + dBot) / 2;
    const avgH = (dLeft + dRight) / 2;
    if (avgW === 0 || avgH === 0) return { valid: false };

    const aspectRatio = avgH / avgW;
    const isPortrait = aspectRatio >= 0.6 && aspectRatio <= 1.6;
    const isLandscape = (1 / aspectRatio) >= 0.6 && (1 / aspectRatio) <= 1.6;
    if (!isPortrait && !isLandscape) return { valid: false };

    // 4. Convexity
    const cross = (p1, p2, p3) => (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
    const c1 = cross(bl, tl, tr);
    const c2 = cross(tl, tr, br);
    const c3 = cross(tr, br, bl);
    const c4 = cross(br, bl, tl);
    const isConvex = (c1 >= 0 && c2 >= 0 && c3 >= 0 && c4 >= 0) || (c1 <= 0 && c2 <= 0 && c3 <= 0 && c4 <= 0);
    if (!isConvex) return { valid: false };

    // 5. Edge Density Consistency
    // Ensure that the edges of the quad actually follow high-gradient paths
    const edgeDensity = checkEdgeDensity(edges, quad, width, height);
    if (edgeDensity < 0.4) return { valid: false }; // At least 40% of the border must be on a strong edge

    // 6. Final Rigorous Confidence
    const coverageScore = Math.min(1.0, area / (imgArea * 0.9));
    const rectangularityScore = 1.0 - Math.abs(1.0 - Math.min(dTop / dBot, dBot / dTop)) - Math.abs(1.0 - Math.min(dLeft / dRight, dRight / dLeft));

    // Combine metrics: coverage (0.2), rectangularity (0.2), orthogonality (0.3), edgeDensity (0.3)
    const confidence = (coverageScore * 0.2) + (rectangularityScore * 0.2) + (orthoSCORE * 0.3) + (edgeDensity * 0.3);

    return { valid: true, area, confidence: Math.max(0, Math.min(1, confidence)) };
}

function checkEdgeDensity(edges, quad, w, h) {
    let hits = 0;
    let totalSamples = 0;
    const [tl, tr, br, bl] = quad;

    const sampleLine = (p1, p2) => {
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const steps = Math.floor(dist / 2); // sample every 2 pixels
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = Math.round(p1.x + (p2.x - p1.x) * t);
            const y = Math.round(p1.y + (p2.y - p1.y) * t);
            if (x >= 0 && x < w && y >= 0 && y < h) {
                totalSamples++;
                if (edges[y * w + x] === 255) hits++;
            }
        }
    };

    sampleLine(tl, tr);
    sampleLine(tr, br);
    sampleLine(br, bl);
    sampleLine(bl, tl);

    return totalSamples === 0 ? 0 : hits / totalSamples;
}

// Math solver for perspective warp
function gaussianElimination(A, b) {
    const n = A.length;
    for (let i = 0; i < n; i++) A[i].push(b[i]);

    for (let i = 0; i < n; i++) {
        let maxEl = Math.abs(A[i][i]);
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(A[k][i]) > maxEl) {
                maxEl = Math.abs(A[k][i]);
                maxRow = k;
            }
        }
        for (let k = i; k < n + 1; k++) {
            let tmp = A[maxRow][k];
            A[maxRow][k] = A[i][k];
            A[i][k] = tmp;
        }
        for (let k = i + 1; k < n; k++) {
            let c = -A[k][i] / A[i][i];
            for (let j = i; j < n + 1; j++) {
                if (i === j) A[k][j] = 0;
                else A[k][j] += c * A[i][j];
            }
        }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        x[i] = A[i][n] / A[i][i];
        for (let k = i - 1; k >= 0; k--) A[k][n] -= A[k][i] * x[i];
    }
    return x;
}

function getPerspectiveTransform(src, dst) {
    const a = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
        a.push([src[i].x, src[i].y, 1, 0, 0, 0, -src[i].x * dst[i].x, -src[i].y * dst[i].x]);
        b.push(dst[i].x);
        a.push([0, 0, 0, src[i].x, src[i].y, 1, -src[i].x * dst[i].y, -src[i].y * dst[i].y]);
        b.push(dst[i].y);
    }
    return gaussianElimination(a, b);
}

function warpPerspective(srcImgData, srcQuad, dstW, dstH) {
    const dstQuad = [
        { x: 0, y: 0 },
        { x: dstW, y: 0 },
        { x: dstW, y: dstH },
        { x: 0, y: dstH }
    ];

    // Compute inverse transform (Dst to Src)
    const invMat = getPerspectiveTransform(dstQuad, srcQuad);

    const srcD = srcImgData.data;
    const srcW = srcImgData.width;
    const srcH = srcImgData.height;

    // Create a new ImageData (we don't have ImageData constructor universally in workers, so we emulate)
    const dstD = new Uint8ClampedArray(dstW * dstH * 4);

    let dstIdx = 0;
    for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
            const den = invMat[6] * x + invMat[7] * y + 1;
            const sx = (invMat[0] * x + invMat[1] * y + invMat[2]) / den;
            const sy = (invMat[3] * x + invMat[4] * y + invMat[5]) / den;

            // Nearest neighbor interpolation for blazing speed. 2MP images are sufficiently dense.
            const sxi = Math.round(sx);
            const syi = Math.round(sy);

            if (sxi >= 0 && sxi < srcW && syi >= 0 && syi < srcH) {
                const srcIdx = (syi * srcW + sxi) * 4;
                dstD[dstIdx] = srcD[srcIdx];
                dstD[dstIdx + 1] = srcD[srcIdx + 1];
                dstD[dstIdx + 2] = srcD[srcIdx + 2];
                dstD[dstIdx + 3] = 255;
            } else {
                // Out of bounds -> white margin
                dstD[dstIdx] = 255;
                dstD[dstIdx + 1] = 255;
                dstD[dstIdx + 2] = 255;
                dstD[dstIdx + 3] = 255;
            }
            dstIdx += 4;
        }
    }
    return new ImageData(dstD, dstW, dstH);
}

function detectAndFixRotation(imageData) {
    const { width, height, data } = imageData;
    const cw = width;
    const ch = height;

    // Fast density check of the 4 outer margins (15% thickness)
    const marginY = Math.floor(ch * 0.15);
    const marginX = Math.floor(cw * 0.15);

    let topInk = 0, bottomInk = 0, leftInk = 0, rightInk = 0;

    // We only sample every 4th pixel for phenomenal speed
    const step = 4;

    // Top
    for (let y = 0; y < marginY; y += step) {
        for (let x = 0; x < cw; x += step) {
            const i = (y * cw + x) * 4;
            if (data[i] < 128) topInk++; // Dark pixel
        }
    }
    // Bottom
    for (let y = ch - marginY; y < ch; y += step) {
        for (let x = 0; x < cw; x += step) {
            const i = (y * cw + x) * 4;
            if (data[i] < 128) bottomInk++;
        }
    }
    // Left
    for (let x = 0; x < marginX; x += step) {
        for (let y = 0; y < ch; y += step) {
            const i = (y * cw + x) * 4;
            if (data[i] < 128) leftInk++;
        }
    }
    // Right
    for (let x = cw - marginX; x < cw; x += step) {
        for (let y = 0; y < ch; y += step) {
            const i = (y * cw + x) * 4;
            if (data[i] < 128) rightInk++;
        }
    }

    // Densities scaled to be comparable regardless of horizontal vs vertical margins
    const topDensity = topInk / ((cw / step) * (marginY / step));
    const botDensity = bottomInk / ((cw / step) * (marginY / step));
    const leftDensity = leftInk / ((ch / step) * (marginX / step));
    const rightDensity = rightInk / ((ch / step) * (marginX / step));

    console.log(`[Orientation] Edge densities - Top:${topDensity.toFixed(3)}, Bot:${botDensity.toFixed(3)}, L:${leftDensity.toFixed(3)}, R:${rightDensity.toFixed(3)}`);

    const maxDensity = Math.max(topDensity, botDensity, leftDensity, rightDensity);

    let workingData = imageData;

    // If the heaviest ink edge is not the top, rotate so it becomes the top.
    // The "Header" of an OMR form (Logo, Title, Instructions) is always the densest edge.
    if (maxDensity === leftDensity && leftDensity > Math.max(topDensity, rightDensity) * 1.2) {
        console.warn("[Orientation] Header is on the LEFT. Rotating +90° CW to make upright.");
        workingData = rotateImageData(workingData, 90);
    }
    else if (maxDensity === rightDensity && rightDensity > Math.max(topDensity, leftDensity) * 1.2) {
        console.warn("[Orientation] Header is on the RIGHT. Rotating 270° CW to make upright.");
        workingData = rotateImageData(workingData, 270);
    }
    else if (maxDensity === botDensity && botDensity > topDensity * 1.5) {
        console.warn("[Orientation] Header is on the BOTTOM. Rotating 180° to make upright.");
        workingData = rotateImageData(workingData, 180);
    }
    else {
        console.log("[Orientation] Header is at the TOP. Already upright.");
    }

    return workingData;
}

function rotateImageData(imageData, degrees) {
    const { width, height, data } = imageData;
    let newW = width, newH = height;

    // Normalize degrees
    degrees = ((degrees % 360) + 360) % 360;

    if (degrees === 90 || degrees === 270) {
        newW = height;
        newH = width;
    }

    const newData = new Uint8ClampedArray(newW * newH * 4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let nx, ny;
            if (degrees === 90) {
                nx = height - 1 - y;
                ny = x;
            } else if (degrees === 270) {
                nx = y;
                ny = width - 1 - x;
            } else if (degrees === 180) {
                nx = width - 1 - x;
                ny = height - 1 - y;
            } else {
                nx = x;
                ny = y;
            }

            const si = (y * width + x) * 4;
            const di = (ny * newW + nx) * 4;

            newData[di] = data[si];
            newData[di + 1] = data[si + 1];
            newData[di + 2] = data[si + 2];
            newData[di + 3] = data[si + 3];
        }
    }

    return new ImageData(newData, newW, newH);
}

function findAnchors(imageData) {
    const { width, height, data } = imageData;
    const anchors = [];
    const searchSize = 250;

    const checkCorner = (startX, startY) => {
        for (let y = startY; y < startY + searchSize; y++) {
            for (let x = startX; x < startX + searchSize; x++) {
                if (x < 0 || x >= width || y < 0 || y >= height) continue;
                const i = (y * width + x) * 4;
                if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) {
                    if (isSolidBlock(imageData, x, y, 15)) {
                        anchors.push({ x, y });
                        return;
                    }
                }
            }
        }
    };

    checkCorner(0, 0);
    checkCorner(width - searchSize, 0);
    checkCorner(0, height - searchSize);
    checkCorner(width - searchSize, height - searchSize);

    return anchors;
}

function isSolidBlock(imageData, startX, startY, size) {
    const { width, height, data } = imageData;
    if (startX + size >= width || startY + size >= height) return false;
    let blackCount = 0;
    for (let y = startY; y < startY + size; y++) {
        for (let x = startX; x < startX + size; x++) {
            const i = (y * width + x) * 4;
            if (data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) blackCount++;
        }
    }
    return blackCount > (size * size * 0.8);
}
