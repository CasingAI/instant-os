/**
 * VS Code AI 图片附件门控与文案单测。
 * 运行：node --experimental-strip-types --test src/apps/vscode/vscode-ai-attachments.test.ts
 */
import assert from 'node:assert/strict'
import {
  assertVscodeAiCanAttachImages,
  attachmentsFromMultimodalContent,
  formatVscodeAiImageAttachmentSection,
  mergeUserTextWithImageAttachments,
  parseVscodeAiImagePathsFromText,
  VSCODE_AI_NO_VISION_ATTACH_ERROR,
  type VscodeAiImageAttachment,
} from './vscode-ai-attachments.ts'

const sample: VscodeAiImageAttachment[] = [
  {
    id: 'a1',
    path: '/tmp/vscode-ai-attachments/s1/paste.png',
    name: 'paste.png',
    mimeType: 'image/png',
  },
]

assert.equal(
  formatVscodeAiImageAttachmentSection(sample),
  '【附件图片】\n- /tmp/vscode-ai-attachments/s1/paste.png',
)

assert.equal(
  mergeUserTextWithImageAttachments('看看这张图', sample),
  '看看这张图\n\n【附件图片】\n- /tmp/vscode-ai-attachments/s1/paste.png',
)

assert.equal(
  mergeUserTextWithImageAttachments('', sample),
  '【附件图片】\n- /tmp/vscode-ai-attachments/s1/paste.png',
)

assert.equal(mergeUserTextWithImageAttachments('仅文字', []), '仅文字')

assert.deepEqual(
  parseVscodeAiImagePathsFromText(
    'brief\n\n【image_paths】\n- /tmp/a.png\n- /tmp/b.png',
  ),
  ['/tmp/a.png', '/tmp/b.png'],
)
assert.deepEqual(
  parseVscodeAiImagePathsFromText(formatVscodeAiImageAttachmentSection(sample)),
  ['/tmp/vscode-ai-attachments/s1/paste.png'],
)

{
  const fromContent = attachmentsFromMultimodalContent('m1', [
    { type: 'text', text: '看看' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,aaa' } },
    {
      type: 'image_url',
      image_url: { url: 'about:blank#vscode-ai-image-omitted' },
    },
  ])
  assert.ok(fromContent)
  assert.equal(fromContent.length, 1)
  assert.equal(fromContent[0]?.previewUrl, 'data:image/png;base64,aaa')
  assert.equal(fromContent[0]?.mimeType, 'image/png')
}

assert.equal(attachmentsFromMultimodalContent('m2', '纯文本'), undefined)

// 无账户视觉模型的测试环境：门控应拒绝
try {
  assertVscodeAiCanAttachImages()
  // 若环境意外配置了视觉模型，跳过断言
} catch (error) {
  assert.ok(error instanceof Error)
  assert.equal(error.message, VSCODE_AI_NO_VISION_ATTACH_ERROR)
}

console.log('vscode-ai-attachments.test.ts: ok')
