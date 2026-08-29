import {
  Button, HStack, Link, Path, RoundedRectangle, Script, ScrollView, Slider, Spacer, Text, VStack,
  useEffect, useRef, useState,
} from "scripting"

/**
 * 原文阅读器 + 《Agent 面试课》播客。
 * articles.json 是可选资源（约 1.3MB）：文件不在时本视图给出说明，
 * 不影响 App 其余功能，和 cards.json 缺失时的处理方式一致。
 * 正式播客读 podcasts_renna.json（仁菜 / 桑多涅）。歌词跟 audio/renna/NN.lrc 同步滚动。
 */

type Block = { k: "h2" | "h3" | "h4" | "p" | "li" | "code"; v: string }
type Article = { title: string; url: string; blocks: Block[] }
type Turn = { s: "host" | "guest"; t: string; ms?: number }
type Speaker = { name: string; role: string }
type Episode = { title: string; audio: string; turns: Turn[]; ms?: number }
type PodcastsFile = {
  series: string
  speakers: { host: Speaker; guest: Speaker }
  decks: Record<string, Record<string, Episode>>
}
type Pane = "podcast" | "article"
type LyricLine = { t: number; name: string; text: string; host: boolean }

const LYRIC_BEFORE = 2
const LYRIC_AFTER = 3

let cache: Record<string, Record<string, Article>> | null | undefined = undefined
let podcastCache: PodcastsFile | null | undefined = undefined
let lyricsCache: Record<string, LyricLine[]> = {}
let audioSessionReady = false
let activePlayer: { pause: () => void } | null = null

function loadArticles(): Record<string, Record<string, Article>> | null {
  if (cache !== undefined) return cache
  const p = Path.join(Script.directory, "articles.json")
  if (!FileManager.existsSync(p)) { cache = null; return null }
  try {
    cache = JSON.parse(FileManager.readAsStringSync(p)).decks
  } catch {
    cache = null
  }
  return cache
}

function loadPodcasts(): PodcastsFile | null {
  if (podcastCache !== undefined) return podcastCache
  const p = Path.join(Script.directory, "podcasts_renna.json")
  if (!FileManager.existsSync(p)) { podcastCache = null; return null }
  try {
    podcastCache = JSON.parse(FileManager.readAsStringSync(p)) as PodcastsFile
  } catch {
    podcastCache = null
  }
  return podcastCache
}

function getEpisode(deck: string, qno: number): Episode | null {
  return loadPodcasts()?.decks?.[deck]?.[String(qno)] ?? null
}

/** 启动时预热，避免首次翻到带原文的卡时同步解析 1.3MB JSON 造成卡顿 */
export function warmArticles(): void {
  loadArticles()
  loadPodcasts()
}

export function hasPodcast(deck: string, qno: number): boolean {
  return getEpisode(deck, qno) != null
}

/** 列出某个专题下的全部原文篇目，按题号排序 */
export function listArticles(deck: string): { qno: number; title: string }[] {
  const all = loadArticles()
  const d = all?.[deck]
  if (d == null) return []
  return Object.keys(d)
    .map(k => ({ qno: Number(k), title: d[k].title }))
    .sort((a, b) => a.qno - b.qno)
}

export function hasArticle(deck: string, qno: number): boolean {
  const a = loadArticles()
  return a != null && a[deck] != null && a[deck][String(qno)] != null
}

function shortRole(role: string): string {
  const cut = role.split("｜")[0].trim()
  return cut.length > 0 ? cut : role
}

function BlockView({ b }: { b: Block }) {
  if (b.k === "h2") {
    return <Text font="title3" fontWeight="bold" padding={{ top: 10 }}>{b.v}</Text>
  }
  if (b.k === "h3" || b.k === "h4") {
    return <Text font="headline" padding={{ top: 6 }}>{b.v}</Text>
  }
  if (b.k === "code") {
    return (
      <VStack alignment="leading" padding={12}
        frame={{ maxWidth: "infinity" }}
        background={<RoundedRectangle cornerRadius={10} fill="tertiarySystemFill" />}>
        <Text font="footnote">{b.v}</Text>
      </VStack>
    )
  }
  if (b.k === "li") {
    return (
      <HStack alignment="top" spacing={8}>
        <Text foregroundStyle="secondaryLabel">·</Text>
        <Text font="body">{b.v}</Text>
        <Spacer />
      </HStack>
    )
  }
  return <Text font="body">{b.v}</Text>
}

