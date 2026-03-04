/**
 * Stage A Layout Analyzer & Question Classifier
 * Implements a pure-JS deterministic computer vision pipeline to slice
 * an image into horizontal question ROIs and classify them as 'omr', 'ocr', or 'unknown'.
 */

// 1. Lightweight Deskew & Pre-processing

export function findSkewAngle(gray, width, height) {
    // We find the skew angle by maximizing the variance of the horizontal projection profile.
    // Text lines aligned perfectly horizontally will have the highest peaks and deepest valleys.
    let bestAngle = 0;
    let maxVariance = 0;

    // Test angles from -3.0 to +3.0 degrees in 0.5 degree steps
    for (let angle = -3.0; angle <= 3.0; angle += 0.5) {
        if (angle === 0) continue; // We'll compute 0 as baseline later if needed, but doing all is fine
        const rad = (angle * Math.PI) / 180;
        const sinA = Math.sin(rad);
        const cosA = Math.cos(rad);

        const profile = new Float64Array(height);
        let sumX = 0;

        // Subsample for speed: check every 4th pixel
        for (let y = 0; y < height; y += 4) {
            for (let x = 0; x < width; x += 4) {
                // Find where this pixel comes from in the rotated space
                // Origin at center
                const cx = x - width / 2;
                const cy = y - height / 2;

                const srcY = Math.round(cx * sinA + cy * cosA + height / 2);

                if (srcY >= 0 && srcY < height) {
                    profile[srcY] += (255 - gray[y * width + x]); // Inverse so dark text = high value
                }
            }
        }

        // Compute variance of the profile
        let mean = 0;
        for (let i = 0; i < height; i++) mean += profile[i];
        mean /= height;

        let variance = 0;
        for (let i = 0; i < height; i++) {
            const diff = profile[i] - mean;
            variance += diff * diff;
        }

        if (variance > maxVariance) {
            maxVariance = variance;
            bestAngle = angle;
        }
    }

    // Check 0 degrees baseline
    let baselineVar = 0;
    const profile = new Float64Array(height);
    for (let y = 0; y < height; y += 4) {
        for (let x = 0; x < width; x += 4) {
            profile[y] += (255 - gray[y * width + x]);
        }
    }
    let mean = 0;
    for (let i = 0; i < height; i++) mean += profile[i];
    mean /= height;
    for (let i = 0; i < height; i++) {
        const diff = profile[i] - mean;
        baselineVar += diff * diff;
    }

    if (baselineVar >= maxVariance) return 0; // 0 degrees is best
    return bestAngle;
}

export function computeGrayscale(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const gray = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        // Human luminance weights
        gray[j] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
    return gray;
}

// 1A. Smart Binarization using Integral Image (Bradley Adaptive)
// 1A. Smart Binarization using Integral Image (Bradley Adaptive)
export function binarizeAdaptive(grayArray, width, height) {
    // Stage A.0: Illumination Surface Normalization
    // Estimate background with a very large kernel box blur (approx 1/10th image width)
    const normalizedGray = normalizeIllumination(grayArray, width, height);

    const integral = new Uint32Array(width * height);
    for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let x = 0; x < width; x++) {
            sum += normalizedGray[y * width + x];
            integral[y * width + x] = sum + (y > 0 ? integral[(y - 1) * width + x] : 0);
        }
    }

    const binary = new Uint8Array(width * height);
    // window size clamp based on dimensions
    const s = Math.max(12, Math.min(40, Math.floor(Math.min(width, height) / 40)));
    const s2 = Math.floor(s / 2);
    const t = 12; // Adjusted sensitivity after normalization

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const x1 = Math.max(x - s2, 0);
            const y1 = Math.max(y - s2, 0);
            const x2 = Math.min(x + s2, width - 1);
            const y2 = Math.min(y + s2, height - 1);
            const count = (x2 - x1) * (y2 - y1);

            const sum = integral[y2 * width + x2]
                - (y1 > 0 ? integral[(y1 - 1) * width + x2] : 0)
                - (x1 > 0 ? integral[y2 * width + (x1 - 1)] : 0)
                + (y1 > 0 && x1 > 0 ? integral[(y1 - 1) * width + (x1 - 1)] : 0);

            const mean = sum / count;

            if (normalizedGray[y * width + x] < mean * ((100 - t) / 100)) {
                binary[y * width + x] = 1; // ink
            } else {
                binary[y * width + x] = 0; // paper
            }
        }
    }
    return binary;
}

