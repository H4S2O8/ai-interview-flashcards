import {
  HStack, Link, Path, RoundedRectangle, Script, ScrollView, Spacer, Text, VStack,
  useEffect, useState,
} from "scripting"

/**
 * 原文阅读器。
 * articles.json 是可选资源（约 280KB）：文件不在时本视图给出说明，
 * 不影响 App 其余功能，和 cards.json 缺失时的处理方式一致。
 */

type Block = { k: "h2" | "h3" | "h4" | "p" | "li" | "code"; v: string }
type Article = { title: string; url: string; blocks: Block[] }

let cache: Record<string, Record<string, Article>> | null | undefined = undefined

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

/** 启动时预热，避免首次翻到带原文的卡时同步解析 280KB JSON 造成卡顿 */
export function warmArticles(): void {
  loadArticles()
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

  return (
    <ScrollView navigationTitle={`第 ${qno} 题 · 原文`} navigationBarTitleDisplayMode="inline">
      <VStack alignment="leading" spacing={12} padding={{ horizontal: 20, vertical: 16 }}>
        <Text font="title3" fontWeight="bold">{article.title}</Text>
        <Text font="caption2" foregroundStyle="tertiaryLabel">
          原文：公众号@小林面试笔记 · 仅供个人学习
        </Text>
        {article.blocks.map(b => <BlockView b={b} />)}
        <Link url={article.url} padding={{ top: 12 }}>
          <Text font="footnote" foregroundStyle="accentColor">在浏览器中查看原文（含配图）</Text>
        </Link>
      </VStack>
    </ScrollView>
  )
}
