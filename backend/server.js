import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import session from "express-session";
import multer from "multer";
import Replicate from "replicate";
import { google } from "googleapis";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, ".env") });

/** Polyfill for pdf-parse (pdf.js) which expects browser APIs in Node. Call before require("pdf-parse"). */
function ensurePdfPolyfills() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor(init) {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        if (typeof init === "string" && init.startsWith("matrix(")) {
          const m = init.replace(/matrix\(|\)/g, "").split(/,\s*/).map(Number);
          if (m.length >= 6) { this.a = m[0]; this.b = m[1]; this.c = m[2]; this.d = m[3]; this.e = m[4]; this.f = m[5]; }
        }
      }
      transform() { return this; }
      multiply() { return this; }
      inverse() { return this; }
      translate() { return this; }
      scale() { return this; }
      toString() { return `matrix(${this.a},${this.b},${this.c},${this.d},${this.e},${this.f})`; }
    };
  }
  if (typeof globalThis.DOMPoint === "undefined") {
    globalThis.DOMPoint = class DOMPoint {
      constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x; this.y = y; this.z = z; this.w = w;
      }
    };
  }
}

const app = express();
app.use(express.json({ limit: "10mb" }));

// -------------------- CONFIG --------------------
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const LMSTUDIO_URL = process.env.LMSTUDIO_URL || "http://127.0.0.1:1234";
const DEFAULT_MODEL = process.env.LMSTUDIO_MODEL || "meta-llama-3.1-8b-instruct";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const REPLICATE_IMAGE_MODEL =
  process.env.REPLICATE_IMAGE_MODEL || "black-forest-labs/flux-schnell";

// pollinations = free (no key)
// replicate = paid (requires credit)
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || "pollinations").toLowerCase();
const POLLINATIONS_IMAGE_BASE = "https://image.pollinations.ai/prompt";

const MAX_HISTORY_MESSAGES = 20;
const MAX_FILE_CONTEXT_CHARS = 80000;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${process.env.PORT || 5000}/auth/google/callback`;

// -------------------- REPLICATE CLIENT --------------------
const replicate = REPLICATE_API_TOKEN
  ? new Replicate({ auth: REPLICATE_API_TOKEN })
  : null;

function getImageUrlFromReplicate(output) {
  if (output == null) return null;
  if (typeof output === "string") return output;

  const first = Array.isArray(output) ? output[0] : output;

  if (typeof first === "string") return first;
  if (first && typeof first.url === "function") return first.url();
  if (first && typeof first.url === "string") return first.url;

  return null;
}

// -------------------- FILE UPLOAD --------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

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
    name: "chat_session",
    secret: process.env.SESSION_SECRET || "local-ai-secret-123",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);
// server.js - Update detectIntent function
function detectIntent(text) {
  const lower = text.toLowerCase().trim();

  // 1. Check for Calendar/Meeting keywords
  const calendarKeywords = /\b(book|meeting|schedule|calendar|gmeet|meet|school|class|appointment|at\s+\d+)\b/i;
  if (calendarKeywords.test(lower)) {
    return "book_calendar";
  }

  // 2. Existing Image check
  if (/\b(create|draw|generate|make)\s+(an?\s+)?(image|picture|photo|art|illustration)\b/i.test(lower)) {
    return "create_image";
  }

  return "general_chat";
}
// -------------------- HELPERS --------------------
// function detectIntent(text) {
//   const lower = text.toLowerCase().trim();

//   if (
//     /\b(create|draw|generate|make)\s+(an?\s+)?(image|picture|photo|art|illustration)\b|create\s+image|draw\s+me|image\s+of/i.test(
//       lower
//     )
//   ) {
//     return "create_image";
//   }

//   // Only treat as image if it looks like a visual description (e.g. "lion wearing glasses"), not a task
//   const isShort = text.length <= 120 && text.split(/\s+/).length <= 15;
//   const looksLikeQuestion =
//     /\?|^(what|how|why|when|where|who|is|are|can|could|do|does|tell|explain|give)\b/i.test(lower);
//   const notGreeting = !/^(hi|hello|hey|thanks|thank you)/i.test(lower);
//   const looksLikeTask =
//     /\b(book|meeting|schedule|calendar|gmeet|meet|send|remind|call|email|set|delete|remove|open|close|create\s+a\s+(meeting|event|reminder)|add\s+(a\s+)?(meeting|event))\b/i.test(lower);
//   const looksLikeVisualDescription =
//     /\b(wearing|with\s+\w+|on\s+(a|the)|in\s+(a|the)|over\s+the|landscape|portrait|sunset|sunrise|photo\s+of|picture\s+of|drawing\s+of)\b/i.test(lower) ||
//     /^[a-z][a-z\s]{2,60}$/i.test(lower.trim()) && !looksLikeTask; // short noun phrase, no task words

//   if (isShort && !looksLikeQuestion && notGreeting && !looksLikeTask && looksLikeVisualDescription) {
//     return "create_image";
//   }

//   if (/pdf|document|file|read|upload/.test(lower)) {
//     return "read_document";
//   }

//   return "general_chat";
// }

function keywordFallback(text) {
  const t = text.toLowerCase();

  if (t.includes("hello") || t.includes("hi")) return "Hello! How can I help you today?";
  if (t.includes("your name")) return "I am your AI assistant.";
  if (t.includes("date")) return `Today is ${new Date().toDateString()}`;
  if (t.includes("time")) return `The current time is ${new Date().toLocaleTimeString()}`;

  return "Sorry, I couldn't process your request right now.";
}

function getSystemPrompt(lang = "en") {
  const today = new Date().toISOString().slice(0, 10);

  return `
