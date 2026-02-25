// List available Gemini models
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyCgX-r4ssCAJMvkx9YcWGleQFgrdCjI6YA";

async function listModels() {
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`,
            {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("❌ Error listing models:");
            console.error(JSON.stringify(data, null, 2));
        } else {
            console.log("✅ Available Gemini models:");
            if (data.models) {
                data.models.forEach((model) => {
                    console.log(`\n- ${model.name}`);
                    console.log(`  Supported methods: ${model.supportedGenerationMethods?.join(", ")}`);
                });
            }
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

listModels();
