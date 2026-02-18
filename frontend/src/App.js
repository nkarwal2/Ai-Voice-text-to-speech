import React, { useEffect, useRef, useState } from "react";

const BACKEND_URL = "http://localhost:5000";

const AGENT_ID = "ag_voice_01";
const AGENT_LLM_ID = "ll_default";
const COST_PER_MIN = "$0.05/min";
const LATENCY = "~800ms";
const TOKEN_RANGE = "~200-500 tokens";

const LANGUAGES = [
  { code: "en", name: "English", speechLang: "en-US" },
  { code: "hi", name: "हिन्दी", speechLang: "hi-IN" },
  { code: "es", name: "Español", speechLang: "es-ES" },
  { code: "fr", name: "Français", speechLang: "fr-FR" },
];

// Fix run-together text: add space between lowercase and uppercase (e.g. "Reactis" -> "React is")
function normalizeSpaces(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [mode, setMode] = useState("text");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [selectedModel, setSelectedModel] = useState("meta-llama-3.1-8b-instruct");
  const [language, setLanguage] = useState("en");
  const [isListening, setIsListening] = useState(false);
  const [testTab, setTestTab] = useState("audio");
  const [tasks, setTasks] = useState([]);
  const [lastCalendarUrl, setLastCalendarUrl] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const chatEndRef = useRef(null);
  const ttsQueueRef = useRef([]);
  const ttsBufferRef = useRef("");
  const ttsActiveRef = useRef(false);
  const streamAbortRef = useRef(null);

  const currentLang = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    ttsQueueRef.current = [];
    ttsBufferRef.current = "";
    ttsActiveRef.current = false;
    setIsSpeaking(false);
  };

  const stopAll = () => {
    stopSpeaking();
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setIsStreaming(false);
  };

  const speakText = (text) => {
    if (!voiceEnabled) return;
    if (!text) return;
    window.speechSynthesis.cancel();
    ttsQueueRef.current = [];
    ttsBufferRef.current = "";
    ttsActiveRef.current = false;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.lang = currentLang.speechLang;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const speakNextChunk = () => {
    if (!voiceEnabled) return;
    if (ttsActiveRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) return;

    ttsActiveRef.current = true;
    setIsSpeaking(true);

    const utterance = new SpeechSynthesisUtterance(next);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.lang = currentLang.speechLang;
    utterance.onend = () => {
      ttsActiveRef.current = false;
      if (ttsQueueRef.current.length === 0 && !ttsBufferRef.current.trim()) {
        setIsSpeaking(false);
      } else {
        speakNextChunk();
      }
    };
    utterance.onerror = () => {
      ttsActiveRef.current = false;
      setIsSpeaking(false);
    };
    window.speechSynthesis.speak(utterance);
  };

  const queueTtsFromStream = (text) => {
    if (!voiceEnabled) return;
    if (!text) return;

    ttsBufferRef.current += text;
    const buf = ttsBufferRef.current;

    // Prefer to speak up to the last sentence boundary, otherwise speak in chunks.
    let cutIdx = -1;
    const boundary = /[.!?](?:\s|$)/g;
    let m;
    while ((m = boundary.exec(buf)) !== null) {
      cutIdx = m.index + 1;
    }
    if (cutIdx === -1 && buf.length < 180) return;
    if (cutIdx === -1) cutIdx = 180;

    const chunk = buf.slice(0, cutIdx).trim();
    ttsBufferRef.current = buf.slice(cutIdx);
    if (!chunk) return;

    ttsQueueRef.current.push(normalizeSpaces(chunk));
    speakNextChunk();
  };

  const clearMemory = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/clear-memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      setMessages([]);
      alert("Memory cleared!");
    } catch (err) {
      alert("Failed to clear memory");
    }
  };

  const switchModel = async (modelName) => {
    try {
      setSelectedModel(modelName);
      await fetch(`${BACKEND_URL}/api/set-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ model: modelName }),
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `✅ Model switched to: ${modelName}` },
      ]);
    } catch (err) {
      alert("Failed to switch model");
    }
  };

  const streamChat = async (text) => {
    setIsStreaming(true);
    setLastCalendarUrl(null);
    stopSpeaking();
    streamAbortRef.current = new AbortController();
    const signal = streamAbortRef.current.signal;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(`${BACKEND_URL}/api/agent/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, language }),
        signal,
      });

      if (!res.ok) {
        const msg = res.status === 500
          ? "Backend error. Is LM Studio running (http://127.0.0.1:1234)?"
          : `Backend returned ${res.status}. Is the server running on ${BACKEND_URL}?`;
        throw new Error(msg);
      }

      // Calendar URL in headers = open immediately (available before stream, avoids popup blocker timing)
      const calendarUrlFromHeader = res.headers.get("X-Calendar-URL");
      const taskFromHeader = res.headers.get("X-Calendar-Task");
      if (calendarUrlFromHeader) {
        setLastCalendarUrl(calendarUrlFromHeader);
        try {
          const t = taskFromHeader ? JSON.parse(taskFromHeader) : null;
          if (t) setTasks((prev) => [...prev, { id: String(prev.length + 1), title: t.title, status: t.status || "Opened in Google Calendar", url: calendarUrlFromHeader }]);
        } catch (_) {}
        try {
          window.open(calendarUrlFromHeader, "_blank", "noopener,noreferrer");
        } catch (_) {}
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let assistantText = "";
      let buffer = "";
      const calendarHandledFromHeaders = !!calendarUrlFromHeader;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (signal.aborted) break;
        buffer += decoder.decode(value, { stream: true });
        if (!buffer.includes("\n")) continue;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let payload = line.slice(5);
          if (payload.startsWith(" ")) payload = payload.slice(1);
          payload = payload.replace(/\r$/, "");
          if (payload.trim() === "[DONE]") continue;
          try {
            const data = JSON.parse(payload.trim());
            if (data?.type === "calendar" && data?.url) {
              setLastCalendarUrl(data.url);
              if (!calendarHandledFromHeaders && data?.task) {
                setTasks((prev) => [...prev, {
                  id: data.task.id,
                  title: data.task.title,
                  status: data.task.status || "Opened in Google Calendar",
                  url: data.url,
                }]);
              }
              try {
                window.open(data.url, "_blank", "noopener,noreferrer");
              } catch (_) {
                // Popup may be blocked; user can click the link below
              }
              continue;
            }
          } catch (_) {
            // not JSON, treat as text token
          }
          assistantText += payload; // keep whitespace tokens so spacing is preserved
          queueTtsFromStream(payload);
          setMessages((prev) => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            if (updated[lastIndex]?.role === "assistant") {
              updated[lastIndex] = { role: "assistant", content: assistantText };
            }
            return updated;
          });
        }
      }

      // Flush any remaining buffered TTS text at end of stream
      if (voiceEnabled) {
        const rest = ttsBufferRef.current.trim();
        if (rest) {
          ttsBufferRef.current = "";
          ttsQueueRef.current.push(normalizeSpaces(rest));
          speakNextChunk();
        }
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        streamAbortRef.current = null;
        return;
      }
      const msg = err?.message?.includes("Backend") || err?.message?.includes("fetch")
        ? err.message
        : "Failed to get response. Check that the backend is running (e.g. `node server.js` in the backend folder) and LM Studio if needed.";
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant" && last?.content === "") {
          updated[updated.length - 1] = { role: "assistant", content: `❌ ${msg}` };
          return updated;
        }
        return [...prev, { role: "assistant", content: `❌ ${msg}` }];
      });
    } finally {
      streamAbortRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    setLastCalendarUrl(null);
    await streamChat(text);
  };

  const startListening = () => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      alert("Speech Recognition not supported in your browser.");
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = currentLang.speechLang;
    recognition.interimResults = false;
    recognition.continuous = false;
    setIsListening(true);

    recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      setIsListening(false);
      await streamChat(transcript);
    };
 
    recognition.onerror = () => {
      setIsListening(false);
      alert("Voice recognition error");
    };
 
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">AI Voice Agent</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Agent ID: {AGENT_ID} · LLM ID: {AGENT_LLM_ID} · {COST_PER_MIN} · {LATENCY} latency · {TOKEN_RANGE}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Modern model select */}
              <div className="relative">    
                <select
                  value={selectedModel}
                  onChange={(e) => switchModel(e.target.value)}
                  className="appearance-none bg-gray-100 hover:bg-gray-200 border-0 rounded-xl pl-4 pr-10 py-2.5 text-sm font-medium text-gray-800 cursor-pointer focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-colors min-w-[160px]"
                >
                  <option value="meta-llama-3.1-8b-instruct">Llama 3.1 8B</option>
                  <option value="qwen2.5-vl-7b-instruct">Qwen 2.5 VL 7B</option>
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </span>
              </div>
              {/* Test Audio | Test Chat tabs */}
              <div className="flex rounded-xl bg-gray-100 p-1">
                <button
                  type="button"
                  onClick={() => { setTestTab("audio"); setMode("voice"); }}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${testTab === "audio" ? "bg-white text-indigo-600 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                  Test Audio
                </button>
                <button
                  type="button"
                  onClick={() => { setTestTab("chat"); setMode("text"); }}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${testTab === "chat" ? "bg-white text-indigo-600 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                  Test Chat
                </button>
              </div>
              <button type="button" className="p-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600" title="JSON">
                <span className="font-mono text-sm font-medium">{'{}'}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main 2-column layout */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left: Role & Task */}
        <section className="min-w-[420px] flex-[1.4] border-r border-gray-200 bg-white overflow-y-auto">
          <div className="p-6 space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Response language</label>
              <div className="relative">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="appearance-none bg-gray-100 hover:bg-gray-200 border-0 rounded-xl pl-4 pr-10 py-2.5 text-sm font-medium text-gray-800 cursor-pointer focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-colors min-w-[140px]"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.name}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </span>
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold text-gray-900 mb-2">## Role</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                A friendly, professional AI voice assistant. Respond in the user&apos;s language (English, Hindi, Spanish, or French). You can help with questions, conversation, and booking meetings in Google Calendar. Use text or voice mode with streaming responses.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-gray-900 mb-2">## Task</h2>
              <ol className="list-decimal list-inside text-sm text-gray-600 space-y-2">
                <li><strong>Multi-language:</strong> Reply in the same language the user speaks or types (e.g. Hindi → Hindi).</li>
                <li><strong>Conversation:</strong> Answer questions and assist with the selected LLM (Llama or Qwen).</li>
                <li><strong>Book meetings:</strong> When the user asks to schedule a meeting (e.g. &quot;book a meeting for tomorrow in Google Calendar&quot;), confirm that the event was added with date and time.</li>
                <li><strong>Voice mode:</strong> When Test Audio is active, speak the reply after generating the response.</li>
              </ol>
            </div>

            {tasks.length > 0 && (
              <div className="pt-4 border-t border-gray-200">
                <h2 className="text-base font-semibold text-gray-900 mb-3">## Tasks from you</h2>
                <div className="space-y-3">
                  {tasks.map((t, i) => (
                    <div key={t.id || i} className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                      <h3 className="text-sm font-semibold text-gray-800"># Task {i + 1}</h3>
                      <p className="text-sm text-gray-600 mt-1">{t.title}</p>
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:text-indigo-800 underline mt-1 inline-block">
                          {t.status}
                        </a>
                      ) : (
                        <p className="text-xs text-indigo-600 mt-1">{t.status}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right: Test Chat */}
        <section className="min-w-[340px] flex-1 flex flex-col min-w-0 bg-gray-50/80">
        

          {/* Open Calendar bar - show when we have a calendar URL (click opens in new tab; avoids popup blocker) */}
          {(lastCalendarUrl || (tasks.length > 0 && tasks[tasks.length - 1]?.url)) && (
            <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between gap-2">
              <span className="text-sm text-gray-700">Add your meeting in Google Calendar:</span>
              <a
                href={lastCalendarUrl || tasks[tasks.length - 1]?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 whitespace-nowrap"
              >
                Open Google Calendar →
              </a>
            </div>
          )}

          {/* Chat thread */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {messages.length === 0 && !isStreaming && (
              <p className="text-sm text-gray-500 text-center py-8">Send a message or use Test Audio to start.</p>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-gray-200 text-gray-900"
                      : "bg-indigo-50 text-gray-900 border border-indigo-100"
                  }`}
                >
                  {normalizeSpaces(msg.content || "") || "\u00A0"}
                </div>
              </div>
            ))}

            {isStreaming && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm text-gray-500 bg-indigo-50 border border-indigo-100">
                  ✍️ Typing...
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div className="p-4 bg-white border-t border-gray-200">
            {(isSpeaking || isStreaming) && (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <span className="text-sm text-red-700">
                  {isStreaming ? "Agent is typing…" : "Agent is speaking"}
                </span>
                <button
                  type="button"
                  onClick={stopAll}
                  className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"
                >
                  Stop
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={mode === "text" ? "Type your message..." : "Voice mode — use Test Audio to speak"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                disabled={isStreaming}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              {mode === "text" ? (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isStreaming}
                  className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isStreaming ? "..." : "Send"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startListening}
                  disabled={isStreaming || isListening}
                  className="px-4 py-2.5 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 disabled:opacity-50"
                >
                  {isListening ? "Listening..." : "🎤 Speak"}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  const next = mode === "text" ? "voice" : "text";
                  setMode(next);
                  setTestTab(next === "voice" ? "audio" : "chat");
                }}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                {mode === "text" ? "📝 Text" : "🎤 Voice"} mode
              </button>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input type="checkbox" checked={voiceEnabled} onChange={(e) => setVoiceEnabled(e.target.checked)} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                Speak replies (TTS)
              </label>
              <button type="button" onClick={clearMemory} className="text-xs text-red-600 hover:underline">
                Clear chat
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
