import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import session from "express-session";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(express.json({ limit: "5mb" }));

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true
  })
);

// SESSION MIDDLEWARE
app.use(session({
  secret: process.env.SESSION_SECRET || "your-secret-key",
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// GOOGLE OAUTH2 CLIENT
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);


const PORT = process.env.PORT || 5000;

// HEALTH CHECK
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Voice Agent Backend Running" });
});

// RULE-BASED FALLBACK
function fallbackResponse(text) {
  const t = text.toLowerCase();

  if (t.includes("hello") || t.includes("hi")) {
    return "Hello! How can I help you today?";
  }

  if (t.includes("your name")) {
    return "I am your AI Voice Assistant demo agent.";
  }

  if (t.includes("schedule") || t.includes("meeting") || t.includes("calendar")) {
    return "Sure! I understood you want to schedule something. In the demo version, I can simulate creating a Google Calendar event.";
  }

  if (t.includes("drive") || t.includes("onedrive") || t.includes("document")) {
    return "Yes, I can read documents from Google Drive or OneDrive in the future integration version.";
  }

  return "Got it. I understood your request. In the full version, I can perform actions like Google Calendar scheduling and document reading.";
}

// INTENT DETECTION
function detectIntent(text) {
  const lower = text.toLowerCase();

  if (lower.includes("schedule") || lower.includes("calendar") || lower.includes("meeting")) {
    return "create_calendar_event";
  }

  if (lower.includes("drive") || lower.includes("onedrive") || lower.includes("document")) {
    return "read_document";
  }

  return "general_chat";
}

// HUGGINGFACE AI CALL (FREE)
async function huggingFaceReply(prompt) {
  const HF_API_KEY = process.env.HF_API_KEY;

  const response = await fetch(
    "https://api-inference.huggingface.co/models/microsoft/DialoGPT-medium",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(HF_API_KEY ? { Authorization: `Bearer ${HF_API_KEY}` } : {})
      },
      body: JSON.stringify({ inputs: prompt })
    }
  );

  const data = await response.json();

  if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
  if (data?.generated_text) return data.generated_text;

  return null;
}

// MAIN AGENT ENDPOINT
app.post("/api/agent", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });

    const intent = detectIntent(text);

    let aiReply = null;
    try {
      aiReply = await huggingFaceReply(text);
    } catch (err) {
      aiReply = null;
    }

    if (!aiReply) aiReply = fallbackResponse(text);

    res.json({
      intent,
      transcript: text,
      reply: aiReply
    });
  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MOCK GOOGLE CALENDAR ENDPOINT (NO OAUTH)
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
        notes: notes || ""
      }
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Mock Calendar Failed" });
  }
});

// GOOGLE OAUTH ROUTES
app.get("/auth/google", (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.events"]
  });
  res.redirect(authUrl);
});

// GOOGLE OAUTH CALLBACK - STORES TOKENS IN SESSION
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    
    // Store tokens in session
    req.session.tokens = tokens;
    req.session.googleAccessToken = tokens.access_token;
    req.session.googleRefreshToken = tokens.refresh_token;
    
    console.log("Google OAuth Success - Tokens stored in session");
    res.redirect(`${process.env.FRONTEND_URL}?auth=success`);
  } catch (error) {
    console.error("OAuth Error:", error);
    res.redirect(`${process.env.FRONTEND_URL}?auth=failed`);
  }
});

// CHECK AUTHENTICATION STATUS
app.get("/auth/status", (req, res) => {
  if (req.session.googleAccessToken) {
    res.json({ authenticated: true, token: req.session.googleAccessToken });
  } else {
    res.json({ authenticated: false });
  }
});

// LOGOUT ROUTE
app.get("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.json({ status: "logged out" });
  });
});


app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
