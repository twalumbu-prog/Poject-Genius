const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

function cleanRepairAndParseJson(text: string) {
  let cleaned = text.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    if (cleaned.length > 100) {
      console.warn("JSON parse failed, attempting aggressive repair of truncated JSON...");

      // 1. First, try simple bracket appendages for cleanly cut strings
      const rescueAttempts = [
        cleaned + '"]}]}',
        cleaned + '"}]}',
        cleaned + '}]}',
        cleaned + ']}',
        cleaned + '}'
      ];

      for (const attempt of rescueAttempts) {
        try { return JSON.parse(attempt); } catch (e2) { }
      }

      // 2. If it cut off mid-property-name or mid-value (e.g., "feedback": "Studen...), 
      // we need to slice it back to the last successfully closed object }

      // Look for the last "}," which usually indicates the end of a question object or a student object inside an array
      let lastGoodBoundary = cleaned.lastIndexOf('},');

      if (lastGoodBoundary === -1) {
        // If no comma, just look for the last closing brace
        lastGoodBoundary = cleaned.lastIndexOf('}');
      }

      if (lastGoodBoundary > -1) {
        // Cut the string right after that valid closing brace
        const truncated = cleaned.substring(0, lastGoodBoundary + 1);

        // Now try closing the outer structures
        const structuralRepairs = [
          truncated + ']}',   // If it was inside the answers array
          truncated + ']} ]}', // If it was inside the results array
          truncated + ']}'    // If it was just results array
        ];

        for (const structuralAttempt of structuralRepairs) {
          try { return JSON.parse(structuralAttempt); } catch (e3) { }
        }
      }

      console.error("All aggressive repair attempts failed.");
    }
    throw e;
  }
}

const MODEL_NAME = "gemini-3-flash-preview";

