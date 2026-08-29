import {
  Button, HStack, Link, NavigationLink, Path, ProgressView, RoundedRectangle, Script, ScrollView,
  Slider, Spacer, Text, VStack,
  useEffect, useObservable, useRef, useState,
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
/** 播客倍速档位，按钮上循环切换 */
const RATES: number[] = [1, 1.25, 1.5, 2]
/** 快退/快进步长（秒） */
const SKIP_SECONDS = 15

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
/** 某个 deck 的播客集列表，按集号排序。ms 是整集时长（毫秒），老数据可能没有。 */
export function listEpisodes(deck: string): { qno: number; title: string; ms?: number; hasArticle: boolean }[] {
  const d = loadPodcasts()?.decks?.[deck]
  if (d == null) return []
  return Object.keys(d)
    .map(k => ({
      qno: Number(k),
      title: d[k].title,
      ms: d[k].ms,
      hasArticle: hasArticle(deck, Number(k)),
    }))
    .filter(e => !Number.isNaN(e.qno))
    .sort((a, b) => a.qno - b.qno)
}

/** 播客的系列名与两位主播，给列表页做页眉 */
export function podcastMeta(): { series: string; host: string; guest: string } | null {
  const p = loadPodcasts()
  if (p == null) return null
  return { series: p.series, host: p.speakers.host.name, guest: p.speakers.guest.name }
}

/** 毫秒 → 「12 分 34 秒」，给列表页用 */
export function formatEpisodeLength(ms?: number): string | null {
  if (ms == null || ms <= 0) return null
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return m > 0 ? `${m} 分 ${sec} 秒` : `${sec} 秒`
}

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
  // OSStatus -50 = 参数不合法（真机实测 allowBluetooth 这类只对可录音 category 有效的
  // option 会被拒）。逐级降配，成功一档就锁定。
  //
  // 顺序很重要：**不带 mixWithOthers 的排最前**。带上它 App 就只是「混进去一起响」，
  // 拿不到系统的「正在播放」身份 —— 锁屏、控制中心、AirPods 捏一下的遥控事件
  // 根本不会路由过来。播客要的是独占播放。mixWithOthers 只当兜底。
  const attempts: Array<[string, string[]]> = [
    ["playback", []],
    ["playback", ["allowAirPlay"]],
    ["playback", ["mixWithOthers"]],
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

/**
 * 锁屏、控制中心、AirPods 的控制走系统的 Now Playing Center。
 * MediaPlayer 是全局单例：nowPlayingInfo 一份、commandHandler 一个 ——
 * 所以同一时刻只能有一个播放器登记，换集必须就地切换而不是叠导航栈。
 */
function clearNowPlaying(): void {
  try { MediaPlayer.nowPlayingInfo = null } catch {}
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
          title={browse ? "回到当前" : "看全部"}
          action={() => onBrowse(!browse)}
          buttonStyle="bordered"
          buttonBorderShape="capsule"
          controlSize="small"
        />
      </HStack>
      <Text font="caption2" foregroundStyle="tertiaryLabel">
        {browse ? `全部 ${lines.length} 句 · 高亮的是当前句，点任意一句跳到对应时间` : "跟随播放滚动。点前后句或拖进度条可跳转。"}
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

/** 缓存文件是否像回事。只看大小（statSync 很便宜）——
 *  文件头校验会走 Data.fromFile，那是把整个 3~5MB 读进内存只为看 4 个字节，
 *  而这个函数在每次打开一集时都会跑。头校验留在下载完成后那一次做就够了。
 *
 *  另外：头读不出来一律放行。读通道本身不可靠（见 fileHeadHex 注释），
 *  v2.5.5 就是把「读不出」当成「不是 mp3」，导致好文件被反复判死、无限重下。 */
function cachedFileOk(p: string): boolean {
  try {
    return FileManager.statSync(p).size > 100000
  } catch {
    return false
  }
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
  episode, speakers, showLyrics, autoPlay, onFinished, children,
}: {
  episode: Episode
  speakers: PodcastsFile["speakers"]
  showLyrics: boolean
  autoPlay?: boolean
  onFinished?: () => void
  children?: any
}) {
  const relativePath = episode.audio
  const cachedPath = cachedAudioPath(relativePath)
  const remoteUrl = AUDIO_BASE + relativePath
  // 已经下过就用本地缓存（免流量、可离线），没下过就在线流式 ——
  // **打开一集永远不会自动下载**：32 集，每集 3~5MB，光是翻一翻就能拉掉一百多兆。
  // 下载只在用户明确按「下载到本地」时发生。
  const [audioPath, setAudioPath] = useState<string | null>(() =>
    cachedFileOk(cachedPath) ? cachedPath : null,
  )
  const [srcMode, setSrcMode] = useState<"remote" | "local">(
    audioPath != null ? "local" : "remote",
  )
  // phase: downloading 拉取中 / ready 已就绪 / error 出错
  const [phase, setPhase] = useState<"downloading" | "ready" | "error">("ready")
  const [attempt, setAttempt] = useState(0)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [sessionErr, setSessionErr] = useState<string | null>(null)
  const [headInfo, setHeadInfo] = useState("—")
  const [ready, setReady] = useState(false)
  // 播放器建好就能按播放，不等 onReadyToPlay：远程流式下它可能一直不触发
  // （v2.5.8 实测在线模式按钮恒灰），而 AVPlayer 自己会边缓冲边起播。
  const [canPlay, setCanPlay] = useState(false)
  const [rate, setRate] = useState<number>(1)
  // 诊断信息默认收起：它是调试脚手架，不该盖过播放控件
  const [showDiag, setShowDiag] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [browse, setBrowse] = useState(false)
  const [sessionInfo, setSessionInfo] = useState("—")
  const [builds, setBuilds] = useState(0)
  // 下面这几个由定时器驱动，必须走 observable：v2.5.7 实测「轮询 0」——
  // setInterval 回调里的 setState 不会触发重渲染（Button / AVPlayer 回调里的会）。
  // 文档进度计时器示例的原话：「脚本环境只保证 setTimeout/clearTimeout」，
  // 且它推 UI 用的是 observable.setValue。index.tsx 里作者也是这么用的。
  // JSX 里读 .value 才会订阅到更新。
  const playhead = useObservable<number>(0)
  const durationObs = useObservable<number>(0)
  const tcObs = useObservable<string>("—")
  const pollObs = useObservable<number>(0)
  const stallMsg = useObservable<string | null>(null)
  const playerRef = useRef<AVPlayer | null>(null)
  const dlSeq = useRef(0)
  const builtFor = useRef<string | null>(null)
  const buildCount = useRef(0)
  const pollRef = useRef<any>(null)
  const pollingFor = useRef<AVPlayer | null>(null)
  // seek 之后这个时间点之前不回写 playhead。AVPlayer 的 seek 是异步的，
  // 刚 seek 完读回来往往还是旧值 —— 拖动中每 500ms 被覆盖一次，滑块会在手指下往回跳。
  const seekGuard = useRef(0)
  const watchdogRef = useRef<any>(null)
  const wantPlay = useRef(false)
  const epRef = useRef(relativePath)
  // playing 的 ref 镜像：轮询是自递归 setTimeout，闭包里读 state 会拿到陈旧值
  const playingRef = useRef(false)
  const lyrics = loadLyrics(relativePath, episode, speakers.host.name, speakers.guest.name)

  const source = srcMode === "remote" ? remoteUrl : audioPath

  // 换集时把整块播放状态复位。组件不会重挂载（这个框架的 key 语义没验证过，
  // 不赌），所以显式重置 —— 否则上一集的缓存路径会漏到下一集。
  useEffect(() => {
    if (epRef.current === relativePath) return
    epRef.current = relativePath
    const cached = cachedFileOk(cachedPath) ? cachedPath : null
    setAudioPath(cached)
    setSrcMode(cached != null ? "local" : "remote")
    setErrMsg(null)
    setSessionErr(null)
    setPhase("ready")
    setHeadInfo("—")
    builtFor.current = null
    // 自动连播接过来的这一集要接着放
    wantPlay.current = autoPlay === true
  }, [relativePath])

  // 只有用户显式切到本地音源、且还没缓存时才下载。默认音源是在线，
  // 所以这个 effect 在正常翻集时根本不会触发（srcMode !== "local" 直接返回）。
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
    // 换集复位要一拍才落地，那一拍里 audioPath 还是上一集的路径。
    // 不校验归属的话会拿旧 source 建一次播放器，而 wantPlay 此时已置位，
    // 自动连播就会先抢播上一集。两种音源都以 relativePath 结尾，据此判断。
    if (!source.endsWith(relativePath)) return
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
    if (pollRef.current != null) clearTimeout(pollRef.current)
    pollRef.current = null
    pollingFor.current = null
    if (watchdogRef.current != null) clearTimeout(watchdogRef.current)
    watchdogRef.current = null
  }

  /** 把当前进度推给系统，锁屏和控制中心的进度条才会走 */
  function pushNowPlaying(player: AVPlayer, isPlaying: boolean) {
    try {
      MediaPlayer.nowPlayingInfo = {
        title: episode.title,
        artist: `${speakers.host.name} / ${speakers.guest.name}`,
        albumTitle: podcastMeta()?.series ?? "播客课",
        playbackRate: isPlaying ? rate : 0,
        elapsedPlaybackTime: player.currentTime,
        playbackDuration: player.duration > 0 ? player.duration : 0,
      }
    } catch {}
  }

  function registerRemoteCommands(player: AVPlayer) {
    try {
      MediaPlayer.setAvailableCommands([
        "play", "pause", "skipBackward", "skipForward", "nextTrack", "previousTrack",
      ])
      MediaPlayer.commandHandler = (command: string) => {
        if (playerRef.current !== player) return
        switch (command) {
          case "play": void play(); break
          case "pause": pause(); break
          case "skipBackward": skip(-SKIP_SECONDS); break
          case "skipForward": skip(SKIP_SECONDS); break
          case "nextTrack": if (onFinished != null) onFinished(); break
          case "previousTrack": seek(0); break
          default: break
        }
      }
    } catch {}
  }

  function teardownPlayer() {
    const p = playerRef.current
    if (p != null) {
      try { p.pause() } catch {}
      try { p.dispose() } catch {}
      if (activePlayer === p) activePlayer = null
    }
    playerRef.current = null
    clearNowPlaying()
  }

  // 诊断全部「直接问播放器」：onTimeControlStatusChanged 只在状态变化时触发一次，
  // 播放器悄悄停下它不会再报 —— 之前那个「状态=2」很可能早就是陈的。
  // 自递归 setTimeout 而非 setInterval：脚本环境只保证 setTimeout/clearTimeout。
  function pollOnce() {
    const player = pollingFor.current
    if (player == null || playerRef.current !== player) return
    pollObs.setValue(pollObs.value + 1)
    if (Date.now() >= seekGuard.current) {
      try { playhead.setValue(player.currentTime) } catch {}
    }
    try { if (player.duration > 0) durationObs.setValue(player.duration) } catch {}
    try { tcObs.setValue(`${String(player.timeControlStatus)} 速率${String(player.rate)}`) } catch {}
    // 每 2 秒同步一次锁屏进度就够了，不必每拍都推
    if (pollObs.value % 4 === 0) pushNowPlaying(player, playingRef.current)
    pollRef.current = setTimeout(pollOnce, 500)
  }

  function startPolling(player: AVPlayer) {
    stopPolling()
    pollingFor.current = player
    pollRef.current = setTimeout(pollOnce, 500)
  }

  async function buildPlayer(src: string) {
    teardownPlayer()
    stopPolling()
    buildCount.current += 1
    setBuilds(buildCount.current)
    setReady(false)
    setCanPlay(false)
    playingRef.current = false
    setPlaying(false)
    setBrowse(false)
    playhead.setValue(0)
    durationObs.setValue(0)
    tcObs.setValue("—")
    stallMsg.setValue(null)
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
      durationObs.setValue(player.duration)
      stallMsg.setValue(null)
      // 文档里 play() 一律写在 onReadyToPlay 里。用户已经按过播放就在这兑现。
      if (wantPlay.current) void startPlayback(player)
    }
    player.onTimeControlStatusChanged = (status: string) => {
      tcObs.setValue(String(status))
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
    try { player.defaultRate = rate } catch {}
    try { player.volume = 1 } catch {}
    player.onEnded = () => {
      wantPlay.current = false
      playingRef.current = false
      setPlaying(false)
      clearNowPlaying()
      // 自动连播：交给上层换集，换过去之后 autoPlay 会让它接着放
      if (onFinished != null) onFinished()
    }
    playerRef.current = player
    setCanPlay(true)
    startPolling(player)
    registerRemoteCommands(player)
    pushNowPlaying(player, false)
    // 兜底：一直不进入可播放状态就报错，别让用户对着 0:00 干等
    const watchdogMs = srcMode === "remote" ? 25000 : 10000
    watchdogRef.current = setTimeout(() => {
      if (!isReady && playerRef.current === player) {
        // 这里不能用 setErrMsg/setPhase：setTimeout 里的 setState 不触发重渲染，
        // v2.5.4 起「一直没出报错卡」多半就是这么来的。改推 observable。
        stallMsg.setValue(srcMode === "remote"
          ? `${watchdogMs / 1000} 秒未进入可播放状态，网络太慢或音源不可达`
          : `${watchdogMs / 1000} 秒未进入可播放状态，文件可能损坏或格式异常`)
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
    playingRef.current = true
    setPlaying(true)
    pushNowPlaying(p, true)
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
    playingRef.current = false
    setPlaying(false)
    const p = playerRef.current
    if (p != null) pushNowPlaying(p, false)
  }

  function seek(t: number) {
    const d = durationObs.value
    const clamped = Math.max(0, d > 0 ? Math.min(t, d) : t)
    playhead.setValue(clamped)
    seekGuard.current = Date.now() + 800
    if (playerRef.current != null) playerRef.current.currentTime = clamped
  }

  function skip(delta: number) {
    seek(playhead.value + delta)
  }

  // 倍速：play() 不带参数时吃 defaultRate；播放中要同时改 rate 才会立刻生效
  function cycleRate() {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
    setRate(next)
    const p = playerRef.current
    if (p == null) return
    try { p.defaultRate = next } catch {}
    if (playing) { try { p.rate = next } catch {} }
    try {
      MediaPlayer.nowPlayingInfo = {
        title: episode.title,
        artist: `${speakers.host.name} / ${speakers.guest.name}`,
        albumTitle: podcastMeta()?.series ?? "播客课",
        playbackRate: playing ? next : 0,
        elapsedPlaybackTime: p.currentTime,
        playbackDuration: p.duration > 0 ? p.duration : 0,
      }
    } catch {}
  }

  // 切换音源：清掉播放态，让播放器 effect 用新的 source 重建
  function switchSource(mode: "remote" | "local") {
    setErrMsg(null)
    setSessionErr(null)
    setReady(false)
    setCanPlay(false)
    setPlaying(false)
    setHeadInfo("—")
    playhead.setValue(0)
    durationObs.setValue(0)
    tcObs.setValue("—")
    stallMsg.setValue(null)
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
    setCanPlay(false)
    playhead.setValue(0)
    durationObs.setValue(0)
    stallMsg.setValue(null)
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
          正在下载这一集（约 3~5 MB），下完就能离线听。不想等可以切回「音源：在线」。
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
            title={srcMode === "remote"
              ? (audioPath != null ? "改用本地缓存" : "下载到本地重试")
              : "改用在线播放"}
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
        background={
          <RoundedRectangle cornerRadius={14} fill="secondarySystemGroupedBackground"
            stroke={{ shapeStyle: "separator", strokeStyle: { lineWidth: 1 } }} />
        }>
        <HStack spacing={8}>
          <Text font="caption" fontWeight="semibold" foregroundStyle="accentColor">本集音频</Text>
          <Spacer />
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {formatClock(playhead.value)} / {formatClock(durationObs.value)}
          </Text>
        </HStack>

        <Slider
          disabled={durationObs.value <= 0}
          min={0}
          max={durationObs.value > 0 ? durationObs.value : 1}
          value={playhead.value}
          onChanged={value => seek(value)}
        />

        {/* 主控件排一行：快退 · 播放 · 快进 · 倍速 */}
        <HStack spacing={8}>
          <Button
            disabled={!canPlay}
            title={`−${SKIP_SECONDS}`}
            action={() => skip(-SKIP_SECONDS)}
            buttonStyle="bordered"
            buttonBorderShape="capsule"
          />
          <Button
            disabled={!canPlay}
            title={playing ? "暂停" : "播放"}
            systemImage={playing ? "pause.fill" : "play.fill"}
            action={playing ? pause : play}
            buttonStyle="borderedProminent"
            buttonBorderShape="capsule"
            frame={{ maxWidth: "infinity" }}
          />
          <Button
            disabled={!canPlay}
            title={`+${SKIP_SECONDS}`}
            action={() => skip(SKIP_SECONDS)}
            buttonStyle="bordered"
            buttonBorderShape="capsule"
          />
          <Button
            disabled={!canPlay}
            title={`${rate}×`}
            action={cycleRate}
            buttonStyle="bordered"
            buttonBorderShape="capsule"
          />
        </HStack>

        {/* 工具行：次要功能压到小字号 */}
        <HStack spacing={10}>
          <Button
            title={
              srcMode === "local" ? "音源：本地缓存"
                : audioPath != null ? "音源：在线（有缓存可切）"
                  : "下载到本地"
            }
            action={() => switchSource(srcMode === "remote" ? "local" : "remote")}
            buttonStyle="borderless"
            controlSize="small"
          />
          <Spacer />
          <Button
            title={showDiag ? "隐藏诊断" : "诊断"}
            action={() => setShowDiag(!showDiag)}
            buttonStyle="borderless"
            controlSize="small"
          />
        </HStack>

        {stallMsg.value != null ? (
          <Text font="caption2" foregroundStyle="systemOrange">卡住了：{stallMsg.value}</Text>
        ) : null}

        {showDiag ? (
          <VStack alignment="leading" spacing={4}>
            <Text font="caption2" foregroundStyle="tertiaryLabel">
              构建 {builds} · 轮询 {pollObs.value} · 就绪 {ready ? "是" : "否"} · 播放中 {playing ? "是" : "否"} · 状态 {tcObs.value}
            </Text>
            <Text font="caption2" foregroundStyle="tertiaryLabel">
              会话 {sessionInfo} · 缓存 {cacheSizeText(audioPath)} · 头 {headInfo}
            </Text>
            {sessionErr != null ? (
              <Text font="caption2" foregroundStyle="systemOrange">会话配置报错：{sessionErr}</Text>
            ) : null}
          </VStack>
        ) : null}
      </VStack>

      {children}

      {showLyrics && lyrics.length > 0 ? (
        <SyncedLyrics
          lines={lyrics}
          playhead={playhead.value}
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

/**
 * 上一集 / 下一集。就地换集，不推导航栈 —— 除了不叠页面，更重要的是
 * MediaPlayer 的 commandHandler 是全局单例，多个播放器同时活着会互相抢。
 */
function EpisodeNav({
  deck, qno, onGo,
}: {
  deck: string
  qno: number
  onGo: (qno: number) => void
}) {
  const eps = listEpisodes(deck)
  const at = eps.findIndex(e => e.qno === qno)
  if (at < 0) return null
  const prev = at > 0 ? eps[at - 1] : null
  const next = at < eps.length - 1 ? eps[at + 1] : null
  if (prev == null && next == null) return null
  return (
    <HStack spacing={10}>
      {prev != null ? (
        <Button title={`← 第 ${prev.qno} 集`} action={() => onGo(prev.qno)}
          buttonStyle="borderless" controlSize="small" />
      ) : null}
      <Spacer />
      {next != null ? (
        <Button title={`第 ${next.qno} 集 →`} action={() => onGo(next.qno)}
          buttonStyle="borderless" controlSize="small" />
      ) : null}
    </HStack>
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
  // 当前集提成状态：上一集/下一集和自动连播都靠改它来换集，页面不叠栈
  const [curQno, setCurQno] = useState(qno)
  // 自动连播接上来的那一集要接着放；手动点上下集则不自动播
  const [autoPlay, setAutoPlay] = useState(false)
  const [article, setArticle] = useState<Article | null | undefined>(undefined)
  const [pane, setPane] = useState<Pane>(focus === "article" ? "article" : "podcast")

  useEffect(() => {
    const all = loadArticles()
    setArticle(all?.[deck]?.[String(curQno)] ?? null)
  }, [deck, curQno])

  function goTo(next: number, play: boolean) {
    setAutoPlay(play)
    setCurQno(next)
  }

  /** 本集放完：有下一集就接上去继续放 */
  function onFinished() {
    const eps = listEpisodes(deck)
    const at = eps.findIndex(e => e.qno === curQno)
    if (at < 0 || at >= eps.length - 1) return
    goTo(eps[at + 1].qno, true)
  }

  if (article === undefined) {
    return <VStack navigationTitle="原文"><Text foregroundStyle="secondaryLabel">载入中…</Text></VStack>
  }

  const podcasts = loadPodcasts()
  const episode = podcasts?.decks?.[deck]?.[String(curQno)] ?? null
  const hasBoth = article != null && episode != null && podcasts != null
  const showPodcast = episode != null && podcasts != null && (article == null || pane === "podcast")
  const showArticle = article != null && (episode == null || pane === "article")
  const title = showPodcast ? `第 ${curQno} 集` : `第 ${curQno} 题 · 原文`

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
              autoPlay={autoPlay}
              onFinished={onFinished}
            >
              {hasBoth ? <PaneSwitcher pane={pane} onChange={setPane} /> : null}
              <EpisodeNav deck={deck} qno={curQno} onGo={q => goTo(q, false)} />
            </PodcastSession>
          </VStack>
        ) : null}

        {showArticle && article != null ? <ArticleBody article={article} /> : null}
      </VStack>
    </ScrollView>
  )
}
