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

    // 0.1 Edge Detection
    const gray = computeGrayscale(smallImgData);
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
        const validation = validateQuad(quad, sw, sh);
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
        const TARGET_H = 1800;
        const TARGET_W = Math.round(1800 / 1.414); // ~1273

        // Draw original full size to get pixels
        const fullCanvas = new OffscreenCanvas(width, height);
        const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
        fullCtx.drawImage(imageBitmap, 0, 0);
        const fullImgData = fullCtx.getImageData(0, 0, width, height);

        const warpedImageData = warpPerspective(fullImgData, originalQuad, TARGET_W, TARGET_H);

        const t1 = performance.now();
        return {
            page_detected: true,
            page_confidence: bestQuad.confidence,
            quad_points: originalQuad,
            warpedImageData: warpedImageData, // This is an ImageData object
            processingTimeMs: Math.round(t1 - t0)
        };
    } else {
        console.warn("[Stage 0] No high-confidence page bounds found. Bypassing warp.");
        const t1 = performance.now();
        return {
            page_detected: false,
            page_confidence: bestQuad ? bestQuad.confidence : 0,
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

function validateQuad(quad, width, height) {
    const [tl, tr, br, bl] = quad;

    // Area via Shoelace (must be ≥ 35% of image)
    const area = 0.5 * Math.abs(
        (tl.x * tr.y - tr.x * tl.y) +
        (tr.x * br.y - br.x * tr.y) +
        (br.x * bl.y - bl.x * br.y) +
        (bl.x * tl.y - tl.x * bl.y)
    );
    const imgArea = width * height;
    if (area < imgArea * 0.35) return { valid: false };

    // Aspect Ratio & Edges
    const dTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const dBot = Math.hypot(br.x - bl.x, br.y - bl.y);
    const dLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const dRight = Math.hypot(br.x - tr.x, br.y - tr.y);

    const avgW = (dTop + dBot) / 2;
    const avgH = (dLeft + dRight) / 2;
    if (avgW === 0 || avgH === 0) return { valid: false };

    // Most documents are taller than wide in portrait (1.414). Could be landscape.
    const aspectRatio = avgH / avgW;
    const isPortrait = aspectRatio >= 0.6 && aspectRatio <= 1.6;
    const isLandscape = (1 / aspectRatio) >= 0.6 && (1 / aspectRatio) <= 1.6;
    if (!isPortrait && !isLandscape) return { valid: false };

    // Convexity: cross products of adjacent edges must not change sign (all positive or all negative)
    const cross = (p1, p2, p3) => (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
    const c1 = cross(bl, tl, tr);
    const c2 = cross(tl, tr, br);
    const c3 = cross(tr, br, bl);
    const c4 = cross(br, bl, tl);
    const isConvex = (c1 >= 0 && c2 >= 0 && c3 >= 0 && c4 >= 0) || (c1 <= 0 && c2 <= 0 && c3 <= 0 && c4 <= 0);
    if (!isConvex) return { valid: false };

    // Confidence heuristic based on area coverage and rectangularity
    const coverageScore = Math.min(1.0, area / (imgArea * 0.9)); // up to 90%
    const rectangularityScore = 1.0 - Math.abs(1.0 - Math.min(dTop / dBot, dBot / dTop)) - Math.abs(1.0 - Math.min(dLeft / dRight, dRight / dLeft));
    const confidence = Math.max(0, Math.min(1, (coverageScore * 0.6) + (rectangularityScore * 0.4)));

    return { valid: true, area, confidence };
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
