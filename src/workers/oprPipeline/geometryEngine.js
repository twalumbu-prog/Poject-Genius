/**
 * Layer 2: Page Detection & Registration
 * Converts raw photo to perfectly flat canonical document.
 * Returns warped original image data.
 */
export function performPageRegistration(imageData) {
    const quadResult = detectRobustQuad(imageData);
    if (!quadResult.success) {
        return { success: false, reason: quadResult.reason || 'NO_PAGE_QUAD' };
    }

    const TARGET_H = 1800;
    const TARGET_W = 1272;
    const warpedImageData = warpPerspective(imageData, quadResult.quad, TARGET_W, TARGET_H);

    return {
        success: true,
        warpedImageData,
        quad: quadResult.quad,
        registration_confidence: quadResult.fallback ? 0.5 : 0.95
    };
}

/**
 * Layers 5 & 6: Layout Detection & Grid Modeling
 * Uses binarized image to detect rows and predict expected bubble centers.
 */
export function performGridModeling(binaryWarpedData, expectedOptions = 4) {
    const { gridModel, finalImageData: orientedBinaryData } = discoverGridRobust(binaryWarpedData, expectedOptions);

    if (gridModel.rows.length === 0 || gridModel.cols.length === 0) {
        return { success: false, reason: 'GRID_MODELING_FAILED' };
    }

    return {
        success: true,
        gridModel,
        orientedBinaryData,
        layoutResult: {
            blocks: gridModel.blocks || 1,
            expectedOptions,
            regions: gridModel.rows.map(row => ({
                question_number: row.question_number,
                y: row.y,
                h: row.h,
                columns: row.columns || gridModel.cols
            }))
        }
    };
}

