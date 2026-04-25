chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_GEMINI_ANALYSIS") {
    handleGeminiAnalysis(sendResponse);
    return true; 
  }
});

async function handleGeminiAnalysis(sendResponse) {
  try {
    // 1. Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // 2. Fetch transcript from content script with retry
    let transcriptResponse;
    let retries = 3;
    while (retries > 0) {
      try {
        transcriptResponse = await chrome.tabs.sendMessage(tab.id, { action: "GET_TRANSCRIPT" });
        break;
      } catch (err) {
        if (err.message.includes("Receiving end does not exist") && retries > 1) {
          await new Promise(r => setTimeout(r, 1000));
          retries--;
        } else {
          throw err;
        }
      }
    }
    
    if (!transcriptResponse || !transcriptResponse.success) {
      sendResponse({ success: false, error: transcriptResponse ? transcriptResponse.error : "Could not connect to page." });
      return;
    }

    // 3. Get API Key
    const storage = await chrome.storage.local.get(["GEMINI_API_KEY"]);
    const apiKey = storage.GEMINI_API_KEY;
    
    if (!apiKey) {
      sendResponse({ success: false, error: "API Key not found. Please set it in storage." });
      return;
    }

    // 4. Call Gemini
    const prompt = `Act as an Expert Video Summarizer... (OMITTED FOR BREVITY - RETAINING THE PREVIOUS PROMPT) ... Here is the transcript: ${transcriptResponse.data}`;
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const result = await response.json();
    if (result.candidates && result.candidates[0].content.parts[0].text) {
      const summary = result.candidates[0].content.parts[0].text;
      // Send message to content script to render
      chrome.tabs.sendMessage(tab.id, { action: "RENDER_TIMESTAMPS", data: summary });
      sendResponse({ success: true, data: summary });
    } else {
      sendResponse({ success: false, error: "Failed to get response from Gemini." });
    }


  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}
