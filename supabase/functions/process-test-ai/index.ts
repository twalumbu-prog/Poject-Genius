import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash-exp",
  "gemini-1.5-pro",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Normalizes question number representations from AI to extract the first integer.
 * Handles "1", " 1 ", "Q1", "01", "4a" -> always returns an integer.
 * @param value The raw string/number from AI
 * @returns {number|null} The cleanly parsed integer or null
 */
function normalizeQuestionNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Math.floor(value);
  const str = String(value).trim();
  const match = str.match(/\d+/);
  if (match) return parseInt(match[0], 10);
  return null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function cleanRepairAndParseJson(text: string) {
  let cleaned = text.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Parse failed. Attempting robust repair...", e);

    // Auto-repair common LLM JSON generation errors

    // 1. Remove trailing commas before closing braces/brackets
    cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

    // 2. Fix unescaped internal quotes (heuristic: quote inside a string value)
    // This is hard to do perfectly with regex but we can try to escape quotes
    // that are preceded by word characters and followed by word characters or spaces
    cleaned = cleaned.replace(/(\w|\s)"(\w|\s)/g, '$1\\"$2');

    // 3. Fix unescaped newlines within strings (Gemini often does this in explanations)
    cleaned = cleaned.replace(/(?<=:\s*")(.*?)(?="[,\n}])/gs, (match) => {
      return match.replace(/\n/g, "\\n").replace(/\r/g, "");
    });

    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      console.error("Robust repair failed. Raw substring around error:", cleaned.substring(Math.max(0, cleaned.length - 200)));
      throw new Error(`AI returned invalid JSON: ${(e2 as Error).message}`);
    }
  }
}

async function callGemini(messages: any[], apiKey: string) {
  const parts = messages.filter(m => m.role === "user").flatMap((msg: any) => {
    if (typeof msg.content === "string") return [{ text: msg.content }];
    return msg.content.map((p: any) => {
      if (p.type === "text") return { text: p.text };
      if (p.type === "image_url") {
        const url = p.image_url.url || p.image_url;
        const match = url.match(/^data:(.+?);base64,(.+)$/);
        if (match) return { inline_data: { mime_type: match[1], data: match[2] } };
        throw new Error("Invalid image_url format");
      }
      return p;
    });
  });

  const systemMessage = messages.find(m => m.role === "system")?.content || "";

  // Check total base64 payload size
  let totalBytes = 0;
  for (const part of parts) {
    if (part.inline_data) {
      totalBytes += (part.inline_data.data.length * 0.75); // base64 to byte approximation
    }
  }

  if (totalBytes > 0) {
    console.log(`[Gemini] Payload contains ~${Math.round(totalBytes / 1024)}KB of image data`);
    if (totalBytes > 4.5 * 1024 * 1024) {
      console.warn(`[Gemini] WARNING: Base64 payload is very large (>4.5MB). Vercel edge may timeout or 413, Supabase may reject.`);
    }
  }

  const payload = {
    system_instruction: { parts: [{ text: systemMessage }] },
    contents: [{ role: "user", parts }],
    // Important: responseMimeType: "application/json" instructs Gemini to guarantee JSON
    // but we use temperature 0.2 to limit wild hallucinations
    generationConfig: { temperature: 0.2, topK: 40, topP: 0.95, maxOutputTokens: 8192, responseMimeType: "application/json" },
  };

  let lastError: Error | null = null;
  for (const model of GEMINI_MODELS) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (resp.status === 429) throw { isQuotaError: true, retryAfter: 15, message: "Quota exceeded" };
      if (resp.status === 404 || resp.status === 400) { lastError = new Error(`Model ${model} unavailable`); continue; }
      throw new Error(`Gemini ${resp.status}: ${JSON.stringify(err)}`);
    }
    const result = await resp.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");
    console.log(`✅ ${model} succeeded`);
    return cleanRepairAndParseJson(text);
  }
  throw lastError || new Error("All Gemini models unavailable");
}

async function callClaude(messages: any[], apiKey: string) {
  const systemPrompt = messages.filter(m => m.role === "system").map((m: any) => m.content).join("\n");
  const claudeMessages = messages.filter(m => m.role === "user").map((msg: any) => {
    if (typeof msg.content === "string") return { role: "user", content: msg.content };
    return {
      role: "user",
      content: msg.content.map((p: any) => {
        if (p.type === "text") return { type: "text", text: p.text };
        if (p.type === "image_url") {
          const url = p.image_url.url || p.image_url;
          const match = url.match(/^data:(.+?);base64,(.+)$/);
          if (match) return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
        }
        return p;
      }),
    };
  });
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-3-5-sonnet-20241022", max_tokens: 4096, system: systemPrompt + " Always respond with valid JSON.", messages: claudeMessages }),
  });
  if (!resp.ok) throw new Error("Claude " + resp.status + ": " + await resp.text());
  return cleanRepairAndParseJson((await resp.json()).content[0].text);
}

