import { Path, Script } from "scripting"

import { applyGrade, newSchedule, type Grade, type Schedule } from "./srs"

const DB_FILE = "ai-flashcards.db"

export type Deck = {
  id: string
  name: string
  icon: string
  color: string
  source: string
  enabled: number
}

export type Card = {
  id: string
  deck: string
  qno: number
  front: string
  back: string
} & Schedule

type DB = ReturnType<typeof SQLite.open>

let cached: DB | null = null

/**
 * 数据库放在 App Group 目录里，这样 widget.tsx 跑在扩展进程时也能读到同一份数据。
 */
export function dbPath(): string {
  return Path.join(FileManager.appGroupDocumentsDirectory, DB_FILE)
}

export async function openDB(): Promise<DB> {
  if (cached != null) return cached
  const db = SQLite.open(dbPath(), {
    journalMode: "wal",
    foreignKeysEnabled: true,
    label: "ai-flashcards",
  })
  await migrate(db)
  cached = db
  return db
}

async function migrate(db: DB) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS decks (
      id     TEXT PRIMARY KEY,
      name   TEXT NOT NULL,
      icon   TEXT NOT NULL DEFAULT 'rectangle.stack',
      color  TEXT NOT NULL DEFAULT '#5E5CE6',
      source TEXT,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS cards (
      id    TEXT PRIMARY KEY,
      deck  TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      qno   INTEGER NOT NULL,
      front TEXT NOT NULL,
      back  TEXT NOT NULL,
      ord   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sched (
      card_id     TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
      due         INTEGER NOT NULL,
      interval    REAL    NOT NULL DEFAULT 0,
      ease        REAL    NOT NULL DEFAULT 2.5,
      reps        INTEGER NOT NULL DEFAULT 0,
      lapses      INTEGER NOT NULL DEFAULT 0,
      last_review INTEGER
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      ts      INTEGER NOT NULL,
      grade   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS chats (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      deck   TEXT    NOT NULL,
      qno    INTEGER NOT NULL,
      ts     INTEGER NOT NULL,
      prompt TEXT    NOT NULL,
      answer TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sched_due  ON sched(due);
    CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck, ord);
    CREATE INDEX IF NOT EXISTS idx_reviews_ts ON reviews(ts);
    CREATE INDEX IF NOT EXISTS idx_chats_q    ON chats(deck, qno, ts);
  `)
  // 单独再跑一遍：老库升级时，整段 execute 有的实现只会跑第一条，chats 表就建不出来，
  // 询问页会一直停在「载入中」，点询问也没反应。
  await db.execute(`
    CREATE TABLE IF NOT EXISTS chats (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      deck   TEXT    NOT NULL,
      qno    INTEGER NOT NULL,
      ts     INTEGER NOT NULL,
      prompt TEXT    NOT NULL,
      answer TEXT    NOT NULL
    )
  `)
  await db.execute("CREATE INDEX IF NOT EXISTS idx_chats_q ON chats(deck, qno, ts)")

  // v3.0：题库可选择是否加入全局复习。老库没有 enabled 列，需要原地升级。
  const deckColumns = await db.fetchAll<{ name: string }>("PRAGMA table_info(decks)")
  if (!deckColumns.some(c => c.name === "enabled")) {
    await db.execute("ALTER TABLE decks ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")
  }
}

/**
 * 普通卡用问题正面文本算稳定 id（FNV-1a）；种子提供 key 时优先用 key。
 * 前者兼容已有题库，后者允许持续润色文案而不丢复习进度。
 */
function cardId(deck: string, front: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < front.length; i++) {
    h ^= front.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${deck}-${h.toString(16).padStart(8, "0")}`
}

// ---------------------------------------------------------------- 导入卡片

type SeedFile = {
  version: number
  decks: Array<{
    id: string
    name: string
    icon?: string
    color?: string
    source?: string
    enabledByDefault?: boolean
    cards: Array<{ q: string; a: string; n: number; key?: string }>
  }>
}

export async function seedIfNeeded(force = false): Promise<{ imported: number; skipped: boolean }> {
  const db = await openDB()

  // cards.json 可能没跟着一起导入（比如脚本从私有仓库分发时数据单独放）。
  // 这种情况下 App 照常可用，只是题库是空的，用户可以补上文件后从「统计 → 重新导入卡片」再来一次。
  const seedPath = Path.join(Script.directory, "cards.json")
  if (!FileManager.existsSync(seedPath)) {
    return { imported: 0, skipped: true }
  }
  const seed = JSON.parse(FileManager.readAsStringSync(seedPath)) as SeedFile

  const current = await db.fetchOne<{ v: string }>("SELECT v FROM meta WHERE k = 'seed_version'")
  if (!force && current != null && Number(current.v) >= seed.version) {
    return { imported: 0, skipped: true }
  }

  const now = Date.now()
  let imported = 0

  for (const deck of seed.decks) {
    await db.execute(
      `INSERT INTO decks (id, name, icon, color, source, enabled) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon,
                                     color = excluded.color, source = excluded.source`,
      [
        deck.id,
        deck.name,
        deck.icon ?? "rectangle.stack",
        deck.color ?? "#5E5CE6",
        deck.source ?? null,
        deck.enabledByDefault === false ? 0 : 1,
      ]
    )

    const seen: string[] = []
    for (let i = 0; i < deck.cards.length; i++) {
      const c = deck.cards[i]
      const id = c.key ? `${deck.id}-${c.key}` : cardId(deck.id, c.q)
      seen.push(id)

      // 正反面文本每次都更新，进度行只在第一次出现时创建
      await db.execute(
        `INSERT INTO cards (id, deck, qno, front, back, ord) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET front = excluded.front, back = excluded.back,
                                       qno = excluded.qno, ord = excluded.ord`,
        [id, deck.id, c.n, c.q, c.a, i]
      )
      const s = newSchedule(now)
      await db.execute(
        `INSERT OR IGNORE INTO sched (card_id, due, interval, ease, reps, lapses, last_review)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, s.due, s.interval, s.ease, s.reps, s.lapses, null]
      )
      imported++
    }

    // 清掉这一版已经删除的卡（外键级联会一并删掉 sched 行）
    const placeholders = seen.map(() => "?").join(",")
    await db.execute(
      `DELETE FROM cards WHERE deck = ? AND id NOT IN (${placeholders})`,
      [deck.id, ...seen]
    )
  }

  await db.execute(
    "INSERT INTO meta (k, v) VALUES ('seed_version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    [String(seed.version)]
  )
  return { imported, skipped: false }
}

// ------------------------------------------------------------------ 查询

const CARD_COLUMNS = `
  c.id, c.deck, c.qno, c.front, c.back,
  s.due, s.interval, s.ease, s.reps, s.lapses, s.last_review AS lastReview
`

export async function dueCards(limit = 50, deck?: string): Promise<Card[]> {
  const db = await openDB()
  const args: (string | number)[] = [Date.now()]
  let sql = `SELECT ${CARD_COLUMNS}
             FROM cards c JOIN sched s ON s.card_id = c.id JOIN decks d ON d.id = c.deck
             WHERE s.due <= ? AND d.enabled = 1`
  if (deck != null) {
    sql += " AND c.deck = ?"
    args.push(deck)
  }
  sql += " ORDER BY s.due ASC LIMIT ?"
  args.push(limit)
  return db.fetchAll<Card>(sql, args)
}

export async function countDue(deck?: string): Promise<number> {
  const db = await openDB()
  const args: (string | number)[] = [Date.now()]
  let sql = `SELECT COUNT(*) AS n
             FROM cards c JOIN sched s ON s.card_id = c.id JOIN decks d ON d.id = c.deck
             WHERE s.due <= ? AND d.enabled = 1`
  if (deck != null) {
    sql += " AND c.deck = ?"
    args.push(deck)
  }
  const row = await db.fetchOne<{ n: number }>(sql, args)
  return row?.n ?? 0
}

export async function listDecks(): Promise<Deck[]> {
  const db = await openDB()
  return db.fetchAll<Deck>("SELECT id, name, icon, color, source, enabled FROM decks ORDER BY id")
}

export async function setDeckEnabled(deck: string, enabled: boolean): Promise<void> {
  const db = await openDB()
  await db.execute("UPDATE decks SET enabled = ? WHERE id = ?", [enabled ? 1 : 0, deck])
}

export async function cardsOfDeck(deck: string): Promise<Card[]> {
  const db = await openDB()
  return db.fetchAll<Card>(
    `SELECT ${CARD_COLUMNS} FROM cards c JOIN sched s ON s.card_id = c.id
     WHERE c.deck = ? ORDER BY c.ord`,
    [deck]
  )
}

export async function gradeCard(card: Card, grade: Grade): Promise<void> {
  const db = await openDB()
  const now = Date.now()
  const next = applyGrade(card, grade, now)
  await db.execute(
    `UPDATE sched SET due = ?, interval = ?, ease = ?, reps = ?, lapses = ?, last_review = ?
     WHERE card_id = ?`,
    [next.due, next.interval, next.ease, next.reps, next.lapses, next.lastReview, card.id]
  )
  await db.execute("INSERT INTO reviews (card_id, ts, grade) VALUES (?, ?, ?)", [card.id, now, grade])
}

export type Stats = {
  total: number
  due: number
  fresh: number
  learning: number
  mature: number
  reviewedToday: number
  streakDays: number
}

export async function stats(): Promise<Stats> {
  const db = await openDB()
  const now = Date.now()
  const t = new Date()
  const startOfToday = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()

  const row = await db.fetchOne<{
    total: number; due: number; fresh: number; learning: number; mature: number
  }>(
     `SELECT COUNT(*) AS total,
            SUM(CASE WHEN s.due <= ? THEN 1 ELSE 0 END)                       AS due,
            SUM(CASE WHEN s.reps = 0 THEN 1 ELSE 0 END)                       AS fresh,
            SUM(CASE WHEN s.reps > 0 AND s.interval < 21 THEN 1 ELSE 0 END)   AS learning,
            SUM(CASE WHEN s.interval >= 21 THEN 1 ELSE 0 END)                 AS mature
     FROM cards c JOIN sched s ON s.card_id = c.id JOIN decks d ON d.id = c.deck
     WHERE d.enabled = 1`,
    [now]
  )

  const today = await db.fetchOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM reviews WHERE ts >= ?",
    [startOfToday]
  )

  // 从今天往前数，连续有复习记录的天数。
  // 交给 SQLite 用 localtime 修饰符分桶，避免手工做整数除法时负数截断方向出错。
  const days = await db.fetchAll<{ d: string }>(
    `SELECT DISTINCT date(ts / 1000, 'unixepoch', 'localtime') AS d
     FROM reviews ORDER BY d DESC`
  )
  const seen = new Set(days.map(x => x.d))
  let streak = 0
  for (const cursor = new Date(); ; cursor.setDate(cursor.getDate() - 1)) {
    const key = [
      cursor.getFullYear(),
      String(cursor.getMonth() + 1).padStart(2, "0"),
      String(cursor.getDate()).padStart(2, "0"),
    ].join("-")
    if (!seen.has(key)) break
    streak++
  }

  return {
    total: row?.total ?? 0,
    due: row?.due ?? 0,
    fresh: row?.fresh ?? 0,
    learning: row?.learning ?? 0,
    mature: row?.mature ?? 0,
    reviewedToday: today?.n ?? 0,
    streakDays: streak,
  }
}

/** cards.json 已导入的版本号，用于界面上标注题库版本 */
export async function seedVersion(): Promise<number> {
  const db = await openDB()
  const row = await db.fetchOne<{ v: string }>("SELECT v FROM meta WHERE k = 'seed_version'")
  return row == null ? 0 : Number(row.v)
}

export async function resetProgress(): Promise<void> {
  const db = await openDB()
  const now = Date.now()
  await db.execute(
    "UPDATE sched SET due = ?, interval = 0, ease = 2.5, reps = 0, lapses = 0, last_review = NULL",
    [now]
  )
  await db.execute("DELETE FROM reviews")
}

// ---------------------------------------------------------------- LLM 配置与问答

const META_LLM_STORE = "llm_store"
const META_LLM_ENDPOINT = "llm_endpoint"
const META_LLM_API_KEY = "llm_api_key"
const META_LLM_MODEL = "llm_model"

/** SpaceXAI 的 OpenAI 兼容入口，用户可改成任意兼容端点 */
export const DEFAULT_LLM_ENDPOINT = "https://api.x.ai/v1"
export const DEFAULT_LLM_MODEL = "grok-4.5"

export type LlmProfile = {
  id: string
  name: string
  endpoint: string
  apiKey: string
  model: string
}

export type LlmStore = {
  activeId: string
  profiles: LlmProfile[]
}

export type LlmConfig = {
  name: string
  endpoint: string
  apiKey: string
  model: string
}

async function metaGet(k: string): Promise<string | null> {
  const db = await openDB()
  const row = await db.fetchOne<{ v: string }>("SELECT v FROM meta WHERE k = ?", [k])
  return row?.v ?? null
}

async function metaSet(k: string, v: string): Promise<void> {
  const db = await openDB()
  await db.execute(
    "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    [k, v]
  )
}

function newProfileId(): string {
  return "p" + Date.now().toString(36)
}

export function blankLlmProfile(name: string): LlmProfile {
  return {
    id: newProfileId(),
    name,
    endpoint: DEFAULT_LLM_ENDPOINT,
    apiKey: "",
    model: DEFAULT_LLM_MODEL,
  }
}

export function activeLlmProfile(store: LlmStore): LlmProfile {
  for (const p of store.profiles) {
    if (p.id === store.activeId) return p
  }
  return store.profiles[0]
}

function normalizeProfile(p: any, fallbackName: string): LlmProfile | null {
  if (p == null || typeof p !== "object") return null
  const id = typeof p.id === "string" && p.id ? p.id : newProfileId()
  const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : fallbackName
  const endpoint = typeof p.endpoint === "string" && p.endpoint.trim()
    ? p.endpoint.trim()
    : DEFAULT_LLM_ENDPOINT
  const apiKey = typeof p.apiKey === "string" ? p.apiKey.trim() : ""
  const model = typeof p.model === "string" && p.model.trim() ? p.model.trim() : DEFAULT_LLM_MODEL
  return { id, name, endpoint, apiKey, model }
}

async function migrateLegacyConfig(): Promise<LlmStore> {
  const endpoint = ((await metaGet(META_LLM_ENDPOINT)) ?? "").trim() || DEFAULT_LLM_ENDPOINT
  const apiKey = ((await metaGet(META_LLM_API_KEY)) ?? "").trim()
  const model = ((await metaGet(META_LLM_MODEL)) ?? "").trim() || DEFAULT_LLM_MODEL
  const p: LlmProfile = {
    id: newProfileId(),
    name: "默认",
    endpoint,
    apiKey,
    model,
  }
  return { activeId: p.id, profiles: [p] }
}

export async function loadLlmStore(): Promise<LlmStore> {
  const raw = await metaGet(META_LLM_STORE)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      const list: LlmProfile[] = []
      if (Array.isArray(parsed?.profiles)) {
        for (let i = 0; i < parsed.profiles.length; i++) {
          const p = normalizeProfile(parsed.profiles[i], "配置 " + (i + 1))
          if (p != null) list.push(p)
        }
      }
      if (list.length > 0) {
        const activeId = typeof parsed.activeId === "string" && list.some(p => p.id === parsed.activeId)
          ? parsed.activeId
          : list[0].id
        return { activeId, profiles: list }
      }
    } catch { /* 坏 JSON，走旧字段 */ }
  }
  const migrated = await migrateLegacyConfig()
  await saveLlmStore(migrated)
  return migrated
}

export async function saveLlmStore(store: LlmStore): Promise<void> {
  const active = activeLlmProfile(store)
  await metaSet(META_LLM_STORE, JSON.stringify(store))
  // 顺手镜像当前套，旧版还能读到
  await metaSet(META_LLM_ENDPOINT, active.endpoint)
  await metaSet(META_LLM_API_KEY, active.apiKey)
  await metaSet(META_LLM_MODEL, active.model)
}

export async function getLlmConfig(): Promise<LlmConfig> {
  const store = await loadLlmStore()
  const p = activeLlmProfile(store)
  return { name: p.name, endpoint: p.endpoint, apiKey: p.apiKey, model: p.model }
}

export type ChatTurn = {
  id: number
  deck: string
  qno: number
  ts: number
  prompt: string
  answer: string
}

/** 问答挂在「一道题」上，同一题拆出的多张卡共享记录 */
export async function listChats(deck: string, qno: number): Promise<ChatTurn[]> {
  const db = await openDB()
  return db.fetchAll<ChatTurn>(
    "SELECT id, deck, qno, ts, prompt, answer FROM chats WHERE deck = ? AND qno = ? ORDER BY ts ASC, id ASC",
    [deck, qno]
  )
}

export async function addChat(
  deck: string, qno: number, prompt: string, answer: string,
): Promise<ChatTurn> {
  const db = await openDB()
  const ts = Date.now()
  await db.execute(
    "INSERT INTO chats (deck, qno, ts, prompt, answer) VALUES (?, ?, ?, ?, ?)",
    [deck, qno, ts, prompt, answer]
  )
  const row = await db.fetchOne<ChatTurn>(
    "SELECT id, deck, qno, ts, prompt, answer FROM chats WHERE deck = ? AND qno = ? ORDER BY id DESC LIMIT 1",
    [deck, qno]
  )
  if (row == null) {
    return { id: 0, deck, qno, ts, prompt, answer }
  }
  return row
}

export async function clearChats(deck: string, qno: number): Promise<void> {
  const db = await openDB()
  await db.execute("DELETE FROM chats WHERE deck = ? AND qno = ?", [deck, qno])
}
