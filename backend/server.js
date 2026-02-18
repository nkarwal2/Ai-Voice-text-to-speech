import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
app.use(express.json({ limit: "10mb" }));

// -------------------- CONFIG --------------------
const PORT = process.env.PORT || 5000;

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const LMSTUDIO_URL = process.env.LMSTUDIO_URL || "http://127.0.0.1:1234";
const DEFAULT_MODEL = process.env.LMSTUDIO_MODEL || "meta-llama-3.1-8b-instruct";

const MAX_HISTORY_MESSAGES = 20;

// -------------------- CORS --------------------
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// -------------------- SESSION --------------------
app.use(
  session({
    secret: process.env.SESSION_SECRET || "local-ai-secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  })
);

// -------------------- HELPERS --------------------
function detectIntent(text) {
  const lower = text.toLowerCase().trim();

  // Calendar: any mention of meeting/calendar/schedule/appointment + optional date/time
  const hasCalendarKeyword = /\b(meeting|calendar|schedule|appointment|event)\b|book\s|add\s+(a\s+)?(meeting|event)|google\s+meeting|google\s+calendar|set\s+up\s+(a\s+)?(meeting|event)|create\s+(a\s+)?(meeting|event)|want\s+to\s+(add|schedule|book)|need\s+(a\s+)?(meeting|appointment)|put\s+(a\s+)?(meeting|event)\s+on/i.test(lower);
  const hasDateAndTime = /(tomorrow|next\s+week|today).*(\d|am|pm|o'?clock)/i.test(lower) || /(tomorrow|next\s+week)\s*[,\s]*(\d{1,2})\s*(am|pm)?/i.test(lower);
  const shortRequest = /^(ready\s+)?(tomorrow|today|next\s+week)\s*[,\s]*(\d{1,2})\s*(am|pm)?\.?$/i.test(lower);

  if (hasCalendarKeyword || hasDateAndTime || shortRequest) {
    return "create_calendar_event";
  }

  if (/drive|document|file|pdf|docx|read/.test(lower)) {
    return "read_document";
  }

  return "general_chat";
}

function keywordFallback(text) {
  const t = text.toLowerCase();

  if (t.includes("hello") || t.includes("hi")) {
    return "Hello! How can I help you today?";
  }

  if (t.includes("your name")) {
    return "I am your AI Voice Assistant.";
  }

  if (t.includes("day") || t.includes("date")) {
    return `Today is ${new Date().toDateString()}`;
  }

  if (t.includes("time")) {
    return `The current time is ${new Date().toLocaleTimeString()}`;
  }

  return "Sorry, I couldn't process your request right now.";
}

function getSystemPrompt(lang = "en") {
  const langRules = {
    en: "You MUST respond only in English. The user has selected English as their response language—ignore what language they typed or spoke in; always reply in English.",
    hi: "You MUST respond only in Hindi (हिन्दी). The user has selected Hindi as their response language—always reply in Hindi.",
    es: "You MUST respond only in Spanish (Español). The user has selected Spanish as their response language—always reply in Spanish.",
    fr: "You MUST respond only in French (Français). The user has selected French as their response language—always reply in French.",
  };
  const langRule = langRules[lang] || langRules.en;

  return `
You are a helpful AI voice assistant. ${langRule}
Rules:
- Give correct, concise answers. If unsure, say you don't know.
- If user asks for code, give complete working code.
- You can help book meetings: when the user asks to schedule a meeting (e.g. "book a meeting for tomorrow in Google Calendar"), confirm that the meeting has been added and state the date/time. The system will create the calendar event.
- Keep responses clean and professional.
  `.trim();
}

// -------------------- SESSION MEMORY --------------------
function getSessionHistory(req) {
  if (!req.session.chatHistory) req.session.chatHistory = [];
  return req.session.chatHistory;
}

function addToSessionHistory(req, role, content) {
  const history = getSessionHistory(req);
  history.push({ role, content });

  if (history.length > MAX_HISTORY_MESSAGES) {
    req.session.chatHistory = history.slice(history.length - MAX_HISTORY_MESSAGES);
  }
}

function getSelectedModel(req) {
  return req.session.selectedModel || DEFAULT_MODEL;
}

// -------------------- CALENDAR (mock – can swap for real Google Calendar API) --------------------
function parseMeetingRequest(text) {
  const lower = text.toLowerCase();
  let date = new Date();
  let time = "10:00";

  if (/tomorrow/.test(lower)) {
    date.setDate(date.getDate() + 1);
  } else if (/next week/.test(lower)) {
    date.setDate(date.getDate() + 7);
  }
  // Match "3", "3pm", "3:30", "tomorrow 3", "ready tomorrow 3"
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = timeMatch[2] ? timeMatch[2] : "00";
    const ampm = (timeMatch[3] || "").toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    // "tomorrow 3" or "ready tomorrow 3" with no am/pm -> assume PM if 1-7, else AM
    if (!ampm && h >= 1 && h <= 7) h += 12;
    if (h >= 24) h -= 12;
    time = `${String(h).padStart(2, "0")}:${m}`;
  }

  const titleMatch = text.match(/(?:meeting|event|appointment)\s+(?:for\s+)?["']?([^"'\n.]+)["']?|(?:book|schedule)\s+["']?([^"'\n.]+)["']?/i);
  const title = titleMatch ? (titleMatch[1] || titleMatch[2] || "Meeting").trim() : "Meeting";

  return {
    title,
    date: date.toISOString().slice(0, 10),
    time,
    notes: "",
  };
}

function bookMeeting(req, body) {
  const { title, date, time, notes } = body;
  const event = {
    id: "evt_" + Date.now(),
    title: title || "Meeting",
    date: date || new Date().toISOString().slice(0, 10),
    time: time || "10:00",
    notes: notes || "",
    created: new Date().toISOString(),
  };
  if (!req.session.calendarEvents) req.session.calendarEvents = [];
  req.session.calendarEvents.push(event);
  return event;
}

/**
 * Build Google Calendar "Add event" URL so user is redirected to Calendar with event pre-filled.
 * Format: https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=start/end&details=...
 */
function buildGoogleCalendarUrl(event) {
  const [y, m, d] = (event.date || "").split("-").map(Number);
  const [th, tm] = (event.time || "10:00").split(":").map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1, th || 10, tm || 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  const fmt = (date) => {
    const Y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, "0");
    const D = String(date.getDate()).padStart(2, "0");
    const H = String(date.getHours()).padStart(2, "0");
    const Min = String(date.getMinutes()).padStart(2, "0");
    const S = "00";
    return `${Y}${M}${D}T${H}${Min}${S}`;
  };

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title || "Meeting",
    dates: `${fmt(start)}/${fmt(end)}`,
  });
  if (event.notes) params.set("details", event.notes);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// -------------------- LM STUDIO NORMAL REPLY --------------------
