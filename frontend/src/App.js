
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";

export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [intent, setIntent] = useState("");
  const [mockEvent, setMockEvent] = useState(null);
  const [error, setError] = useState("");
   const [isAuthenticated, setIsAuthenticated] = useState(false);

  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Speech Recognition not supported. Please use Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = async (event) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      await sendToAgent(text);
    };

    recognition.onerror = (event) => {
      setError("Speech recognition error: " + event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, []);

  const speakText = (text) => {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  };

  const createMockCalendarEvent = async (text) => {
    const title = text.toLowerCase().includes("meeting") ? "Meeting" : "Event";

    const res = await axios.post(`${BACKEND_URL}/api/mock-calendar`, {
      title,
      date: "Tomorrow",
      time: "5:00 PM",
      notes: text
    });

    setMockEvent(res.data.event);
  };

  const sendToAgent = async (text) => {
    try {
      setError("");
      setReply("Thinking...");
      setIntent("");
      setMockEvent(null);

      const res = await axios.post(`${BACKEND_URL}/api/agent`, { text });

      setReply(res.data.reply);
      setIntent(res.data.intent);

      if (res.data.intent === "create_calendar_event") {
        await createMockCalendarEvent(text);
      }

      speakText(res.data.reply);
    } catch (err) {
      setReply("");
      setIntent("");
      setMockEvent(null);
      setError("Backend not reachable or API error.");
    }
  };

  const startListening = () => {
    setError("");
    setTranscript("");
    setReply("");
    setIntent("");
    setMockEvent(null);

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (err) {
      setError("Microphone permission issue or already listening.");
    }
  };

  const stopListening = () => {
    try {
      recognitionRef.current.stop();
      setIsListening(false);
    } catch (err) {}
  };
  const handleGoogleLogin = () => {
  window.location.href = 'https://ai-voice-text-to-speech.onrender.com/auth/google';
};

  return (
    <div style={styles.page}>
      <div style={styles.card}>

     const handleGoogleLogin = () => {
   window.location.href = 'https://ai-voice-text-to-speech.onrender.com/auth/google';
 };
        <div style={styles.header}>
          <h1 style={styles.title}>AI Voice Agent</h1>
          <p style={styles.subTitle}>
            Free Demo (Voice → Intent → Mock Calendar + AI Reply)
          </p>
        </div>
          <button 
  style={{
    width: '100%',
    padding: '12px 18px',
    borderRadius: 12,
    border: 'none',
    background: '#4285F4',
    color: 'white',
    fontSize: 16,
    cursor: 'pointer',
    marginBottom: 10
  }}
  onClick={handleGoogleLogin}
>
  🔗 Login with Google
</button>


        <div style={styles.actions}>
                       <button style={styles.googleBtn} onClick={handleGoogleLogin}>
               🔗 Login with Google
             </button>
          {!isListening ? (
            <button style={styles.primaryBtn} onClick={startListening}>
              🎤 Start Talking
            </button>
          ) : (
            <button style={styles.stopBtn} onClick={stopListening}>
              ⏹ Stop
            </button>
          )}
        </div>

        {error && (
          <div style={styles.errorBox}>
            <b>Error:</b> {error}
          </div>
        )}

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Transcript</h3>
          <div style={styles.box}>{transcript || "..."}</div>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Agent Reply</h3>
          <div style={styles.box}>{reply || "..."}</div>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Detected Intent</h3>
          <div style={styles.intentBox}>{intent || "..."}</div>
        </div>

        {mockEvent && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Mock Google Calendar Result</h3>
            <div style={styles.mockCard}>
              <p style={styles.mockRow}><b>Event ID:</b> {mockEvent.id}</p>
              <p style={styles.mockRow}><b>Title:</b> {mockEvent.title}</p>
              <p style={styles.mockRow}><b>Date:</b> {mockEvent.date}</p>
              <p style={styles.mockRow}><b>Time:</b> {mockEvent.time}</p>
            </div>
          </div>
        )}

        <div style={styles.footer}>
          <p style={styles.footerText}>
            Demo Features: Free voice recognition, free voice output, HuggingFace AI reply (free),
            fallback assistant logic, and mock Google Calendar creation.
          </p>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    background: "#f6f7fb",
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    fontFamily: "Arial, sans-serif"
  },
  card: {
    width: 720,
    background: "#fff",
    borderRadius: 18,
    padding: 30,
    boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
    border: "1px solid #eee"
  },
  header: {
    marginBottom: 20
  },
  title: {
    margin: 0,
    fontSize: 34,
    fontWeight: 700
  },
  subTitle: {
    marginTop: 8,
    color: "#666",
    fontSize: 15
  },
  actions: {
    marginTop: 15,
    marginBottom: 20
  },
  primaryBtn: {
    width: "100%",
    padding: "14px 18px",
    borderRadius: 12,
    border: "none",
    background: "#111",
    color: "#fff",
    fontSize: 16,
    cursor: "pointer"
  },
  stopBtn: {
    width: "100%",
    padding: "14px 18px",
    borderRadius: 12,
    border: "none",
    background: "#d93025",
    color: "#fff",
    fontSize: 16,
    cursor: "pointer"
  },
   googleBtn: {
   width: "100%",
   padding: "12px 18px",
   borderRadius: 12,
   border: "none",
   background: "#4285F4",
   color: "#fff",
   fontSize: 16,
   cursor: "pointer",
   marginBottom: 10
 },
  section: {
    marginTop: 18
  },
  sectionTitle: {
    margin: "0 0 8px 0",
    fontSize: 16,
    color: "#333"
  },
  box: {
    background: "#f9fafb",
    padding: 14,
    borderRadius: 12,
    border: "1px solid #eee",
    minHeight: 55,
    fontSize: 15
  },
  intentBox: {
    background: "#eef6ff",
    padding: 14,
    borderRadius: 12,
    border: "1px solid #dcecff",
    minHeight: 40,
    fontSize: 15,
    fontWeight: "bold",
    color: "#0b4aa2"
  },
  errorBox: {
    padding: 12,
    borderRadius: 12,
    background: "#fff1f1",
    border: "1px solid #ffd4d4",
    color: "#b30000",
    marginBottom: 15
  },
  mockCard: {
    background: "#f3fff4",
    border: "1px solid #c9f0cf",
    padding: 14,
    borderRadius: 12
  },
  mockRow: {
    margin: "6px 0",
    fontSize: 14
  },
  footer: {
    marginTop: 25,
    borderTop: "1px solid #eee",
    paddingTop: 15
  },
  footerText: {
    margin: 0,
    color: "#777",
    fontSize: 13
  }
};
