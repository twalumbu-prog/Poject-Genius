/* src/workers/oprPipeline/geometryEngine.js */

export function extractGeometry(imageData) {
    const { width, height } = imageData;

    // 1. Robust Quad Detection
    const quadResult = detectRobustQuad(imageData);
    if (!quadResult.success) {
        console.warn(`[OPR Geometry] Quad detection failed: ${quadResult.reason}`);
        // Fallback to safe zone for testing, but log it
        const fallbackQuad = [
            { x: width * 0.05, y: height * 0.05 },
            { x: width * 0.95, y: height * 0.05 },
            { x: width * 0.95, y: height * 0.95 },
            { x: width * 0.05, y: height * 0.95 }
        ];
        return { success: false, reason: quadResult.reason || 'NO_PAGE_QUAD' };
    }

    const quad = quadResult.quad;

    // 2. Perspective Warp
    const TARGET_H = 1800;
    const TARGET_W = 1272;
    const warpedImageData = warpPerspective(imageData, quad, TARGET_W, TARGET_H);

    // 3. Grid Discovery
    const gridModel = discoverGridRobust(warpedImageData);

    if (gridModel.rows.length === 0 || gridModel.cols.length === 0) {
        return { success: false, reason: 'GRID_DISCOVERY_FAILED', details: `Rows: ${gridModel.rows.length}, Cols: ${gridModel.cols.length}` };
    }

    return {
        success: true,
        warpedImageData,
        gridModel,
        layoutResult: {
            blocks: gridModel.blocks || 1,
            regions: gridModel.rows.map(row => ({
                question_number: row.question_number,
                y: row.y,
                h: row.h,
                columns: row.columns || gridModel.cols
            }))
        }
    };
}

function detectRobustQuad(imageData) {
    const { width, height, data } = imageData;
    const MAX_DIM = 600;
    const scale = Math.min(1.0, MAX_DIM / Math.max(width, height));
    const sw = Math.round(width * scale);
    const sh = Math.round(height * scale);

    const gray = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
            const si = (Math.round(y / scale) * width + Math.round(x / scale)) * 4;
            gray[y * sw + x] = data[si] * 0.299 + data[si + 1] * 0.587 + data[si + 2] * 0.114;
        }
    }

    const blurred = gaussianBlur(gray, sw, sh);
    const edges = computeSobel(blurred, sw, sh);
    const contours = findContours(edges, sw, sh);

    let bestQuad = null;
    let maxArea = 0;

    for (const contour of contours) {
        const quad = extractQuadCorners(contour);
        if (!quad) continue;
        const validation = validateQuad(quad, sw, sh, edges);
        if (validation.valid && validation.area > maxArea) {
            maxArea = validation.area;
            bestQuad = quad.map(p => ({ x: p.x / scale, y: p.y / scale }));
        }
    }

    if (bestQuad) return { success: true, quad: bestQuad };
    return { success: false, reason: 'NO_CONFIDENT_CONTOUR' };
}

function gaussianBlur(gray, width, height) {
    const out = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            const sum = gray[i] * 4 + gray[i - 1] * 2 + gray[i + 1] * 2 + gray[i - width] * 2 + gray[i + width] * 2 + gray[i - width - 1] + gray[i - width + 1] + gray[i + width - 1] + gray[i + width + 1];
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
            const gx = -1 * gray[i - width - 1] + 1 * gray[i - width + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - 1 * gray[i + width - 1] + 1 * gray[i + width + 1];
            const gy = -1 * gray[i - width - 1] - 2 * gray[i - width] - 1 * gray[i - width + 1] + 1 * gray[i + width - 1] + 2 * gray[i + width] + 1 * gray[i + width + 1];
            edge[i] = (Math.abs(gx) + Math.abs(gy)) > 120 ? 255 : 0;
        }
    }
    return edge;
}

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
                let currX = x, currY = y, dir = 7;
                let startX = currX, startY = currY;
                let limit = 5000;
                while (limit-- > 0) {
                    contour.push({ x: currX, y: currY });
                    visited[currY * width + currX] = 1;
                    let nextDir = -1;
                    for (let i = 0; i < 8; i++) {
                        const testDir = (dir + 5 + i) % 8;
                        const nx = currX + dx[testDir], ny = currY + dy[testDir];
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height && edgeMap[ny * width + nx] === 255) {
                            nextDir = testDir; break;
                        }
                    }
                    if (nextDir === -1) break;
                    currX += dx[nextDir]; currY += dy[nextDir]; dir = nextDir;
                    if (currX === startX && currY === startY) break;
                }
                if (contour.length > 100) contours.push(contour);
            }
        }
    }
    return contours;
}

