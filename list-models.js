
const GEMINI_API_KEY = "AIzaSyCgX-r4ssCAJMvkx9YcWGleQFgrdCjI6YA";
fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + GEMINI_API_KEY)
    .then(r => r.json())
    .then(d => {
        console.log("Supported Models:");
        d.models.filter(m => m.supportedGenerationMethods.includes("generateContent")).forEach(m => console.log("- " + m.name));
    });
