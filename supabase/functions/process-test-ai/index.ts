import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

// Helper function to call Google Gemini (hardcoded free-tier model)
async function callGemini(messages: any[]) {
  const model = "gemini-2.0-flash-lite"; // Verified free-tier model

  try {
    // Gemini uses a different format - combine system and user messages
    const systemMessages = messages.filter(m => m.role === "system");
    const userMessages = messages.filter(m => m.role === "user");

    const systemPrompt = systemMessages.map(m => m.content).join("\n");

    // Build Gemini content parts
    const parts: any[] = [];

    // Add system prompt as first part
    if (systemPrompt) {
      parts.push({ text: systemPrompt + "\n\nIMPORTANT: Return ONLY raw JSON. No markdown formatting, no code blocks." });
    }

    // Add user content
    for (const msg of userMessages) {
      if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      } else {
        // Handle multi-part content (text + images)
        for (const part of msg.content) {
          if (part.type === "text") {
            parts.push({ text: part.text });
          } else if (part.type === "image_url") {
            const imageUrl = part.image_url.url || part.image_url;

            // Extract mime type and base64 data
            const match = imageUrl.match(/^data:(.+);base64,(.+)$/);
            let mimeType = "image/jpeg"; // Default
            let data = imageUrl;

            if (match) {
              mimeType = match[1];
              data = match[2];
            } else if (imageUrl.includes(",")) {
              data = imageUrl.split(",")[1];
            }

            parts.push({
              inlineData: {
                mimeType: mimeType,
                data: data,
              },
            });
          }
        }
      }
    }

    console.log(`Calling Gemini model: ${model} (v1 API)`);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.6,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    // Handle 429 quota exceeded
    if (response.status === 429) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Gemini quota exceeded:", errorData);

      // Extract retry delay from response
      let retryAfter = 15; // Default
      if (errorData.error?.details) {
        const retryInfo = errorData.error.details.find((d: any) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo");
        if (retryInfo?.retryDelay) {
          const delay = retryInfo.retryDelay;
          retryAfter = parseInt(delay.replace(/[^\d]/g, '')) || 15;
        }
      }

      throw {
        isQuotaError: true,
        retryAfter,
        message: "Gemini free-tier quota exceeded. Please retry after delay."
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini status:", response.status);
      console.error("Gemini error:", errorText);
      throw new Error(`Gemini error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    // Gemini returns text in candidates[0].content.parts[0].text
    if (!result.candidates || !result.candidates[0]) {
      throw new Error("Invalid Gemini response structure");
    }

    const textContent = result.candidates[0].content.parts[0].text;
    return cleanRepairAndParseJson(textContent);

  } catch (error: any) {
    // Re-throw quota errors with original structure
    if (error.isQuotaError) {
      throw error;
    }
    // Wrap other errors
    console.error("Gemini call failed:", error.message || error);
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

      const { subject, grade, topics, difficulty } = testParams;

      // Build compact topic list
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

      // Determine cognitive level from difficulty
      const cognitiveLevel = difficulty === "Basic" ? "recall" : difficulty === "Advanced" ? "analysis" : "application";

      messages = [
        {
          role: "system",
          content: "Return valid JSON only. No markdown.",
        },
        {
          role: "user",
          content: `Context:
Subject: ${subject}
Grade: ${grade}
Topics: ${topicList}
Difficulty: ${difficulty}
Cognitive: ${cognitiveLevel}

Schema:
{"questions":[{"question_number":1,"question_text":"...","type":"multiple_choice","options":["A","B","C","D"],"correct_answer":"A","marks":1}]}

Generate ${totalQuestions} curriculum-aligned questions.`,
        },
      ];
    } else if (mode === "generate_key") {
      if (!image) {
        throw new Error("image is required");
      }

      messages = [
        {
          role: "system",
          content: "You are an expert examiner. Always respond with valid JSON.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Analyze this test paper image. Extract all questions, options, and correct answers. Return as JSON: { "questions": [{ "question_number": 1, "question_text": "...", "options": ["...", "...", "...", "..."], "correct_answer": "A", "topic": "...", "subtopic": "...", "learning_outcome": "..." }], "topic_summary": { "TopicName": count } }',
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
          content: "You are an expert examiner. Always respond with valid JSON.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Compare this student answer script against the marking scheme: ${JSON.stringify(markingScheme)}. Identify the student name and mark each answer. Return as JSON: { "studentName": "...", "answers": [{ "question_number": 1, "student_answer": "A", "is_correct": true }] }`,
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ];
    } else {
      throw new Error("Invalid mode: " + mode);
    }

    const { result, provider } = await callAI(messages);

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
