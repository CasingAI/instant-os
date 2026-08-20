/**
 * @deprecated 随模拟终端弃用。此文件定义模拟终端的 `help` 文本，
 * 描述虚拟文件系统路径约定、本地命令表与使用说明。
 * 真终端（terminal-app）有独立的欢迎信息与 help 输出，不使用此文本。
 * 保留仅为过渡，新功能不要加在这里。
 */
export const TERMINAL_HELP_TEXT = `Instant OS 终端

面向高级用户。不是真实 Unix shell（无进程/管道/环境变量）。
普通文件操作可由 AI 翻译；敏感存储变更必须经本终端确认。文件 APP 也可直接挂载/卸载本机文件夹。

路径约定：
  /         命名空间根（虚拟；列出各卷，不可写入）
  /user     用户文件（可读写）
  /system   系统源码快照（只读）
  /models   内置 3D 目录（只读）
  /mount/…  本机挂载目录（可读写；文件 APP 或本终端均可挂载/卸载）

本地命令（不经 AI）：
  help                 显示本说明
  clear                清屏
  pwd / cd [路径]      工作目录
  ls [路径]            列出目录（Markdown 表）
  demo                 演示 Live Markdown（进度条原地刷新 + 表格）
  npm / npx            Instant 包管理（install/run/bin 等；见 npm help）
  mount                挂载本机文件夹（对话框确认）
  umount <路径|标签>   卸载挂载卷
  storage ls           列出 localStorage 键
  storage get <key>    读取键值（账户/API Key 键拒绝）
  storage set <key> <value>  写入/覆盖（对话框确认；账户键拒绝）
  storage rm <key>     删除指定键（对话框确认；账户键拒绝）

账户与 API Key 仅可通过「钥匙串」管理，终端不可读写、删除或清空。

Tab 可补全本地命令、路径、挂载点与 storage 键；多候选时打印列表。

AI 可协助的示例：
  cat notes.txt
  mkdir projects
  列出已挂载卷并帮我卸载某个
  模拟一个下载进度

输出能力：
  支持按 key 原地更新的 Markdown 块（进度条、表格）；结束时用 remove 清掉临时进度块。运行 demo 查看效果。

帮助应用若需动手改系统，会打开本终端并提交待确认操作。
敏感步骤一律弹对话框确认，而不是在提示符里输入 y。`
