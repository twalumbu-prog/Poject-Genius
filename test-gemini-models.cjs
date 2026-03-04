require('dotenv').config();
const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY;

const MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-pro-exp-02-05",
    "gemini-2.0-flash-lite-preview-02-05",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro"
];

const payload = {
    contents: [{ role: "user", parts: [{ text: "Hello" }] }]
};

async function testModels() {
    for (const model of MODELS) {
        process.stdout.write(`Testing ${model}... `);
        try {
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                }
            );
            if (resp.ok) {
                console.log(`✅ Works!`);
            } else {
                const data = await resp.json().catch(() => ({}));
                console.log(`❌ Failed: HTTP ${resp.status} - ${data?.error?.message || 'Unknown'}`);
            }
        } catch (e) {
            console.log(`❌ Error: ${e.message}`);
        }
    }
}
testModels();
