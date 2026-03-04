/**
 * imageProcessing.js
 * Utilities for document scan enhancement and PDF-to-image conversion.
 */

// ── PDF.js setup ─────────────────────────────────────────────────────────────
// We load the worker from the same pdfjs-dist package so Vite bundles it.
import * as pdfjsLib from 'pdfjs-dist';
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfjsWorker;

const PDF_RENDER_SCALE = 1.8; // ~1620px wide for an A4 page — good for OCR
const MAX_IMAGE_DIM = 1800; // Increased to 1800px per user strategy (downscale to sweet spot)

/**
 * Applies Bradley's Adaptive Thresholding optimized with an Integral Image (Summed Area Table).
 * This prevents UI freezing (O(1) local mean) and preserves faint text under uneven lighting perfectly.
 * We blend the binary threshold map 60% with 40% of the original grayscale to retain physical paper context.
 * @param {string} base64Image
 * @returns {Promise<string>}
 */
export async function applyDocScanFilter(base64Image) {
    if (!base64Image.startsWith('data:image/')) return base64Image;

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
                const scale = MAX_IMAGE_DIM / Math.max(width, height);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // Smoother downscaling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            const imageData = ctx.getImageData(0, 0, width, height);
            const d = imageData.data;

            const w = width;
            const h = height;

            // Typed arrays for high-performance memory reads/writes
            const integral = new Uint32Array(w * h);
            const grayData = new Uint8Array(w * h);

            // 1. Pass: Compute Grayscale and Integral Image (Summed Area Table)
            for (let y = 0; y < h; y++) {
                let rowSum = 0;
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    const dataIdx = i * 4;

                    // Standard luminance conversion
                    const gray = Math.round(0.299 * d[dataIdx] + 0.587 * d[dataIdx + 1] + 0.114 * d[dataIdx + 2]);
                    grayData[i] = gray;
                    rowSum += gray;

                    // I(x,y) = current_row_sum + I(x, y-1)
                    integral[i] = rowSum + (y > 0 ? integral[(y - 1) * w + x] : 0);
                }
            }

            // 2. Pass: Local Mean Thresholding (Bradley)
            // Window size S = width / 32 (scales with image size, ~50px for a 1600px image - ideal for handwriting)
            const radius = Math.max(15, Math.floor(w / 32));
            const T = 0.12; // 12% darker than the local average marks it as ink (prevents noise)

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;

                    // Local window boundaries
                    const x1 = Math.max(0, x - radius);
                    const y1 = Math.max(0, y - radius);
                    const x2 = Math.min(w - 1, x + radius);
                    const y2 = Math.min(h - 1, y + radius);

                    const count = (x2 - x1 + 1) * (y2 - y1 + 1);

                    // O(1) Local Sum via Integral Image formula
                    let sum = integral[y2 * w + x2];
                    if (y1 > 0) sum -= integral[(y1 - 1) * w + x2];
                    if (x1 > 0) sum -= integral[y2 * w + (x1 - 1)];
                    if (x1 > 0 && y1 > 0) sum += integral[(y1 - 1) * w + (x1 - 1)];

                    const mean = sum / count;
                    const pixelGray = grayData[i];

                    // Bradley decision
                    let thresholded = 255; // default paper
                    if (pixelGray < mean * (1 - T)) {
                        thresholded = 0; // mark as ink
                    }

                    // Blend: 60% pure black/white structure + 40% original grayscale context
                    const blended = Math.round((thresholded * 0.6) + (pixelGray * 0.4));

                    const dataIdx = i * 4;
                    d[dataIdx] = blended;
                    d[dataIdx + 1] = blended;
                    d[dataIdx + 2] = blended;
                }
            }

            ctx.putImageData(imageData, 0, 0);

            // Export aggressively compressed JPEG (0.75-0.8) to hit our ~300KB payload target
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => resolve(base64Image);
        img.src = base64Image;
    });
}

// ── pdfToImages ───────────────────────────────────────────────────────────────
/**
 * Converts every page of a PDF into a high-contrast JPEG.
 * @param {string} base64Pdf
 * @returns {Promise<string[]>}
 */
export async function pdfToImages(base64Pdf) {
    const base64Data = base64Pdf.split(',')[1];
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pageImages = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport }).promise;

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;

        for (let i = 0; i < d.length; i += 4) {
            let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            // PDF backgrounds are usually pure white, so we use a gentler curve
            if (gray > 200) gray = 255;
            else if (gray < 60) gray = 0;
            else gray = Math.round((gray - 60) * (255 / 140));

            d[i] = d[i + 1] = d[i + 2] = gray;
        }
        ctx.putImageData(imageData, 0, 0);

        pageImages.push(canvas.toDataURL('image/jpeg', 0.88));
    }

    return pageImages;
}

// ── explodeFilesToImages ──────────────────────────────────────────────────────
/**
 * Takes a FileList / File[] from an upload input and returns a flat array of
 * processed JPEG images — one entry per expected student script.
 *
 * Rules:
 *   - image/*  → one entry per file (after doc-scan enhancement)
 *   - PDF      → one entry per PAGE (each page = one student script)
 *
 * @param {File[]} files
 * @param {(msg: string) => void} [onStatus]  optional progress callback
 * @returns {Promise<Array<{base64: string, label: string}>>}
 */
export async function explodeFilesToImages(files, onStatus) {
    const results = [];

    for (const file of files) {
        if (file.type === 'application/pdf') {
            onStatus?.(`Converting PDF: ${file.name}...`);

            // Read file as base64
            const base64Pdf = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const pages = await pdfToImages(base64Pdf);
            pages.forEach((pageBase64, i) => {
                results.push({
                    base64: pageBase64,
                    label: pages.length === 1
                        ? file.name
                        : `${file.name} — page ${i + 1}`,
                });
            });

        } else if (file.type.startsWith('image/')) {
            onStatus?.(`Enhancing image: ${file.name}...`);

            const rawBase64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            try {
                const enhanced = await applyDocScanFilter(rawBase64);
                results.push({ base64: enhanced, label: file.name });
            } catch {
                results.push({ base64: rawBase64, label: file.name });
            }

        } else {
            console.warn(`Unsupported file type: ${file.type} (${file.name}), skipping.`);
        }
    }

    return results;
}
