const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://gjiuseoqtzhdvxwvktfo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqaXVzZW9xdHpoZHZ4d3ZrdGZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2MDAwOTQsImV4cCI6MjA4NTE3NjA5NH0.v3m-OCCYvrkBY_7FCq5BEuioQspD-vyuGEXniM2S4E0";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function generateLargeTest() {
    console.log("🚀 Starting large test generation: 50 Questions (Mathematics Grade 7)");

    let allQuestions = [];
    let existingTitles = [];
    const totalRequired = 50;
    const batchSize = 10;
    const totalBatches = Math.ceil(totalRequired / batchSize);

    for (let i = 0; i < totalBatches; i++) {
        console.log(`\n📦 Processing Batch ${i + 1}/${totalBatches}...`);

        try {
            const { data, error } = await supabase.functions.invoke('process-test-ai', {
                body: {
                    mode: 'generate_test',
                    testParams: {
                        subject: "Mathematics",
                        grade: "Grade 7",
                        difficulty: "Average",
                        topics: [{ name: "Whole Numbers, Fractions, Decimals, Geometry, and Algebra", count: batchSize }],
                        existingQuestions: existingTitles
                    }
                }
            });

            if (error) throw error;
            if (data.error) throw new Error(JSON.stringify(data.error));

            const batchQuestions = data.questions || [];
            allQuestions = [...allQuestions, ...batchQuestions];

            // Add titles to existingTitles to prevent duplicates in next batch
            existingTitles = [...existingTitles, ...batchQuestions.map(q => q.question_text)];

            console.log(`✅ Batch ${i + 1} complete. Generated ${batchQuestions.length} questions.`);

            // Wait to avoid rate limits
            if (i < totalBatches - 1) {
                console.log("⏳ Waiting 10 seconds before next batch...");
                await new Promise(r => setTimeout(r, 10000));
            }

        } catch (err) {
            console.error(`❌ Batch ${i + 1} failed:`, err.message);
            break;
        }
    }

    console.log(`\n🎉 Completed! Total questions generated: ${allQuestions.length}`);

    // Save to a local file for reporting
    const fs = require('fs');
    fs.writeFileSync("generated_test_report.json", JSON.stringify(allQuestions, null, 2));
    console.log("💾 Results saved to generated_test_report.json");
}

generateLargeTest();