async function callAI(messages: any[], keys: { gemini?: string; claude?: string } = {}) {
  const errors: string[] = [];
  const gKey = keys.gemini || GEMINI_API_KEY;
  if (gKey) {
    try { return { result: await callGemini(messages, gKey), provider: "gemini" }; }
    catch (e: any) { if (e.isQuotaError) throw e; errors.push("Gemini: " + e.message); }
  }
  const cKey = keys.claude || ANTHROPIC_API_KEY;
  if (cKey) {
    try { return { result: await callClaude(messages, cKey), provider: "claude" }; }
    catch (e: any) { errors.push("Claude: " + e.message); }
  }
  throw new Error("All AI providers failed: " + errors.join(" | "));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS_HEADERS });

  try {
    const body = await req.json();
    const { mode, image, images, markingScheme, target_questions, testParams, geminiKey } = body;
    const buildParts = () => (images || (image ? [image] : [])).map((img: string) => ({ type: "image_url", image_url: { url: img } }));

    if (!(geminiKey || GEMINI_API_KEY) && !ANTHROPIC_API_KEY) return jsonResponse({ error: "No API keys configured" }, 500);

    let messages: any[] = [];

    if (mode === "generate_test") {
      if (!testParams) throw new Error("testParams is required");
      const { subject, grade, topics, difficulty, existingQuestions } = testParams;
      let topicList = "", total = 0;
      if (Array.isArray(topics)) {
        topicList = topics.map((t: any) => `${t.name}(${t.count})`).join(", ");
        total = topics.reduce((s: number, t: any) => s + (parseInt(t.count) || 0), 0);
      }
      else {
        topicList = testParams.topic;
        total = testParams.numQuestions;
      }
      const cog = difficulty === "Basic" ? "recall & understanding" : difficulty === "Advanced" ? "analysis & evaluation" : "application & interpretation";
      messages = [
        {
          role: "system", content: `Expert curriculum designer for Zambian Ministry of Education. Generate strictly valid JSON.
CRITICAL INSTRUCTION: You MUST generate EXACTLY ${total} questions. Do not stop early. Do not skip any.
Schema: {"questions":[{"question_text":"string","type":"multiple_choice","options":["A","B","C","D"],"correct_answer":"A","marks":1,"topic":"string","subtopic":"string","learning_outcome":"string","cognitive_level":"string","difficulty_score":5,"explanation":"string"}]}` },
        { role: "user", content: "Generate EXACTLY " + total + " " + difficulty + " " + subject + " questions for " + grade + ". Topics: " + topicList + ". Identify specific subtopic and learning_outcome for each." + (existingQuestions?.length > 0 ? " Avoid: " + existingQuestions.join(", ") : "") },
      ];
    } else if (mode === "generate_key") {
      if (!image) throw new Error("image required");
      messages = [
        { role: "system", content: `Expert OCR analyzer. Respond with strictly valid JSON.\nSchema: {"questions":[{"question_number":1,"question_text":"string","options":["string"],"correct_answer":"string","topic":"string","subtopic":"string","learning_outcome":"string"}],"topic_summary":{"Topic":1}}` },
        { role: "user", content: [{ type: "text", text: "Extract all questions from this test paper per the JSON schema." }, ...buildParts()] },
      ];
    } else if (mode === "mark_script") {
      if (!image && (!images || images.length === 0)) throw new Error("image required");
      if (!markingScheme) throw new Error("markingScheme required");

      let filteredScheme = markingScheme;
      if (target_questions && Array.isArray(target_questions) && target_questions.length > 0) {
        filteredScheme = markingScheme.filter((item: any) => {
          const qNumStr = String(item.question_number).trim();
          const qNum = parseInt(qNumStr.match(/\d+/)?.[0] || "0", 10);
          return target_questions.includes(qNum);
        });
        // Fallback if none matched (e.g. malformed scheme)
        if (filteredScheme.length === 0) filteredScheme = markingScheme;
      }

      const schemeText = JSON.stringify(filteredScheme, null, 2);
      const questionCount = filteredScheme.length;

      messages = [
        {
          role: "system",
          content: "You are an expert examiner grading a student's handwritten test script.\n" +
            "Respond with STRICTLY VALID JSON only — no markdown, no commentary.\n\n" +
            "CRITICAL RULES:\n" +
            "1. The marking scheme contains EXACTLY " + questionCount + " questions.\n" +
            "2. You MUST return EXACTLY " + questionCount + " objects in the answers array.\n" +
            "3. NEVER return fewer items.\n" +
            "4. NEVER stop early.\n" +
            "5. NEVER omit a question. If a question in the scheme uses shaded bubbles (OMR), DO NOT process it yourself unless it is completely ambiguous. Focus ONLY on handwriting, short text, or numeric extraction.\n" +
            "6. The `question_number` MUST be an integer exactly matching the scheme. Do NOT output strings like \"1\", output 1.\n" +
            "7. If an answer is missing, unclear, or illegible, you MUST still return the object and set:\n" +
            "   * student_answer: \"Unanswered\"\n" +
            "   * is_correct: false\n" +
            "   * confidence: \"Low\"\n" +
            "   * feedback: \"Missing from page or illegible\"\n\n" +
            "══ ANSWER TYPE DETECTION ══\n" +
            "1. LETTER MCQ (Written letter beside question):\n" +
            "   → Extract the handwritten letter (A/B/C/D).\n\n" +
            "2. SHORT WRITTEN / TEXT:\n" +
            "   → Extract exactly what is written.\n" +
            "   → Compare SEMANTICALLY against the correct answer in the marking scheme.\n" +
            "   → Mark correct if the meaning is equivalent, even if worded differently.\n" +
            "   → Ignore capitalisation and minor spelling errors.\n\n" +
            "3. NUMERIC ANSWER — Student wrote a number.\n" +
            "   → Extract the number. Accept equivalent forms (e.g. 0.5 = 1/2 = 50%).\n" +
            "   → Mark correct if within reasonable rounding for the context.\n\n" +
            "4. SHADED BUBBLES / OMR (Fallback Only):\n" +
            "   → If you are forced to grade a bubble question, find the darkest shaded circle.\n" +
            "   → If you are unsure, guessing is FORBIDDEN. Write 'Unanswered'.\n\n" +
            "══ GENERAL RULES ══\n" +
            "- STUDENT NAME IDENTIFICATION (CRITICAL):\n" +
            "  → First, scan the top 20% of the image for ANY labels like \"Name:\", \"Pupil:\", \"Student:\", \"Names:\", \"Surname:\", or \"First Name:\".\n" +
            "  → Extract the handwritten text found in the immediate vicinity (usually to the right or below these labels).\n" +
            "  → Even if the handwriting is messy, DO NOT use \"Unknown\" if there is clearly readable text in the name field.\n" +
            "  → If there is a box for the name, extract the contents of that box.\n" +
            "  → Cross-reference with any other identifiers found (like Student ID or Grade) to confirm header context.\n" +
            "- Extract student ID/Number if present (often near the name or in its own box).\n" +
            "- If handwriting is crossed out, evaluate ONLY the final uncrossed answer.\n" +
            "- If an answer is completely illegible: is_correct=false, confidence=\"Low\", feedback=\"Illegible handwriting\".\n" +
            "- If a question is left blank: student_answer=\"Unanswered\", is_correct=false.\n" +
            "- Be generous with confidence=\"High\" only when the answer is unambiguously clear.\n" +
            "- Provide SEMANTIC marking for written phrases (if the meaning matches the scheme, it's correct).\n\n" +
            "══ MARKING SCHEME ══\n" +
            schemeText + "\n\n" +
            "══ RESPONSE SCHEMA ══\n" +
            "{\n" +
            "  \"results\": [{\n" +
            "    \"studentName\": \"string\",\n" +
            "    \"student_id\": \"string\",\n" +
            "    \"grade\": \"string\",\n" +
            "    \"answers\": [{\n" +
            "      \"question_number\": 1,\n" +
            "      \"answer_type\": \"letter_mcq|shaded_bubble|short_written|numeric\",\n" +
            "      \"student_answer\": \"string\",\n" +
            "      \"is_correct\": true,\n" +
            "      \"feedback\": \"string (empty if correct, explanation if wrong)\",\n" +
            "      \"confidence\": \"High|Medium|Low\"\n" +
            "    }]\n" +
            "  }]\n" +
            "}"
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Grade this student's test script. Follow all instructions in the system prompt exactly." },
            ...buildParts()
          ]
        }
      ];
    } else if (mode === "solve_questions") {
      if (!testParams?.questions) throw new Error("testParams.questions required");
      messages = [
        { role: "system", content: `Expert examiner. Respond with strictly valid JSON.\nSchema: {"questions":[{"question_number":1,"question_text":"string","options":["A","B","C","D"],"correct_answer":"A","explanation":"string"}]}` },
        { role: "user", content: "Solve:\n" + JSON.stringify(testParams.questions, null, 2) },
      ];
    } else {
      throw new Error("Invalid mode: " + mode);
    }

    const { result, provider } = await callAI(messages, { gemini: geminiKey });

    // ------------------------------------------------------------------
    // EXPERIMENTAL HARD VALIDATION AND REPAIR (V51+)
    // Only runs for mark_script since that's where missing questions break the UI
    // ------------------------------------------------------------------
    if (mode === "mark_script" && markingScheme) {
      console.log(`[Validation V51] Post-processing edge AI results for ${result?.results?.[0]?.studentName || "Unknown"}`);

      let filteredScheme = markingScheme;
      if (target_questions && Array.isArray(target_questions) && target_questions.length > 0) {
        filteredScheme = markingScheme.filter((item: any) => {
          const qNumStr = String(item.question_number).trim();
          const qNum = parseInt(qNumStr.match(/\d+/)?.[0] || "0", 10);
          return target_questions.includes(qNum);
        });
        if (filteredScheme.length === 0) filteredScheme = markingScheme;
      }

      const expectedQuestionCount = filteredScheme.length;
      let aiAnswers = result?.results?.[0]?.answers || [];
      const rawCount = aiAnswers.length;

      // 1. DEDUPLICATION (Keep first occurrence)
      const uniqueAnswers = [];
      const seenQNums = new Set();
      let duplicateCount = 0;

      for (const ans of aiAnswers) {
        const qNum = normalizeQuestionNumber(ans.question_number);
        if (qNum !== null && !seenQNums.has(qNum)) {
          seenQNums.add(qNum);
          ans.question_number = qNum; // enforce clean integer
          uniqueAnswers.push(ans);
        } else if (qNum !== null) {
          console.warn(`[Validation V51] Discarding duplicate answer for Q${qNum}`);
          duplicateCount++;
        }
      }

      // 2. BUILD O(1) MAP OF AI ANSWERS
      const answerMap = new Map();
      uniqueAnswers.forEach((ans: any) => answerMap.set(ans.question_number, ans));

      // 3. HARD REPAIR: Enforce exactly the expected scheme questions
      const repairedAnswers = [];
      let missingCount = 0;

      for (const schemeQ of filteredScheme) {
        const qNum = normalizeQuestionNumber(schemeQ.question_number);
        if (qNum === null) continue; // Invalid scheme question

        if (answerMap.has(qNum)) {
          repairedAnswers.push(answerMap.get(qNum));
        } else {
          // AI missed this question completely — synthesize a blank "Unanswered" response
          console.warn(`[Validation V51] AI missed Q${qNum} entirely. Auto-repairing with 'Unanswered'.`);
          missingCount++;
          repairedAnswers.push({
            question_number: qNum,
            answer_type: "unknown",
            student_answer: "Unanswered",
            is_correct: false,
            confidence: "Low",
            feedback: "Question omitted by AI engine during extraction.",
            _repaired: true // flag for the frontend to know
          });
        }
      }

      // Update the payload
      if (!result.results) result.results = [{}];
      if (!result.results[0]) result.results[0] = {};

      result.results[0].answers = repairedAnswers;

      // Inject debug metadata
      result._debugMeta = {
        raw_llm_count: rawCount,
        duplicate_count: duplicateCount,
        repaired_count: missingCount,
        validation_passed: (missingCount === 0 && duplicateCount === 0)
      };

      console.log(`[Validation V51] Final Output: ${repairedAnswers.length} answers (Repaired: ${missingCount}, Duplicates: ${duplicateCount})`);
    }

    console.log(`Done: ${provider}, mode: ${mode}`);
    return jsonResponse({ ...result, _provider: provider });

  } catch (error: any) {
    console.error("Error:", error);
    if (error.isQuotaError) return jsonResponse({ error: "quota_exceeded", retry_after: error.retryAfter || 15, message: error.message }, 429);
    return jsonResponse({ error: "ai_provider_failed", message: error.message || "Unknown error" }, 500);
  }
});
