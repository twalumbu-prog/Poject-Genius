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
    const horizontalProfile = new Float32Array(height);
    for (let y = 0; y < height; y++) {
        let rowSum = 0;
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            // Use luminosity
            const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            rowSum += (255 - l);
        }
        horizontalProfile[y] = rowSum / width;
    }

    // 1. Detect Rows
    const rows = [];
    const hThreshold = 25;
    let lastY = -100;
    for (let y = 100; y < height - 100; y++) {
        if (horizontalProfile[y] > hThreshold && horizontalProfile[y] > horizontalProfile[y - 1] && horizontalProfile[y] > horizontalProfile[y + 1]) {
            if (y - lastY > 30) {
                rows.push({ y, h: 40 });
                lastY = y;
            }
        }
    }

    if (rows.length === 0) return { rows: [], cols: [] };

    // 2. Vertical Profile across the image
    const verticalProfile = new Float32Array(width);
    for (let x = 0; x < width; x++) {
        let colSum = 0;
        for (const row of rows) {
            const i = (row.y * width + x) * 4;
            const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            colSum += (255 - l);
        }
        verticalProfile[x] = colSum / rows.length;
    }

    // 3. Detect ALL Column Peaks
    const allCols = [];
    let lastX = -100;
    for (let x = 50; x < width - 50; x++) {
        if (verticalProfile[x] > 15 && verticalProfile[x] > verticalProfile[x - 1] && verticalProfile[x] > verticalProfile[x + 1]) {
            if (x - lastX > 50) {
                allCols.push({ x, w: 40 });
                lastX = x;
            }
        }
    }

    // 4. Group Columns into Blocks (usually 5 columns per block: Num + A,B,C,D)
    // We look for larger gaps between blocks
    const blocks = [];
    let currentBlock = [];
    for (let i = 0; i < allCols.length; i++) {
        const col = allCols[i];
        if (currentBlock.length === 0) {
            currentBlock.push(col);
        } else {
            const prevCol = currentBlock[currentBlock.length - 1];
            if (col.x - prevCol.x < 150) { // Same block
                currentBlock.push(col);
            } else { // New block
                if (currentBlock.length >= 4) blocks.push(currentBlock);
                currentBlock = [col];
            }
        }
    }
    if (currentBlock.length >= 4) blocks.push(currentBlock);

    console.log(`[OPR Grid] Detected ${blocks.length} column blocks.`);

    // 5. Expand rows to map to blocks
    // In multi-column, questions 1-20 are block 0, 21-40 are block 1, etc.
    const expandedRows = [];
    const questionsPerBlock = rows.length;

    blocks.forEach((block, blockIdx) => {
        // Label columns in block (A, B, C, D)
        // Usually the first peak is the number, followed by A,B,C,D
        // If 5 peaks: [Num, A, B, C, D]. If 4 peaks: [A, B, C, D]
        const blockCols = block.map((c, i) => ({
            ...c,
            label: block.length === 5 ? (i === 0 ? 'NUM' : String.fromCharCode(64 + i)) : String.fromCharCode(65 + i)
        }));

        rows.forEach((row, rowIdx) => {
            expandedRows.push({
                ...row,
                question_number: blockIdx * questionsPerBlock + (rowIdx + 1),
                columns: blockCols.filter(c => c.label !== 'NUM')
            });
        });
    });

    return {
        rows: expandedRows,
        cols: blocks[0]?.map((c, i) => ({ ...c, label: String.fromCharCode(65 + i) })) || []
    };
}
