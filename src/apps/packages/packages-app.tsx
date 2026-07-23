import { useEffect, useMemo, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { getAppDefinition } from '../../os/app-registry.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import {
  cancelPackageTask,
  getPackageServiceConfig,
  listPackageTasks,
  subscribePackageEvents,
  type PackageLogLine,
  type PackageTask,
} from '../../packages/package-public.ts'
import './packages-app.css'

const APP_ID = 'packages' as const

type TaskView = Omit<PackageTask, 'abortController'>

function statusLabel(status: TaskView['status']): string {
  switch (status) {
    case 'pending':
      return '等待'
    case 'running':
      return '进行中'
    case 'succeeded':
      return '成功'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
  }
}

export function PackagesApp() {
  const { windows, closeWindowsForApp, minimizeWindow } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const definition = getAppDefinition(APP_ID)
  const [tasks, setTasks] = useState<TaskView[]>(() => listPackageTasks())
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const config = getPackageServiceConfig()

  useEffect(() => {
    return subscribePackageEvents(() => {
      setTasks(listPackageTasks())
    })
  }, [])

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? tasks[tasks.length - 1],
    [tasks, selectedId],
  )

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID)
    return [
      {
        label: definition?.name ?? '包管理',
        items: [
          {
            type: 'action',
            label: `关于${definition?.name ?? '包管理'}`,
            onClick: () => showBuiltinAbout(APP_ID),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '刷新',
            onClick: () => setTasks(listPackageTasks()),
          },
          {
            type: 'action',
            label: '最小化',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `退出${definition?.name ?? '包管理'}`,
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, definition?.name, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar(APP_ID, menuBar)

  const logs: PackageLogLine[] = selected?.logs ?? []

  return (
    <div class="packages-app">
      <header class="packages-app__header">
        <div>
          <h1>包管理</h1>
          <p class="packages-app__meta">
            registry {config.registryUrl} · store {config.storeRoot}
          </p>
        </div>
      </header>
      <div class="packages-app__body">
        <aside class="packages-app__list">
          <h2>任务</h2>
          {tasks.length === 0 ? (
            <p class="packages-app__empty">尚无安装任务。可在终端运行 npm install。</p>
          ) : (
            <ul>
              {[...tasks].reverse().map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    class={
                      selected?.id === task.id
                        ? 'packages-app__task packages-app__task--active'
                        : 'packages-app__task'
                    }
                    onClick={() => setSelectedId(task.id)}
                  >
                    <span class="packages-app__task-kind">{task.kind}</span>
                    <span class="packages-app__task-status">{statusLabel(task.status)}</span>
                    <span class="packages-app__task-root">{task.projectRoot}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section class="packages-app__detail">
          {selected ? (
            <>
              <div class="packages-app__detail-head">
                <div>
                  <h2>
                    {selected.kind} · {statusLabel(selected.status)}
                  </h2>
                  <p>{selected.projectRoot}</p>
                  {selected.packages.length > 0 && (
                    <p>{selected.packages.join(', ')}</p>
                  )}
                  {selected.error && (
                    <p class="packages-app__error">{selected.error}</p>
                  )}
                  {selected.status === 'running' && selected.progress && (
                    <div class="packages-app__progress">
                      {selected.progress.percent !== undefined && (
                        <div class="packages-app__progress-track">
                          <div
                            class="packages-app__progress-fill"
                            style={{
                              width: `${Math.max(0, Math.min(100, selected.progress.percent))}%`,
                            }}
                          />
                        </div>
                      )}
                      <p class="packages-app__progress-detail">{selected.progress.detail}</p>
                    </div>
                  )}
                </div>
                {(selected.status === 'running' || selected.status === 'pending') && (
                  <button
                    type="button"
                    class="packages-app__cancel"
                    onClick={() => cancelPackageTask(selected.id)}
                  >
                    取消
                  </button>
                )}
              </div>
              <pre class="packages-app__logs">
                {logs.map((line) => (
                  <div key={`${line.at}-${line.message}`}>
                    [{line.level}] {line.message}
                  </div>
                ))}
              </pre>
            </>
          ) : (
            <p class="packages-app__empty">选择一个任务查看日志</p>
          )}
        </section>
      </div>
    </div>
  )
}