async function lmStudioReply(req, messages) {
  try {
    const model = getSelectedModel(req);

    const res = await fetch(`${LMSTUDIO_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.6,
        max_tokens: 320,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.log("LM Studio Error:", res.status, errText.slice(0, 200));
      return null;
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.log("LM Studio Fetch Error:", err.message || err);
    return null;
  }
}

// -------------------- LM STUDIO STREAMING REPLY --------------------
async function lmStudioStream(req, messages, res) {
  const model = getSelectedModel(req);

  const response = await fetch(`${LMSTUDIO_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.6,
      max_tokens: 320,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LM Studio stream error: ${response.status} ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((l) => l.trim() !== "");

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;

      const dataStr = line.replace("data:", "").trim();

      if (dataStr === "[DONE]") {
        return fullText;
      }

      try {
        const parsed = JSON.parse(dataStr);
        const token = parsed.choices?.[0]?.delta?.content;

        if (token) {
          // Insert space between tokens when model doesn't (avoids "Reactisapopular" -> "React is a popular")
          const needsSpace = fullText.length > 0 &&
            !/[\s.,!?;:)\]}"']$/.test(fullText) &&
            !/^[\s.,!?;:(\[{"']/.test(token);
          let toSend = needsSpace ? ` ${token}` : token;
          // Fix run-together words within token (e.g. "assumingyouare" -> "assuming you are")
          if (toSend.length > 10 && !/\s/.test(toSend)) toSend = fixRunTogetherWords(toSend) || toSend;
          fullText += toSend;
          res.write(`data: ${String(toSend).replace(/\n/g, " ")}\n\n`);
        }
      } catch (err) {
        // ignore chunk parse errors
      }
    }
  }

  return fullText;
}

// Insert spaces before common words when they appear run-together (e.g. "assumingyouare" -> "assuming you are")
function fixRunTogetherWords(text) {
  if (!text || text.length < 4 || /\s/.test(text)) return text;
  const words = [
    "you", "are", "the", "and", "for", "with", "that", "this", "have", "from", "not", "but", "they", "were", "been",
    "has", "had", "was", "will", "can", "would", "could", "should", "may", "might", "must", "what", "when", "where",
    "which", "who", "how", "refer", "referring", "refers", "related", "architecture", "engineering", "construction",
    "term", "assuming", "about", "into", "their", "there", "being", "other", "some", "than", "then", "them", "these",
    "those", "very", "just", "also", "only", "more", "most", "such", "here", "your", "over", "after", "before",
    "between", "under", "again", "because", "through", "during", "without", "erection", "proc", "construction",
  ];
  let out = text;
  for (const w of words) {
    if (w.length < 2) continue;
    const re = new RegExp(`([a-z])(${w})(?=[a-z]|$)`, "gi");
    out = out.replace(re, (_, before, word) => `${before} ${word}`);
  }
  return out;
}

// -------------------- ROUTES --------------------
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "AI Assistant Backend Running (LM Studio + Streaming + Memory)",
  });
});

