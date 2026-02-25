// Test Gemini API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyCgX-r4ssCAJMvkx9YcWGleQFgrdCjI6YA";

async function testGemini() {
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                {
                                    text: "Generate a simple JSON object with the following structure: { \"test\": \"success\", \"message\": \"Hello from Gemini\" }. Return ONLY valid JSON.",
                                },
                            ],
                        },
                    ],
                    generationConfig: {
                        temperature: 0.7,
                    },
                }),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("❌ Gemini API Error:");
            console.error("Status:", response.status);
            console.error("Error:", JSON.stringify(data, null, 2));
        } else {
            console.log("✅ Gemini API is working!");
            console.log("Response:", JSON.stringify(data, null, 2));

            if (data.candidates && data.candidates[0]) {
                const result = data.candidates[0].content.parts[0].text;
                console.log("\n📝 Generated JSON:", result);
            }
        }
    } catch (error) {
        console.error("❌ Network or fetch error:", error.message);
    }
}

testGemini();
