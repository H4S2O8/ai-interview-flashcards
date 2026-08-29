import {
  Button, HStack, Link, Path, ProgressView, RoundedRectangle, Script, ScrollView, Slider, Spacer,
  Text, VStack,
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

async function ensureAudioSession(): Promise<string | null> {
  if (audioSessionReady) return null
  // OSStatus -50 = 参数不合法（真机实测某 option 被拒）。从全配置逐级降到最小配置，成功一个就锁定。
  const attempts: Array<[string, string[]]> = [
    ["playback", ["mixWithOthers", "allowBluetooth", "allowBluetoothA2DP", "allowAirPlay"]],
    ["playback", ["mixWithOthers"]],
    ["playback", []],
  ]
  let lastErr: string | null = null
  for (const [category, options] of attempts) {
    try {
      await SharedAudioSession.setCategory(category, options)
      try {
        // 文档收录但个别平台可能缺失：失败不能拖垮会话激活
        await SharedAudioSession.setMode("spokenAudio")
      } catch {}
      await SharedAudioSession.setActive(true)
      audioSessionReady = true
      return null
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }
  // 全部失败：不再配置会话——系统默认会话也能播放（最多受静音键影响）
  try {
    await SharedAudioSession.setActive(true)
  } catch {}
  return lastErr
}

/** 把会话「最后真正落到哪一档」读回来。
 *  之前只知道 setCategory 有没有抛错，不知道生效的是什么 ——
 *  而 category 不是 playback 时，iOS 默认的 soloAmbient 会被静音拨片直接掐掉声音，
 *  播放器却照样报 playing。这正是「状态=2 但无声」的经典成因。 */
async function describeAudioSession(): Promise<string> {
  try {
    const cat = await SharedAudioSession.category
    const opts = await SharedAudioSession.categoryOptions
    const optText = Array.isArray(opts) ? (opts.length > 0 ? opts.join("+") : "无选项") : String(opts)
    let other = ""
    try {
      if (await SharedAudioSession.isOtherAudioPlaying) other = " ·有其他音频"
    } catch {}
    return `${String(cat)}[${optText}]${other}`
  } catch {
    return "读不出"
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

// ── 音频缓存与下载 ─────────────────────────────────────────────────
// mp3 不进仓库 —— 仓库同步体积直接决定手机端 remoteResource 拉取成败。
// 音频托管在 Cloudflare R2（键与仓库内相对路径一致：audio/renna/NN.mp3），
// 首次收听某集时下载一次，缓存到 documentsDirectory —— 脚本更新不触碰这个目录。

const AUDIO_BASE = "https://audio.asylum.icu/"
const AUDIO_CACHE_ROOT = "ai-flashcards-audio"

function cachedAudioPath(relativePath: string): string {
  return Path.join(FileManager.documentsDirectory, AUDIO_CACHE_ROOT, relativePath)
}

/** 缓存文件是否像回事：有效的一集至少 1MB；文件头「明确不是 mp3」才判坏。
 *  头读不出来一律放行 —— 读通道本身不可靠（见 fileHeadHex 注释），
 *  v2.5.5 就是把「读不出」当成「不是 mp3」，导致好文件被反复判死、无限重下。 */
function cachedFileOk(p: string): boolean {
  try {
    if (FileManager.statSync(p).size <= 100000) return false
  } catch {
    return false
  }
  return headIsMp3(fileHeadHex(p)) !== false
}

function cacheSizeText(p: string | null): string {
  if (p == null) return "无"
  try {
    return `${(FileManager.statSync(p).size / 1048576).toFixed(2)} MB`
  } catch {
    return "不可读"
  }
}

async function downloadEpisodeAudio(relativePath: string): Promise<string> {
  const dest = cachedAudioPath(relativePath)
  const dir = dest.substring(0, dest.lastIndexOf("/"))
  FileManager.createDirectorySync(dir, true)
  const resp = await fetch(AUDIO_BASE + relativePath)
  if (!resp.ok) throw new Error("HTTP " + resp.status)
  const buf = await resp.arrayBuffer()
  if (buf.byteLength === 0) throw new Error("下载内容为空")
  // 走 Data 落盘，不经过 Uint8Array/writeAsBytes（真机上疑似把字节写坏：大小对、内容不可解码）
  const data = Data.fromArrayBuffer(buf)
  if (data == null) throw new Error("Data.fromArrayBuffer 返回空")
  FileManager.writeAsDataSync(dest, data)
  const written = FileManager.statSync(dest).size
  if (written !== buf.byteLength) throw new Error(`写入不完整（${written}/${buf.byteLength} 字节）`)
  // 字节数对得上就算落盘成功。文件头只在「确实读出来了、而且不是 mp3」时才判失败：
  // 读不出头不代表文件坏，不能拿它否掉一次大小已经核对过的下载。
  const hex = fileHeadHex(dest)
  if (headIsMp3(hex) === false) {
    throw new Error(`落盘后文件头是 ${hex}，不是 mp3 —— 写盘通道有问题，请切到「在线播放」`)
  }
  return dest
}

/** 文件头 4 字节的十六进制；读不出来返回 null。
 *  只走 Data（fromFile → slice → toHexString），不碰 Uint8Array：
 *  真机上 FileManager.readAsBytesSync(...) 的返回值在 JS 侧取不到 length/下标，
 *  v2.5.5 报的「文件头异常（，不是 mp3）」括号是空的，就是栽在这条通道上。 */
function fileHeadHex(p: string): string | null {
  try {
    const d = Data.fromFile(p)
    if (d == null || d.size < 4) return null
    const hex = d.slice(0, 4).toHexString()
    if (typeof hex !== "string") return null
    const clean = hex.toLowerCase().replace(/[^0-9a-f]/g, "")
    return clean.length >= 8 ? clean : null
  } catch {
    return null
  }
}

/** true = 是 mp3，false = 明确不是，null = 读不出（不能当成坏文件） */
function headIsMp3(hex: string | null): boolean | null {
  if (hex == null || hex.length < 6) return null
  // 仁菜这批是裸帧同步 ff fb（LAME 的 Info 头在第一帧里），带 ID3 的也一并认
  return hex.startsWith("494433") || hex.startsWith("ff")
}

function fileHeadText(p: string): string {
  const hex = fileHeadHex(p)
  if (hex == null) return "读不出"
  const ok = headIsMp3(hex)
  return hex + (ok === true ? " ✓" : ok === false ? " ✗非mp3" : " ?")
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
  const cachedPath = cachedAudioPath(relativePath)
  const remoteUrl = AUDIO_BASE + relativePath
  // 音源：remote 直接把 R2 的 URL 交给 AVPlayer（setSource 支持远程 URL，Worker 支持 Range），
  // local 走「下载到 documentsDirectory 再播本地文件」。默认 remote——本地那条
  // fetch→Data→写盘→读回的通道在真机上连挂了 5 个版本，先绕开它把声音放出来。
  const [srcMode, setSrcMode] = useState<"remote" | "local">("remote")
  const [audioPath, setAudioPath] = useState<string | null>(() =>
    cachedFileOk(cachedPath) ? cachedPath : null,
  )
  // phase: downloading 拉取中 / ready 已就绪 / error 出错
  const [phase, setPhase] = useState<"downloading" | "ready" | "error">("ready")
  const [attempt, setAttempt] = useState(0)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [sessionErr, setSessionErr] = useState<string | null>(null)
  const [tcStatus, setTcStatus] = useState("—")
  const [headInfo, setHeadInfo] = useState("—")
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [browse, setBrowse] = useState(false)
  const [sessionInfo, setSessionInfo] = useState("—")
  const [builds, setBuilds] = useState(0)
  const [tick, setTick] = useState(0)
  const playerRef = useRef<AVPlayer | null>(null)
  const dlSeq = useRef(0)
  const builtFor = useRef<string | null>(null)
  const buildCount = useRef(0)
  const pollCount = useRef(0)
  const pollRef = useRef<any>(null)
  const watchdogRef = useRef<any>(null)
  const wantPlay = useRef(false)
  const lyrics = loadLyrics(relativePath, episode, speakers.host.name, speakers.guest.name)

  const source = srcMode === "remote" ? remoteUrl : audioPath

  // 切到本地音源、且没有可用缓存时才下载（只一次；失败可重试）。
  // 不用 cleanup 返回值，用递增序号丢弃过期响应（check.py 的 Hooks 扫描也认这种写法）。
  useEffect(() => {
    if (srcMode !== "local") return
    if (audioPath != null) return
    setPhase("downloading")
    const seq = ++dlSeq.current
    downloadEpisodeAudio(relativePath)
      .then((p) => {
        if (dlSeq.current !== seq) return
        setAudioPath(p)
        setPhase("ready")
      })
      .catch((e) => {
        console.error("音频下载失败：", e)
        if (dlSeq.current === seq) {
          setErrMsg(e instanceof Error ? e.message : String(e))
          setPhase("error")
        }
      })
  }, [srcMode, audioPath, relativePath, attempt])

  // 播放器只为每个 source 建一次，判重靠 ref 而不是靠 deps。
  // 这个框架的 effect 重跑语义没验证过，而「effect 反复重跑 → cleanup 里 dispose →
  // 立刻重建」正好能造出「就绪=是 / 播放中=是 / 状态=2 / 时间恒 0 / 无声」这一整套症状：
  // 每个实例都活不过几十毫秒。诊断行的「构建」就是来证伪它的 —— 正常应该恒等于 1。
  useEffect(() => {
    if (source == null) return
    if (builtFor.current === source && playerRef.current != null) return
    builtFor.current = source
    void buildPlayer(source)
  }, [source])

  // 收摊只挂在 [] 上：不能放进 [source] 的 cleanup，否则 effect 一重跑就把活着的播放器 dispose 掉
  useEffect(() => {
    return () => {
      stopPolling()
      teardownPlayer()
    }
  }, [])

  function stopPolling() {
    if (pollRef.current != null) clearInterval(pollRef.current)
    pollRef.current = null
    if (watchdogRef.current != null) clearTimeout(watchdogRef.current)
    watchdogRef.current = null
  }

  function teardownPlayer() {
    const p = playerRef.current
    if (p != null) {
      try { p.pause() } catch {}
      try { p.dispose() } catch {}
      if (activePlayer === p) activePlayer = null
    }
    playerRef.current = null
  }

  // 诊断全部改成「直接问播放器」。onTimeControlStatusChanged 只在状态变化时触发一次，
  // 播放器悄悄停下来它不会再报 —— 之前那个「状态=2」很可能早就是陈的了。
  function startPolling(player: AVPlayer) {
    stopPolling()
    pollRef.current = setInterval(() => {
      if (playerRef.current !== player) return
      pollCount.current += 1
      setTick(pollCount.current)
      try { setCurrent(player.currentTime) } catch {}
      try { if (player.duration > 0) setDuration(player.duration) } catch {}
      try { setTcStatus(`${String(player.timeControlStatus)} 速率${String(player.rate)}`) } catch {}
    }, 500)
  }

  async function buildPlayer(src: string) {
    teardownPlayer()
    stopPolling()
    buildCount.current += 1
    setBuilds(buildCount.current)
    setReady(false)
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
    setBrowse(false)
    setHeadInfo(srcMode === "local" ? fileHeadText(src) : "在线不适用")
    // 文档里每个例子都是「先配好并激活会话，再 setSource」。
    // 之前 ensureAudioSession() 不 await 就往下走，setSource 跑在会话配好之前。
    setSessionErr(await ensureAudioSession())
    setSessionInfo(await describeAudioSession())
    const player = new AVPlayer()
    let isReady = false
    player.onReadyToPlay = () => {
      isReady = true
      setReady(true)
      setDuration(player.duration)
      // 文档里 play() 一律写在 onReadyToPlay 里。用户已经按过播放就在这兑现。
      if (wantPlay.current) void startPlayback(player)
    }
    player.onTimeControlStatusChanged = (status: string) => {
      setTcStatus(String(status))
    }
    player.onError = (message: string) => {
      if (isReady) return
      setErrMsg(String(message))
      setPhase("error")
    }
    if (!player.setSource(src)) {
      setErrMsg(srcMode === "remote"
        ? `打开在线音频失败：${src}`
        : `打开本地音频失败（可能缓存损坏）：${src}`)
      setPhase("error")
      return
    }
    // play() 不带参数时用的是 defaultRate；没见过它的默认值，显式写死 1
    try { player.defaultRate = 1 } catch {}
    try { player.volume = 1 } catch {}
    player.onEnded = () => {
      wantPlay.current = false
      setPlaying(false)
    }
    playerRef.current = player
    startPolling(player)
    // 兜底：一直不进入可播放状态就报错，别让用户对着 0:00 干等
    const watchdogMs = srcMode === "remote" ? 25000 : 10000
    watchdogRef.current = setTimeout(() => {
      if (!isReady && playerRef.current === player) {
        setErrMsg(srcMode === "remote"
          ? `${watchdogMs / 1000} 秒未进入可播放状态，网络太慢或音源不可达`
          : `${watchdogMs / 1000} 秒未进入可播放状态，文件可能损坏或格式异常`)
        setPhase("error")
      }
    }, watchdogMs)
  }

  async function startPlayback(p: AVPlayer) {
    if (activePlayer != null && activePlayer !== p) {
      try { activePlayer.pause() } catch {}
    }
    activePlayer = p
    const started = p.play()
    if (!started) {
      setErrMsg("播放器拒绝开始播放（play() 返回 false）")
      setPhase("error")
      return
    }
    setPlaying(true)
  }

  async function play() {
    wantPlay.current = true
    const p = playerRef.current
    // 还没就绪也不算错：onReadyToPlay 会照着 wantPlay 补上
    if (p == null) return
    setSessionErr(await ensureAudioSession())
    setSessionInfo(await describeAudioSession())
    await startPlayback(p)
  }

  function pause() {
    wantPlay.current = false
    playerRef.current?.pause()
    setPlaying(false)
  }

  function seek(t: number) {
    setCurrent(t)
    if (playerRef.current != null) playerRef.current.currentTime = t
  }

  // 切换音源：清掉播放态，让播放器 effect 用新的 source 重建
  function switchSource(mode: "remote" | "local") {
    setErrMsg(null)
    setSessionErr(null)
    setReady(false)
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
    setTcStatus("—")
    setHeadInfo("—")
    setPhase(mode === "local" && audioPath == null ? "downloading" : "ready")
    builtFor.current = null
    wantPlay.current = false
    setSrcMode(mode)
  }

  // 清掉本地缓存重新下载——错误多半来自损坏的缓存文件
  function retryWithCleanCache() {
    if (audioPath != null) {
      try { FileManager.removeSync(audioPath) } catch {}
    }
    setErrMsg(null)
    setSessionErr(null)
    setReady(false)
    setCurrent(0)
    setDuration(0)
    setAudioPath(null)
    setSrcMode("local")
    setPhase("downloading")
    // 重下之后路径是同一个，不清掉判重标记就不会重建播放器
    builtFor.current = null
    wantPlay.current = false
    setAttempt(attempt + 1)
  }

  // 不清缓存，只重试启动播放（player 还活着，无需重建）
  function retryPlayOnly() {
    setErrMsg(null)
    setPhase("ready")
    void play()
  }

  if (source == null && phase !== "error") {
    return (
      <VStack spacing={8} padding={14} frame={{ maxWidth: "infinity" }}
        background={<RoundedRectangle cornerRadius={14} fill="tertiarySystemFill" />}>
        <ProgressView />
        <Text font="footnote" foregroundStyle="secondaryLabel">
          正在把这一集下载到本地（约 3~5 MB），只下载一次。不想等可以切回「音源：在线」。
        </Text>
      </VStack>
    )
  }

  if (phase === "error") {
    return (
      <VStack spacing={8} padding={14} frame={{ maxWidth: "infinity" }}
        background={<RoundedRectangle cornerRadius={14} fill="tertiarySystemFill" />}>
        <Text font="footnote" foregroundStyle="secondaryLabel">音频下载或播放出错了</Text>
        {errMsg != null ? (
          <Text font="body" foregroundStyle="primaryLabel">{errMsg}</Text>
        ) : null}
        <HStack spacing={8}>
          <Button title="仅重试播放" buttonStyle="bordered" buttonBorderShape="capsule"
            action={retryPlayOnly} frame={{ maxWidth: "infinity" }} />
          <Button
            title={srcMode === "remote" ? "改用本地缓存" : "改用在线播放"}
            buttonStyle="borderedProminent" buttonBorderShape="capsule"
            action={() => switchSource(srcMode === "remote" ? "local" : "remote")}
            frame={{ maxWidth: "infinity" }} />
        </HStack>
        <Button title="清缓存重下（本地）" buttonStyle="bordered" buttonBorderShape="capsule"
          action={retryWithCleanCache} frame={{ maxWidth: "infinity" }} />
      </VStack>
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
          <Button
            title={srcMode === "remote" ? "音源：在线" : "音源：本地"}
            action={() => switchSource(srcMode === "remote" ? "local" : "remote")}
            buttonStyle="bordered"
            buttonBorderShape="capsule"
            controlSize="small"
          />
          <Text font="caption2" foregroundStyle="tertiaryLabel">
            {formatClock(current)} / {formatClock(duration)}
          </Text>
        </HStack>
        <Text font="caption2" foregroundStyle="tertiaryLabel">
          诊断①：音源 {srcMode === "remote" ? "在线" : "本地"} · 构建 {builds} · 轮询 {tick} · 就绪 {ready ? "是" : "否"} · 播放中 {playing ? "是" : "否"} · 状态 {tcStatus} · 时长 {formatClock(duration)}
        </Text>
        <Text font="caption2" foregroundStyle="tertiaryLabel">
          诊断②：会话 {sessionInfo} · 缓存 {cacheSizeText(audioPath)} · 头 {headInfo}
        </Text>
        {sessionErr != null ? (
          <Text font="caption2" foregroundStyle="systemOrange">会话配置报错：{sessionErr}</Text>
        ) : null}
        <Text font="caption2" foregroundStyle="tertiaryLabel">
          没声音先看诊断②的「会话」：不是 playback 开头就会被手机侧面的静音拨片掐掉，把拨片拨到响铃位再试。
        </Text>
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
