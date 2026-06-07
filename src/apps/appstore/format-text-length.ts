/** 以 K 表示 AI 已输出文字长度（千字符） */
export function formatTextLengthK(length: number): string {
  if (length <= 0) {
    return '0K'
  }

  const k = length / 1000
  if (k < 10) {
    return `${k.toFixed(1)}K`
  }

  return `${Math.round(k)}K`
}
