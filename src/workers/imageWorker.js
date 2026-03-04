// src/workers/imageWorker.js
// ─────────────────────────────────────────────────────────────────────────────
// VLM-Optimized Image Processing Worker (Hardened V2)
//
// Single-lossy-encode boundary:
//   INPUT  → PNG blob (lossless from canvas.toDataURL('image/png') in MarkTest.jsx)
//   PROCESS → mild contrast stretch + optional Bradley blend in OffscreenCanvas
//   OUTPUT → ◄ THE ONLY JPEG ENCODE IS HERE ► convertToBlob({ type: 'image/jpeg', quality: 0.75 })
//
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = async (e) => {
    const { id, imageBlob, faintTextAssist, debugMode } = e.data;

    const t0 = performance.now();              // Part 3.2: Processing time start

    try {
        // Part 3.2 — log original (PNG) payload size
        const originalSizeKB = Math.round(imageBlob.size / 1024);
        if (originalSizeKB > 500) {
            console.warn(`[Worker] Input PNG is ${originalSizeKB}KB — larger than recommended 500KB!`);
        }

        // Decode image into bitmap. createImageBitmap is hardware-accelerated.
        const bitmap = await createImageBitmap(imageBlob);

        let { width, height } = bitmap;
        // Part 3.1/3.2 — record natural dimensions
        const naturalWidth = width;
        const naturalHeight = height;

        // Downscale to max 1800px on longest edge if needed.
        // This is the ONLY resize step in the pipeline.
        const MAX_DIM = 1800;
        if (width > MAX_DIM || height > MAX_DIM) {
            const scale = MAX_DIM / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }

        // Part 3.3 — Explicitly set Lanczos-class smoothing BEFORE drawImage.
        // 'high' quality in Chrome/Safari activates multi-pass bilinear or Lanczos-3.
        // DO NOT remove: this preserves faint pencil strokes during downscale.
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;       // ← mandatory for VLM quality
        ctx.imageSmoothingQuality = 'high';     // ← activates Lanczos-3 equivalent

        ctx.drawImage(bitmap, 0, 0, width, height);

        // Part 4.1 — Immediately close bitmap to free GPU/memory.
        // This prevents large bitmaps from lingering in memory during bulk processing.
        bitmap.close();

        const imageData = ctx.getImageData(0, 0, width, height);
        const d = imageData.data;
        const w = width;
        const h = height;

        // Mild contrast stretch (1.10) to slightly lift faint ink without crushing whites.
        // Kept intentionally soft to preserve natural VLM context.
        const contrast = 1.10;
        const intercept = 128 * (1 - contrast);

        // Prep arrays for adaptive thresholding if needed (faint pencil assist)
        let integral;
        let grayData;
        if (faintTextAssist) {
            integral = new Uint32Array(w * h);
            grayData = new Uint8Array(w * h);
        }

        // Apply contrast stretch in a single pass.
        // Simultaneously build integral image if faint text assist requested.
        for (let y = 0; y < h; y++) {
            let rowSum = 0;
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                const dataIdx = i * 4;

                // MILD contrast bump — never crushes whites
                d[dataIdx] = Math.min(255, Math.max(0, d[dataIdx] * contrast + intercept));
                d[dataIdx + 1] = Math.min(255, Math.max(0, d[dataIdx + 1] * contrast + intercept));
                d[dataIdx + 2] = Math.min(255, Math.max(0, d[dataIdx + 2] * contrast + intercept));

                if (faintTextAssist) {
                    const gray = Math.round(0.299 * d[dataIdx] + 0.587 * d[dataIdx + 1] + 0.114 * d[dataIdx + 2]);
                    grayData[i] = gray;
                    rowSum += gray;
                    integral[i] = rowSum + (y > 0 ? integral[(y - 1) * w + x] : 0);
                }
            }
        }

        // NOTE: Unsharp Mask removed entirely — it amplified JPEG artifacts before VLM extraction.
        const outputData = new Uint8ClampedArray(d);

        // Optional faint-text assist via Bradley Adaptive Thresholding.
        // Blend is kept ≤ 15% to preserve natural image context for VLM.
        if (faintTextAssist) {
            const radius = Math.max(15, Math.floor(w / 32));
            const T = 0.10;
            const blendFactor = 0.15; // Very light blend — must not overwhelm real context

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    const x1 = Math.max(0, x - radius);
                    const y1 = Math.max(0, y - radius);
                    const x2 = Math.min(w - 1, x + radius);
                    const y2 = Math.min(h - 1, y + radius);

                    const count = (x2 - x1 + 1) * (y2 - y1 + 1);

                    let sum = integral[y2 * w + x2];
                    if (y1 > 0) sum -= integral[(y1 - 1) * w + x2];
                    if (x1 > 0) sum -= integral[y2 * w + (x1 - 1)];
                    if (x1 > 0 && y1 > 0) sum += integral[(y1 - 1) * w + (x1 - 1)];

                    const mean = sum / count;
                    const pixelGray = grayData[i];

                    let thresholded = 255;
                    if (pixelGray < mean * (1 - T)) {
                        thresholded = 0; // Dark pixel — likely ink/pencil
                    }

                    const dataIdx = i * 4;
                    outputData[dataIdx] = Math.round((thresholded * blendFactor) + (outputData[dataIdx] * (1 - blendFactor)));
                    outputData[dataIdx + 1] = Math.round((thresholded * blendFactor) + (outputData[dataIdx + 1] * (1 - blendFactor)));
                    outputData[dataIdx + 2] = Math.round((thresholded * blendFactor) + (outputData[dataIdx + 2] * (1 - blendFactor)));
                }
            }
        }

        // Part 4.1 — Dereference large intermediate arrays immediately after use
        integral = null;
        grayData = null;

        ctx.putImageData(new ImageData(outputData, w, h), 0, 0);

        // ◄ SINGLE LOSSY ENCODE BOUNDARY ►
        // This is THE ONLY place a JPEG encode occurs in the entire pipeline.
        // Quality 0.75 targets 200–350KB payloads, safe for Supabase Edge Function limits.
        const resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
        const finalSizeKB = Math.round(resultBlob.size / 1024);

        // Part 3.2 — Warn if output is unexpectedly large
        if (finalSizeKB > 500) {
            console.warn(`[Worker] Output JPEG is ${finalSizeKB}KB — exceeds the 500KB warning threshold!`);
        }

        const processingMs = Math.round(performance.now() - t0);

        // Part 3.2 — Telemetry metrics (only included if debugMode requested)
        const debugMetrics = debugMode ? {
            originalSizeKB,
            finalSizeKB,
            naturalWidth,
            naturalHeight,
            outputWidth: w,
            outputHeight: h,
            processingMs,
            faintTextAssist: !!faintTextAssist
        } : null;

        self.postMessage({
            type: 'done',
            id,
            result: {
                blob: resultBlob,
                width: w,
                height: h,
                sizeKB: finalSizeKB,
                ...(debugMetrics && { debug: debugMetrics })
            }
        });

    } catch (error) {
        self.postMessage({ type: 'error', id, error: error.message });
    }
};
