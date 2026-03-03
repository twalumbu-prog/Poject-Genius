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
      console.warn("JSON parse failed, attempting repair...");
      const rescueAttempts = [
        cleaned + '"]}]}', cleaned + '"}]}', cleaned + '}]}', cleaned + ']}', cleaned + '}'
      ];
      for (const attempt of rescueAttempts) {
        try { return JSON.parse(attempt); } catch (e2) { }
      }
      let lastGoodBoundary = cleaned.lastIndexOf('},');
      if (lastGoodBoundary === -1) lastGoodBoundary = cleaned.lastIndexOf('}');
      if (lastGoodBoundary > -1) {
        const truncated = cleaned.substring(0, lastGoodBoundary + 1);
        for (const r of [truncated + ']}', truncated + ']} ]}', truncated + '}']) {
          try { return JSON.parse(r); } catch (e3) { }
        }
      }
      console.error("All repair attempts failed.");
    }
    throw e;
  }
}

// Ordered list of models to try — most capable first.
// If a model returns 404 we skip to the next automatically.
const GEMINI_MODELS = [
  "gemini-2.0-flash-001",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
];

async function callGemini(messages: any[], apiKey: string) {
  const systemMessage = messages.find((m: any) => m.role === "system")?.content || "";
  const userMessage = messages.find((m: any) => m.role === "user");

  const parts: any[] = [];
  if (typeof userMessage.content === "string") {
    parts.push({ text: userMessage.content });
  } else {
    for (const part of userMessage.content) {
      if (part.type === "text") {
        parts.push({ text: part.text });
      } else if (part.type === "image_url") {
        const imageUrl = part.image_url.url || part.image_url;
        const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
        }
      }
    }
  }

  const geminiPayload = {
    system_instruction: { parts: [{ text: systemMessage }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.6, topK: 40, topP: 0.95,
      maxOutputTokens: 8192, responseMimeType: "application/json",
    },
  };

  // Try each model in order until one succeeds
  let lastError: Error | null = null;
  for (const modelName of GEMINI_MODELS) {
    console.log(`Trying Gemini model: ${modelName}`);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiPayload) }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 429) {
        throw { isQuotaError: true, retryAfter: 15, message: "Gemini quota exceeded." };
      }
      if (response.status === 404) {
        console.warn(`Model ${modelName} not found, trying next...`);
        lastError = new Error(`Model ${modelName} not available`);
        continue; // try next model
      }
      throw new Error(`Gemini API Error ${response.status}: ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    const textContent = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) throw new Error("Empty response from Gemini");
    console.log(`✅ Gemini model ${modelName} succeeded`);
    return cleanRepairAndParseJson(textContent);
  }

  throw lastError || new Error("All Gemini models unavailable");
}

async function callClaude(messages: any[], apiKey: string) {
  const userMessages = messages.filter(m => m.role === "user");
  const systemPrompt = messages.filter(m => m.role === "system").map(m => m.content).join("\n");

  const claudeMessages = userMessages.map(msg => {
    if (typeof msg.content === "string") return { role: "user", content: msg.content };
    return {
      role: "user",
      content: msg.content.map((part: any) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "image_url") {
          const imageUrl = part.image_url.url || part.image_url;
          const match = imageUrl.match(/^data:(.+);base64,(.+)$/);
          if (match) return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
          return { type: "image", source: { type: "url", url: imageUrl } };
        }
        return part;
      }),
    };
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: (systemPrompt || "You are a helpful AI assistant.") + " Always respond with valid, raw JSON. No markdown code blocks.",
      messages: claudeMessages,
    }),
  });

  if (!response.ok) throw new Error("Claude error: " + response.status + " - " + await response.text());
  return cleanRepairAndParseJson((await response.json()).content[0].text);
}

async function callAI(messages: any[], keys: { gemini?: string; claude?: string } = {}) {
  const errors: string[] = [];

  const geminiKey = keys.gemini || GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const result = await callGemini(messages, geminiKey);
      return { result, provider: "gemini" };
    } catch (error: any) {
      if (error.isQuotaError) throw error;
      console.warn("Gemini failed:", error.message);
      errors.push("Gemini: " + (error.message || String(error)));
    }
  }

  const claudeKey = keys.claude || ANTHROPIC_API_KEY;
  if (claudeKey) {
    try {
      const result = await callClaude(messages, claudeKey);
      return { result, provider: "claude" };
    } catch (error: any) {
      console.warn("Claude failed:", error.message);
      errors.push("Claude: " + (error.message || String(error)));
    }
  }

  throw new Error("All AI providers failed. " + errors.join(" | "));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { mode, image, images, markingScheme, testParams, geminiKey } = body;

    const buildImageParts = () => {
      const allImages = images || (image ? [image] : []);
      return allImages.map((img: string) => ({ type: "image_url", image_url: { url: img } }));
    };

    const activeGeminiKey = geminiKey || GEMINI_API_KEY;
    if (!activeGeminiKey && !ANTHROPIC_API_KEY) {
      return jsonResponse({ error: "No AI provider API keys configured." }, 500);
    }

    let messages: any[] = [];

    if (mode === "generate_test") {
      if (!testParams) throw new Error("testParams is required");
      const { subject, grade, topics, difficulty, existingQuestions } = testParams;
      let topicList = "", totalQuestions = 0;
      if (topics && Array.isArray(topics)) {
        topicList = topics.map((t: any) => `${t.name}(${t.count})`).join(", ");
        totalQuestions = topics.reduce((sum: number, t: any) => sum + (parseInt(t.count) || 0), 0);
      } else {
        topicList = testParams.topic;
        totalQuestions = testParams.numQuestions;
      }
      const cognitiveLevel = difficulty === "Basic" ? "recall & understanding" : difficulty === "Advanced" ? "analysis & evaluation" : "application & interpretation";
      messages = [
        { role: "system", content: `You are an expert curriculum designer for the Zambian Ministry of Education. Generate strictly valid JSON. No markdown code blocks.\nResponse Schema:\n{\n  "questions": [\n    {\n      "question_text": "string",\n      "type": "multiple_choice",\n      "options": ["A", "B", "C", "D"],\n      "correct_answer": "A",\n      "marks": number,\n      "topic": "string",\n      "cognitive_level": "Knowledge|Application|Analysis",\n      "difficulty_score": 1-10,\n      "explanation": "string"\n    }\n  ]\n}` },
        { role: "user", content: `Generate ${totalQuestions} curriculum-aligned ${subject} questions for ${grade}.\nFocus Topics: ${topicList}\nTarget Difficulty: ${difficulty} (${cognitiveLevel})\n${existingQuestions?.length > 0 ? `IMPORTANT: Do NOT generate questions similar to these existing ones: ${existingQuestions.join(", ")}` : ""}\nEnsure:\n1. Questions are age-appropriate and technically accurate.\n2. Distractors are plausible but clearly incorrect.\n3. Bloom's Taxonomy levels match the target difficulty.\n4. Explanations provided are clear and helpful for teachers.` },
      ];

    } else if (mode === "generate_key") {
      if (!image) throw new Error("image is required");
      messages = [
        { role: "system", content: `You are an expert OCR and curriculum analyzer. Extract text accurately from the provided test paper image. Always respond with strictly valid JSON.\nResponse Schema:\n{\n  "questions": [\n    {\n      "question_number": number,\n      "question_text": "string",\n      "options": ["string", "string", "string", "string"],\n      "correct_answer": "string",\n      "topic": "string",\n      "subtopic": "string",\n      "learning_outcome": "string"\n    }\n  ],\n  "topic_summary": { "Topic Name": number_of_occurrences }\n}` },
        { role: "user", content: [{ type: "text", text: "Analyze this test paper image. Extract all questions, options, and correct answers according to the strict JSON schema provided." }, ...buildImageParts()] },
      ];

    } else if (mode === "mark_script") {
      if ((!image && (!images || images.length === 0)) || !markingScheme) throw new Error("image(s) and markingScheme are required");
      const numImages = (images && images.length > 0) ? images.length : 1;
      messages = [
        { role: "system", content: `You are an expert examiner grading student handwritten test scripts against a provided marking scheme.\nAlways respond with strictly valid JSON.\n\nCRITICAL INSTRUCTIONS:\n1. You have been provided with ${numImages} image(s). Assume EACH image is a separate student's test script.\n2. Extract the student's name from the top of the paper. If unreadable, return "Unknown".\n3. Evaluate each handwritten answer against the correct answer in the marking scheme.\n4. If handwriting is crossed out, evaluate the latest answer.\n5. If illegible, mark incorrect, confidence "Low", feedback "Illegible handwriting".\n6. If blank, mark incorrect, student_answer "Unanswered".\n\nResponse Schema:\n{\n  "results": [\n    {\n      "studentName": "string",\n      "student_id": "string",\n      "grade": "string",\n      "image_index": number,\n      "answers": [\n        {\n          "question_number": number,\n          "student_answer": "string",\n          "is_correct": boolean,\n          "feedback": "string",\n          "confidence": "High|Medium|Low"\n        }\n      ]\n    }\n  ]\n}` },
        { role: "user", content: [{ type: "text", text: `Evaluate these ${numImages} student handwritten test script(s) against the following marking scheme:\n\n${JSON.stringify(markingScheme, null, 2)}\n\nIMPORTANT: Output a distinct result object in the "results" array for EACH student script. Since there are ${numImages} images, output at least ${numImages} objects.` }, ...buildImageParts()] },
      ];

    } else if (mode === "solve_questions") {
      if (!testParams?.questions) throw new Error("testParams.questions is required");
      messages = [
        { role: "system", content: `You are an expert examiner. Provide the correct answer and a brief explanation for each question.\nAlways respond with strictly valid JSON.\nResponse Schema:\n{\n  "questions": [\n    {\n      "question_number": number,\n      "question_text": "string",\n      "options": ["A", "B", "C", "D"],\n      "correct_answer": "A|B|C|D",\n      "explanation": "string"\n    }\n  ]\n}` },
        { role: "user", content: `Please solve the following questions:\n${JSON.stringify(testParams.questions, null, 2)}` },
      ];

    } else {
      throw new Error("Invalid mode: " + mode);
    }

    const { result, provider } = await callAI(messages, { gemini: geminiKey });
    console.log(`AI succeeded with ${provider}`);
    return jsonResponse({ ...result, _provider: provider });

  } catch (error: any) {
    console.error("Function error:", error);
    if (error.isQuotaError) {
      return jsonResponse({ error: "quota_exceeded", retry_after: error.retryAfter || 15, message: error.message }, 429);
    }
    return jsonResponse({ error: "ai_provider_failed", message: error.message || "Unknown error" }, 500);
  }
});