async function callGemini(messages: any[], apiKey?: string) {
  const activeKey = apiKey || GEMINI_API_KEY;
  try {
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
            parts.push({
              inline_data: {
                mime_type: match[1],
                data: match[2],
              },
            });
          }
        }
      }
    }

    console.log(`Calling Gemini REST API with model: ${MODEL_NAME}`);

    // Convert to Gemini API format
    const geminiPayload = {
      system_instruction: {
        parts: [{ text: systemMessage }]
      },
      contents: [{
        role: "user",
        parts: parts
      }],
      generationConfig: {
        temperature: 0.6,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${activeKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(geminiPayload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 429) {
        throw {
          isQuotaError: true,
          retryAfter: 15,
          message: "Gemini quota exceeded. HTTP 429."
        };
      }
      throw new Error(`Gemini API Error ${response.status}: ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    const textContent = result.candidates[0].content.parts[0].text;
    return cleanRepairAndParseJson(textContent);

  } catch (error: any) {
    console.error("Gemini REST API call failed:", error.message || error);

    if (error.isQuotaError) throw error;

    throw new Error(`Gemini failed: ${error.message || String(error)}`);
  }
}

// Helper function to call Anthropic Claude
async function callClaude(messages: any[], apiKey?: string) {
  const activeKey = apiKey || ANTHROPIC_API_KEY;
  const userMessages = messages.filter(m => m.role === "user");
  const systemMessages = messages.filter(m => m.role === "system");

  const systemPrompt = systemMessages.map(m => m.content).join("\n");

  const claudeMessages = userMessages.map(msg => {
    if (typeof msg.content === "string") {
      return { role: "user", content: msg.content };
    }
    return {
      role: "user",
      content: msg.content.map((part: any) => {
        if (part.type === "text") {
          return { type: "text", text: part.text };
        } else if (part.type === "image_url") {
          const imageUrl = part.image_url.url || part.image_url;
          const match = imageUrl.match(/^data:(.+);base64,(.+)$/);

          if (match) {
            return {
              type: "image",
              source: {
                type: "base64",
                media_type: match[1],
                data: match[2]
              }
            };
          }

          // Fallback if not a data URL (though likely won't work for uploads)
          return {
            type: "image",
            source: {
              type: "url",
              url: imageUrl,
            },
          };
        }
        return part;
      }),
    };
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": activeKey!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: (systemPrompt || "You are a helpful AI assistant.") + " Always respond with valid, raw JSON. No markdown code blocks.",
      messages: claudeMessages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error("Claude error: " + response.status + " - " + errorText);
  }

  const result = await response.json();
  const textContent = result.content[0].text;
  return cleanRepairAndParseJson(textContent);
}

// Main AI call with fallback logic
async function callAI(messages: any[], keys: { gemini?: string, claude?: string } = {}) {
  const errors: string[] = [];

  // Try Gemini first
  if (keys.gemini || GEMINI_API_KEY) {
    try {
      console.log("Trying Gemini...");
      const result = await callGemini(messages, keys.gemini);
      console.log("✅ Gemini succeeded");
      return { result, provider: "gemini" };
    } catch (error: any) {
      // Re-throw quota errors immediately (don't fallback to Claude)
      if (error.isQuotaError) {
        throw error;
      }
      console.warn("Gemini failed:", error.message);
      errors.push("Gemini: " + (error.message || String(error)));
    }
  }

  // Fallback to Claude
  if (keys.claude || ANTHROPIC_API_KEY) {
    try {
      console.log("Trying Claude...");
      const result = await callClaude(messages, keys.claude);
      console.log("✅ Claude succeeded");
      return { result, provider: "claude" };
    } catch (error: any) {
      console.warn("Claude failed:", error.message);
      errors.push("Claude: " + (error.message || String(error)));
    }
  }

  // Both failed
  throw new Error("All AI providers failed. " + errors.join(" | "));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
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
      return new Response(
        JSON.stringify({ error: "No AI provider API keys configured. Please add GEMINI_API_KEY or ANTHROPIC_API_KEY." }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    let messages: any[] = [];

    if (mode === "generate_test") {
      if (!testParams) {
        throw new Error("testParams is required");
      }

      const { subject, grade, topics, difficulty, existingQuestions } = testParams;
      console.log(`Generating ${subject} test for ${grade}, topics:`, JSON.stringify(topics));

      // Build compact topic list and question count
      let topicList = "";
      let totalQuestions = 0;

      if (topics && Array.isArray(topics)) {
        topicList = topics.map((t: any) => `${t.name}(${t.count})`).join(", ");
        totalQuestions = topics.reduce((sum: number, t: any) => sum + (parseInt(t.count) || 0), 0);
      } else {
        const { topic, numQuestions } = testParams;
        topicList = topic;
        totalQuestions = numQuestions;
      }

      const cognitiveLevel = difficulty === "Basic" ? "recall & understanding" : difficulty === "Advanced" ? "analysis & evaluation" : "application & interpretation";

      messages = [
        {
          role: "system",
          content: `You are an expert curriculum designer for the Zambian Ministry of Education. 
Generate strictly valid JSON. No markdown code blocks.
Response Schema: 
{
  "questions": [
    {
      "question_text": "string",
      "type": "multiple_choice",
      "options": ["A", "B", "C", "D"],
      "correct_answer": "A",
      "marks": number,
      "topic": "string",
      "subtopic": "string",
      "learning_outcome": "string",
      "learning_outcome_code": "string (The official syllabus code if known, e.g. E2.1.1)",
      "cognitive_level": "Knowledge|Application|Analysis",
      "difficulty_score": 1-10,
      "explanation": "string"
    }
  ]
}`,
        },
        {
          role: "user",
          content: `Generate ${totalQuestions} curriculum-aligned ${subject} questions for ${grade}.
Focus Topics: ${topicList}
Target Difficulty: ${difficulty} (${cognitiveLevel})

${existingQuestions?.length > 0 ? `IMPORTANT: Do NOT generate questions similar to these existing ones: ${existingQuestions.join(", ")}` : ""}

Ensure:
1. Questions are age-appropriate and technically accurate.
2. Distractors are plausible but clearly incorrect.
3. Bloom's Taxonomy levels match the target difficulty.
4. Explanations provided are clear and helpful for teachers.
5. Provide specific 'subtopic', 'learning_outcome', AND its 'learning_outcome_code' (e.g., GS.LO1, E2.1.1) aligned with the official Zambian ECZ syllabus.`,
        },
      ];
    } else if (mode === "generate_key") {
      if (!image) {
        throw new Error("image is required");
      }

      messages = [
        {
          role: "system",
          content: `You are an expert OCR and curriculum analyzer specializing in the Zambian (ECZ) syllabus. 
Extract questions accurately from the provided test paper image.
Always respond with strictly valid JSON.

SYLLABUS MAPPING GUIDANCE:
- "topic": Usually the 'Component' (e.g. 2.1 Listening and Speaking, 4.2 Fractions)
- "subtopic": Usually the 'Topic' (e.g. Greetings, Addition of Fractions)
- "learning_outcome": Usually the 'Specific Outcome' (e.g. demonstrate different types of greetings)

Response Schema:
{
  "questions": [
    {
      "question_number": number,
      "question_text": "string (the full text of the question)",
      "options": ["string", "string", "string", "string"],
      "correct_answer": "string (A, B, C, or D)",
      "topic": "string",
      "subtopic": "string",
      "learning_outcome": "string",
      "learning_outcome_code": "string (The official syllabus code if visible, otherwise infer based on pattern like E2.1.1)"
    }
  ],
  "topic_summary": {
    "Topic Name": number_of_occurrences
  }
}`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Analyze this test paper image according to the strict ECZ syllabus hierarchy. Extract all questions, options, and infer the component (topic), topic (subtopic), specific outcome (learning_outcome), and its official syllabus code (learning_outcome_code).',
            },
            ...buildImageParts(),
          ],
        },
      ];
    } else if (mode === "mark_script") {

      if ((!image && (!images || images.length === 0)) || !markingScheme) {
        throw new Error("image(s) and markingScheme are required");
      }

      const numImages = (images && images.length > 0) ? images.length : 1;

      messages = [
        {
          role: "system",
          content: `You are an expert examiner grading student handwritten test scripts against a provided marking scheme. 
          A single document or image may contain scripts from MULTIPLE different students. 
          Alternatively, multiple images might correspond to different students or the same student's continuation.
Always respond with strictly valid JSON.

CRITICAL INSTRUCTIONS:
1. Identify ALL distinct student scripts present across all provided images. You have been provided with ${numImages} image(s).
2. For each student script found, create a separate object in the "results" array.
3. For each student script, extract:
    - "studentName": The handwritten name at the top.
    - "student_id": The handwritten ID or index number.
    - "grade": The handwritten grade level (e.g. Grade 8).
    - "image_index": The 0-based index of the image where this specific student's script was found (one of: ${Array.from({ length: numImages }, (_, i) => i).join(', ')}).
4. Evaluate the handwritten answers against the marking scheme.
5. If handwriting is crossed out, ignore the crossed-out part and evaluate the latest answer.
6. If an answer is illegible, mark it incorrect, set confidence to "Low", and write "Illegible handwriting" in feedback.
7. If the student left the question blank, mark it incorrect and write "Unanswered" in the student_answer field.

Response Schema:
{
  "results": [
    {
      "studentName": "string",
      "student_id": "string",
      "grade": "string",
      "image_index": number,
      "answers": [
        {
          "question_number": number,
          "student_answer": "string",
          "is_correct": boolean,
          "feedback": "string",
          "confidence": "High|Medium|Low"
        }
      ]
    }
  ]
}`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Evaluate these ${numImages} image(s) against the following marking scheme:\n\n${JSON.stringify(markingScheme, null, 2)}\n\nIMPORTANT: I expect to find results for every student script visible in these images. If there are 3 students shown across the images, I expect 3 objects in the "results" array.`,
            },
            ...buildImageParts(),
          ],
        },
      ];
    } else if (mode === "solve_questions") {
      if (!testParams || !testParams.questions) {
        throw new Error("testParams.questions is required");
      }

      messages = [
        {
          role: "system",
          content: `You are an expert examiner. Your task is to provide the correct answer and a brief explanation for each question provided.
Always respond with strictly valid JSON.

Response Schema:
{
  "questions": [
    {
      "question_number": number,
      "question_text": "string",
      "options": ["A", "B", "C", "D"],
      "correct_answer": "A|B|C|D",
      "explanation": "string (Short explanation of why this answer is correct)"
    }
  ]
}`,
        },
        {
          role: "user",
          content: `Please solve the following questions and provide the correct answer and explanation for each:
${JSON.stringify(testParams.questions, null, 2)}`,
        },
      ];
    } else {
      throw new Error("Invalid mode: " + mode);
    }

    console.log("Calling AI provider...");
    const { result, provider } = await callAI(messages, { gemini: geminiKey });
    console.log(`AI succeeded with ${provider}`);

    return new Response(JSON.stringify({ ...result, _provider: provider }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    console.error("Function error:", error);

    // Handle quota errors with 429
    if (error.isQuotaError) {
      return new Response(
        JSON.stringify({
          error: "quota_exceeded",
          retry_after: error.retryAfter || 15,
          message: error.message || "Gemini free-tier quota exceeded. Please retry after delay."
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Retry-After": String(error.retryAfter || 15),
          },
        }
      );
    }

    // Handle model errors (404)
    if (error.isModelError) {
      return new Response(
        JSON.stringify({
          error: "invalid_model",
          message: error.message || "Configured Gemini model is not available."
        }),
        {
          status: 404, // or 500 depending on client handling
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Handle all other errors with 500
    return new Response(
      JSON.stringify({
        error: "ai_provider_failed",
        message: error.message || "Unknown error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
