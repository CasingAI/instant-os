import { useState } from 'preact/hooks'
import { GENERATED_APP_AI_BASE_URL } from '../bridge/instant-os-protocol.ts'
import { resolveInstantOsRuntimeMode } from '../dev/instant-os-runtime.ts'

export function DevAiPlayground() {
  const [prompt, setPrompt] = useState('用一句话介绍 Instant OS 外链应用模板')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const handleTest = async () => {
    setLoading(true)
    setError(undefined)
    setOutput('')

    try {
      const response = await fetch(`${GENERATED_APP_AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: '你是简洁的中文助手' },
            { role: 'user', content: prompt },
          ],
          stream: true,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error(await response.text())
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let text = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          const line = block
            .split('\n')
            .map((entry) => entry.trim())
            .find((entry) => entry.startsWith('data:'))
          if (!line) {
            continue
          }

          const payload = line.slice(5).trim()
          if (payload === '[DONE]') {
            continue
          }

          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const chunk = parsed.choices?.[0]?.delta?.content
            if (chunk) {
              text += chunk
              setOutput(text)
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'AI 调用失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section class="app__playground">
      <h2 class="app__playground-title">AI 接口测试</h2>
      <p class="app__playground-hint">
        当前运行模式：{resolveInstantOsRuntimeMode()}。开发模式下会自动 Mock 或走 `.env` 配置的真实 API。
      </p>
      <label class="app__field">
        <span>测试 Prompt</span>
        <textarea
          class="app__textarea"
          value={prompt}
          onInput={(event) => setPrompt((event.currentTarget as HTMLTextAreaElement).value)}
          rows={3}
        />
      </label>
      <button type="button" class="app__button" disabled={loading} onClick={() => void handleTest()}>
        {loading ? '调用中…' : '测试 AI 调用'}
      </button>
      {error ? <p class="app__error">{error}</p> : undefined}
      {output ? <pre class="app__output">{output}</pre> : undefined}
    </section>
  )
}