// test route
app.get("/test-lmstudio", async (req, res) => {
  const messages = [
    { role: "system", content: getSystemPrompt() },
    { role: "user", content: "Hello, who are you?" },
  ];  

  const reply = await lmStudioReply(req, messages);
  res.json({ reply, model: getSelectedModel(req) });
});

// set model route
app.post("/api/set-model", (req, res) => {
  const { model } = req.body;

  if (!model) {
    return res.status(400).json({ error: "Model is required" });
  }

  req.session.selectedModel = model;

  res.json({
    status: "success",
    model,
  });
});

// clear memory
app.post("/api/clear-memory", (req, res) => {
  req.session.chatHistory = [];
  res.json({ status: "success", message: "Memory cleared" });
});

// book meeting (mock – add to "Google Calendar" via session; can replace with real API)
app.post("/api/calendar/book", (req, res) => {
  try {
    const event = bookMeeting(req, req.body);
    res.json({ status: "success", event });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// normal agent (non-streaming)
app.post("/api/agent", async (req, res) => {
  try {
    const { text, language = "en" } = req.body;

    if (!text) return res.status(400).json({ error: "Text is required" });

    const intent = detectIntent(text);
    let calendarEvent = null;

    if (intent === "create_calendar_event") {
      const parsed = parseMeetingRequest(text);
      calendarEvent = bookMeeting(req, parsed);
    }

    const history = getSessionHistory(req);
    let systemPrompt = getSystemPrompt(language);
    if (calendarEvent) {
      systemPrompt += `\n\n[System: A calendar event was prepared: "${calendarEvent.title}" on ${calendarEvent.date} at ${calendarEvent.time}. Reply with ONE SHORT SENTENCE in their language. Do NOT give step-by-step instructions.]`;
    }

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: text },
    ];

    const aiReply = await lmStudioReply(req, messages);

    if (!aiReply) {
      return res.json({
        intent,
        transcript: text,
        reply: keywordFallback(text),
        provider: "keyword",
        model: getSelectedModel(req),
      });
    }

    addToSessionHistory(req, "user", text);
    addToSessionHistory(req, "assistant", aiReply);

    const payload = {
      intent,
      transcript: text,
      reply: aiReply,
      provider: "lmstudio",
      model: getSelectedModel(req),
      memoryCount: req.session.chatHistory.length,
    };
    if (calendarEvent) {
      payload.calendarUrl = buildGoogleCalendarUrl(calendarEvent);
    }
    res.json(payload);
  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// streaming agent (chatgpt typing)
app.post("/api/agent/stream", async (req, res) => {
  let calendarEvent = null;
  let calendarUrl = null;
  let taskTitle = null;

  try {
    const { text, language = "en" } = req.body;

    if (!text) return res.status(400).json({ error: "Text is required" });

    const intent = detectIntent(text);
    let systemPrompt = getSystemPrompt(language);

    if (intent === "create_calendar_event") {
      try {
        const parsed = parseMeetingRequest(text);
        calendarEvent = bookMeeting(req, parsed);
        calendarUrl = buildGoogleCalendarUrl(calendarEvent);
        taskTitle = `${calendarEvent.title} — ${calendarEvent.date} at ${calendarEvent.time}`;
        systemPrompt += `\n\n[System: The user asked to add a meeting. Google Calendar will open in their browser with this event pre-filled: "${calendarEvent.title}" on ${calendarEvent.date} at ${calendarEvent.time}. Reply with ONE SHORT SENTENCE only in their language.]`;
      } catch (calErr) {
        console.error("Calendar parse error:", calErr.message || calErr);
      }
    }

    const history = getSessionHistory(req);

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: text },
    ];

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // If we have a calendar URL, send it first so calendar always works even if LLM fails
    if (calendarUrl && taskTitle) {
      res.setHeader("X-Calendar-URL", calendarUrl);
      res.setHeader("X-Calendar-Task", JSON.stringify({ title: taskTitle, status: "Opened in Google Calendar" }));
      res.setHeader("Access-Control-Expose-Headers", "X-Calendar-URL, X-Calendar-Task");
      res.write(`data: ${JSON.stringify({
        type: "calendar",
        url: calendarUrl,
        task: { id: String(req.session.calendarEvents?.length || 1), title: taskTitle, status: "Opened in Google Calendar" },
      })}\n\n`);
    }

    let finalReply = "";

    try {
      finalReply = await lmStudioStream(req, messages, res);
    } catch (err) {
      console.error("Streaming Error:", err.message || err);
      // For calendar requests, send a friendly fallback so user still sees success and can click the link
      if (calendarUrl) {
        const fallback = `I've opened Google Calendar with your meeting. Click "Open Google Calendar" above if the tab didn't open.`;
        res.write(`data: ${fallback}\n\n`);
      } else {
        res.write(`data: ❌ Streaming failed. Is LM Studio running at ${process.env.LMSTUDIO_URL || "http://127.0.0.1:1234"}?\n\n`);
      }
      res.write(`data: [DONE]\n\n`);
      res.end();
      return;
    }

    // save memory
    addToSessionHistory(req, "user", text);
    addToSessionHistory(req, "assistant", finalReply);

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (error) {
    console.error("Streaming Backend Error:", error);
    // If we already sent headers (e.g. calendar), send error in stream instead of 500
    if (res.headersSent) {
      try {
        res.write(`data: Sorry, something went wrong. ${calendarUrl ? 'Click "Open Google Calendar" above to add your meeting.' : ''}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
      } catch (_) {}
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// -------------------- START --------------------
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Using LM Studio at: ${LMSTUDIO_URL}`);
  console.log(`Default model: ${DEFAULT_MODEL}`);
});
