/* src/workers/oprPipeline/oprWorker.js */
import { checkQuality } from './qualityGate.js';
import { extractGeometry } from './geometryEngine.js';
import { detectCandidates } from './bubbleProcessor.js';
import { classifyStates } from './bubbleProcessor.js';
import { decideRows } from './decisionEngine.js';
import { validateSheet } from './decisionEngine.js';

self.onmessage = async (e) => {
    if (e.data.messageType === 'PROCESS_OMR') {
        const { imageBitmap, markingSchemeCount, id } = e.data;

        try {
            const width = imageBitmap.width;
            const height = imageBitmap.height;
            const offscreen = new OffscreenCanvas(width, height);
            const ctx = offscreen.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(imageBitmap, 0, 0);
            const imageData = ctx.getImageData(0, 0, width, height);

            // -- STAGE 0: Quality Gate --
            const quality = checkQuality(imageData);
            if (!quality.accepted) {
                return self.postMessage({
                    success: false,
                    error: `QUALITY_REJECTED: ${quality.reason_if_rejected}`,
                    telemetry: { quality }
                });
            }

            // -- STAGE 1: Geometric Truth Engine --
            const geometry = extractGeometry(imageData);
            if (!geometry.success) {
                return self.postMessage({
                    success: false,
                    error: `GEOMETRY_FAILURE: ${geometry.reason}`,
                    telemetry: { quality, geometry }
                });
            }

            // -- STAGE 2: Bubble Candidate Detection --
            const candidates = detectCandidates(geometry.warpedImageData, geometry.gridModel);

            // -- STAGE 3: Bubble State Classification --
            const classifiedBubbles = classifyStates(candidates, geometry.warpedImageData);

            // -- STAGE 4: Row Decision Engine --
            const rowResults = decideRows(classifiedBubbles, markingSchemeCount);

            // -- STAGE 5: Sheet Sanity Validator --
            const sanity = validateSheet(rowResults);

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
            self.postMessage({
                success: false,
                error: err.message
            });
        }
    }
};
