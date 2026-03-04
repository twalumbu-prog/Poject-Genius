import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Camera, Upload, CheckCircle, AlertCircle, Sparkles, ChevronDown, ChevronUp, X, FileCheck } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import { explodeFilesToImages, processForVLM, blobToBase64 } from '../../utils/imageProcessing';
import { normalizeQuestionNumber } from '../../utils/ocrValidation';
import './Page.css';

export default function MarkTest() {
    const { testId } = useParams();
    const navigate = useNavigate();
    const [test, setTest] = useState(null);
    const [markingScheme, setMarkingScheme] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStatus, setProcessingStatus] = useState('');
    const [processingError, setProcessingError] = useState(null);
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(true);
    const [pupils, setPupils] = useState([]);
    const [reviewBatch, setReviewBatch] = useState(null);
    const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
    const [batchResults, setBatchResults] = useState([]);

    const [scannedImage, setScannedImage] = useState(null);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [isFlashActive, setIsFlashActive] = useState(false);
    const [showAnswers, setShowAnswers] = useState(false);
    const [videoRef, setVideoRef] = useState(null);
    const [showLightbox, setShowLightbox] = useState(false);
    const [duplicatePrompt, setDuplicatePrompt] = useState(null);
    const [capturedImages, setCapturedImages] = useState([]);
    const [batchImages, setBatchImages] = useState([]); // All base64 images in current upload/capture
    const [scanPhase, setScanPhase] = useState(0); // 0-4 message index
    const [scanProgress, setScanProgress] = useState(0); // 0-100 fill bar
    const [scanMode, setScanMode] = useState('upload'); // 'upload' | 'camera'
    const [scanScriptCount, setScanScriptCount] = useState(0);
    const [scanComplete, setScanComplete] = useState(null);
    const scanTimers = React.useRef([]); // all pending setTimeout ids

    const SCAN_STEPS_UPLOAD = [
        { label: 'Preparing files', detail: 'Reading and converting your documents...' },
        { label: 'Enhancing quality', detail: 'Applying document scan filters...' },
        { label: 'AI analysis', detail: 'The AI examiner is reading each script...' },
        { label: 'Mapping answers', detail: 'Cross-referencing with the marking scheme...' },
        { label: 'Finalising', detail: 'Calculating scores and generating report...' },
    ];
    const SCAN_STEPS_CAMERA = [
        { label: 'Enhancing images', detail: 'Sharpening and cleaning camera captures...' },
        { label: 'Reading handwriting', detail: 'AI vision is analysing the scripts...' },
        { label: 'Matching questions', detail: 'Cross-referencing with the marking scheme...' },
        { label: 'Calculating scores', detail: 'Computing marks and percentages...' },
        { label: 'Finalising', detail: 'Preparing results for review...' },
    ];
    const currentSteps = scanMode === 'camera' ? SCAN_STEPS_CAMERA : SCAN_STEPS_UPLOAD;

    // ── Progress helpers ───────────────────────────────────────────────
    // startScanProgress sets the bar into motion with a safe initial crawl.
    // advanceScanProgress(done, total) updates the bar as each real script finishes.
    // completeScan() drives it to 100% and shows the success card.
    const clearScanTimers = () => {
        scanTimers.current.forEach(id => clearTimeout(id));
        scanTimers.current = [];
    };

    const startScanProgress = (total = 1) => {
        clearScanTimers();
        setScanProgress(0);
        setScanPhase(0);
        // Initial crawl to 10% quickly — lets the user know we're working
        const id = setTimeout(() => { setScanProgress(10); setScanPhase(1); }, 300);
        scanTimers.current.push(id);
        // Store total so advanceScanProgress can compute real %
        scanTimers.current._total = total;
        scanTimers.current._done = 0;
    };

    // Call once per script that finishes — advances bar proportionally up to 92%
    const advanceScanProgress = () => {
        scanTimers.current._done = (scanTimers.current._done ?? 0) + 1;
        const done = scanTimers.current._done;
        const total = scanTimers.current._total ?? 1;
        // Map 0..total → 10%..92% (we stall at 92% until completeScan)
        const pct = Math.round(10 + (done / total) * 82);
        const phaseIdx = Math.min(4, Math.floor((done / total) * 5));
        setScanProgress(Math.min(pct, 92));
        setScanPhase(phaseIdx);
    };

    // Called when the API returns successfully
    const completeScan = (batchPayload) => {
        clearScanTimers();
        setScanProgress(100);
        // Short delay so the bar visually completes before the card swaps
        const id = setTimeout(() => {
            setIsProcessing(false);
            const lowConfCount = batchPayload.reduce(
                (acc, s) => acc + s.studentAnswers.filter(a => a.confidence === 'Low' || !a.student_answer).length, 0
            );
            setScanComplete({ success: true, count: batchPayload.length, warnings: lowConfCount, batch: batchPayload });
        }, 500);
        scanTimers.current.push(id);
    };

    // Cleanup on unmount
    React.useEffect(() => () => clearScanTimers(), []);

    const base64ToBlob = (base64) => {
        const byteString = atob(base64.split(',')[1]);
        const mimeString = base64.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        return new Blob([ab], { type: mimeString });
    };

    const reviewData = reviewBatch ? reviewBatch[currentReviewIndex] : null;

    useEffect(() => {
        fetchTestData();
        fetchPupils();
    }, [testId]);



    async function fetchPupils() {
        try {
            const { data, error } = await supabase
                .from('pupils')
                .select('*')
                .order('name');
            if (error) throw error;
            setPupils(data);
        } catch (error) {
            console.error('Error fetching pupils:', error);
        }
    }

    async function fetchTestData() {
        try {
            const { data: testData, error: testError } = await supabase
                .from('tests')
                .select('*, test_streams(*)')
                .eq('id', testId)
                .single();

            if (testError) throw testError;

            const { data: schemeData, error: schemeError } = await supabase
                .from('marking_schemes')
                .select('*')
                .eq('test_id', testId)
                .single();

            if (schemeError && schemeError.code !== 'PGRST116') throw schemeError;

            setTest(testData);
            setMarkingScheme(schemeData);
        } catch (error) {
            console.error('Error fetching test data:', error);
        } finally {
            setLoading(false);
        }
    }

    // ── Phase 4: Bulk Processing Queue (Hardened V2) ─────────────────────
    // Processes scripts via queue to prevent Edge OOM edge cases.
    // Queue backpressure: pauses intake if pending jobs exceed safe threshold.
    const processScriptImages = async (imageObjects) => {
        const QUEUE_BACKPRESSURE_LIMIT = 10; // Safety: pause if pending > this
        const BASE_RETRY_DELAY_MS = 1000;
        const MAX_RETRIES = 2;

        const total = imageObjects.length;
        const parsedBatch = new Array(total).fill(null);

        // ── Part 5: Exponential backoff with jitter ────────────────────────
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        /**
         * Determines if an error is retriable (network, 5xx only).
         * NEVER retries on 4xx, validation, or schema errors.
         */
        const isRetriableError = (err) => {
            if (!err) return false;
            const msg = err.message || '';
            // Retry on network failures or 5xx server errors
            if (err.name === 'TypeError' || msg.toLowerCase().includes('failed to fetch')) return true;
            const httpMatch = msg.match(/HTTP (\d+)/);
            if (httpMatch) {
                const status = parseInt(httpMatch[1]);
                return status >= 500; // Only 5xx
            }
            return false;
        };

        const queue = imageObjects.map((obj, i) => ({ ...obj, index: i, retries: 0 }));
        let activeExecutions = 0;
        const maxConcurrency = 2;

        return new Promise((resolve) => {
            const executeNext = async () => {
                if (queue.length === 0 && activeExecutions === 0) {
                    resolve(parsedBatch.filter(Boolean));
                    return;
                }

                // ── Part 4: Queue backpressure guard ──────────────────────
                if (queue.length > QUEUE_BACKPRESSURE_LIMIT) {
                    setProcessingStatus(`Queue backpressure: ${queue.length} jobs pending. Waiting for drain...`);
                    await sleep(2000);
                }

                while (queue.length > 0 && activeExecutions < maxConcurrency) {
                    const item = queue.shift();
                    activeExecutions++;
                    processItem(item).finally(() => {
                        activeExecutions--;
                        executeNext();
                    });
                }
            };

            const processItem = async (item) => {
                const { base64, label, index } = item;
                setProcessingStatus(`Marking script ${index + 1} of ${total}${total > 1 ? `: ${label}` : ''}...`);

                try {
                    const payload = {
                        mode: 'mark_script',
                        image: base64,
                        imageIndex: index,
                        markingScheme: markingScheme.questions,
                        geminiKey: import.meta.env.VITE_GEMINI_API_KEY
                    };
                    const payloadSize = Math.round(JSON.stringify(payload).length / 1024);
                    console.log(`[AI Scan] Sending script ${index + 1} (${label}). Size: ${payloadSize}KB`);

                    const response = await fetch(
                        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-test-ai`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                            },
                            body: JSON.stringify(payload)
                        }
                    );

                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        const err = new Error(errData.message || errData.error || `HTTP ${response.status}`);
                        err.httpStatus = response.status;
                        throw err;
                    }

                    const data = await response.json();
                    const resultsArray = data.results ? data.results : [data];

                    const studentData = resultsArray[0];
                    if (studentData) {
                        // ── Part 1: Bulletproof Normalized Question Mapping ────────────
                        // Build a precomputed O(n) normalized integer map of AI answers.
                        // This avoids quadratic find() calls and catches LLM format drift.
                        const aiAnswerMap = new Map();
                        const duplicateWarnings = [];

                        if (studentData.answers) {
                            studentData.answers.forEach(a => {
                                const normKey = normalizeQuestionNumber(a.question_number);
                                if (normKey === null) {
                                    console.warn('[OCR] AI returned answer with unparseable question_number:', a.question_number);
                                    return;
                                }
                                if (aiAnswerMap.has(normKey)) {
                                    // Part 1.3: Duplicate handling — keep FIRST, log warning
                                    duplicateWarnings.push({ normKey, duplicate: a });
                                    console.warn(`[OCR] Duplicate AI answer for Q${normKey} — keeping first occurrence`, a);
                                } else {
                                    aiAnswerMap.set(normKey, a);
                                }
                            });
                        }

                        if (duplicateWarnings.length > 0) {
                            console.warn(`[OCR] Script ${index + 1}: ${duplicateWarnings.length} duplicate answer(s) detected`, duplicateWarnings);
                        }

                        // Map each scheme question using the normalized map (O(1) lookup)
                        let unmapped = [];
                        const mappedAnswers = markingScheme.questions.map(q => {
                            const normQ = normalizeQuestionNumber(q.question_number);
                            const aiAns = normQ !== null ? aiAnswerMap.get(normQ) : undefined;
                            return {
                                question_number: q.question_number,
                                student_answer: aiAns?.student_answer || '',
                                is_correct: aiAns ? aiAns.is_correct : false,
                                feedback: aiAns?.feedback || (aiAns ? '' : 'Not found in extraction'),
                                confidence: aiAns?.confidence || 'Low',
                                topic: q.topic
                            };
                        });

                        // Find truly unmapped AI answers (those that never matched a scheme question)
                        const schemeNormSet = new Set(
                            markingScheme.questions.map(q => normalizeQuestionNumber(q.question_number)).filter(n => n !== null)
                        );
                        if (studentData.answers) {
                            studentData.answers.forEach(a => {
                                const normKey = normalizeQuestionNumber(a.question_number);
                                if (normKey === null || !schemeNormSet.has(normKey)) unmapped.push(a);
                            });
                        }

                        parsedBatch[index] = {
                            studentName: studentData.studentName || '',
                            studentId: studentData.student_id || '',
                            grade: studentData.grade || '',
                            imageIndex: index,
                            studentAnswers: mappedAnswers,
                            unmappedAnswers: unmapped,
                            // Part 6 telemetry metadata from Edge
                            _debugMeta: {
                                raw_llm_count: data.raw_llm_count,
                                repaired_count: data.repaired_count,
                                duplicate_count: duplicateWarnings.length,
                                validation_passed: data.validation_passed
                            }
                        };
                    }
                    advanceScanProgress();
                } catch (scriptError) {
                    // ── Part 5: Exponential backoff retry with jitter ─────────────────
                    // Only retry on retriable errors (network errors, 5xx). Never retry 4xx.
                    const canRetry = item.retries < MAX_RETRIES && isRetriableError(scriptError);
                    if (canRetry) {
                        const jitterFactor = 0.8 + Math.random() * 0.4; // ±20% jitter
                        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, item.retries) * jitterFactor;
                        console.warn(`[AI Scan] Script ${index + 1} failed (retry ${item.retries + 1}/${MAX_RETRIES}) in ${Math.round(delay)}ms`, scriptError.message);
                        item.retries++;
                        await sleep(delay);
                        queue.push(item);
                    } else {
                        console.error(`[AI Scan] Script ${index + 1} permanently failed (${scriptError.message || 'Unknown'})`);
                        parsedBatch[index] = {
                            studentName: `Unknown (${label})`,
                            studentId: '',
                            grade: '',
                            imageIndex: index,
                            _failed: true,
                            studentAnswers: markingScheme.questions.map(q => ({
                                question_number: q.question_number,
                                student_answer: '',
                                is_correct: false,
                                feedback: `Script failed: ${scriptError.message}`,
                                confidence: 'Low',
                                topic: q.topic
                            })),
                            unmappedAnswers: []
                        };
                        advanceScanProgress();
                    }
                }
            };

            executeNext();
        });
    };


    // ── Upload handler ───────────────────────────────────────────────────
    const handleFileUpload = async (event) => {
        const files = Array.from(event.target.files);
        if (files.length === 0 || !markingScheme) return;

        try {
            setIsProcessing(true);
            setProcessingError(null);
            setScanComplete(null);
            setScanMode('upload');
            setProcessingStatus('Reading files...');

            // Explode: images stay as single entries, PDFs split into per-page images
            const imageObjects = await explodeFilesToImages(files, setProcessingStatus);

            if (imageObjects.length === 0) {
                throw new Error('No readable images found. Please upload JPEG, PNG, or PDF files.');
            }

            setScanScriptCount(imageObjects.length);
            startScanProgress(imageObjects.length);

            // Store images now so lightbox works immediately
            const allBase64 = imageObjects.map(io => io.base64);
            setBatchImages(allBase64);
            setScannedImage(allBase64[0]);

            const parsedBatch = await processScriptImages(imageObjects);

            setCurrentReviewIndex(0);
            setBatchResults([]);
            setResults(null);
            completeScan(parsedBatch);
        } catch (error) {
            console.error('AI Processing Error:', error);
            clearScanTimers();
            const rawMessage = error?.message || 'Unknown error occurred.';

            let friendlyMessage = 'The AI was unable to read the document. Please ensure images are clear and well-lit.';
            if (rawMessage.includes('quota') || rawMessage.includes('429')) {
                friendlyMessage = 'The AI service is currently busy. Please wait a moment and try again.';
            } else if (rawMessage.includes('No readable images')) {
                friendlyMessage = rawMessage;
            } else if (rawMessage.includes('Failed to fetch')) {
                friendlyMessage = 'Could not connect to the AI servers. Please check your internet connection.';
            }

            setProcessingError({ title: 'Marking Failed', message: friendlyMessage, technicalDetails: rawMessage });
            setIsProcessing(false);
            setProcessingStatus('');
        }
    };




    const handleSaveResult = async (forceOverwrite = false) => {
        if (!reviewData) return;

        try {
            setIsProcessing(true);
            setProcessingStatus('Saving results...');

            const { studentName, studentId, grade, studentAnswers } = reviewData;

            // 1. Calculate Stats
            const correctCount = studentAnswers.filter(a => a.is_correct).length;
            const score = correctCount;
            const percentage = (correctCount / markingScheme.questions.length) * 100;

            // 2. Save or Get Pupil
            let pupilId;

            // First try matching exactly by student_id if provided
            let existingPupil = null;
            if (studentId) {
                const { data } = await supabase
                    .from('pupils')
                    .select('id, grade, student_id, name')
                    .eq('student_id', studentId)
                    .maybeSingle();
                existingPupil = data;
            }

            // Fallback to name match if no ID match found
            if (!existingPupil && studentName) {
                const { data } = await supabase
                    .from('pupils')
                    .select('id, grade, student_id, name')
                    .ilike('name', studentName) // use case-insensitive match
                    .maybeSingle();
                existingPupil = data;
            }

            if (existingPupil) {
                pupilId = existingPupil.id;

                // Only update the grade if it was missing
                const updates = {};
                if (!existingPupil.grade && grade) {
                    updates.grade = grade;
                }

                // Only update the student_id if it was missing (don't overwrite a good ID with a poorly scanned one)
                if (!existingPupil.student_id && studentId) {
                    updates.student_id = studentId;
                }

                if (Object.keys(updates).length > 0) {
                    await supabase.from('pupils').update(updates).eq('id', pupilId);
                }
            } else {
                const { data: newPupil, error: pError } = await supabase
                    .from('pupils')
                    .insert({ name: studentName, grade, student_id: studentId })
                    .select()
                    .single();
                if (pError) throw pError;
                pupilId = newPupil.id;
            }

            // 3. Check for existing result to Prevent Accidental Overwrites
            if (!forceOverwrite) {
                const { data: existingResult } = await supabase
                    .from('results')
                    .select('id, score')
                    .eq('test_id', testId)
                    .eq('pupil_id', pupilId)
                    .maybeSingle();

                if (existingResult) {
                    setIsProcessing(false);
                    setDuplicatePrompt({
                        studentName,
                        existingScore: existingResult.score,
                        newScore: score,
                        pupilId
                    });
                    return; // Pause the save process and wait for user decision
                }
            }

            // 4. Save Result (Insert or Overwrite confirmed)
            const resultPayload = {
                test_id: testId,
                pupil_id: pupilId,
                answers: studentAnswers,
                score,
                percentage
            };

            // 4a. Upload Scanned Copy if exists
            const studentImage = batchImages[reviewData.imageIndex] || scannedImage;
            if (studentImage) {
                try {
                    setProcessingStatus('Uploading scanned script...');
                    const mimeString = studentImage.split(',')[1] ? studentImage.split(',')[0].split(':')[1].split(';')[0] : 'image/jpeg';
                    const blob = base64ToBlob(studentImage);
                    const isPdf = mimeString === 'application/pdf';
                    const fileExt = isPdf ? 'pdf' : 'jpg';
                    const fileName = `scanned-exams/${testId}/${pupilId}_${Date.now()}.${fileExt}`;

                    const { error: uploadError } = await supabase.storage
                        .from('student-scripts')
                        .upload(fileName, blob, {
                            contentType: mimeString,
                            upsert: true
                        });

                    if (!uploadError) {
                        const { data: { publicUrl } } = supabase.storage
                            .from('student-scripts')
                            .getPublicUrl(fileName);
                        resultPayload.scanned_copy_url = publicUrl;
                        resultPayload.scanned_copy_mime = mimeString;
                    }
                    else {
                        console.error('Error uploading scanned image:', uploadError);
                    }
                } catch (uploadErr) {
                    console.error('Storage error:', uploadErr);
                }
            }

            const { data: result, error: resError } = await supabase
                .from('results')
                .upsert(resultPayload, { onConflict: 'test_id,pupil_id' })
                .select()
                .single();

            if (resError) throw resError;


            // 4. Generate Granular Analysis (Topic, Subtopic, Learning Outcome)
            const topicPerf = {};
            const subtopicPerf = {};
            const loPerf = {};

            markingScheme.questions.forEach(q => {
                const difficulty = q.difficulty || 'average';
                const studentAns = studentAnswers.find(a => a.question_number === q.question_number);
                const isCorrect = studentAns?.is_correct || false;

                const updatePerf = (perfMap, key, id) => {
                    if (!key) return;
                    if (!perfMap[key]) {
                        perfMap[key] = {
                            id: id,
                            correct: 0, total: 0,
                            easy_correct: 0, easy_total: 0,
                            average_correct: 0, average_total: 0,
                            hard_correct: 0, hard_total: 0,
                        };
                    }
                    const p = perfMap[key];
                    p.total++;
                    p[`${difficulty}_total`]++;
                    if (isCorrect) {
                        p.correct++;
                        p[`${difficulty}_correct`]++;
                    }
                };

                updatePerf(topicPerf, q.topic, q.topic_id);
                updatePerf(subtopicPerf, q.subtopic, q.subtopic_id);
                updatePerf(loPerf, q.learning_outcome, q.learning_outcome_id);
            });

            // Prepare Bulk Inserts
            const topicAnalysis = Object.entries(topicPerf).map(([name, data]) => ({
                result_id: result.id,
                topic: name,
                topic_id: data.id,
                total_questions: data.total,
                correct_answers: data.correct,
                percentage: (data.correct / data.total) * 100,
                easy_total: data.easy_total,
                easy_correct: data.easy_correct,
                average_total: data.average_total,
                average_correct: data.average_correct,
                hard_total: data.hard_total,
                hard_correct: data.hard_correct,
            }));

            const subtopicAnalysis = Object.entries(subtopicPerf)
                .filter(([_, data]) => data.id) // Only if linked to syllabus
                .map(([_, data]) => ({
                    result_id: result.id,
                    subtopic_id: data.id,
                    total_questions: data.total,
                    correct_answers: data.correct,
                    percentage: (data.correct / data.total) * 100,
                    easy_total: data.easy_total,
                    easy_correct: data.easy_correct,
                    average_total: data.average_total,
                    average_correct: data.average_correct,
                    hard_total: data.hard_total,
                    hard_correct: data.hard_correct,
                }));

            const loAnalysis = Object.entries(loPerf)
                .filter(([_, data]) => data.id) // Only if linked to syllabus
                .map(([_, data]) => ({
                    result_id: result.id,
                    learning_outcome_id: data.id,
                    total_questions: data.total,
                    correct_answers: data.correct,
                    percentage: (data.correct / data.total) * 100,
                    easy_total: data.easy_total,
                    easy_correct: data.easy_correct,
                    average_total: data.average_total,
                    average_correct: data.average_correct,
                    hard_total: data.hard_total,
                    hard_correct: data.hard_correct,
                }));

            // Save Analysis in Parallel
            await Promise.all([
                supabase.from('topic_analysis').delete().eq('result_id', result.id).then(() =>
                    topicAnalysis.length > 0 ? supabase.from('topic_analysis').insert(topicAnalysis) : null
                ),
                supabase.from('subtopic_analysis').delete().eq('result_id', result.id).then(() =>
                    subtopicAnalysis.length > 0 ? supabase.from('subtopic_analysis').insert(subtopicAnalysis) : null
                ),
                supabase.from('learning_outcome_analysis').delete().eq('result_id', result.id).then(() =>
                    loAnalysis.length > 0 ? supabase.from('learning_outcome_analysis').insert(loAnalysis) : null
                )
            ]);

            // 5. Success - Move to next or show final results
            const updatedBatchResults = [...batchResults, { ...reviewData, score, percentage }];
            setBatchResults(updatedBatchResults);
            setDuplicatePrompt(null);

            if (currentReviewIndex < reviewBatch.length - 1) {
                setCurrentReviewIndex(currentReviewIndex + 1);
            } else {
                setResults(updatedBatchResults);
                setReviewBatch(null);
                setCurrentReviewIndex(0);
            }
        } catch (error) {
            console.error('Error saving result:', error);
            alert(`Error saving: ${error.message}`);
        } finally {
            setIsProcessing(false);
            setProcessingStatus('');
        }
    };

    const updateReviewField = (field, value) => {
        const newBatch = [...reviewBatch];
        newBatch[currentReviewIndex] = { ...newBatch[currentReviewIndex], [field]: value };
        setReviewBatch(newBatch);
    };

    const updateReviewAnswer = (index, field, value) => {
        const newBatch = [...reviewBatch];
        const newAnswers = [...newBatch[currentReviewIndex].studentAnswers];
        const updatedAns = { ...newAnswers[index], [field]: value };

        // Re-evaluate correctness if student_answer changed
        if (field === 'student_answer') {
            const questionNumber = updatedAns.question_number;
            const originalQ = markingScheme.questions.find(q => q.question_number === questionNumber);
            if (originalQ) {
                updatedAns.is_correct = value.trim().toUpperCase() === originalQ.correct_answer.trim().toUpperCase();
            }
        }

        newAnswers[index] = updatedAns;
        newBatch[currentReviewIndex] = { ...newBatch[currentReviewIndex], studentAnswers: newAnswers };
        setReviewBatch(newBatch);
    };

    const triggerFileUpload = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*,application/pdf';
        input.onchange = handleFileUpload;
        input.click();
    };

    if (loading) return <div className="loading-container">Loading marking data...</div>;

    if (!markingScheme) {
        return (
            <div className="page page-with-container">
                <button className="back-button" onClick={() => navigate(`/teacher/test/${testId}`)}>
                    <ArrowLeft size={20} />
                    Back to Test
                </button>
                <div className="empty-state">
                    <AlertCircle size={48} className="icon-error" />
                    <h2>No Marking Scheme Found</h2>
                    <p>You must create or generate a marking scheme before you can mark student scripts.</p>
                    <button className="btn btn-primary" onClick={() => navigate(`/teacher/stream/${test.test_stream_id}/setup`)}>
                        Go to Setup
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="page page-with-container">
            <button className="back-button" onClick={() => navigate(`/teacher/test/${testId}`)}>
                <ArrowLeft size={20} />
                Back to Test
            </button>

            <div className="page-header">
                <h1>Mark {test.subject}</h1>
                <p className="subtitle">Upload student scripts for automatic marking</p>
                <datalist id="pupil-list">
                    {pupils.map(p => <option key={p.id} value={p.name} />)}
                </datalist>
            </div>

            {isCameraOpen && (
                <div className="camera-modal">
                    <div className="camera-content">
                        <div className="camera-header">
                            <h3>Document Scanner</h3>
                            <button className="btn-close" onClick={() => {
                                if (videoRef && videoRef.srcObject) {
                                    videoRef.srcObject.getTracks().forEach(track => track.stop());
                                }
                                setIsCameraOpen(false);
                            }}>×</button>
                        </div>
                        <div className="video-wrapper">
                            <video
                                ref={el => {
                                    setVideoRef(el);
                                    if (el && !el.srcObject) {
                                        navigator.mediaDevices.getUserMedia({
                                            video: {
                                                facingMode: 'environment',
                                                width: { ideal: 4096 },
                                                height: { ideal: 2160 },
                                                focusMode: 'continuous'
                                            }
                                        })
                                            .then(stream => { el.srcObject = stream; el.play(); })
                                            .catch(err => console.error("Camera error:", err));
                                    }
                                }}
                                autoPlay
                                playsInline
                            />
                            <div className="scanner-overlay">
                                <div className="scanner-frame"></div>
                                <div className="scanner-hint" style={{ position: 'absolute', top: '15%', left: '0', width: '100%', textAlign: 'center', color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', fontWeight: 500 }}>
                                    Tap to focus • Hold steady...
                                </div>
                                {isFlashActive && <div className="camera-flash" />}
                            </div>
                        </div>
                        <div className="camera-footer" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px', width: '100%', background: 'var(--bg-card)', zIndex: 10, position: 'absolute', bottom: 0, left: 0 }}>
                            {/* Scanned images strip ABOVE the action buttons */}
                            {capturedImages.length > 0 && (
                                <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
                                    {capturedImages.map((img, i) => (
                                        <div key={i} className="thumb-item captured">
                                            <img src={img} alt={`Capture ${i + 1}`} />
                                            <div className="thumb-count">{i + 1}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Button controls row (side-by-side if multiple) */}
                            <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                                <button
                                    className="btn btn-secondary"
                                    style={{ flex: 1, padding: '16px', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                    onClick={async (e) => {
                                        const btn = e.currentTarget;
                                        btn.disabled = true;

                                        // Phase 1: 400ms delay to allow physical stabilization and focus to settle
                                        await new Promise(r => setTimeout(r, 400));

                                        if (!videoRef || videoRef.videoWidth === 0) {
                                            btn.disabled = false;
                                            return;
                                        }

                                        // Trigge Flash
                                        setIsFlashActive(true);
                                        setTimeout(() => setIsFlashActive(false), 400);

                                        const canvas = document.createElement('canvas');
                                        const videoWidth = videoRef.videoWidth;
                                        const videoHeight = videoRef.videoHeight;

                                        // Calculate the A4 Crop Box (Matching .scanner-frame CSS: 80% width, 70% height)
                                        const cropWidth = videoWidth * 0.8;
                                        const cropHeight = videoHeight * 0.7;
                                        const cropX = (videoWidth - cropWidth) / 2;
                                        const cropY = (videoHeight - cropHeight) / 2;

                                        // Immediately downscale intelligently to prevent payload/memory bloat on bulk capture
                                        let targetWidth = cropWidth;
                                        let targetHeight = cropHeight;
                                        const MAX_CAPTURE_DIM = 1800;

                                        if (Math.max(cropWidth, cropHeight) > MAX_CAPTURE_DIM) {
                                            const scale = MAX_CAPTURE_DIM / Math.max(cropWidth, cropHeight);
                                            targetWidth = Math.round(cropWidth * scale);
                                            targetHeight = Math.round(cropHeight * scale);
                                        }

                                        canvas.width = targetWidth;
                                        canvas.height = targetHeight;

                                        const ctx = canvas.getContext('2d');
                                        ctx.imageSmoothingEnabled = true;
                                        ctx.imageSmoothingQuality = 'high';

                                        // Draw only the cropped portion, scaling it in the same pass
                                        ctx.drawImage(videoRef, cropX, cropY, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);

                                        // Extract as TRUE LOSSLESS PNG to completely eliminate double-encoding artifacts.
                                        // The Web Worker will handle the single, final JPEG 0.75 compression pass later.
                                        const rawBase64 = canvas.toDataURL('image/png');

                                        // Push to state array
                                        setCapturedImages(prev => [...prev, rawBase64]);
                                        btn.disabled = false;
                                    }}>
                                    <Camera size={24} />
                                    Scan
                                </button>

                                {capturedImages.length > 0 && (
                                    <button
                                        className="btn btn-primary"
                                        style={{ flex: 1, padding: '16px', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                        onClick={async () => {
                                            // Stop camera
                                            if (videoRef.srcObject) {
                                                videoRef.srcObject.getTracks().forEach(track => track.stop());
                                            }
                                            setIsCameraOpen(false);

                                            try {
                                                setScanMode('camera');
                                                setScanComplete(null);
                                                setIsProcessing(true);
                                                setProcessingStatus(`Enhancing ${capturedImages.length} image${capturedImages.length !== 1 ? 's' : ''}...`);

                                                // Phase 2/3/4: Enhance each camera image one by one using Web Worker to prevent memory spikes
                                                const imageObjects = [];
                                                for (let idx = 0; idx < capturedImages.length; idx++) {
                                                    const img = capturedImages[idx];
                                                    setProcessingStatus(`Enhancing image ${idx + 1} of ${capturedImages.length}...`);
                                                    await new Promise(r => setTimeout(r, 10)); // UI tick
                                                    let enhancedBase64 = img;
                                                    try {
                                                        const result = await processForVLM(img, true); // Use faint-text assist
                                                        enhancedBase64 = await blobToBase64(result.blob);
                                                    } catch (err) {
                                                        console.error("Worker enhancement failed:", err);
                                                    }
                                                    imageObjects.push({ base64: enhancedBase64, label: `Photo ${idx + 1}` });
                                                }

                                                const allBase64 = imageObjects.map(io => io.base64);
                                                setScanScriptCount(imageObjects.length);
                                                startScanProgress(imageObjects.length);
                                                setBatchImages(allBase64);
                                                setScannedImage(allBase64[0]);

                                                const parsedBatch = await processScriptImages(imageObjects);

                                                setCurrentReviewIndex(0);
                                                setBatchResults([]);
                                                setResults(null);
                                                setCapturedImages([]);
                                                completeScan(parsedBatch);
                                            } catch (error) {
                                                console.error('Scan Error:', error);
                                                clearScanTimers();
                                                const rawMessage = error?.message || 'Unknown error occurred.';
                                                setProcessingError({ title: 'Scan Failed', message: 'The camera scan could not be processed. Please ensure the images are clear and try again.', technicalDetails: rawMessage });
                                                setIsProcessing(false);
                                                setProcessingStatus('');
                                            }
                                        }}>
                                        <CheckCircle size={24} />
                                        Process ({capturedImages.length})
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── PREMIUM SCANNING CARD ─────────────────────────── */}
            {isProcessing && (
                <div className="scan-card" key="scanning">
                    <div className="scan-orb-wrap">
                        <div className="scan-orb">
                            <div className="scan-ring scan-ring-1" />
                            <div className="scan-ring scan-ring-2" />
                            <Sparkles size={28} className="scan-orb-icon" />
                        </div>
                    </div>
                    <div className="scan-card-body">
                        <p className="scan-script-chip">{scanScriptCount} script{scanScriptCount !== 1 ? 's' : ''} · AI Analysis in Progress</p>
                        <h3 className="scan-phase-label">{currentSteps[scanPhase]?.label}</h3>
                        <p className="scan-phase-detail">{currentSteps[scanPhase]?.detail}</p>

                        {/* Real fill progress bar */}
                        <div className="scan-bar-wrap">
                            <div
                                className="scan-bar-fill"
                                style={{ width: `${scanProgress}%` }}
                            />
                        </div>
                        <div className="scan-bar-meta">
                            <span className="scan-bar-stage">{currentSteps[scanPhase]?.label}</span>
                            <span className="scan-bar-pct">{scanProgress}%</span>
                        </div>
                    </div>
                </div>
            )}

            {/* ── SCAN SUCCESS BEAT ─────────────────────────────── */}
            {scanComplete?.success && !isProcessing && !reviewData && (
                <div className="scan-complete-card" key="complete">
                    <div className="scan-check-wrap">
                        <svg viewBox="0 0 52 52" className="scan-check-svg">
                            <circle className="scan-check-circle" cx="26" cy="26" r="24" />
                            <path className="scan-check-mark" d="M14 27 l8 8 l16 -16" />
                        </svg>
                    </div>
                    <div className="scan-complete-body">
                        <h3>Scan Complete</h3>
                        <p className="scan-complete-count">{scanComplete.count} script{scanComplete.count !== 1 ? 's' : ''} extracted successfully</p>
                        {scanComplete.warnings > 0 && (
                            <p className="scan-complete-warn">
                                <AlertCircle size={14} />
                                {scanComplete.warnings} answer{scanComplete.warnings !== 1 ? 's' : ''} had low confidence — review carefully
                            </p>
                        )}
                        <button
                            className="btn btn-primary scan-review-btn"
                            onClick={() => {
                                setReviewBatch(scanComplete.batch);
                                setScanComplete(null);
                            }}
                        >
                            <FileCheck size={18} />
                            Review Results
                        </button>
                    </div>
                </div>
            )}

            {/* ── SCAN ERROR CARD ───────────────────────────────── */}
            {processingError && !isProcessing && !reviewData && !results && (
                <div className="scan-error-card">
                    <div className="scan-error-icon-wrap">
                        <AlertCircle size={32} />
                    </div>
                    <div className="scan-error-body">
                        <h3>{processingError.title}</h3>
                        <p>{processingError.message}</p>
                        {processingError.technicalDetails && (
                            <details className="scan-error-details">
                                <summary>Technical Details</summary>
                                <code>{processingError.technicalDetails}</code>
                            </details>
                        )}
                        <button className="btn btn-secondary" onClick={() => setProcessingError(null)}>
                            <X size={16} /> Dismiss &amp; Try Again
                        </button>
                    </div>
                </div>
            )}

            {!reviewData && !results && !isProcessing && !processingError && (
                <div className="mark-options">
                    <div className="mark-option-card" onClick={() => setIsCameraOpen(true)}>
                        <div className="option-icon">
                            <Camera size={48} strokeWidth={1.5} />
                        </div>
                        <h3>Scan Script</h3>
                        <p>Use your camera to scan student answer sheet</p>
                    </div>
                    <div className="mark-option-card" onClick={triggerFileUpload}>
                        <div className="option-icon">
                            <Upload size={48} strokeWidth={1.5} />
                        </div>
                        <h3>Upload Image</h3>
                        <p>Upload a photo or PDF from your gallery</p>
                    </div>
                </div>
            )}

            {reviewData && !results && (
                <div className="review-interface">
                    <div className="review-header">
                        <h2>Review Extraction ({currentReviewIndex + 1} of {reviewBatch.length})</h2>
                        <div className="review-actions">
                            <button className="btn btn-secondary" onClick={() => { setReviewBatch(null); setBatchResults([]); }}>Cancel</button>
                            <button className="btn btn-primary" onClick={() => handleSaveResult(false)}>
                                {currentReviewIndex < reviewBatch.length - 1 ? 'Save & Next' : 'Confirm & Save All'}
                            </button>
                        </div>
                    </div>

                    <div className="review-content vertically-stacked">
                        <button
                            className="btn btn-secondary"
                            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                            onClick={() => setShowLightbox(true)}
                        >
                            <Camera size={20} /> View Scanned Script
                        </button>

                        <div className="review-data-pane" style={{ width: '100%', flexDirection: 'column' }}>
                            <div className="student-info-review">
                                <div className="field-group">
                                    <label>Student Name</label>
                                    <input
                                        type="text"
                                        list="pupil-list"
                                        value={reviewData.studentName}
                                        onChange={(e) => updateReviewField('studentName', e.target.value)}
                                        placeholder="Enter student name"
                                        className="student-name-input"
                                    />
                                </div>
                                <div className="info-grid">
                                    <div className="field-group">
                                        <label>Student ID</label>
                                        <input
                                            type="text"
                                            value={reviewData.studentId}
                                            onChange={(e) => updateReviewField('studentId', e.target.value)}
                                            placeholder="Extracted ID"
                                        />
                                    </div>
                                    <div className="field-group">
                                        <label>Grade</label>
                                        <input
                                            type="text"
                                            value={reviewData.grade}
                                            onChange={(e) => updateReviewField('grade', e.target.value)}
                                            placeholder="Extracted Grade"
                                        />
                                    </div>
                                </div>
                            </div>

                            <button
                                className="btn"
                                style={{
                                    width: '100%',
                                    marginTop: '16px',
                                    marginBottom: '16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    background: 'var(--color-bg-secondary)',
                                    border: '2px solid var(--color-border)',
                                    color: 'var(--color-text-primary)'
                                }}
                                onClick={() => setShowAnswers(!showAnswers)}
                            >
                                <span style={{ fontWeight: 'bold' }}>{showAnswers ? 'Hide Answer Sheets' : 'View Answer Sheets'}</span>
                                {showAnswers ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                            </button>

                            {duplicatePrompt && (
                                <div className="duplicate-alert" style={{
                                    marginTop: '24px', padding: '20px', borderRadius: '12px',
                                    background: 'var(--color-bg-secondary)', border: '2px solid var(--color-accent-primary)',
                                    textAlign: 'center'
                                }}>
                                    <AlertCircle size={32} color="var(--color-accent-primary)" style={{ margin: '0 auto 12px' }} />
                                    <h3 style={{ color: 'var(--color-text-primary)', marginBottom: '8px', margin: 0 }}>Existing Score Found</h3>
                                    <p style={{ margin: '0 0 16px 0', color: 'var(--color-text-secondary)' }}>
                                        <strong>{duplicatePrompt.studentName}</strong> already has a saved score of {duplicatePrompt.existingScore}/{markingScheme.questions.length} for this test.
                                        <br />This new scan scored {duplicatePrompt.newScore}/{markingScheme.questions.length}.
                                    </p>
                                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                                        <button className="btn btn-secondary" onClick={() => {
                                            setDuplicatePrompt(null);
                                            // Handle Skip: move to next student in batch
                                            if (currentReviewIndex < reviewBatch.length - 1) {
                                                setCurrentReviewIndex(currentReviewIndex + 1);
                                            } else {
                                                setResults(batchResults);
                                                setReviewBatch(null);
                                            }
                                        }}>
                                            Skip & Keep Old Score
                                        </button>
                                        <button className="btn btn-primary" style={{ background: 'var(--color-accent-primary)' }} onClick={() => handleSaveResult(true)}>
                                            Update with New Score
                                        </button>
                                    </div>
                                </div>
                            )}

                            {showAnswers && (
                                <>
                                    <h3>Verification</h3>
                                    <div className="review-answers-list" style={{ width: '100%' }}>
                                        {reviewData.studentAnswers.map((ans, idx) => (
                                            <div key={idx} className={`review-item ${ans.confidence === 'Low' || !ans.student_answer ? 'review-warning' : ''}`}>
                                                <div className="review-item-header">
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span className="q-circle">Q{ans.question_number}</span>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Conf: {ans.confidence}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        {(!ans.student_answer || ans.feedback?.toLowerCase().includes('not found')) && (
                                                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#dc2626', background: '#fee2e2', padding: '3px 8px', borderRadius: '12px', border: '1px solid #fca5a5' }}>
                                                                Not Found
                                                            </span>
                                                        )}
                                                        <span className={`status-badge ${ans.is_correct ? 'correct' : 'incorrect'}`}>
                                                            {ans.is_correct ? 'Correct' : 'Incorrect'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="review-item-body">
                                                    <div className="field-group">
                                                        <label>Extracted Answer</label>
                                                        <input
                                                            type="text"
                                                            value={ans.student_answer}
                                                            onChange={(e) => updateReviewAnswer(idx, 'student_answer', e.target.value)}
                                                        />
                                                    </div>
                                                    {ans.feedback && (
                                                        <div className="review-note">
                                                            <strong>AI Note:</strong> {ans.feedback}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {reviewData.unmappedAnswers?.length > 0 && (
                                        <div className="unmapped-answers-dump" style={{ marginTop: '20px', padding: '16px', background: '#fdf2f8', border: '1px solid #fbcfe8', borderRadius: '8px' }}>
                                            <h4 style={{ color: '#be185d', marginBottom: '8px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <AlertCircle size={16} />
                                                Unmapped AI Answers ({reviewData.unmappedAnswers.length})
                                            </h4>
                                            <p style={{ fontSize: '0.8rem', color: '#831843', marginBottom: '12px' }}>
                                                The AI extracted the following answers but could not match them to a question number in the marking scheme. These were ignored during grading. Use this dump to diagnose what it saw.
                                            </p>
                                            <pre style={{ fontSize: '0.75rem', color: '#9d174d', background: '#fce7f3', padding: '12px', borderRadius: '6px', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                                                {JSON.stringify(reviewData.unmappedAnswers, null, 2)}
                                            </pre>
                                        </div>
                                    )}

                                    {/* Part 6.2: AI Debug Panel — shown when Edge reports anomalies */}
                                    {(() => {
                                        const meta = reviewData._debugMeta;
                                        if (!meta) return null;
                                        const hasAnomalies = meta.repaired_count > 0 || meta.duplicate_count > 0 || meta.validation_passed === false;
                                        const hasLowConfidenceCluster = reviewData.studentAnswers?.filter(a => a.confidence === 'Low').length >= 3;
                                        if (!hasAnomalies && !hasLowConfidenceCluster) return null;
                                        return (
                                            <details style={{ marginTop: '20px', border: '1px solid #fbbf24', borderRadius: '8px', overflow: 'hidden' }}>
                                                <summary style={{
                                                    padding: '12px 16px',
                                                    background: '#fffbeb',
                                                    color: '#92400e',
                                                    cursor: 'pointer',
                                                    fontWeight: 600,
                                                    fontSize: '0.88rem',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    listStyle: 'none'
                                                }}>
                                                    <AlertCircle size={15} />
                                                    AI Debug Details
                                                    {meta.repaired_count > 0 && <span style={{ background: '#fde68a', color: '#78350f', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>{meta.repaired_count} repaired</span>}
                                                    {meta.duplicate_count > 0 && <span style={{ background: '#fed7aa', color: '#7c2d12', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>{meta.duplicate_count} duplicates</span>}
                                                    {hasLowConfidenceCluster && <span style={{ background: '#fee2e2', color: '#7f1d1d', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>Low confidence cluster</span>}
                                                </summary>
                                                <div style={{ padding: '16px', background: '#fefce8' }}>
                                                    <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                                                        <tbody>
                                                            <tr><td style={{ padding: '4px 8px', color: '#78350f', width: '60%' }}>Raw LLM answer count</td><td style={{ fontWeight: 600 }}>{meta.raw_llm_count ?? '—'}</td></tr>
                                                            <tr><td style={{ padding: '4px 8px', color: '#78350f' }}>Auto-repaired missing answers</td><td style={{ fontWeight: 600, color: meta.repaired_count > 0 ? '#b45309' : '#16a34a' }}>{meta.repaired_count ?? '—'}</td></tr>
                                                            <tr><td style={{ padding: '4px 8px', color: '#78350f' }}>Duplicate question numbers</td><td style={{ fontWeight: 600, color: meta.duplicate_count > 0 ? '#b45309' : '#16a34a' }}>{meta.duplicate_count ?? '—'}</td></tr>
                                                            <tr><td style={{ padding: '4px 8px', color: '#78350f' }}>Edge validation passed</td><td style={{ fontWeight: 600, color: meta.validation_passed ? '#16a34a' : '#dc2626' }}>{meta.validation_passed === true ? 'Yes' : meta.validation_passed === false ? 'No' : '—'}</td></tr>
                                                            <tr><td style={{ padding: '4px 8px', color: '#78350f' }}>Low confidence answers</td><td style={{ fontWeight: 600 }}>{reviewData.studentAnswers?.filter(a => a.confidence === 'Low').length ?? '—'}</td></tr>
                                                        </tbody>
                                                    </table>
                                                    {meta.repaired_count > 0 && (
                                                        <p style={{ marginTop: '10px', fontSize: '0.78rem', color: '#92400e', background: '#fde68a', padding: '8px 12px', borderRadius: '6px' }}>
                                                            ⚠️ {meta.repaired_count} question(s) were not found in the AI response and were auto-filled as "Unanswered". Check the scan quality and re-scan if needed.
                                                        </p>
                                                    )}
                                                </div>
                                            </details>
                                        );
                                    })()}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── BATCH COMPLETE RESULTS CARD ───────────────────── */}
            {results && (
                <div className="scan-batch-done">
                    <div className="scan-batch-done-header">
                        <div className="scan-batch-check">
                            <CheckCircle size={28} />
                        </div>
                        <div>
                            <h2>Batch Marking Complete</h2>
                            <p>{results.length} script{results.length !== 1 ? 's' : ''} saved successfully</p>
                        </div>
                    </div>

                    <div className="scan-result-list">
                        {results.map((res, rIdx) => {
                            const pct = res.percentage ?? 0;
                            const tier = pct >= 80 ? 'excellent' : pct >= 65 ? 'good' : pct >= 50 ? 'average' : 'weak';
                            return (
                                <div key={rIdx} className="scan-result-row">
                                    <div className="scan-result-info">
                                        <span className="scan-result-name">{res.studentName || 'Unknown'}</span>
                                        <span className="scan-result-fraction">{res.score}/{markingScheme.questions.length} marks</span>
                                    </div>
                                    <span className={`mini-badge ${tier}`}>{pct.toFixed(1)}%</span>
                                </div>
                            );
                        })}
                    </div>

                    <div className="scan-batch-actions">
                        <button className="btn btn-primary" onClick={() => { setResults(null); setBatchResults([]); setScanComplete(null); }}>
                            <Camera size={16} /> Mark More Scripts
                        </button>
                        <button className="btn btn-secondary" onClick={() => navigate(`/teacher/test/${testId}`)}>
                            View All Results
                        </button>
                    </div>
                </div>
            )}



            {showLightbox && (
                <div className="lightbox-overlay" onClick={() => setShowLightbox(false)}>
                    <div className="lightbox-content" onClick={e => e.stopPropagation()}>
                        <button className="lightbox-close" onClick={() => setShowLightbox(false)}>×</button>
                        {batchImages[currentReviewIndex]
                            ? <img src={batchImages[currentReviewIndex]} alt="Full Screen Scan" />
                            : scannedImage
                                ? <img src={scannedImage} alt="Full Screen Scan" />
                                : <p style={{ color: 'white', padding: '32px' }}>No image available for this script.</p>
                        }
                    </div>
                </div>
            )}

            <div className="info-box">
                <h4>💡 Production Hint</h4>
                <p>
                    For best results, ensure:
                </p>
                <ul>
                    <li>Student name is clearly written after "Name:"</li>
                    <li>Answers are numbered (1. A, 2. B, etc.)</li>
                    <li>The image is clear and well-lit</li>
                </ul>
            </div>
        </div>
    );
}
