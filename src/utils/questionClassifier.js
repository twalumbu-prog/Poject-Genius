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

export function binarize(grayArray, width, height, threshold = 180) {
    const binary = new Uint8Array(width * height);
    for (let i = 0; i < grayArray.length; i++) {
        binary[i] = grayArray[i] < threshold ? 1 : 0; // 1 = dark ink, 0 = white paper
    }
    return binary;
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

// 5. Shape Heuristics & Classification
export function classifyROI(blobs, expectedBubbles = 4) {
    let circleCount = 0;
    let textBlobs = 0;

    const validCircles = blobs.filter(blob => {
        const w = blob.maxX - blob.minX + 1;
        const h = blob.maxY - blob.minY + 1;

        // Exclude tiny noise and massive lines
        if (blob.area < 50 || blob.area > 5000) return false;

        const aspectRatio = Math.max(w, h) / Math.min(w, h);
        if (aspectRatio > 1.5) {
            if (w > 20) textBlobs++; // likely a word/line
            return false;
        }

        // Circularity Score = 4 * PI * Area / Perimeter^2
        // Perfect circle = 1.0. Square = ~0.78. 
        if (blob.perimeter === 0) return false;
        const circularity = (4 * Math.PI * blob.area) / (blob.perimeter * blob.perimeter);

        // Strict circularity to reject checkboxes and dense text characters like '0' or 'O'
        if (circularity >= 0.65 && circularity <= 1.25) {
            return true;
        }
        textBlobs++;
        return false;
    });

    circleCount = validCircles.length;

    let type = "unknown";
    let confidence = 0.0;

    // If we see at least 3 identical circles aligned in a row, it's highly likely an OMR question
    if (circleCount >= 3) {
        type = "omr";
        confidence = Math.min(1.0, circleCount / expectedBubbles);

        // Decrease confidence if there is a massive amount of text next to it 
        // that shouldn't be in a pure-bubble answer sheet column
        if (textBlobs > 20) {
            confidence -= 0.3;
        }
    } else if (textBlobs > 5) {
        type = "ocr"; // Lots of irregular blobs = handwriting/paragraphs
        confidence = 0.8;
    }

    if (confidence < 0) confidence = 0;

    // Sort valid circles left-to-right for Stage B
    validCircles.sort((a, b) => a.minX - b.minX);

    return { type, confidence, circleBlobs: validCircles };
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

    // 1. Convert & Binarize
    const gray = computeGrayscale(finalImageData);
    const binary = binarize(gray, width, height, 180); // Strict threshold to isolate dark print from faint shading

    // 2. Horizontal Slicing
    const hProfile = computeHorizontalProjection(binary, width, height);
    const slices = sliceROIsViaHPP(hProfile, height);
    console.log(`[Stage A] Found ${slices.length} distinct horizontal regions across ${height}px height.`);

    let allBubbleGroups = [];

    for (const slice of slices) {
        const blobs = findBlobs(binary, width, height, slice.y, slice.height);
        const classification = classifyROI(blobs);

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
