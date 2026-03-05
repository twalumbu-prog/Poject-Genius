/* src/workers/oprPipeline/oprWorker.js */
import { checkQuality } from './qualityGate.js';
import { performPageRegistration, performGridModeling } from './geometryEngine.js';
import { detectCandidates, classifyStates } from './bubbleProcessor.js';
import { decideRows, validateSheet } from './decisionEngine.js';
import { normalizeIllumination, binarizeAdaptive } from './preprocessor.js';

console.log('[OPR Worker] Source loaded and initialized');

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

            // -- LAYER 2: Page Detection & Registration --
            console.log('[OPR] Layer 2: Page Registration...');
            const registration = performPageRegistration(imageData);
            if (!registration.success) {
                return self.postMessage({
                    success: false,
                    error: `REGISTRATION_FAILURE: ${registration.reason}`,
                    telemetry: { quality }
                });
            }

            // -- LAYER 3: Illumination Normalization --
            console.log('[OPR] Layer 3: Illumination Normalization...');
            const normalizedImageData = normalizeIllumination(registration.warpedImageData);

            // -- LAYER 4: Adaptive Binarization --
            console.log('[OPR] Layer 4: Adaptive Binarization...');
            const binaryImageData = binarizeAdaptive(normalizedImageData);

            // -- LAYER 5 & 6: Grid Modeling --
            console.log('[OPR] Layer 5 & 6: Grid Modeling...');
            const geometry = performGridModeling(binaryImageData);
            if (!geometry.success) {
                return self.postMessage({
                    success: false,
                    error: `GEOMETRY_FAILURE: ${geometry.reason}`,
                    telemetry: { quality, registration }
                });
            }

            // -- LAYER 6.5: Question Number Remapping --
            const numBlocks = geometry.layoutResult.blocks || 1;
            if (markingSchemeCount) {
                // ECZ sheets usually have 20 questions per column
                const QUESTIONS_PER_BLOCK = 20;
                console.log(`[OPR Remap] ${numBlocks} blocks, totalQ=${markingSchemeCount}, capacityPerBlock=${QUESTIONS_PER_BLOCK}`);

                // Group rows by blockIdx and sort them by Y coordinate
                const blockGroups = {};
                geometry.gridModel.rows.forEach(row => {
                    const bIdx = row.blockIdx || 0;
                    if (!blockGroups[bIdx]) blockGroups[bIdx] = [];
                    blockGroups[bIdx].push(row);
                });

                const finalRows = [];
                Object.keys(blockGroups).sort().forEach(bKey => {
                    const bIdx = parseInt(bKey);
                    // Standard ECZ mapping: Block 0 = Q1-20, Block 1 = Q21-40, etc.
                    const blockStartNum = bIdx * QUESTIONS_PER_BLOCK;

                    const rowsInBlock = blockGroups[bKey].sort((a, b) => a.y - b.y);

                    rowsInBlock.forEach((row, rowIndex) => {
                        const qNum = blockStartNum + rowIndex + 1;

                        // Only keep if within the marking scheme range
                        if (qNum <= markingSchemeCount) {
                            row.question_number = qNum;
                            // Debug log
                            const cols = row.columns || [];
                            const xPos = cols.map(c => `${c.label}@${c.x}`).join(',');
                            console.log(`[OPR Remap] Q${row.question_number} (Block ${bIdx}) → y=${row.y} x=[${xPos}]`);
                            finalRows.push(row);
                        }
                    });
                });

                geometry.gridModel.rows = finalRows;
                console.log(`[OPR Remap] After filter: ${geometry.gridModel.rows.length} rows kept (expected <= ${markingSchemeCount})`);
            }




            // -- LAYER 7: Candidates & Classification --
            console.log('[OPR] Layer 7: Bubble Classification (using Normalized image)...');
            // Classification MUST use the shadow-normalized image, NOT binary.
            const candidates = detectCandidates(normalizedImageData, geometry.gridModel);
            const classifiedBubbles = classifyStates(candidates, normalizedImageData);

            // -- LAYER 8: Row Decision Engine --
            console.log('[OPR] Layer 8: Decision Engine...');
            const rowResults = decideRows(classifiedBubbles, markingSchemeCount);

            // -- LAYER 9: Sheet Sanity Validator --
            console.log('[OPR] Layer 9: Sanity Validator...');
            const sanity = validateSheet(rowResults);

            console.log('[OPR] Complete!');
            // Create blobs for step-by-step inspection
            const [warpedBlob, normalizedBlob, binaryBlob] = await Promise.all([
                imageDataToBlob(registration.warpedImageData),
                imageDataToBlob(normalizedImageData),
                imageDataToBlob(binaryImageData)
            ]);

            self.postMessage({
                success: true,
                omrResults: rowResults,
                results: rowResults,
                layoutResult: geometry.layoutResult,
                warpedBlob,
                normalizedBlob,
                binaryBlob,
                meta: {
                    blurScore: quality.blurScore,
                    glareScore: quality.glareScore,
                    registration_confidence: registration.registration_confidence,
                    version: '1.0.0-beta'
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

async function imageDataToBlob(imageData) {
    if (!imageData) return null;
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    return await canvas.convertToBlob();
}
