/** 系统空间条分段：浏览器 / 其他 之外的残差归「系统配置」（含应用清单索引）；注册表不参与 */
export function buildSystemSpaceBreakdown(input: {
  usedBytes: number
  capacityBytes: number
  browserSystemBytes: number
  otherBytes: number
}): {
  systemConfigBytes: number
  availableBytes: number
} {
  const attributed = input.browserSystemBytes + input.otherBytes
  return {
    systemConfigBytes: Math.max(0, input.usedBytes - attributed),
    availableBytes: Math.max(0, input.capacityBytes - input.usedBytes),
  }
}
