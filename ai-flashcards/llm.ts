import { getLlmConfig, type ChatTurn, type LlmConfig } from "./db"

const SYSTEM_PROMPT =
  "你是面试辅导助手。用户会给出一道面试题或知识点。你必须直接、完整地回答这个问题，不要拒绝，不要只复述题目，不要只给提纲。用中文作答；概念先给结论，再补容易被追问的细节。用 Markdown 排版：标题、列表、加粗、代码块。"

const HISTORY_LIMIT = 10
const TIMEOUT_SEC = 120

/** OpenAI 兼容：填 base（…/v1）或完整 …/chat/completions 都可以 */
export function completionsUrl(endpoint: string): string {
  const u = endpoint.trim().replace(/\/+$/, "")
  if (/\/chat\/completions$/i.test(u)) return u
  if (/\/responses$/i.test(u)) return u
  try {
    const parsed = new URL(u)
    if (parsed.pathname === "" || parsed.pathname === "/") return u + "/v1/chat/completions"
  } catch { /* 不是合法 URL 也照样拼接 */ }
  return u + "/chat/completions"
}

function extractText(data: any): string {
  const choice = data?.choices?.[0]
  const content = choice?.message?.content ?? choice?.text
  if (typeof content === "string" && content.trim()) return content.trim()
  if (Array.isArray(content)) {
    const joined = content
      .map((p: any) => (typeof p === "string" ? p : (p?.text ?? p?.content ?? "")))
      .join("")
      .trim()
    if (joined) return joined
  }
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim()
  }
  if (Array.isArray(data?.output)) {
    const parts: string[] = []
    for (const item of data.output) {
      if (typeof item?.content === "string") parts.push(item.content)
      else if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === "string") parts.push(c.text)
        }
      }
    }
    const joined = parts.join("").trim()
    if (joined) return joined
  }
  return ""
}

function deltaFromJson(j: any): string {
  const c = j?.choices?.[0]
  if (c != null) {
    const d = c.delta?.content ?? c.message?.content ?? c.text
    if (typeof d === "string") return d
    if (Array.isArray(d)) {
      return d.map((p: any) => (typeof p === "string" ? p : (p?.text ?? p?.content ?? ""))).join("")
    }
  }
  if (j?.type === "response.output_text.delta" && typeof j.delta === "string") return j.delta
  if (typeof j?.delta === "string") return j.delta
  return ""
}

function deltaFromSseEvent(event: string): string {
  const lines = event.replace(/\r/g, "").split("\n")
  let data = ""
  for (const line of lines) {
    if (line.startsWith("data:")) data += line.slice(5).trimStart()
  }
  const t = data.trim()
  if (!t || t === "[DONE]") return ""
  try {
    return deltaFromJson(JSON.parse(t))
  } catch {
    return ""
  }
}

function flushSse(buf: string, onPiece: (s: string) => void): string {
  let start = 0
  while (true) {
    const i = buf.indexOf("\n\n", start)
    const j = buf.indexOf("\r\n\r\n", start)
    let at = -1
    let sep = 2
    if (i >= 0 && (j < 0 || i <= j)) { at = i; sep = 2 }
    else if (j >= 0) { at = j; sep = 4 }
    if (at < 0) return buf.slice(start)
    const piece = deltaFromSseEvent(buf.slice(start, at))
    if (piece) onPiece(piece)
    start = at + sep
  }
}

function chunkToString(value: any): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof TextDecoder !== "undefined") {
    try { return new TextDecoder("utf-8").decode(value) } catch { /* fall through */ }
  }
  if (typeof value.length === "number") {
    let s = ""
    for (let i = 0; i < value.length; i++) s += String.fromCharCode(value[i])
    return s
  }
  return String(value)
}

function errorMessage(status: number, raw: string): string {
  try {
    const j = JSON.parse(raw)
    const msg = j?.error?.message ?? j?.message ?? j?.error
    if (typeof msg === "string" && msg.trim()) return `HTTP ${status}：${msg.trim()}`
  } catch { /* 非 JSON */ }
  const snippet = raw.replace(/\s+/g, " ").slice(0, 180)
  return snippet ? `HTTP ${status}：${snippet}` : `HTTP ${status}`
}

function recentHistory(history: ChatTurn[]): ChatTurn[] {
  return history.length > HISTORY_LIMIT
    ? history.slice(history.length - HISTORY_LIMIT)
    : history
}

