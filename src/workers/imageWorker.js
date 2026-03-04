// src/workers/imageWorker.js

self.onmessage = async (e) => {
    const { id, imageBlob, faintTextAssist } = e.data;

    try {
        // Phase 3: Web Worker decoding (prevent main UI freeze)
        const bitmap = await createImageBitmap(imageBlob);

        let { width, height } = bitmap;
        const MAX_DIM = 1800; // Phase 2 / Step 1: Max 1800px width

        if (width > MAX_DIM || height > MAX_DIM) {
            const scale = MAX_DIM / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const d = imageData.data;
        const w = width;
        const h = height;

        // Phase 2 / Step 2: Very mild contrast (1.10) to preserve natural VLM context
        const contrast = 1.10;
        const intercept = 128 * (1 - contrast);

        // Prep arrays for adaptive thresholding if needed
        let integral;
        let grayData;
        if (faintTextAssist) {
            integral = new Uint32Array(w * h);
            grayData = new Uint8Array(w * h);
        }

        // Apply contrast stretch
        for (let y = 0; y < h; y++) {
            let rowSum = 0;
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                const dataIdx = i * 4;

                // MILD Contrast bump (never crush whites)
                d[dataIdx] = Math.min(255, Math.max(0, d[dataIdx] * contrast + intercept));
                d[dataIdx + 1] = Math.min(255, Math.max(0, d[dataIdx + 1] * contrast + intercept));
                d[dataIdx + 2] = Math.min(255, Math.max(0, d[dataIdx + 2] * contrast + intercept));

                // Populate gray/integral image if faint text enhancement requested
                if (faintTextAssist) {
                    const gray = Math.round(0.299 * d[dataIdx] + 0.587 * d[dataIdx + 1] + 0.114 * d[dataIdx + 2]);
                    grayData[i] = gray;
                    rowSum += gray;
                    integral[i] = rowSum + (y > 0 ? integral[(y - 1) * w + x] : 0);
                }
            }
        }

        // Removed Phase 2 / Step 3 (Unsharp mask) entirely because it amplified noise artifacts before VLM extraction
        const outputData = new Uint8ClampedArray(d);

        // Phase 2 / Step 4: Conditional faint-text assist (Bradley)
        if (faintTextAssist) {
            const radius = Math.max(15, Math.floor(w / 32));
            const T = 0.10;
            const blendFactor = 0.15; // VERY LIGHT adaptive enhancement (≤ 20% according to spec)

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
                        thresholded = 0; // Pure black mark
                    }

                    const dataIdx = i * 4;
                    outputData[dataIdx] = Math.round((thresholded * blendFactor) + (outputData[dataIdx] * (1 - blendFactor)));
                    outputData[dataIdx + 1] = Math.round((thresholded * blendFactor) + (outputData[dataIdx + 1] * (1 - blendFactor)));
                    outputData[dataIdx + 2] = Math.round((thresholded * blendFactor) + (outputData[dataIdx + 2] * (1 - blendFactor)));
                }
            }
        }

        ctx.putImageData(new ImageData(outputData, w, h), 0, 0);

        // Phase 2 / Step 5: JPEG compression at 0.75
        const resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
        const sizeKB = Math.round(resultBlob.size / 1024);

        self.postMessage({
            type: 'done',
            id,
            result: {
                blob: resultBlob,
                width: w,
                height: h,
                sizeKB
            }
        });

    } catch (error) {
        self.postMessage({ type: 'error', id, error: error.message });
    }
};
