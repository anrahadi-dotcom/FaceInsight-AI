console.log("🔥 ai.js loaded");

async function analyzeImage(imageData) {
    const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            image: imageData
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Analysis failed");
    }

    return data;
}