function extractQuadCorners(contour) {
    let tl = contour[0], tr = contour[0], bl = contour[0], br = contour[0];
    let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
    for (const p of contour) {
        const sum = p.x + p.y, diff = p.x - p.y;
        if (sum < minSum) { minSum = sum; tl = p; }
        if (sum > maxSum) { maxSum = sum; br = p; }
        if (diff < minDiff) { minDiff = diff; bl = p; }
        if (diff > maxDiff) { maxDiff = diff; tr = p; }
    }
    return [tl, tr, br, bl];
}

function validateQuad(quad, width, height) {
    const [tl, tr, br, bl] = quad;
    const area = 0.5 * Math.abs((tl.x * tr.y - tr.x * tl.y) + (tr.x * br.y - br.x * tr.y) + (br.x * bl.y - bl.x * br.y) + (bl.x * tl.y - tl.x * bl.y));
    const imgArea = width * height;
    if (area < imgArea * 0.25) return { valid: false };
    return { valid: true, area };
}

function warpPerspective(src, srcQuad, dstW, dstH) {
    const dstQuad = [{ x: 0, y: 0 }, { x: dstW, y: 0 }, { x: dstW, y: dstH }, { x: 0, y: dstH }];
    const invMat = getPerspectiveTransform(dstQuad, srcQuad);
    const dstD = new Uint8ClampedArray(dstW * dstH * 4);
    const srcW = src.width, srcH = src.height, srcD = src.data;
    for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
            const den = invMat[6] * x + invMat[7] * y + 1;
            const sx = Math.round((invMat[0] * x + invMat[1] * y + invMat[2]) / den);
            const sy = Math.round((invMat[3] * x + invMat[4] * y + invMat[5]) / den);
            const i = (y * dstW + x) * 4;
            if (sx >= 0 && sx < srcW && sy >= 0 && sy < srcH) {
                const si = (sy * srcW + sx) * 4;
                dstD[i] = srcD[si]; dstD[i + 1] = srcD[si + 1]; dstD[i + 2] = srcD[si + 2]; dstD[i + 3] = 255;
            } else {
                dstD[i] = dstD[i + 1] = dstD[i + 2] = 255; dstD[i + 3] = 255;
            }
        }
    }
    return new ImageData(dstD, dstW, dstH);
}

function getPerspectiveTransform(src, dst) {
    const a = [], b = [];
    for (let i = 0; i < 4; i++) {
        a.push([src[i].x, src[i].y, 1, 0, 0, 0, -src[i].x * dst[i].x, -src[i].y * dst[i].x]); b.push(dst[i].x);
        a.push([0, 0, 0, src[i].x, src[i].y, 1, -src[i].x * dst[i].y, -src[i].y * dst[i].y]); b.push(dst[i].y);
    }
    return solve(a, b);
}

function solve(A, b) {
    const n = A.length;
    for (let i = 0; i < n; i++) {
        let max = i;
        for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[max][i])) max = j;
        [A[i], A[max]] = [A[max], A[i]];[b[i], b[max]] = [b[max], b[i]];
        for (let j = i + 1; j < n; j++) {
            const c = A[j][i] / A[i][i];
            for (let k = i; k < n; k++) A[j][k] -= c * A[i][k];
            b[j] -= c * b[i];
        }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) sum += A[i][j] * x[j];
        x[i] = (b[i] - sum) / A[i][i];
    }
    return x;
}

/**
 * Rotate raw ImageData 90° clockwise and return new ImageData.
 */
function rotateImageData90CW(imageData) {
    const { width, height, data } = imageData;
    const newData = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const si = (y * width + x) * 4;
            const nx = height - 1 - y;
            const ny = x;
            const di = (ny * height + nx) * 4;
            newData[di] = data[si];
            newData[di + 1] = data[si + 1];
            newData[di + 2] = data[si + 2];
            newData[di + 3] = data[si + 3];
        }
    }
    return new ImageData(newData, height, width);
}

/**
 * Core grid detection: horizontal + vertical projection on a given ImageData.
 * Returns { rows, cols, blocks, score } — score = rows.length (0 = failure).
 */
