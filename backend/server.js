import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import { google } from "googleapis";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
app.use(express.json({ limit: "10mb" }));

 
let chatHistory = [];

 
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
 
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false, // localhost = false
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  })
);
 
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const PORT = process.env.PORT || 5000;

 
const GEMINI_KEY = (process.env.GEMINI_API_KEY || "").trim();
const genAI = GEMINI_KEY
  ? new GoogleGenerativeAI(GEMINI_KEY)
  : null;

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || null;
const GROQ_API_KEY = process.env.GROQ_API_KEY || null;

console.log("Gemini Key Loaded:", !!GEMINI_KEY);
console.log("HuggingFace Key Loaded:", !!HUGGINGFACE_API_KEY);
console.log("Groq Key Loaded:", !!GROQ_API_KEY);
 
function detectIntent(text) {
  const lower = text.toLowerCase();

  if (/meeting|schedule|calendar|event|appointment/.test(lower)) {
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

  return "I'm sorry, I couldn't process that right now. Please check your API keys (Gemini, HuggingFace, or Groq in .env) and try again.";
}

 
async function geminiReply(prompt) {
  if (!genAI) return null;

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 256, 
      },
    });
    const result = await model.generateContent(prompt);
    let text;
    try {
      text = result.response.text();
    } catch (textErr) {
      console.log("Gemini response blocked or empty:", textErr.message || textErr);
      return null;
    }
    if (text && text.trim()) return text.trim();
    return null;
  } catch (err) {
    console.error("Gemini Error:", err.message || err);
    if (err.message) console.error("  → Check key at https://aistudio.google.com/apikey and quota/safety settings.");
    return null;
  }
}
 
async function huggingFaceReplyWithModel(prompt, model) {
  const url = `https://api-inference.huggingface.co/models/${model}`;
  const instruction = `Answer the following question clearly and concisely: ${prompt}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: instruction,
      parameters: {
        max_new_tokens: 256,
        return_full_text: false,
        temperature: 0.7,
      },
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (Array.isArray(data) && data[0]?.generated_text) {
    return data[0].generated_text.trim();
  }
  if (data.generated_text) return data.generated_text.trim();
  return null;
}

async function huggingFaceReply(prompt) {
  if (!HUGGINGFACE_API_KEY) return null;

  try {
    const models = [
      "mistralai/Mistral-7B-Instruct-v0.2",
      "google/flan-t5-large",
    ];
    for (const model of models) {
      const reply = await huggingFaceReplyWithModel(prompt, model);
      if (reply) return reply;
    }
    return null;
  } catch (err) {
    console.log("HuggingFace Error:", err.message || err);
    return null;
  }
}

 
async function groqReply(prompt) {
  if (!GROQ_API_KEY) return null;

  const url = "https://api.groq.com/openai/v1/chat/completions";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 256,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.log("Groq API Error:", res.status, errBody.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (content && content.trim()) return content.trim();
    return null;
  } catch (err) {
    console.log("Groq Error:", err.message || err);
    return null;
  }
} 
 
async function getAIReply(prompt) {
  let reply = await geminiReply(prompt);
  if (reply) return { reply, provider: "gemini" };

  reply = await huggingFaceReply(prompt);
  if (reply) return { reply, provider: "huggingface" };

  reply = await groqReply(prompt);
  if (reply) return { reply, provider: "groq" };

  return { reply: keywordFallback(prompt), provider: "keyword" };
}

 
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Voice Agent Backend Running" });
});

 
app.get("/test-gemini", async (req, res) => {
  const reply = await geminiReply("Who is the Prime Minister of India?");
  res.json({ reply });
});
 
app.post("/api/agent", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const intent = detectIntent(text);

    console.log("User Text:", text);
    console.log("Detected Intent:", intent);

    const { reply: aiReply, provider } = await getAIReply(text);
    console.log("AI Provider used:", provider);

    res.json({
      intent,
      transcript: text,
      reply: aiReply,
      provider,
    });
  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

 
app.post("/api/mock-calendar", async (req, res) => {
  try {
    const { title, date, time, notes } = req.body;

    const eventId = "demo_evt_" + Math.random().toString(36).substring(2, 10);

    res.json({
      status: "success",
      message: "Mock Calendar Event Created Successfully",
      event: {
        id: eventId,
        title: title || "Meeting",
        date: date || "Tomorrow",
        time: time || "5:00 PM",
        notes: notes || "",
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Mock Calendar Failed" });
  }
});

 
app.get("/auth/google", (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
  });

  res.redirect(authUrl);
});
 
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;

    const { tokens } = await oauth2Client.getToken(code);

    req.session.tokens = tokens;
    req.session.googleAccessToken = tokens.access_token;
    req.session.googleRefreshToken = tokens.refresh_token;

    console.log("Google OAuth Success - Tokens stored");

    res.redirect(`${process.env.FRONTEND_URL}?auth=success`);
  } catch (error) {
    console.error("OAuth Error:", error);
    res.redirect(`${process.env.FRONTEND_URL}?auth=failed`);
  }
});
 
app.get("/auth/status", (req, res) => {
  if (req.session.googleAccessToken) {
    res.json({ authenticated: true, token: req.session.googleAccessToken });
  } else {
    res.json({ authenticated: false });
  }
});
 
app.get("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });

    res.json({ status: "logged out" });
  });
});

 
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
