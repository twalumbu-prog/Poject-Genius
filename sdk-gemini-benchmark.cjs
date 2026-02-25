const { GoogleGenAI } = require("@google/genai");
const fs = require('fs');

const GEMINI_API_KEY = "AIzaSyCgX-r4ssCAJMvkx9YcWGleQFgrdCjI6YA";
const MODEL = "gemini-3-flash-preview";

const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function generateLargeTest() {
    console.log(`🚀 Starting large test generation: 50 Questions (Mathematics Grade 7) using ${MODEL}`);

    let allQuestions = [];
    let existingTitles = [];
    const totalRequired = 50;
    const batchSize = 10;
    const totalBatches = Math.ceil(totalRequired / batchSize);

    for (let i = 0; i < totalBatches; i++) {
        console.log(`\n📦 Processing Batch ${i + 1}/${totalBatches}...`);

        const prompt = `You are an expert curriculum designer for the Zambian Ministry of Education. 
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
}

Generate ${batchSize} curriculum-aligned Mathematics questions for Grade 7.
Focus Topics: Whole Numbers, Fractions, Decimals, Geometry, and Algebra
Target Difficulty: Average

${existingTitles.length > 0 ? `IMPORTANT: Do NOT generate questions similar to these existing ones: ${existingTitles.join(", ")}` : ""}

Ensure:
1. Questions are age-appropriate and technically accurate.
2. Distractors are plausible but clearly incorrect.
3. Bloom's Taxonomy levels match the target difficulty.
4. Explanations provided are clear and helpful for teachers.`;

        try {
            const response = await genAI.models.generateContent({
                model: MODEL,
                contents: [{ role: "user", parts: [{ text: prompt }] }],
            });

            // The SDK might return an object with a .text property or a .text() method
            const text = response.text;
            const cleaned = text.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();
            const data = JSON.parse(cleaned);

            const batchQuestions = data.questions || [];
            allQuestions = [...allQuestions, ...batchQuestions];
            existingTitles = [...existingTitles, ...batchQuestions.map(q => q.question_text).slice(0, 10)];

            console.log(`✅ Batch ${i + 1} complete. Generated ${batchQuestions.length} questions.`);

            if (i < totalBatches - 1) {
                console.log("⏳ Waiting 5 seconds before next batch...");
                await new Promise(r => setTimeout(r, 5000));
            }
        } catch (err) {
            console.error(`❌ Batch ${i + 1} failed:`, err.message);
            // Log full error if possible
            if (err.response) {
                console.error("Response:", JSON.stringify(err.response, null, 2));
            }
            break;
        }
    }

    console.log(`\n🎉 Completed! Total questions generated: ${allQuestions.length}`);

    // Final re-numbering
    const finalReport = allQuestions.map((q, idx) => ({
        ...q,
        question_number: idx + 1
    }));

    fs.writeFileSync("generated_test_report.json", JSON.stringify(finalReport, null, 2));
    console.log("💾 Results saved to generated_test_report.json");

    if (finalReport.length > 0) {
        let markdown = `# Grade 7 Mathematics Test Report\n\nGenerated 50 Questions using ${MODEL}\n\n`;
        finalReport.forEach(q => {
            markdown += `### Question ${q.question_number}\n`;
            markdown += `**Topic:** ${q.topic} | **Level:** ${q.cognitive_level} | **Difficulty:** ${q.difficulty_score}/10\n\n`;
            markdown += `${q.question_text}\n\n`;
            q.options.forEach((opt, idx) => {
                markdown += `${String.fromCharCode(65 + idx)}. ${opt}\n`;
            });
            markdown += `\n**Correct Answer:** ${q.correct_answer}\n`;
            markdown += `**Explanation:** ${q.explanation}\n\n---\n\n`;
        });
        fs.writeFileSync("generated_test_report.md", markdown);
        console.log("💾 Results saved to generated_test_report.md");
    }
}

generateLargeTest();
