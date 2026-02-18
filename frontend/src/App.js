import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import "./App.scss";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";

export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const recognitionRef = useRef(null);
  const threadEndRef = useRef(null);

  const scrollToBottom = () => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // ==========================
  // Speech Recognition Setup
  // ==========================
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech Recognition not supported in this browser. Use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = async (event) => {
      const speechText = event.results[0][0].transcript;
      setTranscript(speechText);

      // Add user message to thread
      const userMsg = { id: Date.now(), role: "user", content: speechText };
      setMessages((prev) => [...prev, userMsg]);

      // Send to backend and add assistant reply to thread
      await sendToBackend(speechText);
    };

    recognition.onerror = (event) => {
      console.log("Speech Recognition Error:", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, []);

  // ==========================
  // Speak Function
  // ==========================
  const speakText = (text) => {
    if (!text) return;

    window.speechSynthesis.cancel(); // stop previous speech

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;

    window.speechSynthesis.speak(utterance);
  };

  // ==========================
  // API Call to Backend
  // ==========================
  const sendToBackend = async (text) => {
    try {
      setLoading(true);

      const res = await axios.post(
        `${BACKEND_URL}/api/agent`,
        { text },
        { withCredentials: true }
      );

      const reply = res.data.reply;
      const assistantMsg = { id: Date.now(), role: "assistant", content: reply };
      setMessages((prev) => [...prev, assistantMsg]);

      speakText(reply);
    } catch (err) {
      console.log("Backend Error:", err);
      const errMsg = { id: Date.now(), role: "assistant", content: "Error connecting to backend." };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  // ==========================
  // Start Listening
  // ==========================
  const startListening = () => {
    if (!recognitionRef.current) return;

    setTranscript("");
    setIsListening(true);

    recognitionRef.current.start();
  };

  const lastAssistantMessage = messages.filter((m) => m.role === "assistant").pop();

  const clearThread = () => {
    setMessages([]);
    setTranscript("");
  };

  // ==========================
  // Stop Listening
  // ==========================
  const stopListening = () => {
    if (!recognitionRef.current) return;

    recognitionRef.current.stop();
    setIsListening(false);
  };

  return (
    <div className="app">
      <h1 className="title">🎙️ AI Voice Assistant</h1>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Conversation</span>
          {messages.length > 0 && (
            <button type="button" className="btn-new-chat" onClick={clearThread}>
              New chat
            </button>
          )}
        </div>

        <div className="thread">
          {messages.length === 0 && !loading && !transcript && (
            <div className="thread-empty">
              <p>Say something to start the conversation.</p>
              <p className="thread-empty-hint">Click &quot;Start Talking&quot; and speak your question.</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`message message--${msg.role}`}>
              <div className="message-avatar" aria-hidden>
                {msg.role === "user" ? "👤" : "🤖"}
              </div>
              <div className="message-content">
                <div className="message-bubble">
                  {msg.content}
                </div>
                {msg.role === "assistant" && (
                  <button
                    type="button"
                    className="message-speak"
                    onClick={() => speakText(msg.content)}
                    title="Speak this reply"
                  >
                    🔊
                  </button>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="message message--assistant message--loading">
              <div className="message-avatar" aria-hidden>🤖</div>
              <div className="message-content">
                <div className="message-bubble message-bubble--loading">
                  Thinking...
                </div>
              </div>
            </div>
          )}

          <div ref={threadEndRef} className="thread-end" />
        </div>

        <div className="card-footer">
          <div className="status">
            {isListening && <span className="status-dot" />}
            {isListening ? "Listening..." : loading ? "Thinking..." : "Ready"}
          </div>
          <div className="btn-row">
            {!isListening ? (
              <button className="btn start" onClick={startListening}>
                🎤 Start Talking
              </button>
            ) : (
              <button className="btn stop" onClick={stopListening}>
                🛑 Stop
              </button>
            )}

            <button
              className="btn speak"
              onClick={() => lastAssistantMessage && speakText(lastAssistantMessage.content)}
              disabled={!lastAssistantMessage?.content}
            >
              🔊 Speak Last Reply
            </button>
          </div>
        </div>
      </div>

      <p className="footer">
        Backend: <b>{BACKEND_URL}</b>
      </p>
    </div>
  );
}
