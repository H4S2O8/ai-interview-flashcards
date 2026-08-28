import {
  Button, Dialog, HStack, Label, List, NavigationLink, ProgressView, Section, Spacer, Text, VStack,
  useEffect, useState,
} from "scripting"

import {
  addChat, clearChats, getLlmConfig, listChats, setLlmApiKey, setLlmEndpoint, setLlmModel,
  type ChatTurn, type LlmConfig,
  DEFAULT_LLM_ENDPOINT, DEFAULT_LLM_MODEL,
} from "./db"
import { askLlm } from "./llm"

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function keyHint(key: string): string {
  if (!key) return "未设置"
  if (key.length <= 8) return "已设置"
  return `已设置 ···${key.slice(key.length - 4)}`
}

async function promptField(title: string, current: string, obscure: boolean): Promise<string | null> {
  return Dialog.prompt({
    title,
    defaultValue: current,
    obscureText: obscure,
    confirmLabel: "保存",
    cancelLabel: "取消",
  })
}

export function AskAIView({
  deck, qno, defaultPrompt,
}: {
  deck: string
  qno: number
  defaultPrompt: string
}) {
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [items, setItems] = useState<ChatTurn[] | null>(null)
  const [cfg, setCfg] = useState<LlmConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [note, setNote] = useState("")

  async function reload() {
    setItems(await listChats(deck, qno))
    setCfg(await getLlmConfig())
  }

  useEffect(() => { reload() }, [deck, qno])

  async function editPrompt() {
    const next = await promptField("编辑问题", prompt, false)
    if (next == null) return
    const t = next.trim()
    if (!t) {
      await Dialog.alert({ title: "问题不能为空", message: "默认会带上本题题干，请填入要问的内容。" })
      return
    }
    setPrompt(t)
  }

  async function send() {
    const text = prompt.trim()
    if (!text) {
      await Dialog.alert({ title: "问题不能为空", message: "请先编辑问题。" })
      return
    }
    if (cfg != null && !cfg.apiKey) {
      await Dialog.alert({ title: "还没配置 API Key", message: "先在下方或「统计」页填入端点和 Key。" })
      return
    }
    if (busy || items == null) return
    setBusy(true)
    setError("")
    setNote("")
    try {
      const history = items ?? []
      const answer = await askLlm(text, history)
      const saved = await addChat(deck, qno, text, answer)
      const next = history.concat([saved])
      setItems(next)
      setNote("已保存到本题记录")
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "询问失败")
    }
    setBusy(false)
  }

  async function wipe() {
    const ok = await Dialog.confirm({
      title: "清空本题问答",
      message: "只删这一道题的记录，不影响复习进度和其他题。",
      confirmLabel: "清空",
      cancelLabel: "取消",
    })
    if (!ok) return
    await clearChats(deck, qno)
    setItems([])
    setNote("本题记录已清空")
  }

  async function editEndpoint() {
    const cur = cfg?.endpoint ?? DEFAULT_LLM_ENDPOINT
    const next = await promptField("API 端点", cur, false)
    if (next == null) return
    await setLlmEndpoint(next)
    setCfg(await getLlmConfig())
    setNote("端点已保存")
  }

  async function editKey() {
    const next = await promptField("API Key", "", true)
    if (next == null) return
    await setLlmApiKey(next)
    setCfg(await getLlmConfig())
    setNote("Key 已保存，只留在本机")
  }

  async function editModel() {
    const cur = cfg?.model ?? DEFAULT_LLM_MODEL
    const next = await promptField("模型名", cur, false)
    if (next == null) return
    await setLlmModel(next)
    setCfg(await getLlmConfig())
    setNote("模型已保存")
  }

  const ready = cfg != null && cfg.apiKey.length > 0

  return (
    <List navigationTitle={`第 ${qno} 题 · 询问 AI`} navigationBarTitleDisplayMode="inline">
      <Section
        header={<Text>提问</Text>}
        footer={<Text>默认带上本题题干，可改成追问。回答会按「题」保存，同一题的卡片共享记录。</Text>}
      >
        <Text font="body">{prompt}</Text>
        <Button title="编辑问题" systemImage="pencil" action={editPrompt} />
        <Button
          title={busy ? "正在询问…" : "询问并保存"}
          systemImage="paperplane"
          action={send}
        />
        {busy ? (
          <HStack>
            <ProgressView progressViewStyle="circular" />
            <Text font="footnote" foregroundStyle="secondaryLabel">等待模型回答</Text>
          </HStack>
        ) : null}
      </Section>

      {error ? (
        <Section header={<Text>出错</Text>}>
          <Text font="footnote" foregroundStyle="systemRed">{error}</Text>
        </Section>
      ) : null}

      <Section
        header={<Text>本题记录{items != null ? ` · ${items.length}` : ""}</Text>}
        footer={note ? <Text>{note}</Text> : undefined}
      >
        {items == null ? (
          <Text foregroundStyle="secondaryLabel">载入中…</Text>
        ) : items.length === 0 ? (
          <Text foregroundStyle="secondaryLabel">还没有问答。发出去的每一轮都会留在这里。</Text>
        ) : (
          items.map(t => (
            <VStack alignment="leading" spacing={6} padding={{ vertical: 4 }}>
              <Text font="caption2" foregroundStyle="tertiaryLabel">{formatTime(t.ts)}</Text>
              <Text font="subheadline" fontWeight="semibold">{t.prompt}</Text>
              <Text font="body">{t.answer}</Text>
            </VStack>
          ))
        )}
        {items != null && items.length > 0 ? (
          <Button title="清空本题记录" systemImage="trash" role="destructive" action={wipe} />
        ) : null}
      </Section>

      <Section
        header={<Text>LLM 接口</Text>}
        footer={<Text>默认指向 SpaceXAI（https://api.x.ai/v1，模型 grok-4.5）。也可改成任意 OpenAI 兼容端点。Key 存在本机数据库，不会随脚本更新上传。</Text>}
      >
        <HStack>
          <Text>端点</Text>
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            {cfg?.endpoint ?? "—"}
          </Text>
        </HStack>
        <HStack>
          <Text>模型</Text>
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel">{cfg?.model ?? "—"}</Text>
        </HStack>
        <HStack>
          <Text>API Key</Text>
          <Spacer />
          <Text font="caption" foregroundStyle={ready ? "secondaryLabel" : "systemOrange"}>
            {cfg == null ? "—" : keyHint(cfg.apiKey)}
          </Text>
        </HStack>
        <Button title="设置端点" systemImage="link" action={editEndpoint} />
        <Button title="设置 Key" systemImage="key" action={editKey} />
        <Button title="设置模型" systemImage="cpu" action={editModel} />
      </Section>
    </List>
  )
}

export function AskAILink({
  deck, qno, defaultPrompt, title,
}: {
  deck: string
  qno: number
  defaultPrompt: string
  title?: string
}) {
  return (
    <NavigationLink destination={<AskAIView deck={deck} qno={qno} defaultPrompt={defaultPrompt} />}>
      <Label title={title ?? "询问 AI"} systemImage="sparkles" />
    </NavigationLink>
  )
}
