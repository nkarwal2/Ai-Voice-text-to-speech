import React, { useEffect, useRef, useState } from "react";

const BACKEND_URL = "http://localhost:5000";

const AGENT_ID = "ag_voice_01";
const AGENT_LLM_ID = "ll_default";
const COST_PER_MIN = "$0.05/min";
const LATENCY = "~800ms";
const TOKEN_RANGE = "~200-500 tokens";

const CHATS_STORAGE_KEY = "ai-voice-chats";
const MAX_CHAT_TITLE_LEN = 42;

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

function loadChatsFromStorage() {
  try {
    const raw = localStorage.getItem(CHATS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveChatsToStorage(chats) {
  try {
    localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(chats));
  } catch (_) {}
}

function to24h(hour, minute, period) {
  let h = hour;
  const p = (period || "").replace(/\./g, "").toLowerCase();
  if (p.startsWith("p") && h !== 12) h += 12;
  if (p.startsWith("a") && h === 12) h = 0;
  return { hour24: h, minute };
}

/**
 * Parse time from text like "at 11:00 PM", "at 11am", "11pm". Returns { hour24, minute } or null.
 */
function parseTimeFromText(text) {
  if (!text || typeof text !== "string") return null;
  const lower = text.toLowerCase().trim();
  const match = lower.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.?)\b/i);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const { hour24 } = to24h(hour, minute, match[3]);
  if (hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) return null;
  return { hour24, minute };
}

/**
 * Parse time range like "11am to 11:15am", "11:00 to 11:15". Returns { start, end } or null.
 */
function parseTimeRangeFromText(text) {
  if (!text || typeof text !== "string") return null;
  const lower = text.toLowerCase().trim();
  const rangeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.?)?\s+to\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.?)\b/i);
  if (!rangeMatch) return null;
  const startHour = parseInt(rangeMatch[1], 10);
  const startMin = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
  const endHour = parseInt(rangeMatch[4], 10);
  const endMin = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : 0;
  const endPeriod = rangeMatch[6] || "";
  const startPeriod = rangeMatch[3] || endPeriod || "am";
  const start = to24h(startHour, startMin, startPeriod);
  const end = to24h(endHour, endMin, endPeriod);
  if (start.hour24 < 0 || start.hour24 > 23 || end.hour24 < 0 || end.hour24 > 23) return null;
  const endOnNextDay = end.hour24 < start.hour24 || (end.hour24 === start.hour24 && end.minute <= start.minute);
  return {
    start: { hour24: start.hour24, minute: start.minute },
    end: { hour24: end.hour24, minute: end.minute },
    endOnNextDay,
  };
}

/**
 * Remove time phrase from title so we don't show "Book a meeting at 11pm" or "11am to 11:15am" in the event name.
 */
function titleWithoutTime(text) {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.?)?\s+to\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.?)\.?/gi, "")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.?)\.?/gi, "")
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.?)\.?/gi, "")
    .replace(/\s+to\s*$/i, "")
    .replace(/\s+at\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getCalendarEventDetails(userInput) {
  const baseUrl = "https://www.google.com/calendar/render?action=TEMPLATE";
  const rawTitleWithTime = userInput.charAt(0).toUpperCase() + userInput.slice(1).trim();
  const rawTitle = titleWithoutTime(rawTitleWithTime) || rawTitleWithTime;
  const title = encodeURIComponent(rawTitle);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 1);
  startDate.setSeconds(0, 0);

  const range = parseTimeRangeFromText(userInput);
  const singleTime = parseTimeFromText(userInput);

  if (range) {
    startDate.setHours(range.start.hour24, range.start.minute, 0, 0);
  } else if (singleTime) {
    startDate.setHours(singleTime.hour24, singleTime.minute, 0, 0);
  } else {
    startDate.setHours(10, 0, 0, 0);
  }

  const endDate = range
    ? (() => {
        const e = new Date(startDate.getTime());
        if (range.endOnNextDay) e.setDate(e.getDate() + 1);
        e.setHours(range.end.hour24, range.end.minute, 0, 0);
        return e;
      })()
    : new Date(startDate.getTime() + 60 * 60 * 1000);

  const startIso = startDate.toISOString().replace(/-|:|\.\d\d\d/g, "");
  const endIso = endDate.toISOString().replace(/-|:|\.\d\d\d/g, "");
  const eventUrl = `${baseUrl}&text=${title}&dates=${startIso}/${endIso}`;
  const calendarUrl = "https://calendar.google.com/calendar";
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timeStr = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
  const eventTimeRange = `${fmt(startDate)}, ${timeStr(startDate)} - ${fmt(endDate)}, ${timeStr(endDate)}`;
  const confirmationText = `OK. I've created the meeting for ${rawTitle || "your event"} on your calendar for tomorrow, ${fmt(startDate)}, at ${timeStr(startDate)}.`;
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();
  return { eventUrl, calendarUrl, eventTitle: rawTitle || "Meeting", eventTimeRange, confirmationText, startISO, endISO };
}

