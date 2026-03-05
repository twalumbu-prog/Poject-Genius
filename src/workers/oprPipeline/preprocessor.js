/* src/workers/oprPipeline/preprocessor.js */

/**
 * Layer 3: Illumination Normalization
 * Removes shadows and uneven lighting by subtracting a large-kernel blur.
 * I_norm = I_original - I_blur + 128
 */
export function normalizeIllumination(imageData) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);

    // We'll use a fast box blur as an approximation for Gaussian blur
    // A large kernel (e.g., 40px) is needed to capture the illumination gradient
    const blurred = boxBlur(imageData, 40);

    for (let i = 0; i < data.length; i += 4) {
        // Only process luma
        const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        const blurLuma = blurred[i / 4];

        // Normalize: center around 128
        let norm = luma - blurLuma + 128;
        norm = Math.max(0, Math.min(255, norm));

        output[i] = output[i + 1] = output[i + 2] = norm;
        output[i + 3] = 255;
    }

    return new ImageData(output, width, height);
}

/**
 * Layer 4: Adaptive Binarization (Bradley-Roth)
 * Converts grayscale to binary (0 or 255) using local window averages.
 * This is much more robust than global thresholding for OMR.
 */
export function binarizeAdaptive(imageData, sensitivity = 0.15) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    const luma = new Uint8Array(width * height);

    // Extract luma
    for (let i = 0; i < data.length; i += 4) {
        luma[i / 4] = data[i]; // Assumes already normalized to grayscale
    }

    // Integral image for fast local window averages
    const integral = new Uint32Array(width * height);
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let y = 0; y < height; y++) {
            const idx = y * width + x;
            sum += luma[idx];
            integral[idx] = (x > 0 ? integral[idx - 1] : 0) + sum;
        }
    }

    const s = Math.floor(width / 8); // Window size
    const t = 1 - sensitivity;

    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const idx = y * width + x;

            const x1 = Math.max(0, x - s / 2);
            const x2 = Math.min(width - 1, x + s / 2);
            const y1 = Math.max(0, y - s / 2);
            const y2 = Math.min(height - 1, y + s / 2);

            const count = (x2 - x1) * (y2 - y1);
            const sum = getIntegralSum(integral, width, x1, y1, x2, y2);

            const val = (luma[idx] * count < sum * t) ? 0 : 255;

            output[idx * 4] = output[idx * 4 + 1] = output[idx * 4 + 2] = val;
            output[idx * 4 + 3] = 255;
        }
    }

    return new ImageData(output, width, height);
}

// --- Helper Functions ---

function boxBlur(imageData, radius) {
    const { width, height, data } = imageData;
    const luma = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
        luma[i / 4] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }

    const output = new Uint8Array(width * height);
    // Simple 1D horizontal pass then vertical pass
    const temp = new Uint8Array(width * height);

    // Horizontal
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0, count = 0;
            for (let dx = -radius; dx <= radius; dx++) {
                const nx = x + dx;
                if (nx >= 0 && nx < width) {
                    sum += luma[y * width + nx];
                    count++;
                }
            }
            temp[y * width + x] = sum / count;
        }
    }

    // Vertical
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            let sum = 0, count = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                const ny = y + dy;
                if (ny >= 0 && ny < height) {
                    sum += temp[ny * width + x];
                    count++;
                }
            }
            output[y * width + x] = sum / count;
        }
    }

    return output;
}

function getIntegralSum(integral, width, x1, y1, x2, y2) {
    x1 = Math.floor(x1); y1 = Math.floor(y1);
    x2 = Math.floor(x2); y2 = Math.floor(y2);

    const a = (x1 > 0 && y1 > 0) ? integral[(y1 - 1) * width + (x1 - 1)] : 0;
    const b = (y1 > 0) ? integral[(y1 - 1) * width + x2] : 0;
    const c = (x1 > 0) ? integral[y2 * width + (x1 - 1)] : 0;
    const d = integral[y2 * width + x2];

    return d - b - c + a;
}