You are a helpful AI assistant.
Today's date is ${today}.
Rules:
- Give correct and helpful answers.
- If unsure, say you don't know.
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
        max_tokens: 400,
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
      temperature: 0.5,
      max_tokens: 350,
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
          fullText += token;
          res.write(`data: ${token.replace(/\n/g, " ")}\n\n`);
        }
      } catch (_) {}
    }
  }

  return fullText;
}

// -------------------- PDF/TXT UPLOAD --------------------
app.post("/api/upload-file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { originalname, buffer } = req.file;
    const ext = (path.extname(originalname || "") || "").toLowerCase();

    if (ext === ".pdf") {
      ensurePdfPolyfills();
      const pdfParseModule = require("pdf-parse");
      const PDFParse = pdfParseModule?.PDFParse ?? pdfParseModule?.default?.PDFParse ?? (typeof pdfParseModule === "function" ? pdfParseModule : null);
      if (!PDFParse || typeof PDFParse !== "function") {
        return res.status(500).json({ error: "PDF parsing is not available on this server. Try uploading a TXT or MD file instead." });
      }
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        let text = result?.text ? String(result.text).trim() : "";
        if (text.length > MAX_FILE_CONTEXT_CHARS) {
          text = text.slice(0, MAX_FILE_CONTEXT_CHARS) + "\n\n[Content truncated for length.]";
        }
        return res.json({ text, filename: originalname });
      } finally {
        await parser.destroy?.();
      }
    }

    if ([".txt", ".md", ".json", ".csv"].includes(ext) || !ext) {
      let text = buffer.toString("utf-8").trim();

      if (text.length > MAX_FILE_CONTEXT_CHARS) {
        text = text.slice(0, MAX_FILE_CONTEXT_CHARS) + "\n\n[Content truncated for length.]";
      }

      return res.json({ text, filename: originalname });
    }

    return res.status(400).json({ error: "Unsupported file type. Use PDF, TXT, MD, JSON, CSV." });
  } catch (err) {
    console.error("Upload error:", err);
    const msg = err.message || "Failed to read file";
    const friendly = /DOMMatrix|not defined|not a function|pdfParse/.test(msg)
      ? "PDF parsing is not fully supported on this server. Try uploading a TXT or MD file instead."
      : msg;
    return res.status(500).json({ error: friendly });
  }
});

