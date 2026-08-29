import {
  Button, HStack, Link, Path, RoundedRectangle, Script, ScrollView, Slider, Spacer, Text, VStack,
  useEffect, useRef, useState,
} from "scripting"

/**
 * 原文阅读器 + Agent 面试课播客。
 * articles.json 是可选资源（约 1.3MB）：文件不在时本视图给出说明，
 * 不影响 App 其余功能，和 cards.json 缺失时的处理方式一致。
 * podcasts.json 同样可选：没有讲稿或 mp3 时只显示原文。
 */

type Block = { k: "h2" | "h3" | "h4" | "p" | "li" | "code"; v: string }
type Article = { title: string; url: string; blocks: Block[] }
type Turn = { s: "host" | "guest"; t: string }
type Speaker = { name: string; role: string }
type Episode = { title: string; audio: string; turns: Turn[] }
type PodcastsFile = {
  series: string
  speakers: { host: Speaker; guest: Speaker }
  decks: Record<string, Record<string, Episode>>
}

let cache: Record<string, Record<string, Article>> | null | undefined = undefined
let podcastCache: PodcastsFile | null | undefined = undefined
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
  const p = Path.join(Script.directory, "podcasts.json")
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

function PodcastPlayer({ relativePath }: { relativePath: string }) {
  const filePath = Path.join(Script.directory, relativePath)
  const exists = FileManager.existsSync(filePath)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const playerRef = useRef<AVPlayer | null>(null)

  useEffect(() => {
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
    }, 250)
    return () => {
      clearInterval(timerId)
      try { player.pause() } catch {}
      try { player.dispose() } catch {}
      if (activePlayer === player) activePlayer = null
      playerRef.current = null
    }
  }, [filePath, exists])

  if (!exists) {
    return (
      <Text font="footnote" foregroundStyle="tertiaryLabel">
        本机没有这一集的音频文件。重新导入脚本后再试。
      </Text>
    )
  }

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

  return (
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
        onChanged={value => {
          setCurrent(value)
          if (playerRef.current != null) playerRef.current.currentTime = value
        }}
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
  )
}

function TurnView({ turn, speakers }: { turn: Turn; speakers: PodcastsFile["speakers"] }) {
  const meta = turn.s === "host" ? speakers.host : speakers.guest
  return (
    <VStack alignment="leading" spacing={4} padding={{ top: 4 }}>
      <Text font="caption" fontWeight="semibold" foregroundStyle="accentColor">
        {meta.name} · {meta.role}
      </Text>
      <Text font="body">{turn.t}</Text>
    </VStack>
  )
}

export function ArticleView({ deck, qno }: { deck: string; qno: number }) {
  const [article, setArticle] = useState<Article | null | undefined>(undefined)

  useEffect(() => {
    const all = loadArticles()
    setArticle(all?.[deck]?.[String(qno)] ?? null)
  }, [deck, qno])

  if (article === undefined) {
    return <VStack navigationTitle="原文"><Text foregroundStyle="secondaryLabel">载入中…</Text></VStack>
  }

  if (article === null) {
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

  const podcasts = loadPodcasts()
  const episode = podcasts?.decks?.[deck]?.[String(qno)] ?? null

  return (
    <ScrollView navigationTitle={`第 ${qno} 题 · 原文`} navigationBarTitleDisplayMode="inline">
      <VStack alignment="leading" spacing={12} padding={{ horizontal: 20, vertical: 16 }}>
        <Text font="title3" fontWeight="bold">{article.title}</Text>
        <Text font="caption2" foregroundStyle="tertiaryLabel">
          原文：公众号@小林面试笔记 · 仅供个人学习
        </Text>
        {article.blocks.map(b => <BlockView b={b} />)}
        {episode != null && podcasts != null ? (
          <VStack alignment="leading" spacing={12} padding={{ top: 16 }}>
            <RoundedRectangle cornerRadius={1} fill="separator"
              frame={{ maxWidth: "infinity", height: 1 }} />
            <Text font="headline">本集音频 · {podcasts.series}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              把这一题改写成双人播客课：{podcasts.speakers.host.name} 主理，{podcasts.speakers.guest.name} 以面试官视角拆题。可边听边对照原文。
            </Text>
            <PodcastPlayer relativePath={episode.audio} />
            <Text font="headline" padding={{ top: 6 }}>播客讲稿</Text>
            {episode.turns.map(t => <TurnView turn={t} speakers={podcasts.speakers} />)}
          </VStack>
        ) : null}
        <Link url={article.url} padding={{ top: 12 }}>
          <Text font="footnote" foregroundStyle="accentColor">在浏览器中查看原文（含配图）</Text>
        </Link>
      </VStack>
    </ScrollView>
  )
}
