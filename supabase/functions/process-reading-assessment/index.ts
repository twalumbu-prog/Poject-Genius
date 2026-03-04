import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
}

function cleanAndParseJson(text: string) {
    const cleaned = text.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.error("Failed to parse AI JSON:", text);
        throw e;
    }
}

async function callGeminiAudio(audioData: string, mimeType: string, passageText: string, apiKey: string) {
    const model = "gemini-2.0-flash-001";
    const payload = {
        contents: [{
            parts: [
                {
                    text: `You are an expert reading fluctuating specialist. 
Analyze this audio recording of a student reading the following passage:

Passage: "${passageText}"

Task:
1. Transcribe the audio word-for-word.
2. For EVERY word in the TRANSCRIPT, identify which word in the PASSAGE it matches.
3. Provide word-level timestamps (start and end in seconds).
4. Identify mispronunciations, omissions, or insertions.
5. Calculate overall Words Per Minute (WPM) and Accuracy %.
6. Provide a diagnostic summary (strengths, weaknesses, interventions).

Respond ONLY with a valid JSON object following this schema:
{
  "transcription": [{ "word": "string", "start": 0.0, "end": 0.5, "is_correct": true, "error_type": null, "spoken": "string", "confidence": 0.0 }],
  "metrics": {
    "count_total": 0,
    "count_correct": 0,
    "wpm": 0,
    "accuracy_percentage": 0,
    "fluency_score": 0
  },
  "analysis": {
    "strengths": ["string"],
    "weaknesses": ["string"],
    "interventions": ["string"],
    "reading_level_estimate": "string"
  }
}` },
                { inline_data: { mime_type: mimeType, data: audioData } }
            ]
        }],
        generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
        }
    };

    const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }
    );

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`Gemini Error ${resp.status}: ${JSON.stringify(err)}`);
    }

    const result = await resp.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");

    return cleanAndParseJson(text);
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { status: 200, headers: CORS_HEADERS });
    }

    try {
        console.log(`[${req.method}] Request received`);
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        let body;
        try {
            body = await req.json();
            console.log("Body parsed successfully:", JSON.stringify(body));
        } catch (e) {
            console.error("Failed to parse request body:", e);
            return jsonResponse({ error: "Invalid JSON body" }, 400);
        }

        const { mode, audioUrl, passageText, passageId, pupilId, teacherId, sessionId, geminiKey, genParams } = body;

        const apiKey = geminiKey || GEMINI_API_KEY;
        if (!apiKey) throw new Error("No Gemini API key configured");

        if (mode === "generate_passage") {
            const { grade, level, length, focus } = genParams;
            const model = "gemini-2.0-flash-001";
            const prompt = `You are an expert curriculum designer for the Zambian Ministry of Education.
Generate a reading passage for a ${grade} student.
Difficulty Level: ${level}
Length: Approximately ${length} words
Focus area: ${focus}

Requirements:
1. Content must be culturally relevant to students in Zambia (use local names, settings, or themes).
2. Use vocabulary and sentence structures appropriate for ${grade}.
3. The story must be engaging and educational.

Return ONLY a valid JSON object:
{
  "title": "string",
  "text": "string",
  "word_count": 0,
  "grade": "${grade}",
  "level": "${level}"
}`;

            console.log("Generating passage with params:", genParams);
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.7, responseMimeType: "application/json" }
                    })
                }
            );

            if (!resp.ok) {
                const errorText = await resp.text();
                console.error("Gemini AI generation failed:", resp.status, errorText);
                throw new Error(`AI generation failed: ${resp.status} - ${errorText}`);
            }

            const result = await resp.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
            console.log("AI Response text:", text);
            return jsonResponse(cleanAndParseJson(text));
        }

        // Process Reading Case
        if (mode === "process_reading" || !mode) {
            if (!audioUrl || !passageText || !passageId || !pupilId) {
                throw new Error("Missing required parameters (audioUrl, passageText, passageId, pupilId)");
            }

            // 1. Download audio from storage
            const pathMatch = audioUrl.match(/reading-audio\/(.+)$/);
            const path = pathMatch ? pathMatch[1] : audioUrl;

            const { data: audioBlob, error: downloadError } = await supabaseClient
                .storage
                .from("reading-audio")
                .download(path);

            if (downloadError) throw new Error(`Failed to download audio: ${downloadError.message}`);

            // 2. Convert Blob to Base64
            const arrayBuffer = await audioBlob.arrayBuffer();
            const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
            const mimeType = audioBlob.type || "audio/webm";

            // 3. Process with Gemini
            const analysisResults = await callGeminiAudio(base64Audio, mimeType, passageText, apiKey);

            // 4. Save to Database
            const sessionData = {
                passage_id: passageId,
                pupil_id: pupilId,
                audio_url: audioUrl,
                duration_seconds: analysisResults.transcription[analysisResults.transcription.length - 1]?.end || 0,
                words_per_minute: analysisResults.metrics.wpm,
                accuracy_percentage: analysisResults.metrics.accuracy_percentage,
                fluency_score: analysisResults.metrics.fluency_score,
                raw_analysis: analysisResults.analysis,
            };

            let currentSessionId = sessionId;
            if (currentSessionId) {
                const { error: updateError } = await supabaseClient
                    .from("reading_sessions")
                    .update(sessionData)
                    .eq("id", currentSessionId);
                if (updateError) throw updateError;
            } else {
                const { data: newSession, error: insertError } = await supabaseClient
                    .from("reading_sessions")
                    .insert(sessionData)
                    .select()
                    .single();
                if (insertError) throw insertError;
                currentSessionId = newSession.id;
            }

            // Word-Level Analysis
            const wordAnalyses = analysisResults.transcription.map((w: any, idx: number) => ({
                session_id: currentSessionId,
                word_index: idx,
                expected_word: w.word,
                spoken_word: w.spoken || w.word,
                start_time: w.start,
                end_time: w.end,
                is_correct: w.is_correct,
                confidence: w.confidence,
                error_type: w.error_type,
            }));

            if (sessionId) {
                await supabaseClient.from("word_level_analysis").delete().eq("session_id", currentSessionId);
            }

            const { error: wordInsertError } = await supabaseClient
                .from("word_level_analysis")
                .insert(wordAnalyses);

            if (wordInsertError) throw wordInsertError;

            return jsonResponse({
                sessionId: currentSessionId,
                ...analysisResults
            });
        }

        return jsonResponse({ error: "Invalid mode" }, 400);

    } catch (error: any) {
        console.error("Reading Assessment Error:", error);
        return jsonResponse({ error: error.message }, 500);
    }
});
