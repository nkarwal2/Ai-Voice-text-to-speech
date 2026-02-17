import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import "./App.scss";

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
    window.location.href =
      "https://ai-voice-text-to-speech.onrender.com/auth/google";
  };

  return (
    <div className="app">
      <header className="top-header">
        <div className="header-content">
          <div className="logo">
            <span className="logo-icon">🤖</span>
            <span className="logo-text">AI Agent</span>
          </div>

          <button className="google-header-btn" onClick={handleGoogleLogin}>
            <svg className="google-icon" viewBox="0 0 24 24" width="18" height="18">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span>Login with Google</span>
          </button>
        </div>
      </header>
 
      <main className="main-content"> 
        <div className="main-flex-1">
          <div className="container">
            <div className="welcome-section">
              <h1 className="welcome-title">What can I help with?</h1>
              <p className="welcome-subtitle">
                Voice-powered AI assistant with calendar integration
              </p>
            </div>

            <div className="voice-controls">
              {!isListening ? (
                <button className="voice-btn" onClick={startListening}>
                  <span className="voice-icon">🎤</span>
                  <span>Start Talking</span>
                </button>
              ) : (
                <button className="voice-btn stop" onClick={stopListening}>
                  <span className="voice-icon">⏹</span>
                  <span>Stop</span>
                </button>
              )}
            </div>

            {/* Error Display */}
            {error && (
              <div className="message-box error-message">
                <strong>Error:</strong> {error}
              </div>
            )}

            {(transcript || reply) && (
              <div className="conversation">
                {transcript && (
                  <div className="message user-message">
                    <div className="message-avatar">👤</div>
                    <div className="message-content">
                      <div className="message-label">You</div>
                      <div className="message-text">{transcript}</div>
                    </div>
                  </div>
                )}

                {reply && (
                  <div className="message assistant-message">
                    <div className="message-avatar">🤖</div>
                    <div className="message-content">
                      <div className="message-label">AI Agent</div>
                      <div className="message-text">{reply}</div>

                      {intent && (
                        <div className="intent-badge">Intent: {intent}</div>
                      )}
                    </div>
                  </div>
                )}

                {mockEvent && (
                  <div className="calendar-event">
                    <div className="event-header">
                      <span className="event-icon">📅</span>
                      <span className="event-title">
                        Calendar Event Created
                      </span>
                    </div>

                    <div className="event-details">
                      <div className="event-row">
                        <span className="event-label">Title:</span>
                        <span className="event-value">{mockEvent.title}</span>
                      </div>
                      <div className="event-row">
                        <span className="event-label">Date:</span>
                        <span className="event-value">{mockEvent.date}</span>
                      </div>
                      <div className="event-row">
                        <span className="event-label">Time:</span>
                        <span className="event-value">{mockEvent.time}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
 
        <footer className="app-footer">
          <p>
            Free demo with voice recognition, AI replies, and mock calendar
            integration
          </p>
        </footer>
      </main>
    </div>
  );
}
