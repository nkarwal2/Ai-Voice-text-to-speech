import React, { useEffect, useRef, useState } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";

// Microphone icon for header
function MicIcon({ className = "w-6 h-6" }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z" />
      <path d="M19 11v1a7 7 0 0 1-14 0v-1h2v1a5 5 0 0 0 10 0v-1h2Z" />
      <path d="M5 14v2h14v-2H5Z" />
    </svg>
  );
}

// Speaker icon for Speak Last Reply
function SpeakerIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06L7 8H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h3l3.94 3.94c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z" />
      <path d="M15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}

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

      const userMsg = { id: Date.now(), role: "user", content: speechText };
      setMessages((prev) => [...prev, userMsg]);

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

  const speakText = (text) => {
    if (!text) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;

    window.speechSynthesis.speak(utterance);
  };

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
      const errMsg = {
        id: Date.now(),
        role: "assistant",
        content: "Error connecting to backend.",
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const startListening = () => {
    if (!recognitionRef.current) return;
    setTranscript("");
    setIsListening(true);
    recognitionRef.current.start();
  };

  const lastAssistantMessage = messages.filter((m) => m.role === "assistant").pop();

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
  };

  const clearThread = () => {
    // Stop any ongoing TTS (agent speaking)
    window.speechSynthesis.cancel();
    // Stop listening if mic is active
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
    setMessages([]);
    setTranscript("");
  };

  const stopListening = () => {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsListening(false);
  };

  const statusText = isListening ? "Listening..." : loading ? "Thinking..." : "Ready";
  const isReady = !isListening && !loading;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center py-10 px-4 bg-[#0d0f0e] bg-gradient-to-b from-[#0f1412] via-[#0d0f0e] to-[#080908]">
      {/* Header — centered, clean */}
      <header className="flex items-center justify-center gap-2.5 mb-10">
        <MicIcon className="w-7 h-7 text-zinc-200" />
        <h1 className="text-xl font-semibold text-zinc-100 tracking-tight">
          AI Voice Assistant
        </h1>
      </header>

      {/* Main card — floating, subtle glass */}
      <div className="w-full max-w-[520px] flex flex-col rounded-xl bg-zinc-800/95 border border-white/[0.06] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-[0.12em]">
            Conversation
          </span>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearThread}
              className="text-xs font-medium text-zinc-400 hover:text-zinc-300 rounded-md px-2.5 py-1.5 hover:bg-white/[0.06] transition-colors"
            >
              New chat
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-4 min-h-[220px]">
          {messages.length === 0 && !loading && !transcript && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-10 px-4">
              <p className="text-[15px] text-zinc-400 leading-relaxed">
                Say something to start the conversation.
              </p>
              <p className="text-sm text-zinc-500 leading-relaxed">
                Click &apos;Start Talking&apos; and speak your question.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className="flex gap-3 items-start animate-[messageIn_0.2s_ease-out]"
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${
                  msg.role === "user" ? "bg-zinc-600" : "bg-emerald-600/30"
                }`}
                aria-hidden
              >
                {msg.role === "user" ? "👤" : "🤖"}
              </div>
              <div className="flex-1 min-w-0 flex items-start gap-2">
                <div
                  className={`px-3.5 py-2.5 rounded-lg text-[15px] leading-relaxed max-w-[85%] ${
                    msg.role === "user"
                      ? "bg-zinc-600/80 text-zinc-100 ml-0 mr-auto"
                      : "bg-zinc-700/60 text-zinc-100 ml-0 mr-auto border border-white/[0.06]"
                  }`}
                >
                  {msg.content}
                </div>
                {msg.role === "assistant" && (
                  <button
                    type="button"
                    onClick={() => speakText(msg.content)}
                    title="Speak this reply"
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md border border-white/[0.08] hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    🔊
                  </button>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 items-start">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-600/30 shrink-0 text-sm">
                🤖
              </div>
              <div className="px-3.5 py-2.5 rounded-lg text-zinc-500 text-[15px] animate-pulse">
                Thinking...
              </div>
            </div>
          )}

          <div ref={threadEndRef} className="h-px shrink-0" />
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-white/[0.06] bg-black/20">
          <div
            className={`flex items-center gap-2 text-xs mb-4 ${
              isReady ? "text-emerald-400" : "text-zinc-500"
            }`}
          >
            {isListening && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
            {statusText}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={startListening}
              disabled={isListening}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98]"
            >
              <MicIcon className="w-5 h-5" />
              Start
            </button>
            <button
              type="button"
              onClick={() => {
                stopSpeaking();
                if (isListening) stopListening();
              }}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-400 transition-colors active:scale-[0.98]"
            >
              🛑 Stop
            </button>

            <button
              type="button"
              onClick={() =>
                lastAssistantMessage && speakText(lastAssistantMessage.content)
              }
              disabled={!lastAssistantMessage?.content}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-zinc-600 hover:bg-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-600 transition-colors active:scale-[0.98]"
            >
              <SpeakerIcon className="w-5 h-5" />
              Speak Last Reply
            </button>
          </div>
        </div>
      </div>

      <p className="mt-8 text-[11px] text-zinc-600">
        Backend: <span className="font-medium text-zinc-500">{BACKEND_URL}</span>
      </p>

      <style>{`
        @keyframes messageIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
