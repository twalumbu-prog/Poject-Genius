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
const MAX_IMAGE_DIM = 1600; // cap for camera/upload images to stay under 546 OOM limit

/**
 * Applies a robust contrast-boost filter designed for documents.
 * Unlike hard binary thresholding, this preserves nuance while making text pop.
 * Includes a "panic" check: if the result is solid white (common in overexposed photos),
 * it returns the original image instead.
 *
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
            ctx.drawImage(img, 0, 0, width, height);

            const imageData = ctx.getImageData(0, 0, width, height);
            const d = imageData.data;

            let whiteCount = 0;
            const totalPixels = width * height;

            for (let i = 0; i < d.length; i += 4) {
                // Standard grayscale luminosity
                let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

                // Robust contrast boost (Softer than previous binary threshold)
                // Maps 50-200 range to 0-255 roughly, with smoothing
                if (gray > 185) {
                    gray = 255;
                } else if (gray < 75) {
                    gray = 0;
                } else {
                    // Linear stretch: (val - min) * (newMax / (max - min))
                    gray = Math.round((gray - 75) * (255 / 110));
                }

                if (gray >= 250) whiteCount++;

                d[i] = d[i + 1] = d[i + 2] = gray;
            }

            // SAFETY CHECK: If > 99% of the image is pure white, the filter failed
            // (likely the original was already quite bright). Return original.
            if (whiteCount > totalPixels * 0.99) {
                console.warn('Doc scan filter resulted in blank image. Falling back to raw capture.');
                resolve(base64Image);
                return;
            }

            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => resolve(base64Image); // Fallback on error
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