function formatClock(time: number): string {
  const total = Number.isFinite(time) && time > 0 ? Math.floor(time) : 0
  const m = Math.floor(total / 60)
  const s = total % 60
  return m + ":" + String(s).padStart(2, "0")
}

function parseLrc(src: string, hostName: string): LyricLine[] {
  const lines: LyricLine[] = []
  const rows = src.split("\n")
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i].match(/^\[(\d{1,2}):(\d{2})\.(\d{1,3})\](.*)$/)
    if (m == null) continue
    const frac = m[3]
    const sub = Number(frac) / (frac.length === 3 ? 1000 : 100)
    const t = Number(m[1]) * 60 + Number(m[2]) + sub
    let name = ""
    let text = m[4]
    const cut = text.indexOf("：")
    if (cut > 0 && cut <= 8) {
      name = text.slice(0, cut)
      text = text.slice(cut + 1)
    }
    lines.push({ t, name, text, host: name === hostName })
  }
  return lines
}

function lyricsFromTurns(episode: Episode, hostName: string, guestName: string): LyricLine[] {
  const out: LyricLine[] = []
  for (let i = 0; i < episode.turns.length; i++) {
    const turn = episode.turns[i]
    out.push({
      t: (turn.ms ?? 0) / 1000,
      name: turn.s === "host" ? hostName : guestName,
      text: turn.t,
      host: turn.s === "host",
    })
  }
  return out
}

function loadLyrics(audioRel: string, episode: Episode, hostName: string, guestName: string): LyricLine[] {
  const hit = lyricsCache[audioRel]
  if (hit != null) return hit
  const lrcRel = audioRel.replace(/\.mp3$/i, ".lrc")
  const p = Path.join(Script.directory, lrcRel)
  if (FileManager.existsSync(p)) {
    try {
      const parsed = parseLrc(FileManager.readAsStringSync(p), hostName)
      if (parsed.length > 0) {
        lyricsCache[audioRel] = parsed
        return parsed
      }
    } catch {
      // 解析失败就用 json 里的 ms
    }
  }
  const fallback = lyricsFromTurns(episode, hostName, guestName)
  lyricsCache[audioRel] = fallback
  return fallback
}

function lyricIndexAt(lines: LyricLine[], t: number): number {
  let idx = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= t + 0.05) idx = i
    else break
  }
  return idx
}

function windowIndices(idx: number, n: number): number[] {
  const start = Math.max(0, idx - LYRIC_BEFORE)
  const end = Math.min(n, idx + LYRIC_AFTER + 1)
  const out: number[] = []
  for (let i = start; i < end; i++) out.push(i)
  return out
}

function ensureAudioSession(): void {
  if (audioSessionReady) return
  try {
    SharedAudioSession.setCategory(
      "playback",
      ["mixWithOthers", "allowAirPlay", "allowBluetooth", "allowBluetoothA2DP"],
    )
    SharedAudioSession.setMode("spokenAudio")
    SharedAudioSession.setActive(true)
    audioSessionReady = true
  } catch (e) {
    console.error("音频会话初始化失败：", e)
  }
}

