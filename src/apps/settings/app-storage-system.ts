/** 系统空间条分段：应用程序 / 浏览器 / 其他 之外的残差归「系统配置」；注册表不参与 */
export function buildSystemSpaceBreakdown(input: {
  usedBytes: number
  capacityBytes: number
  appsBytes: number
  browserSystemBytes: number
  otherBytes: number
}): {
  systemConfigBytes: number
  availableBytes: number
} {
  const attributed = input.appsBytes + input.browserSystemBytes + input.otherBytes
  return {
    systemConfigBytes: Math.max(0, input.usedBytes - attributed),
    availableBytes: Math.max(0, input.capacityBytes - input.usedBytes),
  }
}