function normalizeIllumination(gray, w, h) {
    const kernelSize = Math.floor(w / 10);
    // 3-pass box blur approximates Gaussian O(N)
    const background = boxBlur(gray, w, h, kernelSize);
    const background2 = boxBlur(background, w, h, kernelSize);

    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const pixel = gray[i];
        const bg = background2[i];
        // Normalize: pixel / bg * 255 (using 128 as neutral offset for stability)
        // new = original - blurred + 192 (high offset to keep it bright)
        const val = pixel - bg + 192;
        out[i] = Math.max(0, Math.min(255, val));
    }
    return out;
}

function boxBlur(src, w, h, r) {
    const dst = new Uint8Array(w * h);
    const val = 1 / (r + r + 1);

    // Horizontal pass
    for (let y = 0; y < h; y++) {
        let ix = y * w;
        let ly = y * w;
        let fv = src[ix];
        let lv = src[ix + w - 1];
        let li = fv * (r + 1);
        for (let j = 0; j < r; j++) li += src[ix + j];
        for (let j = 0; j <= r; j++) {
            li += src[ix + j + r] - fv;
            dst[ly++] = li * val;
        }
        for (let j = r + 1; j < w - r; j++) {
            li += src[ix + j + r] - src[ix + j - r - 1];
            dst[ly++] = li * val;
        }
        for (let j = w - r; j < w; j++) {
            li += lv - src[ix + j - r - 1];
            dst[ly++] = li * val;
        }
    }

    // Vertical pass
    const final = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
        let fv = dst[x];
        let lv = dst[x + (h - 1) * w];
        let li = fv * (r + 1);
        for (let j = 0; j < r; j++) li += dst[x + j * w];
        for (let j = 0; j <= r; j++) {
            li += dst[x + (j + r) * w] - fv;
            final[x + j * w] = li * val;
        }
        for (let j = r + 1; j < h - r; j++) {
            li += dst[x + (j + r) * w] - dst[x + (j - r - 1) * w];
            final[x + j * w] = li * val;
        }
        for (let j = h - r; j < h; j++) {
            li += lv - dst[x + (j - r - 1) * w];
            final[x + j * w] = li * val;
        }
    }
    return final;
}

// 2. Vertical Projection for Multi-column detection (Guardrail)
export function computeVerticalProjection(binary, width, height) {
    const profile = new Int32Array(width);
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let y = 0; y < height; y++) {
            sum += binary[y * width + x];
        }
        profile[x] = sum;
    }
    return profile;
}

export function detectMultiColumn(verticalProfile, totalHeight) {
    // If we find exactly two massive spikes of text separated by a deep valley,
    // we are likely looking at a multi-column layout.
    // However, since many tests are single column, right now we just warn if we see a massive split.
    const width = verticalProfile.length;
    let peaks = 0;
    let inPeak = false;
    const threshold = totalHeight * 0.05; // at least 5% ink density in column

    for (let i = 0; i < width; i++) {
        if (verticalProfile[i] > threshold && !inPeak) {
            inPeak = true;
            peaks++;
        } else if (verticalProfile[i] < threshold / 2 && inPeak) {
            inPeak = false;
        }
    }
    return peaks > 1; // Basic heuristic: more than 1 distinct text block horizontally
}

// 3. Horizontal Projection Profile (HPP) for Row Slicing
export function computeHorizontalProjection(binary, width, height) {
    const profile = new Int32Array(height);
    for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let x = 0; x < width; x++) {
            sum += binary[y * width + x];
        }
        profile[y] = sum;
    }
    return profile;
}