function LyricRow({
  line, active, onSeek,
}: {
  line: LyricLine
  active: boolean
  onSeek: (t: number) => void
}) {
  if (active) {
    return (
      <VStack alignment="leading" spacing={4} padding={12}
        frame={{ maxWidth: "infinity" }}
        background={<RoundedRectangle cornerRadius={12} fill="tertiarySystemFill" />}>
        <HStack>
          <Text font="caption" fontWeight="semibold" foregroundStyle="accentColor">{line.name}</Text>
          <Spacer />
          <Text font="caption2" foregroundStyle="tertiaryLabel">{formatClock(line.t)}</Text>
        </HStack>
        <Text font="body" fontWeight="semibold">{line.text}</Text>
      </VStack>
    )
  }
  return (
    <Button action={() => onSeek(line.t)} buttonStyle="borderless">
      <VStack alignment="leading" spacing={2} padding={{ vertical: 6 }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="caption2" foregroundStyle="tertiaryLabel">{line.name}</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">{line.text}</Text>
      </VStack>
    </Button>
  )
}

function SyncedLyrics({
  lines, playhead, browse, onBrowse, onSeek,
}: {
  lines: LyricLine[]
  playhead: number
  browse: boolean
  onBrowse: (v: boolean) => void
  onSeek: (t: number) => void
}) {
  const idx = lyricIndexAt(lines, playhead)
  const indices = browse ? lines.map((_, i) => i) : windowIndices(idx, lines.length)
  return (
    <VStack alignment="leading" spacing={8}>
      <HStack>
        <Text font="headline">歌词</Text>
        <Spacer />
        <Text font="caption" foregroundStyle="tertiaryLabel">{idx + 1} / {lines.length}</Text>
        <Button
          title={browse ? "跟随" : "全部"}
          action={() => onBrowse(!browse)}
          buttonStyle="bordered"
          buttonBorderShape="capsule"
          controlSize="small"
        />
      </HStack>
      <Text font="caption2" foregroundStyle="tertiaryLabel">
        {browse ? "点某一句跳到对应时间。" : "跟随播放滚动。点前后句或拖进度条可跳转。"}
      </Text>
      {indices.map(i => (
        <LyricRow line={lines[i]} active={i === idx} onSeek={onSeek} />
      ))}
    </VStack>
  )
}

function PodcastSession({
  episode, speakers, showLyrics, children,
}: {
  episode: Episode
  speakers: PodcastsFile["speakers"]
  showLyrics: boolean
  children?: any
}) {
  const relativePath = episode.audio
  const filePath = Path.join(Script.directory, relativePath)
  const exists = FileManager.existsSync(filePath)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [browse, setBrowse] = useState(false)
  const playerRef = useRef<AVPlayer | null>(null)
  const lyrics = loadLyrics(relativePath, episode, speakers.host.name, speakers.guest.name)

  useEffect(() => {
    setBrowse(false)
    setCurrent(0)
    setPlaying(false)
    setReady(false)
    if (!exists) return
    ensureAudioSession()
    const player = new AVPlayer()
    player.setSource(filePath)
    player.onReadyToPlay = () => {
      setReady(true)
      setDuration(player.duration)
    }
    player.onEnded = () => {
      setPlaying(false)
    }
    playerRef.current = player
    const timerId = setInterval(() => {
      const p = playerRef.current
      if (p != null) setCurrent(p.currentTime)
    }, 200)
    return () => {
      clearInterval(timerId)
      try { player.pause() } catch {}
      try { player.dispose() } catch {}
      if (activePlayer === player) activePlayer = null
      playerRef.current = null
    }
  }, [filePath, exists])

  function play() {
    const p = playerRef.current
    if (p == null) return
    if (activePlayer != null && activePlayer !== p) {
      try { activePlayer.pause() } catch {}
    }
    activePlayer = p
    p.play()
    setPlaying(true)
  }

  function pause() {
    playerRef.current?.pause()
    setPlaying(false)
  }

  function seek(t: number) {
    setCurrent(t)
    if (playerRef.current != null) playerRef.current.currentTime = t
  }

  if (!exists) {
    return (
      <Text font="footnote" foregroundStyle="tertiaryLabel">
        本机没有这一集的音频文件。重新导入脚本后再试。
      </Text>
    )
  }

  return (
    <VStack alignment="leading" spacing={14} frame={{ maxWidth: "infinity" }}>
      <VStack alignment="leading" spacing={10} padding={14}
        frame={{ maxWidth: "infinity" }}
        background={<RoundedRectangle cornerRadius={14} fill="tertiarySystemFill" />}>
        <HStack spacing={8}>
          <Text font="caption" fontWeight="semibold" foregroundStyle="accentColor">本集音频</Text>
          <Spacer />
          <Text font="caption2" foregroundStyle="tertiaryLabel">
            {formatClock(current)} / {formatClock(duration)}
          </Text>
        </HStack>
        <Slider
          disabled={!ready}
          min={0}
          max={duration > 0 ? duration : 1}
          value={current}
          onChanged={value => seek(value)}
        />
        <Button
          disabled={!ready}
          title={playing ? "暂停" : "播放本集"}
          systemImage={playing ? "pause.fill" : "play.fill"}
          action={playing ? pause : play}
          buttonStyle={playing ? "borderedProminent" : "bordered"}
          buttonBorderShape="capsule"
        />
      </VStack>

      {children}

      {showLyrics && lyrics.length > 0 ? (
        <SyncedLyrics
          lines={lyrics}
          playhead={current}
          browse={browse}
          onBrowse={setBrowse}
          onSeek={seek}
        />
      ) : null}

      {showLyrics && lyrics.length === 0 ? (
        <Text font="footnote" foregroundStyle="tertiaryLabel">这一集没有歌词文件。</Text>
      ) : null}
    </VStack>
  )
}

function ArticleBody({ article }: { article: Article }) {
  return (
    <VStack alignment="leading" spacing={12}>
      <Text font="title3" fontWeight="bold">{article.title}</Text>
      <Text font="caption2" foregroundStyle="tertiaryLabel">
        原文：公众号@小林面试笔记 · 仅供个人学习
      </Text>
      {article.blocks.map(b => <BlockView b={b} />)}
      <Link url={article.url} padding={{ top: 4 }}>
        <Text font="footnote" foregroundStyle="accentColor">在浏览器中查看原文（含配图）</Text>
      </Link>
    </VStack>
  )
}

function PaneSwitcher({ pane, onChange }: { pane: Pane; onChange: (p: Pane) => void }) {
  return (
    <HStack spacing={8}>
      <Button
        title="歌词"
        action={() => onChange("podcast")}
        buttonStyle={pane === "podcast" ? "borderedProminent" : "bordered"}
        buttonBorderShape="capsule"
        frame={{ maxWidth: "infinity" }}
      />
      <Button
        title="原文"
        action={() => onChange("article")}
        buttonStyle={pane === "article" ? "borderedProminent" : "bordered"}
        buttonBorderShape="capsule"
        frame={{ maxWidth: "infinity" }}
      />
    </HStack>
  )
}

export function ArticleView({
  deck, qno, focus,
}: {
  deck: string
  qno: number
  focus?: Pane
}) {
  const [article, setArticle] = useState<Article | null | undefined>(undefined)
  const [pane, setPane] = useState<Pane>(focus === "article" ? "article" : "podcast")

  useEffect(() => {
    const all = loadArticles()
    setArticle(all?.[deck]?.[String(qno)] ?? null)
  }, [deck, qno])

  if (article === undefined) {
    return <VStack navigationTitle="原文"><Text foregroundStyle="secondaryLabel">载入中…</Text></VStack>
  }

  const podcasts = loadPodcasts()
  const episode = podcasts?.decks?.[deck]?.[String(qno)] ?? null
  const hasBoth = article != null && episode != null && podcasts != null
  const showPodcast = episode != null && podcasts != null && (article == null || pane === "podcast")
  const showArticle = article != null && (episode == null || pane === "article")
  const title = showPodcast ? `第 ${qno} 集` : `第 ${qno} 题 · 原文`

  if (article === null && episode == null) {
    return (
      <VStack navigationTitle="原文" spacing={12} padding={24}>
        <Text font="headline">本机没有原文数据</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">
          没找到 articles.json。重新导入一次脚本，或直接去网页阅读。
        </Text>
        <Link url="https://xiaolinnote.com/ai/agent/">
          <Text foregroundStyle="accentColor">在浏览器中打开</Text>
        </Link>
      </VStack>
    )
  }

  return (
    <ScrollView navigationTitle={title} navigationBarTitleDisplayMode="inline">
      <VStack alignment="leading" spacing={14} padding={{ horizontal: 20, vertical: 16 }}>
        {episode != null && podcasts != null ? (
          <VStack alignment="leading" spacing={8}>
            <Text font="title3" fontWeight="bold">{episode.title}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              {podcasts.series} · {podcasts.speakers.host.name} / {podcasts.speakers.guest.name}
            </Text>
            <Text font="caption2" foregroundStyle="tertiaryLabel">
              {podcasts.speakers.host.name} · {shortRole(podcasts.speakers.host.role)}
              {"  ·  "}
              {podcasts.speakers.guest.name} · {shortRole(podcasts.speakers.guest.role)}
            </Text>
            <PodcastSession
              episode={episode}
              speakers={podcasts.speakers}
              showLyrics={showPodcast}
            >
              {hasBoth ? <PaneSwitcher pane={pane} onChange={setPane} /> : null}
            </PodcastSession>
          </VStack>
        ) : null}

        {showArticle && article != null ? <ArticleBody article={article} /> : null}
      </VStack>
    </ScrollView>
  )
}
