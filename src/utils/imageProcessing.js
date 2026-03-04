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

import ImageWorker from '../workers/imageWorker.js?worker';


import ImageWorker from "../workers/imageWorker.js?worker";

/**
 * Processes an image for Vision Language Model OCR (Gemini).
 * Offloads heavy downscaling, mild contrast, sharpening, and compression to a Web Worker.
 *
 * @param {Blob | File | string} imageObj - The image to process.
 * @param {boolean} faintTextAssist - IF true, applies VERY LIGHT adaptive enhancement (≤ 20% blend).
 * @returns {Promise<{blob: Blob, width: number, height: number, sizeKB: number}>}
 */
export function processForVLM(imageObj, faintTextAssist = false) {
    return new Promise(async (resolve, reject) => {
        try {
            let blob = imageObj;
            
            // If passed a base64 string, convert it to a Blob first
            if (typeof imageObj === "string" && imageObj.startsWith("data:image/")) {
                const res = await fetch(imageObj);
                blob = await res.blob();
            } else if (!(imageObj instanceof Blob)) {
                return reject(new Error("processForVLM requires a Blob, File, or base64 string."));
            }

            const worker = new ImageWorker();
            const id = Date.now().toString() + Math.random().toString();
            
            worker.onmessage = (e) => {
                const { type, id: resId, result, error } = e.data;
                if (resId === id) {
                    if (type === "done") {
                        resolve(result); // { blob, width, height, sizeKB }
                    } else if (type === "error") {
                        reject(new Error(error));
                    }
                    worker.terminate();
                }
            };

            worker.onerror = (err) => {
                reject(err);
                worker.terminate();
            };

            worker.postMessage({ id, imageBlob: blob, faintTextAssist });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Helper to convert Blob back to Base64 (since our React app currently relies heavily on Base64 state)
 */
export function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ── pdfToImages ───────────────────────────────────────────────────────────────
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