function detectGridOnImage(imageData) {
    const { width, height, data } = imageData;

    // ── STEP A: COMPUTE IMAGE BRIGHTNESS STATS FOR ADAPTIVE THRESHOLDING ──
    let totalLuma = 0;
    const STEP = 4; // Sample every 4th pixel for speed
    let count = 0;
    for (let y = 0; y < height; y += STEP) {
        for (let x = 0; x < width; x += STEP) {
            const i = (y * width + x) * 4;
            totalLuma += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            count++;
        }
    }
    const meanLuma = totalLuma / count;
    // Adaptive: treat pixels darker than (meanLuma - margin) as "ink"
    const inkThreshold = Math.max(100, meanLuma - 30);

    console.log(`[OPR Grid] Image ${width}x${height}, meanLuma=${Math.round(meanLuma)}, inkThreshold=${Math.round(inkThreshold)}`);

    // ── STEP B: HORIZONTAL PROJECTION (full width) ──
    const horizontalProfile = new Float32Array(height);
    for (let y = 0; y < height; y++) {
        let inkCount = 0;
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            if (l < inkThreshold) inkCount++;
        }
        horizontalProfile[y] = inkCount;
    }

    // ── STEP C: FIND CANDIDATE ROWS (local peaks in ink density) ──
    // Dynamic threshold: top 30% of profile values
    const sortedH = [...horizontalProfile].sort((a, b) => a - b);
    const hThreshold = Math.max(2, sortedH[Math.floor(sortedH.length * 0.70)]);

    const candidateRows = [];
    let lastY = -100;
    for (let y = 50; y < height - 50; y++) {
        if (horizontalProfile[y] > hThreshold &&
            horizontalProfile[y] >= horizontalProfile[y - 1] &&
            horizontalProfile[y] >= horizontalProfile[y + 1] &&
            y - lastY > 15) {
            candidateRows.push({ y, h: 40, strength: horizontalProfile[y] });
            lastY = y;
        }
    }

    console.log(`[OPR Grid] hThreshold=${Math.round(hThreshold)}, candidateRows=${candidateRows.length}`);
    if (candidateRows.length < 3) return { rows: [], cols: [], blocks: 0, score: 0 };

    // ── STEP D: SPACING VALIDATION — filter to evenly-spaced rows ──
    const spacings = [];
    for (let i = 1; i < candidateRows.length; i++) {
        spacings.push(candidateRows[i].y - candidateRows[i - 1].y);
    }
    spacings.sort((a, b) => a - b);
    const medianSpacing = spacings[Math.floor(spacings.length / 2)];
    const SPACING_TOLERANCE = Math.max(12, medianSpacing * 0.45);

    const rows = [];
    for (let i = 0; i < candidateRows.length; i++) {
        const prev = i > 0 ? candidateRows[i].y - candidateRows[i - 1].y : null;
        const next = i < candidateRows.length - 1 ? candidateRows[i + 1].y - candidateRows[i].y : null;
        const prevOk = prev === null || Math.abs(prev - medianSpacing) < SPACING_TOLERANCE;
        const nextOk = next === null || Math.abs(next - medianSpacing) < SPACING_TOLERANCE;
        if (prevOk || nextOk) rows.push(candidateRows[i]);
    }

    console.log(`[OPR Grid] spacing validation: ${candidateRows.length} → ${rows.length} valid rows (medianSpacing=${Math.round(medianSpacing)}px)`);

    if (rows.length < 5) return { rows: [], cols: [], blocks: 0, score: 0 };

    // ── STEP E: VERTICAL PROFILE (sampled at valid row y-positions only) ──
    const verticalProfile = new Float32Array(width);
    const vWindow = 15;
    for (let x = 0; x < width; x++) {
        let inkCount = 0;
        let samples = 0;
        for (const row of rows) {
            for (let dy = -vWindow; dy <= vWindow; dy++) {
                const targetY = row.y + dy;
                if (targetY < 0 || targetY >= height) continue;
                const i = (targetY * width + x) * 4;
                const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                if (l < inkThreshold) inkCount++;
                samples++;
            }
        }
        verticalProfile[x] = samples > 0 ? inkCount / samples * 100 : 0;
    }

    // ── STEP F: DETECT COLUMN PEAKS ──
    // Adaptive: use 70th percentile of vertical profile as threshold
    const sortedV = [...verticalProfile].sort((a, b) => a - b);
    const vThreshold = Math.max(1, sortedV[Math.floor(sortedV.length * 0.60)]);

    const allCols = [];
    let lastX = -40;
    for (let x = 20; x < width - 20; x++) {
        if (verticalProfile[x] > vThreshold &&
            verticalProfile[x] >= verticalProfile[x - 1] &&
            verticalProfile[x] >= verticalProfile[x + 1] &&
            x - lastX > 20) {
            allCols.push({ x, w: 35, strength: verticalProfile[x] });
            lastX = x;
        }
    }

    console.log(`[OPR Grid] vThreshold=${vThreshold.toFixed(1)}, allCols=${allCols.length}`);

    if (allCols.length < 4) return { rows: [], cols: [], blocks: 0, score: 0 };

    // ── STEP G: GROUP COLUMN PEAKS INTO BLOCKS ──
    // Use 85th-percentile gap as the block separator threshold
    const gaps = [];
    for (let i = 1; i < allCols.length; i++) {
        gaps.push(allCols[i].x - allCols[i - 1].x);
    }
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const p85Gap = sortedGaps[Math.floor(sortedGaps.length * 0.85)] || medianGap;
    // Block boundary = gap larger than median + 50% of the p85-median range
    const blockBoundary = medianGap + (p85Gap - medianGap) * 0.5 + 5;

    console.log(`[OPR Grid] medianGap=${Math.round(medianGap)}, p85Gap=${Math.round(p85Gap)}, blockBoundary=${Math.round(blockBoundary)}`);

    const blocks = [];
    let currentBlock = [allCols[0]];
    for (let i = 1; i < allCols.length; i++) {
        const gap = allCols[i].x - allCols[i - 1].x;
        if (gap > blockBoundary) {
            if (currentBlock.length >= 4) blocks.push(currentBlock);
            currentBlock = [allCols[i]];
        } else {
            currentBlock.push(allCols[i]);
        }
    }
    if (currentBlock.length >= 4) blocks.push(currentBlock);

    // Fallback: if no multi-block found, use single block
    if (blocks.length === 0) {
        console.warn(`[OPR Grid] Block grouping found no 4+ column blocks. Fallback to single block.`);
        blocks.push(allCols);
    }

    console.log(`[OPR Grid] Detected ${blocks.length} column blocks from ${allCols.length} peaks.`);

    // ── STEP H: CAP COLUMNS AND LABEL ──
    const MAX_COLS_PER_BLOCK = 5;
    const clampedBlocks = blocks.map(block => {
        if (block.length <= MAX_COLS_PER_BLOCK) return block;
        return [...block].sort((a, b) => b.strength - a.strength).slice(0, MAX_COLS_PER_BLOCK).sort((a, b) => a.x - b.x);
    });

    // ── STEP I: BUILD EXPANDED ROW LIST ──
    const expandedRows = [];
    const questionsPerBlock = rows.length;

    clampedBlocks.forEach((block, blockIdx) => {
        const hasNum = block.length === 5;
        const blockCols = block
            .filter((_, i) => !(hasNum && i === 0))
            .map((c, i) => ({ ...c, label: String.fromCharCode(65 + i) }));

        rows.forEach((row, rowIdx) => {
            expandedRows.push({
                ...row,
                question_number: blockIdx * questionsPerBlock + (rowIdx + 1),
                columns: blockCols
            });
        });
    });

    const cols = clampedBlocks[0]
        ?.filter((_, i) => !(clampedBlocks[0].length === 5 && i === 0))
        .map((c, i) => ({ ...c, label: String.fromCharCode(65 + i) })) || [];

    return { rows: expandedRows, cols, blocks: blocks.length, score: expandedRows.length };
}

function discoverGridRobust(imageData) {
    // Try current orientation
    const result0 = detectGridOnImage(imageData);
    console.log(`[OPR Grid] Orientation 0°: ${result0.score} questions, ${result0.blocks} blocks`);

    if (result0.score >= 5) return result0;

    // If that failed, try rotating 90° CW
    console.warn(`[OPR Grid] 0° orientation insufficient (${result0.score} questions). Trying 90°CW...`);
    const rotated = rotateImageData90CW(imageData);
    const result90 = detectGridOnImage(rotated);
    console.log(`[OPR Grid] Orientation 90°CW: ${result90.score} questions, ${result90.blocks} blocks`);

    if (result90.score > result0.score) {
        console.log(`[OPR Grid] Using 90°CW orientation (better: ${result90.score} vs ${result0.score})`);
        return result90;
    }

    // Return best effort even if score < 5
    return result0.score >= result90.score ? result0 : result90;
}






