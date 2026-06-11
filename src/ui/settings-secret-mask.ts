/** 与密码输入框圆点数量一致，配合 -webkit-text-security 渲染掩码。 */
export function settingsSecretMaskText(length: number): string {
  if (length <= 0) {
    return ''
  }
  return '0'.repeat(length)
}
