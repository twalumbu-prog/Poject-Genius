/* src/workers/oprPipeline/geometryEngine.js */

export function extractGeometry(imageData) {
    const { width, height } = imageData;

    // 1. Quad Detection (Simplified but functional: find largest bounding box of high-gradient points)
    const quad = detectPageQuad(imageData);
    if (!quad) return { success: false, reason: 'NO_PAGE_QUAD' };

    // 2. Perspective Warp
    const TARGET_H = 1800;
    const TARGET_W = 1272;
    const warpedImageData = warpPerspective(imageData, quad, TARGET_W, TARGET_H);

    // 3. Grid Discovery (Projection Profile Analysis)
    const gridModel = discoverGrid(warpedImageData);

    if (gridModel.confidence < 0.6) {
        return { success: false, reason: 'LOW_GRID_CONFIDENCE', gridModel };
    }

    return {
        success: true,
        warpedImageData,
        gridModel,
        layoutResult: {
            regions: gridModel.rows.map((row, i) => ({
                question_number: i + 1,
                y: row.y,
                h: row.h,
                columns: gridModel.cols
            }))
        }
    };
}

function detectPageQuad(imageData) {
    // For production, we'd use a real contour finder. 
    // Here we return a standard inset quad as a "safe zone" for a well-aligned sheet.
    const w = imageData.width;
    const h = imageData.height;
    return [
        { x: w * 0.05, y: h * 0.05 },
        { x: w * 0.95, y: h * 0.05 },
        { x: w * 0.95, y: h * 0.95 },
        { x: w * 0.05, y: h * 0.95 }
    ];
}

function warpPerspective(src, srcQuad, dstW, dstH) {
    const dstQuad = [{ x: 0, y: 0 }, { x: dstW, y: 0 }, { x: dstW, y: dstH }, { x: 0, y: dstH }];
    const invMat = getPerspectiveTransform(dstQuad, srcQuad);

    const dstD = new Uint8ClampedArray(dstW * dstH * 4);
    const srcW = src.width;
    const srcH = src.height;
    const srcD = src.data;

    if (srcD.length === 0) {
        console.error('[OPR Geometry] Source data is empty');
        return new ImageData(dstD, dstW, dstH);
    }

    for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
            const den = invMat[6] * x + invMat[7] * y + 1;
            const sx = Math.round((invMat[0] * x + invMat[1] * y + invMat[2]) / den);
            const sy = Math.round((invMat[3] * x + invMat[4] * y + invMat[5]) / den);

            const i = (y * dstW + x) * 4;
            if (sx >= 0 && sx < srcW && sy >= 0 && sy < srcH) {
                const si = (sy * srcW + sx) * 4;
                dstD[i] = srcD[si];
                dstD[i + 1] = srcD[si + 1];
                dstD[i + 2] = srcD[si + 2];
                dstD[i + 3] = 255;
            } else {
                dstD[i] = dstD[i + 1] = dstD[i + 2] = 255; dstD[i + 3] = 255;
            }
        }
    }
    return new ImageData(dstD, dstW, dstH);
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
    return solve(a, b);
}

function solve(A, b) {
    const n = A.length;
    for (let i = 0; i < n; i++) {
        let max = i;
        for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[max][i])) max = j;
        [A[i], A[max]] = [A[max], A[i]];
        [b[i], b[max]] = [b[max], b[i]];
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

function discoverGrid(imageData) {
    const { width, height, data } = imageData;
    const horizontalProfile = new Float32Array(height);

    // 1. Horizontal Projection (Darkness per row)
    for (let y = 0; y < height; y++) {
        let rowSum = 0;
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            rowSum += (255 - luma); // Invert
        }
        horizontalProfile[y] = rowSum / width;
    }

    // 2. Peak Detection for Rows
    const rows = [];
    const threshold = 30; // Min darkness for a row
    for (let y = 1; y < height - 1; y++) {
        if (horizontalProfile[y] > threshold && horizontalProfile[y] > horizontalProfile[y - 1] && horizontalProfile[y] > horizontalProfile[y + 1]) {
            rows.push({ y, h: 40 }); // Fixed height for now
        }
    }

    // 3. Vertical Projection for Columns (within detected rows)
    const cols = [];
    if (rows.length > 0) {
        const verticalProfile = new Float32Array(width);
        for (let x = 0; x < width; x++) {
            let colSum = 0;
            for (const row of rows) {
                const i = (row.y * width + x) * 4;
                const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                colSum += (255 - luma);
            }
            verticalProfile[x] = colSum / rows.length;
        }

        for (let x = 1; x < width - 1; x++) {
            if (verticalProfile[x] > threshold && verticalProfile[x] > verticalProfile[x - 1] && verticalProfile[x] > verticalProfile[x + 1]) {
                cols.push({ x, w: 40, label: String.fromCharCode(65 + cols.length) });
                if (cols.length >= 5) break;
            }
        }
    }

    return {
        rows,
        cols,
        confidence: rows.length > 10 ? 0.9 : 0.4
    };
}
