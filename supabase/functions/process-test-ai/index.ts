const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// Helper to clean and repair JSON string
function cleanRepairAndParseJson(text: string) {
  let cleaned = text.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    if (cleaned.length > 100) { // Only try repair if we have substantial content
      console.warn("JSON parse failed, attempting repair of truncated JSON...");
      // Find the last closing brace '}' which likely closes a question object
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace > -1) {
        const truncated = cleaned.substring(0, lastBrace + 1);
        // Try closing the array and object: { "questions": [ ... ] }
        try {
          return JSON.parse(truncated + ']}');
        } catch (e2) {
          // Try closing just the object (if array wasn't open or already closed?)
          try {
            return JSON.parse(truncated + '}');
          } catch (e3) {
            console.error("Repair failed.");
          }
        }
      }
    }
    throw e;
  }
}

const MODEL_NAME = "gemini-3-flash-preview";

async function callGemini(messages: any[]) {
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

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`, {
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
async function callClaude(messages: any[]) {
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
      "x-api-key": ANTHROPIC_API_KEY!,
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
async function callAI(messages: any[]) {
  const errors: string[] = [];

  // Try Gemini first
  if (GEMINI_API_KEY) {
    try {
      console.log("Trying Gemini...");
      const result = await callGemini(messages);
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
  if (ANTHROPIC_API_KEY) {
    try {
      console.log("Trying Claude...");
      const result = await callClaude(messages);
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
    const { mode, image, markingScheme, testParams } = body;

    if (!GEMINI_API_KEY && !ANTHROPIC_API_KEY) {
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
4. Explanations provided are clear and helpful for teachers.`,
        },
      ];
    } else if (mode === "generate_key") {
      if (!image) {
        throw new Error("image is required");
      }

      messages = [
        {
          role: "system",
          content: `You are an expert OCR and curriculum analyzer. Extract text accurately from the provided test paper image.
Always respond with strictly valid JSON.
Response Schema:
{
  "questions": [
    {
      "question_number": number,
      "question_text": "string (the full text of the question)",
      "options": ["string", "string", "string", "string"] (extract all visible multiple choice options),
      "correct_answer": "string (A, B, C, or D if indicated, or empty string)",
      "topic": "string (Infer the mathematical topic)",
      "subtopic": "string",
      "learning_outcome": "string"
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
              text: 'Analyze this test paper image. Extract all questions, options, and correct answers (if marked) according to the strict JSON schema provided.',
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ];
    } else if (mode === "mark_script") {

      if (!image || !markingScheme) {
        throw new Error("image and markingScheme are required");
      }

      messages = [
        {
          role: "system",
          content: `You are an expert examiner grading a student's handwritten test script against a provided marking scheme.
Always respond with strictly valid JSON.

CRITICAL INSTRUCTIONS:
1. Extract the student's name from the top of the paper. If unreadable, return "Unknown".
2. Compare the student's handwritten answer for each question against the correct answer in the marking scheme.
3. If handwriting is crossed out, ignore the crossed-out part and evaluate the latest answer.
4. If an answer is completely illegible, mark it incorrect, set confidence to "Low", and write "Illegible handwriting" in feedback.
5. If the student left the question blank, mark it incorrect and write "Unanswered" in the student_answer field.

Response Schema:
{
  "studentName": "string",
  "answers": [
    {
      "question_number": number,
      "student_answer": "string (what the student wrote, e.g. 'A', 'B', 'Blank', 'Illegible')",
      "is_correct": boolean,
      "feedback": "string (Explain why it is wrong, or note if illegible/blank. Leave empty if correct.)",
      "confidence": "High|Medium|Low"
    }
  ]
}`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Evaluate this student handwritten test script against the following marking scheme:\n\n${JSON.stringify(markingScheme, null, 2)}\n\nFollow the formatting schema and instructions completely.`,
            },
            { type: "image_url", image_url: { url: image } },
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
    const { result, provider } = await callAI(messages);
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