export function sliceROIsViaHPP(horizontalProfile, height) {
    const rois = [];
    let startY = -1;
    // We expect some noise, so a valley isn't strictly 0 pixels.
    // If a horizontal line has less than 3 pixels of ink, consider it white space.
    const noiseThreshold = 3;
    const minHeight = 20; // Question row must be at least 20px tall

    for (let y = 0; y < height; y++) {
        const lineInk = horizontalProfile[y];

        if (lineInk > noiseThreshold) {
            if (startY === -1) {
                startY = y; // start of a row
            }
        } else {
            if (startY !== -1) {
                const h = y - startY;
                if (h >= minHeight) {
                    rois.push({ y: startY, height: h });
                }
                startY = -1; // end of a row
            }
        }
    }
    // catch last row if it reaches bottom
    if (startY !== -1 && (height - startY) >= minHeight) {
        rois.push({ y: startY, height: height - startY });
    }
    return rois;
}

// 4. Connected Component Labeling (CCL) using 4-way BFS
export function findBlobs(binary, width, height, roiStartY, roiHeight) {
    const labels = new Int32Array(width * roiHeight);
    let nextLabel = 1;
    const blobs = []; // array of { id, minX, minY, maxX, maxY, area, perimeter }

    const queueX = new Int32Array(width * roiHeight);
    const queueY = new Int32Array(width * roiHeight);

    for (let y = 0; y < roiHeight; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;
            const globalY = roiStartY + y;
            const globalIndex = globalY * width + x;

            if (binary[globalIndex] === 1 && labels[index] === 0) {
                // Found a new unvisited dark pixel
                const label = nextLabel++;
                let minX = x, maxX = x, minY = y, maxY = y;
                let area = 0;
                let perimeter = 0;

                let qHead = 0, qTail = 0;
                queueX[qTail] = x;
                queueY[qTail] = y;
                qTail++;
                labels[index] = label;

                while (qHead < qTail) {
                    const cx = queueX[qHead];
                    const cy = queueY[qHead];
                    qHead++;

                    area++;
                    if (cx < minX) minX = cx;
                    if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy;
                    if (cy > maxY) maxY = cy;

                    let isEdge = false;

                    // Check 4 neighbors
                    const neighbors = [
                        { nx: cx, ny: cy - 1 }, // up
                        { nx: cx, ny: cy + 1 }, // down
                        { nx: cx - 1, ny: cy }, // left
                        { nx: cx + 1, ny: cy }  // right
                    ];

                    for (const { nx, ny } of neighbors) {
                        if (nx >= 0 && nx < width && ny >= 0 && ny < roiHeight) {
                            const nIndex = ny * width + nx;
                            const nGlobalIndex = (roiStartY + ny) * width + nx;

                            if (binary[nGlobalIndex] === 0) {
                                isEdge = true; // touches white space
                            } else if (labels[nIndex] === 0) {
                                labels[nIndex] = label;
                                queueX[qTail] = nx;
                                queueY[qTail] = ny;
                                qTail++;
                            }
                        } else {
                            isEdge = true; // touches image boundary
                        }
                    }
                    if (isEdge) perimeter++;
                }

                blobs.push({ id: label, minX, minY, maxX, maxY, area, perimeter });
            }
        }
    }
    return blobs;
}