// Deprecated: legacy entry point
export function extractGeometry(imageData) {
    const reg = performPageRegistration(imageData);
    if (!reg.success) return reg;
    const grid = performGridModeling(reg.warpedImageData);
    if (!grid.success) return grid;
    return { ...grid, warpedImageData: reg.warpedImageData };
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

    // -- FALLBACK: Use a 'safe zone' quad if contour detection fails --
    console.warn('[OPR Geometry] No page quad found. Falling back to safe-zone...');
    const fallbackQuad = [
        { x: width * 0.05, y: height * 0.05 },
        { x: width * 0.95, y: height * 0.05 },
        { x: width * 0.95, y: height * 0.95 },
        { x: width * 0.05, y: height * 0.95 }
    ];
    return { success: true, quad: fallbackQuad, fallback: true };
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

function detectGridOnImage(imageData, expectedOptions = 4) {
    const { width, height, data } = imageData;

    // -- STEP A: BRIGHTNESS STATS --
    let totalLuma = 0, count = 0;
    for (let i = 0; i < data.length; i += 16) {
        totalLuma += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        count++;
    }
    const meanLuma = totalLuma / count;
    const inkThreshold = Math.max(100, meanLuma - 35);

    // -- STEP B: HORIZONTAL PROJECTION (Global Rows) --
    const hProfile = new Float32Array(height);
    for (let y = 0; y < height; y++) {
        let inkCount = 0;
        for (let x = 50; x < width - 50; x += 4) {
            const i = (y * width + x) * 4;
            if (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < inkThreshold) inkCount++;
        }
        hProfile[y] = inkCount;
    }

    // Detect row peaks
    const sortedH = [...hProfile].sort((a, b) => a - b);
    const hThreshold = Math.max(4, sortedH[Math.floor(sortedH.length * 0.85)]);
    // DENSITY CAP: A row of bubbles shouldn't be a solid black line across the whole page.
    // If width is 1200, 3 columns of 5 bubbles (15 bubbles) * ~20px = 300px. 
    // Plus question numbers and noise, let's cap at 50% of width.
    const hDensityCap = width * 0.55;

    const candidateRows = [];
    let lastY = -100;
    // SKIP HEADER: Start row detection at 200px to avoid scanning "Name:", school name, etc.
    for (let y = 200; y < height - 100; y++) {
        if (hProfile[y] > hThreshold && hProfile[y] < hDensityCap && hProfile[y] >= hProfile[y - 1] && hProfile[y] >= hProfile[y + 1] && y - lastY > 20) {
            candidateRows.push({ y, strength: hProfile[y] });
            lastY = y;
        }
    }

    // Spacing validation
    const hSpacings = [];
    for (let i = 1; i < candidateRows.length; i++) hSpacings.push(candidateRows[i].y - candidateRows[i - 1].y);
    hSpacings.sort((a, b) => a - b);
    const medianSpacing = hSpacings[Math.floor(hSpacings.length / 2)] || 40;
    const validRows = candidateRows.filter((r, i) => {
        const prev = i > 0 ? r.y - candidateRows[i - 1].y : null;
        const next = i < candidateRows.length - 1 ? candidateRows[i + 1].y - candidateRows[i].y : null;
        // Stricter spacing validation (±30%)
        return (prev && Math.abs(prev - medianSpacing) < medianSpacing * 0.3) || (next && Math.abs(next - medianSpacing) < medianSpacing * 0.3);
    });

    // -- STEP C: ROW-AWARE VERTICAL PROJECTION --
    // Instead of projecting the whole page, project only pixels aligned with confirmed rows.
    // This is much more robust against vertical lines and text noise between rows.
    const vProfile = new Float32Array(width);
    validRows.forEach(row => {
        const y = row.y;
        for (let x = 40; x < width - 40; x++) {
            // Sample a 7px vertical strip around each row's center
            for (let dy = -3; dy <= 3; dy += 2) {
                const i = ((y + dy) * width + x) * 4;
                if (i < 0 || i >= data.length) continue;
                if (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < inkThreshold) {
                    vProfile[x]++;
                }
            }
        }
    });

    const sortedV = [...vProfile].sort((a, b) => a - b);
    // V-Threshold: at least 40% of rows must have ink at this X 
    const vThreshold = Math.max(validRows.length * 0.4, sortedV[Math.floor(sortedV.length * 0.75)]);
    // DENSITY CAP: Avoid picking up thick vertical lines (e.g. table borders)
    const vDensityCap = validRows.length * 4.5;

    const allCols = [];
    let lastX = -50;
    for (let x = 40; x < width - 40; x++) {
        if (vProfile[x] > vThreshold && vProfile[x] < vDensityCap && vProfile[x] >= vProfile[x - 1] && vProfile[x] >= vProfile[x + 1] && x - lastX > 25) {
            allCols.push({ x, strength: vProfile[x] });
            lastX = x;
        }
    }

    if (allCols.length < 4 || validRows.length < 5) {
        console.warn(`[OPR Grid] Insufficient results: cols=${allCols.length}, rows=${validRows.length}`);
        return { rows: [], cols: [], blocks: 0, score: 0 };
    }

    // Group columns into blocks based on large gaps
    const gaps = [];
    for (let i = 1; i < allCols.length; i++) gaps.push(allCols[i].x - allCols[i - 1].x);
    gaps.sort((a, b) => a - b);
    const medianGapVal = gaps[Math.floor(gaps.length / 2)] || 35;
    const blockBoundary = medianGapVal * 1.6;

    const columnsPerBlockThreshold = expectedOptions + 1; // e.g., 5 for A-D
    const blocks = [];
    let currentBlock = [allCols[0]];
    for (let i = 1; i < allCols.length; i++) {
        const gap = allCols[i].x - allCols[i - 1].x;
        // Split if gap is too large OR if block has reached its expected headcount
        // This is critical for ECZ sheets where gaps between blocks are uniform.
        const isHeadcountFull = currentBlock.length >= columnsPerBlockThreshold;

        if (gap > blockBoundary || (isHeadcountFull && gap > medianGapVal * 0.95)) {
            if (currentBlock.length >= 4) blocks.push(currentBlock);
            currentBlock = [allCols[i]];
        } else {
            currentBlock.push(allCols[i]);
        }
    }
    if (currentBlock.length >= 4) blocks.push(currentBlock);

    // Map rows with block metadata
    const expandedRows = [];
    validRows.forEach((row, rowIdx) => {
        blocks.forEach((block, bIdx) => {
            // Updated Heuristic: 
            // 1. If we have exactly options+1 cols, Col 0 is almost certainly the Number.
            // 2. If first gap is substantial, it's definitely a Number.
            const firstGap = block.length > 1 ? (block[1].x - block[0].x) : 0;
            const hasNum = (block.length === (expectedOptions + 1)) ||
                (block.length >= 4 && firstGap > medianGapVal * 1.25);

            const optionCols = block.filter((_, ci) => !(hasNum && ci === 0));
            const blockCols = optionCols.map((c, ci) => ({
                ...c,
                label: String.fromCharCode(64 + (ci + 1)) // 65 is 'A'
            }));

            expandedRows.push({
                ...row,
                pitch: medianSpacing,
                h: Math.round(medianSpacing * 0.75),
                // Assume standard row capacity (20) for sequential mapping
                question_number: bIdx * 20 + (rowIdx + 1),
                columns: blockCols,
                blockIdx: bIdx
            });
        });
    });

    return {
        rows: expandedRows,
        cols: allCols.map((c, i) => ({ ...c, label: String.fromCharCode(65 + i) })),
        blocks: blocks.length,
        score: expandedRows.length,
        expectedOptions
    };
}

function discoverGridRobust(imageData, expectedOptions = 4) {
    // Try current orientation
    const result0 = detectGridOnImage(imageData, expectedOptions);
    console.log(`[OPR Grid] Orientation 0°: ${result0.score} questions, ${result0.blocks} blocks`);

    // If we have a very high score (e.g., full sheet), accept it immediately
    if (result0.score >= 20) return { gridModel: result0, finalImageData: imageData };

    // Try rotating 90° CW
    console.warn(`[OPR Grid] 0° insufficient score. Trying 90°CW rotation...`);
    const rot90 = rotateImageData90CW(imageData);
    const result90 = detectGridOnImage(rot90, expectedOptions);
    console.log(`[OPR Grid] Orientation 90°CW: ${result90.score} questions, ${result90.blocks} blocks`);

    // If 90°CW is significantly better, use it
    if (result90.score > result0.score + 5) {
        console.log(`[OPR Grid] Using 90°CW orientation (better: ${result90.score} vs ${result0.score})`);
        return { gridModel: result90, finalImageData: rot90 };
    }

    // Best effort: use the one with the higher score
    return result0.score >= result90.score ?
        { gridModel: result0, finalImageData: imageData } :
        { gridModel: result90, finalImageData: rot90 };
}







