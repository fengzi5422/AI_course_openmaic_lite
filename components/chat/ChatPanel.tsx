"use client";

import { memo, useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/** 极简 markdown 渲染：**粗体**、`代码`、换行 */
function renderMarkdown(text: string) {
  const lines = text.split("\n");
  return lines.map((line, li) => {
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;
    // 逐段解析 **bold** 与 `code`
    const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let match: RegExpExecArray | null;
    let lastIdx = 0;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIdx) parts.push(line.slice(lastIdx, match.index));
      const token = match[0];
      if (token.startsWith("**")) {
        parts.push(<strong key={`${li}-${key++}`}>{token.slice(2, -2)}</strong>);
      } else {
        parts.push(
          <code
            key={`${li}-${key++}`}
            className="px-1.5 py-0.5 rounded text-xs font-mono"
            style={{ background: "var(--panel-2)" }}
          >
            {token.slice(1, -1)}
          </code>
        );
      }
      lastIdx = match.index + token.length;
    }
    if (lastIdx < line.length) parts.push(line.slice(lastIdx));
    return (
      <div key={li}>
        {parts.length ? parts : "\u00a0"}
      </div>
    );
  });
}

function ChatPanelInner({ getContext }: { getContext: () => string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const contextRef = useRef(getContext);
  contextRef.current = getContext;

  // 仅在消息条数变化或流式时滚动到底部
  const msgCount = messages.length;
  const lastLen = messages[msgCount - 1]?.content.length ?? 0;
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgCount, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: contextRef.current(), messages: next }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `HTTP ${res.status}`);
      }
      setMessages([...next, { role: "assistant", content: "" }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      // 节流渲染：约 60ms 一次，降低重渲染频率保证流畅
      let lastRender = 0;
      const flush = (force = false) => {
        const now = performance.now();
        if (force || now - lastRender > 60) {
          lastRender = now;
          setMessages([...next, { role: "assistant", content: acc }]);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        flush();
      }
      flush(true);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: `出错了：${String(err)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 panel overflow-hidden">
      <div
        className="px-4 py-2.5 border-b font-display text-sm flex items-baseline gap-2"
        style={{ borderColor: "var(--border)" }}
      >
        课堂问答
        <span className="text-xs font-sans font-normal" style={{ color: "var(--text-dim)" }}>
          基于当前场景作答
        </span>
      </div>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-sm anim-fade-in" style={{ color: "var(--text-dim)" }}>
            有问题随时问老师，例如「再举一个例子？」
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] px-3.5 py-2 text-sm anim-fade-in ${
                m.role === "user" ? "ml-auto" : ""
              }`}
              style={
                m.role === "user"
                  ? { background: "var(--ink)", color: "var(--paper)" }
                  : { background: "var(--panel-2)", border: "1px solid var(--border)" }
              }
            >
              {m.role === "user" ? m.content : renderMarkdown(m.content)}
              {busy && i === messages.length - 1 && m.role === "assistant" && m.content === "" && (
                <span className="inline-flex gap-1 py-1">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--text-dim)" }} />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--text-dim)" }} />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--text-dim)" }} />
                </span>
              )}
            </div>
          ))
        )}
      </div>
      <div className="p-3 border-t flex gap-2" style={{ borderColor: "var(--border)" }}>
        <input
          className="input-box flex-1 px-3 py-2 text-sm"
          placeholder="输入你的问题…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
          }}
        />
        <button
          className="btn-primary px-4 text-sm disabled:opacity-50"
          disabled={busy || !input.trim()}
          onClick={() => void send()}
        >
          {busy ? "…" : "发送"}
        </button>
      </div>
    </div>
  );
}

export const ChatPanel = memo(ChatPanelInner);