// 5. Hardened Shape Heuristics & Classification
export function classifyROI(blobs, expectedBubbles = 4) {
    let circleCount = 0;
    let textBlobs = 0;

    // Track stats for ROI Confidence telemetry
    const validCircles = [];
    let avgW = 0, avgH = 0;

    for (const blob of blobs) {
        const w = blob.maxX - blob.minX + 1;
        const h = blob.maxY - blob.minY + 1;

        // Exclude tiny noise and massive lines
        if (blob.area < 15 || blob.area > 5000) continue;

        const aspectRatio = Math.max(w, h) / Math.min(w, h);
        if (aspectRatio > 1.4) {
            if (w > 12) textBlobs++;
            continue;
        }

        // Hardened Bubble Checks: Solid OR Hollow Ring
        // Bounding box area
        const bbArea = w * h;
        const fillRatio = blob.area / bbArea; // Perfect solid circle is 0.78. Hollow ring is lower (e.g. 0.15 - 0.45)

        let isBubble = false;

        if (blob.perimeter > 0) {
            const circularity = (4 * Math.PI * blob.area) / (blob.perimeter * blob.perimeter);

            // Branch A: Solid shaded circle
            if (fillRatio > 0.6) {
                if (circularity > 0.6 && circularity <= 1.25) {
                    isBubble = true;
                }
            }
            // Branch B: Unshaded hollow bubble (ring)
            else if (fillRatio > 0.08 && fillRatio < 0.6) {
                // For a ring, circularity is very low. But it is perfectly symmetric
                // We use bounding box symmetry instead
                if (aspectRatio <= 1.25) {
                    isBubble = true; // Symmetric hollow square/circle
                }
            }
        }

        if (isBubble) {
            validCircles.push(blob);
            avgW += w;
            avgH += h;
        } else {
            textBlobs++;
        }
    }

    circleCount = validCircles.length;
    avgW = circleCount > 0 ? avgW / circleCount : 0;
    avgH = circleCount > 0 ? avgH / circleCount : 0;

    // Variance check
    let sizeVariance = 0;
    if (circleCount > 0) {
        for (const c of validCircles) {
            const cw = c.maxX - c.minX + 1;
            sizeVariance += Math.pow(cw - avgW, 2);
        }
        sizeVariance /= circleCount;
    }

    let type = "unknown";
    let confidence = 0.0;

    // Hardened Routing logic
    if (circleCount >= 3) {
        type = "omr";
        confidence = Math.min(1.0, circleCount / expectedBubbles);

        // Penalize variance (OMR bubbles should be identical size)
        if (sizeVariance > Math.pow(avgW * 0.3, 2)) {
            confidence -= 0.4;
        }
        if (textBlobs > 20) {
            confidence -= 0.3;
        }
    } else if (textBlobs > 5) {
        type = "ocr";
        confidence = 0.8;
    }

    if (confidence < 0) confidence = 0;

    // Sort valid circles left-to-right
    validCircles.sort((a, b) => a.minX - b.minX);

    return { type, confidence, circleBlobs: validCircles, bubble_count: circleCount, size_variance: sizeVariance };
}

/**
 * Main public entrypoint from Web Worker
 */