const openCalendarRedirect = (userInput) => {
  const { eventUrl } = getCalendarEventDetails(userInput);
  window.open(eventUrl, "_blank", "noopener,noreferrer");
};

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
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [chats, setChats] = useState(() => loadChatsFromStorage());
  const [activeChatId, setActiveChatId] = useState(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [attachedFileContent, setAttachedFileContent] = useState(null);
  const [attachedFileName, setAttachedFileName] = useState(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [createImageMode, setCreateImageMode] = useState(false);
  const chatEndRef = useRef(null);
  const ttsQueueRef = useRef([]);
  const ttsBufferRef = useRef("");
  const ttsActiveRef = useRef(false);
  const streamAbortRef = useRef(null);
  const fileInputRef = useRef(null);

  const currentLang = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  // Persist chats to localStorage when they change
  useEffect(() => {
    saveChatsToStorage(chats);
  }, [chats]);

  // When messages change and we have an active chat, update that chat in the list
  useEffect(() => {
    if (!activeChatId || messages.length === 0) return;
    setChats((prev) => {
      const idx = prev.findIndex((c) => c.id === activeChatId);
      if (idx === -1) return prev;
      const next = [...prev];
      const firstUser = messages.find((m) => m.role === "user");
      const title = firstUser
        ? String(firstUser.content || "").slice(0, MAX_CHAT_TITLE_LEN).trim() || "New chat"
        : next[idx].title;
      next[idx] = { ...next[idx], title, messages: [...messages], updatedAt: Date.now() };
      return next;
    });
  }, [messages, activeChatId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auth: check session on load and when returning from OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");
    const authErrorParam = params.get("auth_error");
    if (authErrorParam) {
      setAuthError(decodeURIComponent(authErrorParam));
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (auth === "success") {
      window.history.replaceState({}, "", window.location.pathname);
    }

    fetch(`${BACKEND_URL}/auth/me`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.user) setUser(data.user);
        if (authErrorParam) setAuthError(decodeURIComponent(authErrorParam));
      })
      .catch(() => {});
  }, []);

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
      setActiveChatId(null);
      alert("Memory cleared!");
    } catch (err) {
      alert("Failed to clear memory");
    }
  };

  const startNewChat = () => {
    // Do NOT add current conversation again — it's already in the list as activeChatId (avoids duplicate titles)
    setMessages([]);
    setActiveChatId(null);
    setTasks([]);
    setLastCalendarUrl(null);
    setAttachedFileContent(null);
    setAttachedFileName(null);
    setCreateImageMode(false);
  };

  const loadChat = (chat) => {
    setActiveChatId(chat.id);
    setMessages(chat.messages || []);
    setTasks([]);
    setLastCalendarUrl(null);
    setAttachedFileContent(null);
    setAttachedFileName(null);
    setCreateImageMode(false);
  };

  const filteredChats = (() => {
    const list = sidebarSearch.trim()
      ? chats.filter((c) => (c.title || "").toLowerCase().includes(sidebarSearch.trim().toLowerCase()))
      : chats;
    return [...list].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  })();

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

  const streamChat = async (text, options = {}) => {
    const { fileContext, isImageRequest } = options;
    const effectiveText = fileContext ? `${text}\n\n[Attached file content]:\n${fileContext}` : (isImageRequest ? `Create an image: ${text}` : text);

    setIsStreaming(true);
    setLastCalendarUrl(null);
    stopSpeaking();
    streamAbortRef.current = new AbortController();
    const signal = streamAbortRef.current.signal;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    // Puter.js image generation (client-side, no backend) when in image mode
    if (isImageRequest && typeof window !== "undefined" && window.puter?.ai?.txt2img) {
      setMessages((prev) => {
        const u = [...prev];
        const last = u.length - 1;
        if (u[last]?.role === "assistant") u[last] = { ...u[last], content: "Generating image (Puter)…" };
        return u;
      });
      try {
        const imgEl = await window.puter.ai.txt2img(text);
        const src = imgEl?.src || imgEl?.currentSrc || (imgEl && imgEl instanceof HTMLImageElement ? imgEl.getAttribute?.("src") : null);
        if (src) {
          setMessages((prev) => {
            const u = [...prev];
            const last = u.length - 1;
            if (u[last]?.role === "assistant") u[last] = { ...u[last], content: "Here’s your image.", imageContent: src };
            return u;
          });
        } else {
          setMessages((prev) => {
            const u = [...prev];
            const last = u.length - 1;
            if (u[last]?.role === "assistant") u[last] = { ...u[last], content: "❌ Image generated but could not get URL." };
            return u;
          });
        }
      } catch (err) {
        setMessages((prev) => {
          const u = [...prev];
          const last = u.length - 1;
          if (u[last]?.role === "assistant") u[last] = { ...u[last], content: `❌ Puter image failed: ${(err?.message || err)?.toString?.()?.slice(0, 120) || "Unknown error"}. Try again or use text mode.` };
          return u;
        });
      }
      setIsStreaming(false);
      setAttachedFileContent(null);
      setAttachedFileName(null);
      setCreateImageMode(false);
      return;
    }

    if (activeChatId === null) {
      const newId = String(Date.now());
      setActiveChatId(newId);
      setChats((prev) => [
        { id: newId, title: text.slice(0, MAX_CHAT_TITLE_LEN).trim() || "New chat", messages: [], createdAt: Date.now(), updatedAt: Date.now() },
        ...prev,
      ]);
    }

    const intentCheck = await fetch(`${BACKEND_URL}/api/check-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text }),
      signal,
    }).catch(() => null);
    if (intentCheck?.ok) {
      try {
        const { intent } = await intentCheck.json();
        if (intent === "book_calendar") {
          const details = getCalendarEventDetails(text);
          const calendarCards = {
            calendarUrl: details.calendarUrl,
            eventUrl: details.eventUrl,
            eventTitle: details.eventTitle,
            eventTimeRange: details.eventTimeRange,
            saved: false,
            eventLink: null,
          };
          let saveError = null;
          if (user) {
            try {
              const timeZone = typeof Intl !== "undefined" && Intl.DateTimeFormat?.().resolvedOptions?.()?.timeZone ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
              const createRes = await fetch(`${BACKEND_URL}/api/calendar/create-event`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  title: details.eventTitle,
                  start: details.startISO,
                  end: details.endISO,
                  timeZone,
                }),
              });
              const createData = await createRes.json().catch(() => ({}));
              if (createData.success && createData.htmlLink) {
                calendarCards.saved = true;
                calendarCards.eventLink = createData.htmlLink;
                if (createData.meetLink) calendarCards.meetLink = createData.meetLink;
              } else {
                saveError = createData?.error || (createRes.ok ? "Save failed" : `Request failed (${createRes.status})`);
              }
            } catch (err) {
              saveError = err?.message || "Network error";
            }
          }
          const content = calendarCards.saved
            ? `Event saved to your Google Calendar. ${details.confirmationText}`
            : saveError
              ? `Couldn't save to your calendar (${saveError}). Use the link below to add it. ${details.confirmationText}`
              : details.confirmationText;
          if (saveError && details.eventUrl) {
            try { window.open(details.eventUrl, "_blank", "noopener,noreferrer"); } catch (_) {}
          }
          setMessages((prev) => {
            const u = [...prev];
            const last = u.length - 1;
            if (u[last]?.role === "assistant") {
              u[last] = { ...u[last], content, calendarCards };
            }
            return u;
          });
          // When not logged in, open the pre-filled event URL so user can add to calendar in one click
          if (!calendarCards.saved && !saveError && details.eventUrl) {
            try { window.open(details.eventUrl, "_blank", "noopener,noreferrer"); } catch (_) {}
          }
          setIsStreaming(false);
          return;
        }
      } catch (_) {}
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/agent/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: effectiveText,
          language,
          createImage: isImageRequest || createImageMode,
        }),
        signal,
      });

      if (!res.ok) {
        let msg;
        if (res.status === 500) {
          try {
            const body = await res.clone().json();
            msg = body?.error || "Backend error. Is the Node server running? Is LM Studio running at http://127.0.0.1:1234?";
          } catch (_) {
            msg = "Backend error. Is the Node server running? Is LM Studio running at http://127.0.0.1:1234?";
          }
        } else {
          msg = `Backend returned ${res.status}. Is the server running on ${BACKEND_URL}?`;
        }
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
            if (data?.type === "image" && data?.content) {
              setMessages((prev) => {
                const updated = [...prev];
                const lastIndex = updated.length - 1;
                if (updated[lastIndex]?.role === "assistant") {
                  updated[lastIndex] = { ...updated[lastIndex], content: assistantText || "Here’s your image.", imageContent: data.content };
                }
                return updated;
              });
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
              updated[lastIndex] = { ...updated[lastIndex], content: assistantText };
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
    const text = input.trim();
    if (!text && !attachedFileContent) return;
    const messageText = text || "What can you tell me about this file?";
    setInput("");
    setLastCalendarUrl(null);
    const isImageReq = createImageMode;
    await streamChat(messageText, {
      fileContext: attachedFileContent || undefined,
      isImageRequest: isImageReq,
    });
    setAttachedFileContent(null);
    setAttachedFileName(null);
    setCreateImageMode(false);
  };

  const handleFileSelect = (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const ext = (file.name || "").toLowerCase().split(".").pop();
    if (!["pdf", "txt", "md", "json", "csv"].includes(ext)) {
      alert("Please upload a PDF, TXT, MD, JSON, or CSV file.");
      e.target.value = "";
      return;
    }
    // Clear previous file content so we never send the old PDF when user uploads a new one
    setAttachedFileContent(null);
    setFileUploading(true);
    setAttachedFileName(file.name);
    const formData = new FormData();
    formData.append("file", file);
    fetch(`${BACKEND_URL}/api/upload-file`, {
      method: "POST",
      credentials: "include",
      body: formData,
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.text != null) {
          setAttachedFileContent(data.text);
          setAttachedFileName(data.filename || file.name);
        } else {
          alert(data?.error || "Could not read file");
          setAttachedFileName(null);
        }
      })
      .catch(() => {
        alert("Upload failed. Is the backend running?");
        setAttachedFileName(null);
      })
      .finally(() => setFileUploading(false));
    e.target.value = "";
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
    <div className="h-screen w-full bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shrink-0 z-10">
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
              {/* Login with Google (top right) */}
              {user ? (
                <div className="flex items-center gap-2">
                  {user.picture && (
                    <img src={user.picture} alt="" className="w-8 h-8 rounded-full border border-gray-200" />
                  )}
                  <span className="text-sm font-medium text-gray-700 max-w-[140px] truncate" title={user.email}>
                    {user.name || user.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      fetch(`${BACKEND_URL}/auth/logout`, { method: "POST", credentials: "include" })
                        .then(() => setUser(null));
                    }}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  >
                    Logout
                  </button>
                </div>
              ) : ( 
                <a
                  href={`${BACKEND_URL}/auth/google`}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400 transition-colors shadow-sm"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Login with Google
                </a>
              )}
            </div>
          </div>
        </div>
      </header>
      {authError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-2">
          <span className="text-sm text-amber-800">{authError}</span>
          <button type="button" onClick={() => setAuthError(null)} className="text-amber-600 hover:text-amber-800 text-sm font-medium">Dismiss</button>
        </div>
      )}
 
      {/* Main layout: Sidebar | Role & Task | Chat */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        {/* Left sidebar: scrollable chat list */}
        <aside className="w-[260px] shrink-0 flex flex-col min-h-0 border-r border-gray-200 bg-white shadow-sm">
          <div className="p-3 flex flex-col gap-2 border-b border-gray-100 shrink-0">
            <button
              type="button"
              onClick={startNewChat}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium text-sm transition-all hover:bg-gray-50 hover:border-gray-300 active:bg-gray-100"
            >
              <svg className="w-4 h-4 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              New chat
            </button>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </span>
              <input
                type="text"
                placeholder="Search chats"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 bg-gray-50/80 text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-colors"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            <h2 className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 sticky top-0 bg-white z-[1]">
              Your chats
            </h2>
            <ul className="py-1">
              {filteredChats.length === 0 && (
                <li className="px-3 py-4 text-center text-sm text-gray-400">No chats yet</li>
              )}
              {filteredChats.map((chat) => (
                <li key={chat.id} className="px-2 py-0.5">
                  <button
                    type="button"
                    onClick={() => loadChat(chat)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm truncate transition-colors flex items-center gap-2 ${
                      activeChatId === chat.id
                        ? "bg-indigo-50 text-indigo-800 border border-indigo-100"
                        : "text-gray-700 hover:bg-gray-100 border border-transparent"
                    }`}
                    title={chat.title || "New chat"}
                  >
                    <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                    <span className="min-w-0 flex-1 truncate">{chat.title || "New chat"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Middle: Role & Task */}
        <section className="min-w-[380px] flex-[1.2] border-r border-gray-200 bg-white overflow-y-auto">
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

        {/* Right: Chat — sticky panel, scrollable messages, sticky input at bottom */}
        <section className="min-w-[340px] flex-1 flex flex-col min-h-0 min-w-0 bg-gray-50/80 sticky right-0">
          {/* Open Calendar bar */}
          {(lastCalendarUrl || (tasks.length > 0 && tasks[tasks.length - 1]?.url)) && (
            <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between gap-2 shrink-0">
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

          {/* Chat thread — scrollable */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 flex flex-col gap-4">
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
                  {msg.imageContent && (
                    <img src={msg.imageContent} alt="Generated" className="rounded-lg max-w-full mb-2 block" />
                  )}
                  {normalizeSpaces(msg.content || "") || "\u00A0"}
                  {msg.calendarCards && (
                    <div className="mt-3 space-y-2">
                      <a
                        href={msg.calendarCards.calendarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-gray-800 hover:bg-gray-50 transition-colors"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white border border-gray-200">
                          <svg className="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </span>
                        <span className="font-medium">Google Calendar</span>
                      </a>
                      <a
                        href={msg.calendarCards.eventLink || msg.calendarCards.eventUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
                      >
                        <span className="font-semibold text-gray-900">{msg.calendarCards.eventTitle}</span>
                        <span className="text-xs text-gray-500 mt-0.5">{msg.calendarCards.eventTimeRange}</span>
                        {msg.calendarCards.saved && (
                          <span className="text-xs text-green-600 font-medium mt-1">Saved to your calendar</span>
                        )}
                        {msg.calendarCards.meetLink && (
                          <a
                            href={msg.calendarCards.meetLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-indigo-600 hover:underline mt-1 inline-block"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Join Google Meet →
                          </a>
                        )}
                      </a>
                    </div>
                  )}
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

          {/* Input area — sticky at bottom of right panel */}
          <div className="shrink-0 p-4 bg-white border-t border-gray-200">
            {(fileUploading || attachedFileContent || createImageMode) && (
              <div className="mb-2 flex items-center gap-2 flex-wrap">
                {fileUploading && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs">
                    Reading PDF…
                  </span>
                )}
                {attachedFileContent && !fileUploading && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-800 text-xs">
                    📎 {attachedFileName || "File attached"} ({attachedFileContent.length.toLocaleString()} chars)
                    <button type="button" onClick={() => { setAttachedFileContent(null); setAttachedFileName(null); }} className="text-indigo-600 hover:text-indigo-800 font-medium" aria-label="Remove">×</button>
                  </span>
                )}
                {createImageMode && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 text-xs">
                    🖼️ Create image
                    <button type="button" onClick={() => setCreateImageMode(false)} className="text-amber-600 hover:text-amber-800" aria-label="Cancel">×</button>
                  </span>
                )}
              </div>
            )}
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
            <div className="flex gap-2 items-center">
              <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept=".pdf,.txt,.md,.json,.csv,application/pdf,text/plain,text/markdown" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 shrink-0"
                title="Add photos & files (Ctrl+U)"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              </button>
              <button
                type="button"
                onClick={() => setCreateImageMode(true)}
                className={`p-2.5 rounded-lg border shrink-0 ${createImageMode ? "bg-amber-50 border-amber-300 text-amber-700" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
                title="Create image"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </button>
              <input
                type="text"
                placeholder={createImageMode ? "Describe the image to create..." : mode === "text" ? "Ask anything" : "Voice mode — use Test Audio to speak"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
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
