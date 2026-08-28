import { Path, Script } from "scripting"

import { applyGrade, newSchedule, type Grade, type Schedule } from "./srs"

const DB_FILE = "ai-flashcards.db"

export type Deck = {
  id: string
  name: string
  icon: string
  color: string
  source: string
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
      source TEXT
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
    CREATE INDEX IF NOT EXISTS idx_sched_due  ON sched(due);
    CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck, ord);
    CREATE INDEX IF NOT EXISTS idx_reviews_ts ON reviews(ts);
  `)
}

/**
 * 用问题正面文本算稳定 id（FNV-1a）。
 * 这样 cards.json 里增删、重排卡片都不会打乱已有的复习进度，
 * 只有改动问题文本才会被当成一张新卡。
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
    cards: Array<{ q: string; a: string; n: number }>
  }>
}

export async function seedIfNeeded(force = false): Promise<{ imported: number; skipped: boolean }> {
  const db = await openDB()
  const raw = FileManager.readAsStringSync(Path.join(Script.directory, "cards.json"))
  const seed = JSON.parse(raw) as SeedFile

  const current = await db.fetchOne<{ v: string }>("SELECT v FROM meta WHERE k = 'seed_version'")
  if (!force && current != null && Number(current.v) >= seed.version) {
    return { imported: 0, skipped: true }
  }

  const now = Date.now()
  let imported = 0

  for (const deck of seed.decks) {
    await db.execute(
      `INSERT INTO decks (id, name, icon, color, source) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon,
                                     color = excluded.color, source = excluded.source`,
      [deck.id, deck.name, deck.icon ?? "rectangle.stack", deck.color ?? "#5E5CE6", deck.source ?? null]
    )

    const seen: string[] = []
    for (let i = 0; i < deck.cards.length; i++) {
      const c = deck.cards[i]
      const id = cardId(deck.id, c.q)
      seen.push(id)

      // 正反面文本每次都更新，进度行只在第一次出现时创建
      await db.execute(
        `INSERT INTO cards (id, deck, qno, front, back, ord) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET back = excluded.back, qno = excluded.qno, ord = excluded.ord`,
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
  let sql = `SELECT ${CARD_COLUMNS} FROM cards c JOIN sched s ON s.card_id = c.id WHERE s.due <= ?`
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
  let sql = "SELECT COUNT(*) AS n FROM cards c JOIN sched s ON s.card_id = c.id WHERE s.due <= ?"
  if (deck != null) {
    sql += " AND c.deck = ?"
    args.push(deck)
  }
  const row = await db.fetchOne<{ n: number }>(sql, args)
  return row?.n ?? 0
}

export async function listDecks(): Promise<Deck[]> {
  const db = await openDB()
  return db.fetchAll<Deck>("SELECT id, name, icon, color, source FROM decks ORDER BY id")
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
     FROM cards c JOIN sched s ON s.card_id = c.id`,
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

export async function resetProgress(): Promise<void> {
  const db = await openDB()
  const now = Date.now()
  await db.execute(
    "UPDATE sched SET due = ?, interval = 0, ease = 2.5, reps = 0, lapses = 0, last_review = NULL",
    [now]
  )
  await db.execute("DELETE FROM reviews")
}