export async function classifyQuestionRegions(imageBitmap, markingSchemeCount) {
    console.log("[Stage A] Starting hybrid architecture layout analysis...");

    const t0 = performance.now();
    const width = imageBitmap.width;
    const height = imageBitmap.height;

    // A. Draw to OffscreenCanvas to get initial raw pixels (scaled down for speed)
    const scale = 0.5; // Process deskew on 50% size for huge speedup
    const sw = Math.round(width * scale);
    const sh = Math.round(height * scale);
    const smallCanvas = new OffscreenCanvas(sw, sh);
    const sCtx = smallCanvas.getContext('2d', { willReadFrequently: true });
    sCtx.drawImage(imageBitmap, 0, 0, sw, sh);
    const smallImgData = sCtx.getImageData(0, 0, sw, sh);
    const smallGray = computeGrayscale(smallImgData);

    // B. Find Skew Angle
    const skewAngle = findSkewAngle(smallGray, sw, sh);
    console.log(`[Stage A] Estimated optimal deskew angle: ${skewAngle}°`);

    // C. Render final full-size corrected image
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    if (skewAngle !== 0) {
        ctx.translate(width / 2, height / 2);
        ctx.rotate((skewAngle * Math.PI) / 180);
        ctx.translate(-width / 2, -height / 2);
    }
    ctx.drawImage(imageBitmap, 0, 0);
    const finalImageData = ctx.getImageData(0, 0, width, height);

    // 1. Convert & Binarize (Adaptive)
    const gray = computeGrayscale(finalImageData);
    const binary = binarizeAdaptive(gray, width, height);

    // 2. Vertical Projection for Multi-column Guardrail
    const vProfile = computeVerticalProjection(binary, width, height);
    const isMultiColumn = detectMultiColumn(vProfile, height);

    if (isMultiColumn) {
        console.warn("[Stage A] Multi-column layout detected via vertical projection. Routing to high-level fallback.");
        return {
            layout: 'multi-column',
            confidence: 0.4, // Force fallback for safety in multi-column
            regions: [],
            correctedImageData: finalImageData
        };
    }

    // 3. Horizontal Slicing
    const hProfile = computeHorizontalProjection(binary, width, height);
    const slices = sliceROIsViaHPP(hProfile, height);
    console.log(`[Stage A] Found ${slices.length} distinct horizontal regions across ${height}px height.`);

    let allBubbleGroups = [];

    for (const slice of slices) {
        const blobs = findBlobs(binary, width, height, slice.y, slice.height);
        const classification = classifyROI(blobs, markingSchemeCount);

        // If a row has pure OMR bubbles (or even if it's mixed but has bubbles)
        // We must extract the validCircles and group them by X-distance to handle
        // multiple questions sitting on the exact same horizontal slice
        const validCircles = classification.circleBlobs;
        if (validCircles && validCircles.length > 0) {
            let currentGroup = [];
            for (let i = 0; i < validCircles.length; i++) {
                const c = validCircles[i];
                if (currentGroup.length === 0) {
                    currentGroup.push(c);
                } else {
                    const last = currentGroup[currentGroup.length - 1];
                    const avgW = ((last.maxX - last.minX) + (c.maxX - c.minX)) / 2;
                    const gap = c.minX - last.maxX;
                    // If the gap between circles is more than ~2x the width of a circle,
                    // it is highly likely jumping to the next question's bubble column.
                    if (gap > avgW * 2.0) {
                        allBubbleGroups.push({
                            y: slice.y,
                            height: slice.height,
                            confidence: Math.min(1.0, currentGroup.length / 4), // Roughly
                            circleBlobs: currentGroup
                        });
                        currentGroup = [c];
                    } else {
                        currentGroup.push(c);
                    }
                }
            }
            if (currentGroup.length > 0) {
                allBubbleGroups.push({
                    y: slice.y,
                    height: slice.height,
                    confidence: Math.min(1.0, currentGroup.length / 4),
                    circleBlobs: currentGroup
                });
            }
        }
    }

    // 4. Validate and Route
    // Filter out obvious noise (a question MUST have at least 3 bubbles horizontally)
    allBubbleGroups = allBubbleGroups.filter(g => g.circleBlobs.length >= 3);

    // 5. Column-Major Numbering
    // Determine the center X of each group
    allBubbleGroups.forEach(g => {
        g.centerX = (g.circleBlobs[0].minX + g.circleBlobs[g.circleBlobs.length - 1].maxX) / 2;
    });

    const columns = [];
    // Sort left-to-right primarily
    const sortedByX = [...allBubbleGroups].sort((a, b) => a.centerX - b.centerX);

    for (const g of sortedByX) {
        let placed = false;
        for (const col of columns) {
            const colAvgX = col.reduce((sum, item) => sum + item.centerX, 0) / col.length;
            // If the center X sits within ~8% of the page width of a column, group it
            if (Math.abs(g.centerX - colAvgX) < width * 0.08) {
                col.push(g);
                placed = true;
                break;
            }
        }
        if (!placed) {
            columns.push([g]);
        }
    }

    // Sort columns strictly left-to-right
    columns.sort((a, b) => a[0].centerX - b[0].centerX);

    const classifiedROIs = [];
    let qNum = 1;

    // Number them going down each column
    for (const col of columns) {
        // Sort top-to-bottom within the column
        col.sort((a, b) => a.y - b.y);
        for (const g of col) {
            classifiedROIs.push({
                inferred_question_number: qNum++,
                y: g.y,
                height: g.height, // Keep structural properties for debugging UI
                type: 'omr',
                confidence: 0.9, // Bubble clusters structured in grids are highly confident
                omr_options: g.circleBlobs
            });
        }
    }

    const t1 = performance.now();
    console.log(`[Stage A] Completed in ${Math.round(t1 - t0)}ms. Grouped ${classifiedROIs.length} pure-OMR question blocks across ${columns.length} columns.`);

    return {
        layout: "hybrid-grid",
        regions: classifiedROIs,
        processingTimeMs: Math.round(t1 - t0),
        correctedImageData: finalImageData // Pass the straightened image forward to Stage B
    };
}
