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
            regions: gridModel.rows.map(row => ({
                question_number: row.question_number,
                y: row.y,
                h: row.h,
                columns: gridModel.cols
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

function discoverGridRobust(imageData) {
    const { width, height, data } = imageData;

    // ══ 1. HORIZONTAL PROJECTION PROFILE ══
    const horizontalProfile = new Float32Array(height);
    for (let y = 0; y < height; y++) {
        let rowSum = 0;
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            rowSum += (255 - l);
        }
        horizontalProfile[y] = rowSum / width;
    }

    // ══ 2. DETECT CANDIDATE ROWS (Raw peaks in profile) ══
    const candidateRows = [];
    const hThreshold = 15; // Reduced threshold for sensitivity
    let lastY = -100;
    for (let y = 80; y < height - 80; y++) {
        if (horizontalProfile[y] > hThreshold &&
            horizontalProfile[y] > horizontalProfile[y - 1] &&
            horizontalProfile[y] > horizontalProfile[y + 1]) {
            if (y - lastY > 20) {
                candidateRows.push({ y, h: 40, strength: horizontalProfile[y] });
                lastY = y;
            }
        }
    }

    if (candidateRows.length < 3) return { rows: [], cols: [] };

    // ══ 3. VALIDATE ROWS — Keep only evenly-spaced rows (filter header artifacts) ══
    // Real bubble rows form a grid: they are evenly spaced.
    // Header artifacts are isolated or irregularly spaced.
    const spacings = [];
    for (let i = 1; i < candidateRows.length; i++) {
        spacings.push(candidateRows[i].y - candidateRows[i - 1].y);
    }

    // Find the dominant spacing (most common gap range, i.e., the mode within a 15px tolerance)
    spacings.sort((a, b) => a - b);
    const medianSpacing = spacings[Math.floor(spacings.length / 2)];

    // Keep only rows where the gap to the previous or next row is close to median
    const SPACING_TOLERANCE = Math.max(15, medianSpacing * 0.4);
    const rows = [];
    for (let i = 0; i < candidateRows.length; i++) {
        const prev = i > 0 ? candidateRows[i].y - candidateRows[i - 1].y : null;
        const next = i < candidateRows.length - 1 ? candidateRows[i + 1].y - candidateRows[i].y : null;

        const prevOk = prev === null || Math.abs(prev - medianSpacing) < SPACING_TOLERANCE;
        const nextOk = next === null || Math.abs(next - medianSpacing) < SPACING_TOLERANCE;

        // A row is valid if at least one of its neighbours has consistent spacing
        if (prevOk || nextOk) {
            rows.push(candidateRows[i]);
        }
    }

    // Must have at least 5 rows to be a real answer grid
    if (rows.length < 5) return { rows: [], cols: [] };

    console.log(`[OPR Grid] Row validation: ${candidateRows.length} candidates → ${rows.length} valid rows (medianSpacing=${Math.round(medianSpacing)}px)`);

    // ══ 4. VERTICAL PROFILE (sampled across VALID rows only) ══
    const verticalProfile = new Float32Array(width);
    const vWindow = 12; // Sample +/- 12px to handle tilt
    for (let x = 0; x < width; x++) {
        let colSum = 0;
        let samples = 0;
        for (const row of rows) {
            for (let dy = -vWindow; dy <= vWindow; dy++) {
                const targetY = row.y + dy;
                if (targetY < 0 || targetY >= height) continue;
                const i = (targetY * width + x) * 4;
                const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                colSum += (255 - l);
                samples++;
            }
        }
        verticalProfile[x] = colSum / (samples || 1);
    }

    // ══ 5. DETECT ALL COLUMN PEAKS ══
    const allCols = [];
    let lastX = -50;
    for (let x = 30; x < width - 30; x++) {
        if (verticalProfile[x] > 10 &&
            verticalProfile[x] > verticalProfile[x - 1] &&
            verticalProfile[x] > verticalProfile[x + 1]) {
            if (x - lastX > 30) { // minimum 30px between peaks
                allCols.push({ x, w: 40, strength: verticalProfile[x] });
                lastX = x;
            }
        }
    }

    if (allCols.length < 4) return { rows: [], cols: [] };

    // ══ 6. SMART COLUMN BLOCK GROUPING ══
    // Compute all inter-peak gaps
    const colGaps = [];
    for (let i = 1; i < allCols.length; i++) {
        colGaps.push({ gap: allCols[i].x - allCols[i - 1].x, afterIdx: i - 1 });
    }

    // Find the median and std of gaps
    const sortedGaps = [...colGaps].map(g => g.gap).sort((a, b) => a - b);
    const medianColGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const meanGap = sortedGaps.reduce((a, b) => a + b, 0) / sortedGaps.length;

    // Block boundary = gap that is > 1.8x the median column gap
    const BLOCK_GAP_RATIO = 1.8;
    const blockBoundaryThreshold = medianColGap * BLOCK_GAP_RATIO;

    console.log(`[OPR Grid] ${allCols.length} column peaks. medianGap=${Math.round(medianColGap)}, blockThreshold=${Math.round(blockBoundaryThreshold)}`);

    const blocks = [];
    let currentBlock = [allCols[0]];
    for (let i = 1; i < allCols.length; i++) {
        const gap = allCols[i].x - allCols[i - 1].x;
        if (gap > blockBoundaryThreshold) {
            // Only keep blocks with ≥ 4 columns (A, B, C, D minimum)
            if (currentBlock.length >= 4) blocks.push(currentBlock);
            currentBlock = [allCols[i]];
        } else {
            currentBlock.push(allCols[i]);
        }
    }
    if (currentBlock.length >= 4) blocks.push(currentBlock);

    console.log(`[OPR Grid] Detected ${blocks.length} column blocks.`);

    // If no valid multi-block was found, attempt single-block fallback
    if (blocks.length === 0) {
        console.warn(`[OPR Grid] No valid blocks found. Using all columns as single block.`);
        blocks.push(allCols);
    }

    // ══ 7. BUILD EXPANDED ROWS WITH CORRECT QUESTION NUMBERS ══
    const expandedRows = [];
    const questionsPerBlock = rows.length;

    blocks.forEach((block, blockIdx) => {
        // Label columns: if 5 peaks → [NUM, A, B, C, D]; if 4 peaks → [A, B, C, D]
        const hasNum = block.length === 5;
        const blockCols = block
            .filter((_, i) => !(hasNum && i === 0)) // remove NUM column
            .map((c, i) => ({ ...c, label: String.fromCharCode(65 + i) }));

        rows.forEach((row, rowIdx) => {
            expandedRows.push({
                ...row,
                question_number: blockIdx * questionsPerBlock + (rowIdx + 1),
                columns: blockCols
            });
        });
    });

    return {
        rows: expandedRows,
        cols: blocks[0]
            ?.filter((_, i) => !(blocks[0].length === 5 && i === 0))
            .map((c, i) => ({ ...c, label: String.fromCharCode(65 + i) })) || []
    };
}

