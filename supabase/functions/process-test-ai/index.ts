const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

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

function cleanRepairAndParseJson(text: string) {
  let cleaned = text.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    if (cleaned.length > 100) {
      const rescueAttempts = [cleaned + '"]}]}', cleaned + '"}]}', cleaned + '}]}', cleaned + ']}', cleaned + '}'];
      for (const attempt of rescueAttempts) {
        try { return JSON.parse(attempt); } catch (_) { }
      }
      let lastGood = cleaned.lastIndexOf('},');
      if (lastGood === -1) lastGood = cleaned.lastIndexOf('}');
      if (lastGood > -1) {
        const t = cleaned.substring(0, lastGood + 1);
        for (const r of [t + ']}', t + ']} ]}', t + '}']) {
          try { return JSON.parse(r); } catch (_) { }
        }
      }
    }
    throw e;
  }
}

const GEMINI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
];

async function callGemini(messages: any[], apiKey: string) {
  const systemMessage = messages.find((m: any) => m.role === "system")?.content || "";
  const userMessage = messages.find((m: any) => m.role === "user");

  const parts: any[] = [];
  if (typeof userMessage.content === "string") {
    parts.push({ text: userMessage.content });
  } else {
    for (const part of userMessage.content) {
      if (part.type === "text") parts.push({ text: part.text });
      else if (part.type === "image_url") {
        const url = part.image_url.url || part.image_url;
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
      }
    }
  }

  const payload = {
    system_instruction: { parts: [{ text: systemMessage }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.2, topK: 40, topP: 0.95, maxOutputTokens: 4096, responseMimeType: "application/json" },
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
          const match = url.match(/^data:(.+);base64,(.+)$/);
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
    const { mode, image, images, markingScheme, testParams, geminiKey } = body;
    const buildParts = () => (images || (image ? [image] : [])).map((img: string) => ({ type: "image_url", image_url: { url: img } }));

    if (!(geminiKey || GEMINI_API_KEY) && !ANTHROPIC_API_KEY) return jsonResponse({ error: "No API keys configured" }, 500);

    let messages: any[] = [];

    if (mode === "generate_test") {
      if (!testParams) throw new Error("testParams is required");
      const { subject, grade, topics, difficulty, existingQuestions } = testParams;
      let topicList = "", total = 0;
      if (Array.isArray(topics)) { topicList = topics.map((t: any) => `${t.name}(${t.count})`).join(", "); total = topics.reduce((s: number, t: any) => s + (parseInt(t.count) || 0), 0); }
      else { topicList = testParams.topic; total = testParams.numQuestions; }
      const cog = difficulty === "Basic" ? "recall & understanding" : difficulty === "Advanced" ? "analysis & evaluation" : "application & interpretation";
      messages = [
        { role: "system", content: `Expert curriculum designer for Zambian Ministry of Education. Generate strictly valid JSON.\nSchema: {"questions":[{"question_text":"string","type":"multiple_choice","options":["A","B","C","D"],"correct_answer":"A","marks":1,"topic":"string","cognitive_level":"string","difficulty_score":5,"explanation":"string"}]}` },
        { role: "user", content: `Generate ${total} ${difficulty} ${subject} questions for ${grade}. Topics: ${topicList}.${existingQuestions?.length > 0 ? ` Avoid: ${existingQuestions.join(", ")}` : ""}` },
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

      const schemeText = JSON.stringify(markingScheme, null, 2);
      const questionCount = markingScheme.length;

      messages = [
        {
          role: "system",
          content: `You are an expert examiner grading a student's handwritten test script.
Respond with STRICTLY VALID JSON only — no markdown, no commentary.

CRITICAL RULES:
1. The marking scheme contains EXACTLY ${questionCount} questions.
2. You MUST return EXACTLY ${questionCount} objects in the answers array.
3. NEVER return fewer items.
4. NEVER stop early.
5. NEVER omit a question.
6. If an answer is missing, unclear, or illegible, you MUST still return the object and set:
   * student_answer: "Unanswered"
   * is_correct: false
   * confidence: "Low"
   * feedback: "Missing from page or illegible"

══ ANSWER TYPE DETECTION ══
For each question, first determine HOW the student answered, then extract accordingly:

1. LETTER MCQ — Student wrote a letter (A/B/C/D) next to a question number.
   → Extract the letter as-is. Accept both capital and lowercase.

2. SHADED / FILLED BUBBLE — Student filled or shaded a circle from a row of options (A B C D).
   → Identify the darkest, most completely filled circle as the answer.
   → If two circles appear equally filled, pick the one more completely shaded.
   → Report as the corresponding letter (A, B, C, or D).

3. SHORT WRITTEN ANSWER / PHRASE — Student wrote a word, phrase, or sentence.
   → Extract the exact text the student wrote.
   → Compare SEMANTICALLY against the correct answer in the marking scheme.
   → Mark correct if the meaning is equivalent, even if worded differently.
   → Ignore capitalisation and minor spelling errors.

4. NUMERIC ANSWER — Student wrote a number.
   → Extract the number. Accept equivalent forms (e.g. 0.5 = 1/2 = 50%).
   → Mark correct if within reasonable rounding for the context.

══ GENERAL RULES ══
- STUDENT NAME IDENTIFICATION (CRITICAL):
  → First, scan the top 20% of the image for ANY labels like "Name:", "Pupil:", "Student:", "Names:", "Surname:", or "First Name:".
  → Extract the handwritten text found in the immediate vicinity (usually to the right or below these labels).
  → Even if the handwriting is messy, DO NOT use "Unknown" if there is clearly readable text in the name field.
  → If there is a box for the name, extract the contents of that box.
  → Cross-reference with any other identifiers found (like Student ID or Grade) to confirm header context.
- Extract student ID/Number if present (often near the name or in its own box).
- If handwriting is crossed out, evaluate ONLY the final uncrossed answer.
- If an answer is completely illegible: is_correct=false, confidence="Low", feedback="Illegible handwriting".
- If a question is left blank: student_answer="Unanswered", is_correct=false.
- Be generous with confidence="High" only when the answer is unambiguously clear.
- Provide SEMANTIC marking for written phrases (if the meaning matches the scheme, it's correct).

══ MARKING SCHEME ══
${schemeText}

══ RESPONSE SCHEMA ══
{
  "results": [{
    "studentName": "string",
    "student_id": "string",
    "grade": "string",
    "answers": [{
      "question_number": 1,
      "answer_type": "letter_mcq|shaded_bubble|short_written|numeric",
      "student_answer": "string",
      "is_correct": true,
      "feedback": "string (empty if correct, explanation if wrong)",
      "confidence": "High|Medium|Low"
    }]
  }]
}`
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
        { role: "user", content: `Solve:\n${JSON.stringify(testParams.questions, null, 2)}` },
      ];
    } else {
      throw new Error("Invalid mode: " + mode);
    }

    const { result, provider } = await callAI(messages, { gemini: geminiKey });
    console.log(`Done: ${provider}, mode: ${mode}`);
    return jsonResponse({ ...result, _provider: provider });

  } catch (error: any) {
    console.error("Error:", error);
    if (error.isQuotaError) return jsonResponse({ error: "quota_exceeded", retry_after: error.retryAfter || 15, message: error.message }, 429);
    return jsonResponse({ error: "ai_provider_failed", message: error.message || "Unknown error" }, 500);
  }
});