function chatBody(cfg: LlmConfig, prompt: string, history: ChatTurn[]): any {
  const messages: { role: string; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ]
  for (const t of recentHistory(history)) {
    messages.push({ role: "user", content: t.prompt })
    messages.push({ role: "assistant", content: t.answer })
  }
  messages.push({ role: "user", content: prompt })
  return { model: cfg.model, messages, stream: true }
}

function responsesBody(cfg: LlmConfig, prompt: string, history: ChatTurn[]): any {
  const input: { role: string; content: string }[] = []
  for (const t of recentHistory(history)) {
    input.push({ role: "user", content: t.prompt })
    input.push({ role: "assistant", content: t.answer })
  }
  input.push({ role: "user", content: prompt })
  return { model: cfg.model, instructions: SYSTEM_PROMPT, input, stream: true }
}

async function readSse(res: Response, onPiece: (s: string) => void): Promise<string> {
  let raw = ""
  let rest = ""
  function push(s: string) {
    if (!s) return
    raw += s
    rest += s
    rest = flushSse(rest, onPiece)
  }

  const ts = (res as any).textStream
  if (typeof ts === "function") {
    try {
      const stream = ts.call(res)
      if (stream != null && typeof stream[Symbol.asyncIterator] === "function") {
        for await (const chunk of stream) push(chunkToString(chunk))
        flushSse(rest + "\n\n", onPiece)
        return raw
      }
    } catch { /* 退回别的读法 */ }
  }

  const body = (res as any).body
  if (body != null && typeof body.getReader === "function") {
    const reader = body.getReader()
    while (true) {
      const r = await reader.read()
      if (r.done) break
      push(chunkToString(r.value))
    }
    flushSse(rest + "\n\n", onPiece)
    return raw
  }

  if (body != null && typeof body[Symbol.asyncIterator] === "function") {
    for await (const chunk of body) push(chunkToString(chunk))
    flushSse(rest + "\n\n", onPiece)
    return raw
  }

  raw = await res.text()
  flushSse(raw + "\n\n", onPiece)
  return raw
}

/**
 * OpenAI 兼容 Chat Completions（stream=true，SSE）。
 * onDelta 收到的是到目前为止的完整回答，便于界面边收边画。
 */
export async function askLlm(
  prompt: string,
  history: ChatTurn[],
  onDelta?: (full: string) => void,
): Promise<string> {
  const cfg = await getLlmConfig()
  if (!cfg.apiKey) throw new Error("还没配置 API Key，请到「统计」页填写并保存")
  if (typeof fetch !== "function") throw new Error("当前 Scripting 环境没有 fetch")

  const url = completionsUrl(cfg.endpoint)
  const isResponses = /\/responses$/i.test(url)
  const payload = isResponses ? responsesBody(cfg, prompt, history) : chatBody(cfg, prompt, history)

  let acc = ""
  let lastEmit = 0
  function emit(force: boolean) {
    if (!onDelta) return
    const now = Date.now()
    if (!force && now - lastEmit < 80) return
    lastEmit = now
    onDelta(acc)
  }
  function onPiece(p: string) {
    acc += p
    emit(false)
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null
  const timer = setTimeout(() => {
    try { controller?.abort() } catch { /* ignore */ }
  }, TIMEOUT_SEC * 1000)

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(payload),
      timeout: TIMEOUT_SEC,
      signal: controller?.signal,
      allowInsecureRequest: url.startsWith("http://"),
      debugLabel: "ask-llm",
    })
  } catch (e: any) {
    clearTimeout(timer)
    if (e?.name === "AbortError") throw new Error("请求超时，请稍后重试")
    throw new Error(e?.message ? String(e.message) : "网络请求失败")
  }

  let raw = ""
  try {
    raw = await readSse(res, onPiece)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) throw new Error(errorMessage(res.status, raw))

  emit(true)
  if (acc.trim()) return acc.trim()

  try {
    const fromJson = extractText(JSON.parse(raw))
    if (fromJson) {
      if (onDelta) onDelta(fromJson)
      return fromJson
    }
  } catch { /* 不是整包 JSON */ }

  throw new Error("接口返回了空内容。请确认端点是 OpenAI 兼容的 /v1/chat/completions。")
}