// -------------------- ROOT --------------------
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "AI Assistant Backend Running (LM Studio + Streaming + Images)",
  });
});

// -------------------- SET MODEL --------------------
app.post("/api/set-model", (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: "Model is required" });

  req.session.selectedModel = model;
  res.json({ status: "success", model });
});

// -------------------- CLEAR MEMORY --------------------
app.post("/api/clear-memory", (req, res) => {
  req.session.chatHistory = [];
  res.json({ status: "success", message: "Memory cleared" });
});

app.post("/api/check-intent", (req, res) => {
  const { text } = req.body || {};
  const intent = detectIntent(String(text || "").trim());
  res.json({ intent });
});

// -------------------- GOOGLE AUTH + CALENDAR --------------------
function getOAuth2Client() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

app.get("/auth/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent("Google OAuth not configured")}`);
  }
  const oauth2 = getOAuth2Client();
  const url = oauth2.generateAuthUrl({
    scope: ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"],
    access_type: "offline",
    prompt: "consent",
  });
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent(error.toString())}`);
  }
  if (!code) {
    return res.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent("No code from Google")}`);
  }
  try {
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    const oauth2_alt = google.oauth2({ version: "v2", auth: oauth2 });
    const { data: profile } = await oauth2_alt.userinfo.get();
    req.session.tokens = tokens;
    req.session.user = { email: profile.email, name: profile.name, picture: profile.picture };
    res.redirect(`${FRONTEND_URL}?auth=success`);
  } catch (err) {
    console.error("Google callback error:", err);
    res.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent(err.message || "Auth failed")}`);
  }
});

app.get("/auth/me", (req, res) => {
  if (req.session?.user) {
    return res.json({ user: req.session.user });
  }
  res.json({ user: null });
});

app.post("/auth/logout", (req, res) => {
  req.session.tokens = null;
  req.session.user = null;
  res.json({ success: true });
});

app.post("/api/calendar/create-event", async (req, res) => {
  if (!req.session?.tokens) {
    return res.status(401).json({ error: "Not logged in. Please log in with Google first." });
  }
  const { title, start, end, timeZone: tzParam } = req.body || {};
  if (!title || !start || !end) {
    return res.status(400).json({ error: "Missing title, start, or end. Use ISO date strings." });
  }
  const tz = tzParam || "UTC";
  try {
    const oauth2 = getOAuth2Client();
    oauth2.setCredentials(req.session.tokens);
    const calendar = google.calendar({ version: "v3", auth: oauth2 });
    const requestId = `meet-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const { data: event } = await calendar.events.insert({
      calendarId: "primary",
      conferenceDataVersion: 1,
      requestBody: {
        summary: title,
        start: { dateTime: start, timeZone: tz },
        end: { dateTime: end, timeZone: tz },
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });
    const meetLink = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri || null;
    res.json({ success: true, eventId: event.id, htmlLink: event.htmlLink, meetLink });
  } catch (err) {
    console.error("Calendar create error:", err);
    if (err.code === 401 || err.response?.status === 401) {
      req.session.tokens = null;
      req.session.user = null;
      return res.status(401).json({ error: "Session expired. Please log in again with Google." });
    }
    res.status(500).json({ error: err.message || "Failed to create calendar event" });
  }
});

