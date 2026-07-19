import type { MonacoProblem, MonacoProblemSeverity } from '../../monaco/monaco-markers.ts'

export type VscodeProblemsPanelProps = {
  problems: MonacoProblem[]
  onSelect: (problem: MonacoProblem) => void
}

function severityLabel(severity: MonacoProblemSeverity): string {
  if (severity === 'error') return '错误'
  if (severity === 'warning') return '警告'
  if (severity === 'info') return '信息'
  return '提示'
}

function locationLabel(problem: MonacoProblem): string {
  const base = `${problem.resourceLabel}:${problem.startLineNumber}:${problem.startColumn}`
  const parts = [base]
  if (problem.source) parts.push(problem.source)
  if (problem.code) parts.push(`(${problem.code})`)
  return parts.join(' · ')
}

export function VscodeProblemsPanel({ problems, onSelect }: VscodeProblemsPanelProps) {
  if (problems.length === 0) {
    return (
      <div class="vscode__problems">
        <div class="vscode__problems-empty">未检测到问题</div>
      </div>
    )
  }

  return (
    <div class="vscode__problems" role="list" aria-label="问题">
      {problems.map((problem) => {
        const location = locationLabel(problem)
        return (
          <button
            key={problem.id}
            type="button"
            class={`vscode__problems-item vscode__problems-item--${problem.severity}`}
            role="listitem"
            title={`${severityLabel(problem.severity)}：${problem.message}\n${location}`}
            onClick={() => onSelect(problem)}
          >
            <span class={`vscode__problems-severity vscode__problems-severity--${problem.severity}`}>
              {severityLabel(problem.severity)}
            </span>
            <span class="vscode__problems-body">
              <span class="vscode__problems-message">{problem.message}</span>
              <span class="vscode__problems-meta">{location}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
