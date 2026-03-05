/* src/workers/oprPipeline/oprWorker.js */
import { checkQuality } from './qualityGate.js';
import { extractGeometry } from './geometryEngine.js';
import { detectCandidates } from './bubbleProcessor.js';
import { classifyStates } from './bubbleProcessor.js';
import { decideRows } from './decisionEngine.js';
import { validateSheet } from './decisionEngine.js';

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

            // -- STAGE 2: Question Number Remapping (multi-block) --
            const numBlocks = geometry.layoutResult.blocks || 1;
            if (numBlocks > 1 && markingSchemeCount) {
                const questionsPerBlock = Math.ceil(markingSchemeCount / numBlocks);
                console.log(`[OPR Remap] ${numBlocks} blocks, totalQ=${markingSchemeCount}, questionsPerBlock=${questionsPerBlock}`);

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
                    const rowsInBlock = blockGroups[bKey].sort((a, b) => a.y - b.y);

                    // Only take the first questionsPerBlock rows for this block
                    const usedRows = rowsInBlock.slice(0, questionsPerBlock);
                    usedRows.forEach((row, rowIndex) => {
                        row.question_number = bIdx * questionsPerBlock + rowIndex + 1;

                        // Debug log
                        const cols = row.columns || [];
                        const xPos = cols.map(c => `${c.label}@${c.x}`).join(',');
                        console.log(`[OPR Remap] Q${row.question_number} (Block ${bIdx}) → y=${row.y} x=[${xPos}]`);

                        finalRows.push(row);
                    });
                });

                geometry.gridModel.rows = finalRows;
                console.log(`[OPR Remap] After filter: ${geometry.gridModel.rows.length} rows kept (expected ${markingSchemeCount})`);
            }



            // -- STAGE 2b: Bubble Candidate Detection --
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
            // Create a blob from warpedImageData for debugging
            const debugCanvas = new OffscreenCanvas(geometry.warpedImageData.width, geometry.warpedImageData.height);
            debugCanvas.getContext('2d').putImageData(geometry.warpedImageData, 0, 0);
            const warpedBlob = await debugCanvas.convertToBlob();

            self.postMessage({
                success: true,
                omrResults: rowResults,  // Key expected by MarkTest.jsx
                results: rowResults,     // Backward compat alias
                layoutResult: geometry.layoutResult,
                warpedBlob,
                meta: {
                    blurScore: quality.blurScore,
                    glareScore: quality.glareScore,
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
