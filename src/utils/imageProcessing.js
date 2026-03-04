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
const MAX_IMAGE_DIM = 1600; // Balanced for OCR accuracy vs payload size (helps prevent "load failed" on mobile)

/**
 * Applies a robust contrast-boost filter designed for documents.
 * Uses a dynamic histogram-based stretch to ensure text is black and background is white.
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

            // 1. Calculate Histogram
            const hist = new Uint32Array(256);
            for (let i = 0; i < d.length; i += 4) {
                const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
                hist[gray]++;
            }

            // 2. Find Black/White points (Percentile based)
            let blackPoint = 0;
            let whitePoint = 255;
            const totalPixels = width * height;

            // Black point: darker 5% (to crush shadows/faint text to black)
            let count = 0;
            for (let i = 0; i < 256; i++) {
                count += hist[i];
                if (count > totalPixels * 0.05) {
                    blackPoint = i;
                    break;
                }
            }

            // White point: lighter 25% (very aggressive to push paper to white)
            count = 0;
            for (let i = 255; i >= 0; i--) {
                count += hist[i];
                if (count > totalPixels * 0.25) {
                    whitePoint = i;
                    break;
                }
            }

            // Ensure points aren't too close to prevent extreme noise amplification
            if (whitePoint - blackPoint < 60) {
                blackPoint = Math.max(0, blackPoint - 30);
                whitePoint = Math.min(255, whitePoint + 30);
            }

            // 3. Apply Contrast Stretch + Gamma Adjustment
            const range = Math.max(1, whitePoint - blackPoint);
            let whitePixelCount = 0;

            for (let i = 0; i < d.length; i += 4) {
                let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

                // Stretch: (val - black) / range * 255
                gray = ((gray - blackPoint) / range) * 255;

                // Push to extremes more aggressively
                if (gray > 210) gray = 255;
                else if (gray < 80) gray = 0;
                else {
                    // Smooth s-curve in middle
                    const normalized = gray / 255;
                    gray = (Math.pow(normalized, 1.2) * 255); // Gentler curve
                }

                const final = Math.min(255, Math.max(0, Math.round(gray)));
                if (final >= 250) whitePixelCount++;

                d[i] = d[i + 1] = d[i + 2] = final;
            }

            // Safety check: if image became > 99% white, fallback to raw
            if (whitePixelCount > totalPixels * 0.995) {
                console.warn('Filter too aggressive, falling back to raw image.');
                resolve(base64Image);
                return;
            }

            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', 0.75));
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
