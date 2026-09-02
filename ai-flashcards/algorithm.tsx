import {
  HStack, Label, Link, List, NavigationLink, Path, Script, Section, Spacer, Text, VStack,
} from "scripting"

import { AskAILink } from "./ask"

export const ALGORITHM_DECK_ID = "algorithm-150"

type AlgorithmProblem = {
  order: number
  problemId: number
  title: string
  englishTitle: string
  category: string
  difficulty: "基础" | "进阶" | "挑战"
  tags: string[]
  prompt: string
  hint: string
  solution: string
  time: string
  space: string
  practiceUrl: string
}

type AlgorithmFile = {
  version: number
  title: string
  description: string
  categories: Array<{ name: string; count: number }>
  problems: AlgorithmProblem[]
}

let cache: AlgorithmFile | null | undefined = undefined

function loadAlgorithmFile(): AlgorithmFile | null {
  if (cache !== undefined) return cache
  const p = Path.join(Script.directory, "algorithm150.json")
  if (!FileManager.existsSync(p)) {
    cache = null
    return null
  }
  try {
    cache = JSON.parse(FileManager.readAsStringSync(p)) as AlgorithmFile
  } catch {
    cache = null
  }
  return cache
}

export function warmAlgorithm(): void {
  loadAlgorithmFile()
}

export function algorithmProblem(order: number): AlgorithmProblem | null {
  return loadAlgorithmFile()?.problems.find(p => p.order === order) ?? null
}

function DifficultyLabel({ value }: { value: AlgorithmProblem["difficulty"] }) {
  const color = value === "基础" ? "systemGreen" : value === "进阶" ? "systemOrange" : "systemRed"
  return <Text font="caption" fontWeight="semibold" foregroundStyle={color}>{value}</Text>
}

export function AlgorithmProblemView({ order }: { order: number }) {
  const problem = algorithmProblem(order)
  if (problem == null) {
    return (
      <VStack navigationTitle="算法训练" spacing={10} padding={24}>
        <Text font="headline">找不到这道训练题</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">请从统计页重新导入题库。</Text>
      </VStack>
    )
  }

  return (
    <List navigationTitle={`训练 ${problem.order}`} navigationBarTitleDisplayMode="inline">
      <Section>
        <VStack alignment="leading" spacing={5} padding={{ vertical: 4 }}>
          <HStack>
            <DifficultyLabel value={problem.difficulty} />
            <Spacer />
            <Text font="caption2" foregroundStyle="tertiaryLabel">练习索引 LC {problem.problemId}</Text>
          </HStack>
          <Text font="title3" fontWeight="bold">{problem.title}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{problem.englishTitle}</Text>
          <Text font="caption2" foregroundStyle="tertiaryLabel">
            {problem.category} · {problem.tags.join(" · ")}
          </Text>
        </VStack>
      </Section>

      <Section header={<Text>问题抽象</Text>}>
        <Text>{problem.prompt}</Text>
      </Section>

      <Section header={<Text>思考提示</Text>}>
        <Text>{problem.hint}</Text>
      </Section>

      <Section header={<Text>解题主线</Text>}>
        <Text>{problem.solution}</Text>
      </Section>

      <Section header={<Text>复杂度</Text>}>
        <HStack>
          <Label title={`时间 ${problem.time}`} systemImage="clock" />
          <Spacer />
          <Label title={`空间 ${problem.space}`} systemImage="memorychip" />
        </HStack>
      </Section>

      <Section header={<Text>继续练习</Text>}>
        <AskAILink deck={ALGORITHM_DECK_ID} qno={problem.order} defaultPrompt={problem.prompt} />
        <Link url={problem.practiceUrl}>
          <Label title="打开外部练习题" systemImage="arrow.up.right.square" />
        </Link>
      </Section>
    </List>
  )
}

export function AlgorithmDeckView() {
  const data = loadAlgorithmFile()
  if (data == null) {
    return (
      <VStack navigationTitle="经典算法 150" spacing={10} padding={24}>
        <Text font="headline">算法训练数据未安装</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">请重新导入脚本资源后再试。</Text>
      </VStack>
    )
  }

  return (
    <List navigationTitle={data.title} navigationBarTitleDisplayMode="inline">
      <Section footer={<Text>{data.description}</Text>}>
        <Label title={`${data.problems.length} 道训练题 · ${data.categories.length} 个专题`} systemImage="curlybraces.square" />
      </Section>
      {data.categories.map(category => (
        <Section header={<Text>{category.name} · {category.count} 题</Text>}>
          {data.problems.filter(p => p.category === category.name).map(problem => (
            <NavigationLink destination={<AlgorithmProblemView order={problem.order} />}>
              <HStack spacing={10}>
                <Text font="caption" fontWeight="semibold" foregroundStyle="accentColor"
                  frame={{ width: 28 }}>
                  {problem.order}
                </Text>
                <VStack alignment="leading" spacing={2}>
                  <Text lineLimit={1}>{problem.title}</Text>
                  <Text font="caption2" foregroundStyle="tertiaryLabel">
                    LC {problem.problemId} · {problem.tags.slice(0, 3).join(" · ")}
                  </Text>
                </VStack>
                <Spacer />
                <DifficultyLabel value={problem.difficulty} />
              </HStack>
            </NavigationLink>
          ))}
        </Section>
      ))}
    </List>
  )
}
