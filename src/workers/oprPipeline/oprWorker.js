/* src/workers/oprPipeline/oprWorker.js */
import { checkQuality } from './qualityGate.js';
import { extractGeometry } from './geometryEngine.js';
import { detectCandidates } from './bubbleProcessor.js';
import { classifyStates } from './bubbleProcessor.js';
import { decideRows } from './decisionEngine.js';
import { validateSheet } from './decisionEngine.js';

self.onerror = (err) => {
    console.error('[OPR Worker Global Error]', err);
    self.postMessage({ success: false, error: `GLOBAL_WORKER_ERROR: ${err.message}` });
};

self.onmessage = async (e) => {
    if (e.data.messageType === 'PROCESS_OMR') {
        const { imageBitmap, markingSchemeCount, id } = e.data;

        try {
            if (!imageBitmap) {
                throw new Error('MISSING_IMAGE_DATA: imageBitmap is null or undefined');
            }

            // 1. Convert ImageBitmap to ImageData for pixel manipulation
            // ImageBitmap is highly efficient for transfer but lacks direct pixel access.
            const width = imageBitmap.width;
            const height = imageBitmap.height;

            console.log(`[OPR Engine] Initializing canvas for ${width}x${height} image...`);
            const offscreen = new OffscreenCanvas(width, height);
            const ctx = offscreen.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(imageBitmap, 0, 0);
            const imageData = ctx.getImageData(0, 0, width, height);

            // Close the bitmap to free memory immediately
            if (imageBitmap.close) imageBitmap.close();

            console.log(`[OPR Engine] Starting process for script ${id || 'unknown'}`);

            // -- STAGE 0: Quality Gate --
            console.log('[OPR] Stage 0: Quality Gate...');
            const quality = checkQuality(imageData);
            if (!quality.accepted) {
                return self.postMessage({
                    success: false,
                    error: `QUALITY_REJECTED: ${quality.reason_if_rejected}`,
                    telemetry: { quality }
                });
            }

            // -- STAGE 1: Geometric Truth Engine --
            console.log('[OPR] Stage 1: Geometry Engine...');
            const geometry = extractGeometry(imageData);
            if (!geometry.success) {
                return self.postMessage({
                    success: false,
                    error: `GEOMETRY_FAILURE: ${geometry.reason}`,
                    telemetry: { quality, geometry }
                });
            }

            // -- STAGE 2: Bubble Candidate Detection --
            console.log('[OPR] Stage 2: Candidate Detection...');
            const candidates = detectCandidates(geometry.warpedImageData, geometry.gridModel);

            // -- STAGE 3: Bubble State Classification --
            console.log('[OPR] Stage 3: State Classification...');
            const classifiedBubbles = classifyStates(candidates, geometry.warpedImageData);

            // -- STAGE 4: Row Decision Engine --
            console.log('[OPR] Stage 4: Decision Engine...');
            const rowResults = decideRows(classifiedBubbles, markingSchemeCount);

            // -- STAGE 5: Sheet Sanity Validator --
            console.log('[OPR] Stage 5: Sanity Validator...');
            const sanity = validateSheet(rowResults);

            console.log('[OPR] Complete!');
            self.postMessage({
                success: true,
                omrResults: rowResults,
                layoutResult: geometry.layoutResult,
                telemetry: {
                    quality,
                    geometry,
                    sanity,
                    opr_version: '1.0.0-beta'
                }
            });

        } catch (err) {
            console.error('[OPR Worker Error]', err);
            self.postMessage({
                success: false,
                error: `PIPELINE_ERROR: ${err.message}`,
                stack: err.stack
            });
        }
    }
};
