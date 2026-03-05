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

    // -- STEP A: BRIGHTNESS STATS --
    let totalLuma = 0, count = 0;
    for (let i = 0; i < data.length; i += 16) {
        totalLuma += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        count++;
    }
    const meanLuma = totalLuma / count;
    const inkThreshold = Math.max(100, meanLuma - 30);
    console.log(`[OPR Grid] meanLuma=${Math.round(meanLuma)}, inkThreshold=${Math.round(inkThreshold)}`);

    // -- STEP B: VERTICAL PROFILE (Find Column Blocks First) --
    // Sum ink vertically across the whole image
    const verticalProfile = new Float32Array(width);
    // TRUNCATION: Skip top 50 and bottom 250 (avoid QR codes/headers)
    for (let x = 0; x < width; x++) {
        let inkCount = 0;
        for (let y = 50; y < height - 250; y += 2) {
            const i = (y * width + x) * 4;
            if (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < inkThreshold) inkCount++;
        }
        verticalProfile[x] = inkCount;
    }

    // Detect raw column peaks
    const sortedV = [...verticalProfile].sort((a, b) => a - b);
    const vThreshold = Math.max(5, sortedV[Math.floor(sortedV.length * 0.70)]);
    const allCols = [];
    let lastX = -40;
    for (let x = 20; x < width - 20; x++) {
        if (verticalProfile[x] > vThreshold &&
            verticalProfile[x] >= verticalProfile[x - 1] &&
            verticalProfile[x] >= verticalProfile[x + 1] &&
            x - lastX > 20) {
            allCols.push({ x, strength: verticalProfile[x] });
            lastX = x;
        }
    }

    if (allCols.length < 4) return { rows: [], cols: [], blocks: 0, score: 0 };

    // -- DYNAMIC BLOCK BOUNDARY --
    const gaps = [];
    for (let i = 1; i < allCols.length; i++) {
        gaps.push(allCols[i].x - allCols[i - 1].x);
    }
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGapVal = sortedGaps[Math.floor(sortedGaps.length / 2)];
    // Block boundary: Large gap = new block. Median * 2.5 is usually safe.
    const blockBoundary = medianGapVal * 2.5;

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

    // -- CAP COLUMNS --
    // Prune noise: only keep the best 6 columns (Num + A-E) if extra peaks were found
    const clampedBlocks = blocks.map(block => {
        if (block.length <= 6) return block;
        return [...block].sort((a, b) => b.strength - a.strength).slice(0, 6).sort((a, b) => a.x - b.x);
    });

    console.log(`[OPR Grid] Found ${clampedBlocks.length} blocks with adaptive boundary ${Math.round(blockBoundary)}px`);

    // -- STEP C: PER-BLOCK ROW DETECTION --
    const expandedRows = [];
    let grandScore = 0;

    clampedBlocks.forEach((block, blockIdx) => {
        // Prepare columns for this block (remap to A, B, C, D)
        // Heuristic: If 5 or more columns, the first one is likely the question number label
        const hasNum = block.length >= 5;
        const optionCols = block.filter((_, i) => !(hasNum && i === 0));
        const colPitch = optionCols.length > 1 ? (optionCols[optionCols.length - 1].x - optionCols[0].x) / (optionCols.length - 1) : 30;
        const blockCols = optionCols.map((c, i) => ({
            ...c, label: String.fromCharCode(65 + i), colPitch
        }));

        // Define X-range for this block with some padding
        const minX = Math.max(0, block[0].x - 20);
        const maxX = Math.min(width - 1, block[block.length - 1].x + 20);

        // Compute local horizontal profile (only within this block's X-range)
        const localHProfile = new Float32Array(height);
        for (let y = 0; y < height; y++) {
            let inkCount = 0;
            for (let x = minX; x <= maxX; x++) {
                const i = (y * width + x) * 4;
                if (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < inkThreshold) inkCount++;
            }
            localHProfile[y] = inkCount;
        }

        // Find locally-significant rows for this block
        const sortedH = [...localHProfile].sort((a, b) => a - b);
        const hThresholdBlock = Math.max(3, sortedH[Math.floor(sortedH.length * 0.85)]);
        const localCandidateRows = [];
        let lastY = -100;
        for (let y = 50; y < height - 50; y++) {
            if (localHProfile[y] > hThresholdBlock &&
                localHProfile[y] >= localHProfile[y - 1] &&
                localHProfile[y] >= localHProfile[y + 1] &&
                y - lastY > 24) {
                localCandidateRows.push({ y, strength: localHProfile[y] });
                lastY = y;
            }
        }

        // Spacing validation for this block
        const spacings = [];
        for (let i = 1; i < localCandidateRows.length; i++) spacings.push(localCandidateRows[i].y - localCandidateRows[i - 1].y);
        spacings.sort((a, b) => a - b);
        let medianSpacing = spacings[Math.floor(spacings.length / 2)] || 40;

        const blockRows = [];
        const SPACING_TOL = medianSpacing * 0.4;
        for (let i = 0; i < localCandidateRows.length; i++) {
            const prev = i > 0 ? localCandidateRows[i].y - localCandidateRows[i - 1].y : null;
            const next = i < localCandidateRows.length - 1 ? localCandidateRows[i + 1].y - localCandidateRows[i].y : null;
            if ((prev && Math.abs(prev - medianSpacing) < SPACING_TOL) || (next && Math.abs(next - medianSpacing) < SPACING_TOL)) {
                blockRows.push(localCandidateRows[i]);
            }
        }

        console.log(`[OPR Grid] Block ${blockIdx}: ${blockRows.length} rows found at x=[${minX}-${maxX}]`);

        // Assemble rows for this block
        // IMPORTANT: We use a placeholder question_number, oprWorker.js re-numbers them properly
        blockRows.forEach((row, i) => {
            expandedRows.push({
                ...row,
                pitch: medianSpacing,
                h: Math.round(medianSpacing * 0.75),
                // Give a temporary number based on block order for remap logic
                question_number: blockIdx * 100 + (i + 1),
                columns: blockCols,
                blockIdx: blockIdx // metadata
            });
        });
        grandScore += blockRows.length;
    });

    const cols = clampedBlocks[0].map((c, i) => ({ ...c, label: String.fromCharCode(65 + i) }));

    return {
        rows: expandedRows,
        cols,
        blocks: clampedBlocks.length,
        score: grandScore
    };
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






