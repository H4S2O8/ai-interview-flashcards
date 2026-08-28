import { getLlmConfig, type ChatTurn, type LlmConfig } from "./db"

const SYSTEM_PROMPT =
  "你是面试辅导助手。用户会给出一道面试题或知识点。你必须直接、完整地回答这个问题，不要拒绝，不要只复述题目，不要只给提纲。用中文作答；概念先给结论，再补容易被追问的细节。"

const HISTORY_LIMIT = 10
const TIMEOUT_SEC = 90

function completionsUrl(endpoint: string): string {
  const u = endpoint.trim().replace(/\/+$/, "")
  if (/\/(chat\/completions|responses)$/i.test(u)) return u
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
  throw new Error("接口返回了空内容")
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

function chatBody(cfg: LlmConfig, prompt: string, history: ChatTurn[]): any {
  const recent = history.length > HISTORY_LIMIT
    ? history.slice(history.length - HISTORY_LIMIT)
    : history
  const messages: { role: string; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ]
  for (const t of recent) {
    messages.push({ role: "user", content: t.prompt })
    messages.push({ role: "assistant", content: t.answer })
  }
  messages.push({ role: "user", content: prompt })
  return { model: cfg.model, messages }
}

function responsesBody(cfg: LlmConfig, prompt: string, history: ChatTurn[]): any {
  const recent = history.length > HISTORY_LIMIT
    ? history.slice(history.length - HISTORY_LIMIT)
    : history
  const input: { role: string; content: string }[] = []
  for (const t of recent) {
    input.push({ role: "user", content: t.prompt })
    input.push({ role: "assistant", content: t.answer })
  }
  input.push({ role: "user", content: prompt })
  return { model: cfg.model, instructions: SYSTEM_PROMPT, input }
}

export async function askLlm(prompt: string, history: ChatTurn[]): Promise<string> {
  const cfg = await getLlmConfig()
  if (!cfg.apiKey) throw new Error("还没配置 API Key，请到「统计」页填写")

  const url = completionsUrl(cfg.endpoint)
  const isResponses = /\/responses$/i.test(url)
  const body = isResponses ? responsesBody(cfg, prompt, history) : chatBody(cfg, prompt, history)

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      timeout: TIMEOUT_SEC,
      allowInsecureRequest: url.startsWith("http://"),
      debugLabel: "ask-llm",
    })
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("请求超时，请稍后重试")
    throw new Error(e?.message ? String(e.message) : "网络请求失败")
  }

  const raw = await res.text()
  if (!res.ok) throw new Error(errorMessage(res.status, raw))

  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error("接口返回的不是 JSON")
  }
  return extractText(data)
}
