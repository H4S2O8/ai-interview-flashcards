/**
 * SM-2 间隔重复调度。
 *
 * 四档评分映射到 SM-2 的质量分 q：
 *   0 忘了 -> q=2   1 困难 -> q=3   2 良好 -> q=4   3 简单 -> q=5
 */

export type Grade = 0 | 1 | 2 | 3

export const GRADE_LABELS = ["忘了", "困难", "良好", "简单"] as const

export type Schedule = {
  /** 下次到期时间，毫秒时间戳 */
  due: number
  /** 当前间隔，单位天。0 表示还在当天重学 */
  interval: number
  /** 难度系数，越小复习越频繁 */
  ease: number
  /** 连续答对次数 */
  reps: number
  /** 遗忘次数 */
  lapses: number
  lastReview: number | null
}

const MIN_EASE = 1.3
/** 间隔上限，避免连点「简单」把卡片甩到几年之后 */
const MAX_INTERVAL = 365
const DAY = 86_400_000
/** 答错后当天重来的间隔 */
const RELEARN_MS = 10 * 60 * 1000

export function newSchedule(now: number): Schedule {
  return { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0, lastReview: null }
}

export function applyGrade(s: Schedule, grade: Grade, now: number): Schedule {
  const q = grade + 2
  const ease = Math.max(MIN_EASE, s.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))

  // 忘了：当天重新排队，连击清零，不动 interval 的历史值以外的东西
  if (grade === 0) {
    return {
      due: now + RELEARN_MS,
      interval: 0,
      ease,
      reps: 0,
      lapses: s.lapses + 1,
      lastReview: now,
    }
  }

  const reps = s.reps + 1
  let interval: number
  if (reps === 1) {
    interval = grade === 3 ? 3 : 1
  } else if (reps === 2) {
    interval = grade === 3 ? 8 : 6
  } else {
    const prev = Math.max(s.interval, 1)
    // 「困难」走固定的小倍率，不吃 ease —— 否则它给出的间隔会比「良好」只短一点点，不符合直觉
    interval = grade === 1
      ? Math.round(prev * 1.2)
      : Math.round(prev * ease * (grade === 3 ? 1.3 : 1))
  }
  interval = Math.min(MAX_INTERVAL, Math.max(1, interval))

  return { due: now + interval * DAY, interval, ease, reps, lapses: s.lapses, lastReview: now }
}

/** 给按钮标注「按这个评分下次什么时候再见」 */
export function previewInterval(s: Schedule, grade: Grade, now: number): string {
  const next = applyGrade(s, grade, now)
  if (next.interval === 0) return "10 分钟"
  if (next.interval === 1) return "1 天"
  if (next.interval < 30) return `${next.interval} 天`
  const months = Math.round(next.interval / 30)
  return months < 12 ? `${months} 个月` : `${(next.interval / 365).toFixed(1)} 年`
}
