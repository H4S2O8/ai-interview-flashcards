import {
  Button, Label, List, Markdown, NavigationLink, ProgressView, Section, SecureField, Text, TextField, VStack,
  useEffect, useState,
} from "scripting"

import {
  activeLlmProfile, addChat, blankLlmProfile, clearChats, getLlmConfig, listChats,
  loadLlmStore, saveLlmStore,
  type ChatTurn, type LlmProfile, type LlmStore,
  DEFAULT_LLM_ENDPOINT, DEFAULT_LLM_MODEL,
} from "./db"
import { askLlm } from "./llm"

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 多套端点 / Key / 模型。点列表切换；输入框改完点保存。
 * 不能用 Dialog.prompt：主界面已经 Navigation.present 全屏，再弹一层会静默失败。
 */
export function LlmSettingsBlock() {
  const [store, setStore] = useState<LlmStore | null>(null)
  const [name, setName] = useState("默认")
  const [endpoint, setEndpoint] = useState(DEFAULT_LLM_ENDPOINT)
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState(DEFAULT_LLM_MODEL)
  const [message, setMessage] = useState("")

  useEffect(() => {
    loadLlmStore().then(s => {
      setStore(s)
      const p = activeLlmProfile(s)
      setName(p.name)
      setEndpoint(p.endpoint)
      setApiKey(p.apiKey)
      setModel(p.model)
    })
  }, [])

  function fill(p: LlmProfile) {
    setName(p.name)
    setEndpoint(p.endpoint)
    setApiKey(p.apiKey)
    setModel(p.model)
  }

  function withCurrentFields(s: LlmStore): LlmStore {
    const profiles: LlmProfile[] = []
    for (const p of s.profiles) {
      if (p.id !== s.activeId) {
        profiles.push(p)
      } else {
        profiles.push({
          id: p.id,
          name: name.trim() || p.name,
          endpoint: endpoint.trim() || DEFAULT_LLM_ENDPOINT,
          apiKey: apiKey.trim(),
          model: model.trim() || DEFAULT_LLM_MODEL,
        })
      }
    }
    return { activeId: s.activeId, profiles }
  }

  async function persist(next: LlmStore, note: string) {
    await saveLlmStore(next)
    setStore(next)
    fill(activeLlmProfile(next))
    setMessage(note)
  }

  async function save() {
    if (store == null) return
    await persist(withCurrentFields(store), "当前配置已保存")
  }

  async function selectProfile(id: string) {
    if (store == null) return
    const edited = withCurrentFields(store)
    const next: LlmStore = { activeId: id, profiles: edited.profiles }
    const picked = activeLlmProfile(next)
    await persist(next, "已切换到「" + picked.name + "」")
  }

  async function addProfile() {
    if (store == null) return
    const edited = withCurrentFields(store)
    const fresh = blankLlmProfile("配置 " + (edited.profiles.length + 1))
    fresh.endpoint = endpoint.trim() || DEFAULT_LLM_ENDPOINT
    fresh.apiKey = apiKey.trim()
    fresh.model = model.trim() || DEFAULT_LLM_MODEL
    const next: LlmStore = {
      activeId: fresh.id,
      profiles: edited.profiles.concat([fresh]),
    }
    await persist(next, "已新建「" + fresh.name + "」，可改名称/端点/模型后保存")
  }

  async function removeProfile() {
    if (store == null) return
    if (store.profiles.length <= 1) {
      setMessage("至少保留一套配置")
      return
    }
    const rest: LlmProfile[] = []
    for (const p of store.profiles) {
      if (p.id !== store.activeId) rest.push(p)
    }
    const next: LlmStore = { activeId: rest[0].id, profiles: rest }
    await persist(next, "已删除，当前是「" + rest[0].name + "」")
  }

  const activeName = store == null ? "" : activeLlmProfile(store).name

  return (
    <Section
      header={<Text>LLM 接口{activeName ? " · " + activeName : ""}</Text>}
      footer={
        <Text>
          {message
            ? message
            : "点上面一套即可切换。改完名称/端点/Key/模型后点保存。端点填 OpenAI 兼容 base。"}
        </Text>
      }
    >
      {store == null ? (
        <Text foregroundStyle="secondaryLabel">载入中…</Text>
      ) : (
        store.profiles.map(p => (
          <Button
            title={(p.id === store.activeId ? "✓ " : "") + p.name + " · " + p.model}
            action={() => { selectProfile(p.id) }}
          />
        ))
      )}
      <Button title="新建一套" systemImage="plus" action={addProfile} />
      <TextField title="名称" value={name} onChanged={setName} />
      <TextField title="端点" value={endpoint} onChanged={setEndpoint} />
      <SecureField title="API Key" value={apiKey} onChanged={setApiKey} />
      <TextField title="模型" value={model} onChanged={setModel} />
      <Button title="保存当前配置" systemImage="checkmark.circle" action={save} />
      <Button title="删除当前配置" systemImage="trash" role="destructive" action={removeProfile} />
    </Section>
  )
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
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState("")
  const [note, setNote] = useState("")
  const [confirmWipe, setConfirmWipe] = useState(false)

  async function reload() {
    try {
      setItems(await listChats(deck, qno))
    } catch {
      setItems([])
      setError("读取问答记录失败，仍可以询问（本次不带历史）。")
    }
  }

  useEffect(() => { reload() }, [deck, qno])

  async function send() {
    const text = prompt.trim()
    if (!text) {
      setError("问题不能为空，默认会带上本题题干。")
      return
    }
    if (busy) return
    const live = await getLlmConfig()
    if (!live.apiKey) {
      setError("还没配置 API Key，请在下方填写并点「保存接口配置」。")
      return
    }
    setBusy(true)
    setError("")
    setNote("")
    setDraft("")
    try {
      const history = items ?? []
      const answer = await askLlm(text, history, (full) => { setDraft(full) })
      const saved = await addChat(deck, qno, text, answer)
      setItems(history.concat([saved]))
      setDraft("")
      setNote("已保存到本题记录")
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "询问失败")
    }
    setBusy(false)
  }

  async function wipe() {
    if (!confirmWipe) {
      setConfirmWipe(true)
      return
    }
    await clearChats(deck, qno)
    setItems([])
    setConfirmWipe(false)
    setNote("本题记录已清空")
  }

  return (
    <List navigationTitle={`第 ${qno} 题 · 询问 AI`} navigationBarTitleDisplayMode="inline">
      <Section
        header={<Text>提问</Text>}
        footer={<Text>默认带上本题题干，可改成追问。回答按「题」保存，同一题的卡片共享记录。</Text>}
      >
        <TextField title="问题" value={prompt} onChanged={setPrompt} />
        <Button
          title={busy ? "正在询问…" : "询问并保存"}
          systemImage="paperplane"
          action={send}
        />
        {busy ? (
          <VStack>
            <ProgressView progressViewStyle="circular" />
            <Text font="footnote" foregroundStyle="secondaryLabel">正在流式接收…</Text>
          </VStack>
        ) : null}
      </Section>

      {busy || draft ? (
        <Section header={<Text>{busy ? "回答中" : "刚才的回答"}</Text>}>
          {draft
            ? <Markdown content={draft} />
            : <Text font="footnote" foregroundStyle="secondaryLabel">等待第一个字…</Text>}
        </Section>
      ) : null}

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
              <Markdown content={t.answer} />
            </VStack>
          ))
        )}
        {items != null && items.length > 0 ? (
          <Button
            title={confirmWipe ? "再点一次确认清空" : "清空本题记录"}
            systemImage="trash"
            role="destructive"
            action={wipe}
          />
        ) : null}
      </Section>

      <LlmSettingsBlock />
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