// -------------------- STREAM CHAT + IMAGE --------------------
app.post("/api/agent/stream", async (req, res) => {
  try {
    const { text, language = "en", createImage } = req.body;

    if (!text) return res.status(400).json({ error: "Text is required" });

    const intent = createImage ? "create_image" : detectIntent(text);

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // ---------------- IMAGE GENERATION ----------------
    if (intent === "create_image") {
      const imagePrompt = text.replace(/create\s+(an?\s+)?image\s*/i, "").trim() || text;

      // Pollinations (Free)
      if (IMAGE_PROVIDER === "pollinations") {
        res.write(`data: Generating image (free)...\n\n`);

        const encoded = encodeURIComponent(imagePrompt);
        const imageUrl = `${POLLINATIONS_IMAGE_BASE}/${encoded}?width=1024&height=1024&model=flux`;

        const maxAttempts = 5;
        const retryDelayMs = 4000;

        let lastStatus = 0;

        try {
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const imgRes = await fetch(imageUrl);

            lastStatus = imgRes.status;

            if (imgRes.ok) {
              const buffer = Buffer.from(await imgRes.arrayBuffer());
              const contentType = imgRes.headers.get("content-type") || "image/png";
              const base64 = buffer.toString("base64");
              const dataUrl = `data:${contentType};base64,${base64}`;

              res.write(`data: ${JSON.stringify({ type: "image", content: dataUrl })}\n\n`);
              res.write(`data: [DONE]\n\n`);
              res.end();
              return;
            }

            if ((imgRes.status === 530 || imgRes.status >= 500) && attempt < maxAttempts) {
              res.write(`data: Server busy (${imgRes.status}) retrying... (${attempt}/${maxAttempts})\n\n`);
              await new Promise((r) => setTimeout(r, retryDelayMs));
              continue;
            }

            break;
          }

          res.write(
            `data: ❌ Free image service busy (${lastStatus}). Try again in 1 minute or shorten prompt.\n\n`
          );
        } catch (err) {
          res.write(
            `data: ❌ Free image failed: ${(err.message || err).toString().slice(0, 150)}\n\n`
          );
        }

        res.write(`data: [DONE]\n\n`);
        res.end();
        return;
      }

      // Replicate (Paid)
      if (!REPLICATE_API_TOKEN || !replicate) {
        res.write(
          `data: ❌ Replicate API key missing. Set IMAGE_PROVIDER=pollinations for free.\n\n`
        );
        res.write(`data: [DONE]\n\n`);
        res.end();
        return;
      }

      res.write(`data: Generating image with Replicate...\n\n`);

      try {
        const output = await replicate.run(REPLICATE_IMAGE_MODEL, {
          input: { prompt: imagePrompt },
        });

        const imageUrl = getImageUrlFromReplicate(output);

        if (imageUrl) {
          res.write(`data: ${JSON.stringify({ type: "image", content: imageUrl })}\n\n`);
        } else {
          res.write(`data: ❌ Image generation failed (no image URL)\n\n`);
        }

        res.write(`data: [DONE]\n\n`);
        res.end();
        return;
      } catch (err) {
        const msg = (err.message || err).toString();
        const is402 = msg.includes("402") || /insufficient\s+credit/i.test(msg);

        const userMsg = is402
          ? "Replicate has insufficient credit. Add billing or use free pollinations."
          : `Replicate error: ${msg.slice(0, 200)}`;

        res.write(`data: ❌ ${userMsg}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
        return;
      }
    }

    // ---------------- TEXT STREAMING ----------------
    const history = getSessionHistory(req);

    const messages = [
      { role: "system", content: getSystemPrompt(language) },
      ...history,
      { role: "user", content: text },
    ];

    let finalReply = "";

    try {
      finalReply = await lmStudioStream(req, messages, res);
    } catch (err) {
      res.write(`data: ❌ ${err.message || "Streaming failed"}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
      return;
    }

    addToSessionHistory(req, "user", text);
    addToSessionHistory(req, "assistant", finalReply);

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (error) {
    console.error("Streaming Backend Error:", error);

    if (res.headersSent) {
      res.write(`data: ❌ Internal server error\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// -------------------- START --------------------
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Frontend allowed: ${FRONTEND_URL}`);
  console.log(`Using LM Studio at: ${LMSTUDIO_URL}`);
  console.log(`Default model: ${DEFAULT_MODEL}`);
  console.log(
    `Image provider: ${IMAGE_PROVIDER} ${
      IMAGE_PROVIDER === "replicate"
        ? `(model: ${REPLICATE_IMAGE_MODEL})`
        : "(Pollinations.ai free)"
    }`
  );
});
