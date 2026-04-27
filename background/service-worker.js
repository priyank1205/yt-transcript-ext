// background/service-worker.js

// Handle messages from content script
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
    const geminiClient = new GeminiClient();
    const transcriptResponse = await geminiClient.fetchTranscriptWithRetry(tab.id);
    
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
    const summary = await geminiClient.callGeminiAPI(apiKey, transcriptResponse.data);
    
    // Send message to content script to render
    sendResponse({ success: true, data: summary });
    
    // Send message to content script to render timestamps
    chrome.tabs.sendMessage(tab.id, { action: "RENDER_TIMESTAMPS", data: summary });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

class GeminiClient {
  // Function to fetch transcript from content script with retry
  async fetchTranscriptWithRetry(tabId, retries = 3) {
    while (retries > 0) {
      try {
        const transcriptResponse = await chrome.tabs.sendMessage(tabId, { action: "GET_TRANSCRIPT" });
        return transcriptResponse;
      } catch (err) {
        if (err.message.includes("Receiving end does not exist") && retries > 1) {
          await new Promise(r => setTimeout(r, 1000));
          retries--;
        } else {
          throw err;
        }
      }
    }
    throw new Error("Failed to fetch transcript after retries");
  }

  // Function to call Gemini API
  async callGeminiAPI(apiKey, transcript) {
    const prompt = "Act as an Expert Video Summarizer.\n\nYour job is to generate an accurate timestamped summary from the pasted timestamped transcript.\n\nTimestamps are absolute video-clock timestamps, not relative transcript offsets.\n\nUse ONLY timestamps that already exist in the transcript. Never invent, estimate, interpolate, normalize, offset, compress, or recalculate timestamps.\n\nCore rules\nFirst detect:\n\nT_start = first timestamp in transcript\n\nT_end = last timestamp in transcript\n\nTreat all transcript timestamps as absolute video time.\n\nDo NOT rebase timestamps relative to T_start.\n\nDo NOT subtract skipped intro time.\n\nDo NOT convert later timestamps into a shorter timeline.\n\nDo NOT \"compress\" the second half of the video.\n\nIf the transcript starts at 00:47, the summary must start at 00:47 or later, not 00:00.\n\nIf the transcript contains 1:25:29, output 1:25:29 exactly if that is the matched source timestamp.\n\nUse only verified source timestamps.\n\nEvery summary timestamp must match a real timestamp present in the transcript.\n\nNever output a timestamp that is not explicitly written in the transcript.\n\nIf unsure between two moments, choose the nearest exact transcript timestamp, never an invented one.\n\nSegment the full transcript span.\n\nCreate 10–30 summary points depending on transcript length.\n\nCover beginning, middle, and end proportionally.\n\nFinal summary point must fall near T_end.\n\nDo not overweight only the first 30–40 minutes.\n\nTimestamp format rules\nOutput timestamps exactly according to the original video clock:\n\nFor times under 1 hour, use:\n[mm:ss]\n\nFor times of 1 hour or more, use:\n[h:mm:ss]\n\nExamples:\n[00:47]\n[24:58]\n[59:42]\n[1:03:34]\n[1:25:29]\n\nStrict formatting rules:\n\nNever flatten hour-based timestamps into total minutes.\n\nNever output 63:34 if the real timestamp is 1:03:34.\n\nNever output 65:29 if the real timestamp is 1:25:29.\n\nIf hours are present, minutes must remain 00–59.\n\nSeconds must always remain 00–59.\n\nSummary style\nUse this exact format:\n\n#Section Heading\n[timestamp] - Title: Description\n\nRules:\n\nSection headings should group nearby related points.\n\nTitle should be short and specific.\n\nDescription should summarize the key idea only.\n\nDo not write speaker-log notes like \"he says\" or \"the speaker says\" unless unavoidable.\n\nBe concise but accurate.\n\nMandatory self-check before final output\nBefore answering, verify all of these:\n\nThe first summary timestamp is >= T_start and is never 00:00 unless transcript starts at 00:00.\n\nThe last summary timestamp is near T_end.\n\nAll timestamps appear exactly in the transcript.\n\nTimestamps are strictly increasing.\n\nNo timestamp was recalculated from an earlier one.\n\nNo timestamp was converted into a shortened minute-only form.\n\nNo later part of the transcript has been shifted backward.\n\nAny timestamp >= 1 hour is shown in [h:mm:ss] format.\n\nBeginning, middle, and end are all covered.\n\nIf any check fails, correct it before producing the answer.\n\nOutput rule\nReturn ONLY the final timestamped summary in one fenced code block.\n\nOutput nothing else.\nNo explanations.\nNo notes.\nNo citations.\nNo validation logs.\nPure summary only.\n\n" + transcript + "\n\nOutput rule\nReturn ONLY the final timestamped summary in one fenced code block.\n\nOutput nothing else.\nNo explanations.\nNo notes.\nNo citations.\nNo validation logs.\nPure summary only.\n\nHere is the transcript: " + transcript;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=" + apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const result = await response.json();
    if (result.candidates && result.candidates[0].content.parts[0].text) {
      return result.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Failed to get response from Gemini.");
    }
  }
}