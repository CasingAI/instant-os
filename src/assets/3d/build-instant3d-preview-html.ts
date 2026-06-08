import type { Instant3dPrimitiveKind } from './asset-catalog.ts'

function previewShell(scriptBody: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
html, body, #app { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:#dbe4ef; }
</style>
</head>
<body>
<div id="app"></div>
<script type="module">
${scriptBody}
</script>
</body>
</html>`
}

const FRAME_CAMERA = `
scene.camera.position.set(2.2, 1.6, 2.8);
scene.camera.lookAt(0, 0.35, 0);
scene.controls.target.set(0, 0.35, 0);
scene.controls.update();
`

function groundPlane(): string {
  return `Instant3D.addPrimitive(scene, 'plane', { width: 6, depth: 6, color: '#c9bdb1', position: [0, -0.01, 0] });`
}

export function buildInstant3dModelPreviewHtml(modelId: string): string {
  return previewShell(`
await Instant3DReady;
const scene = Instant3D.createScene(document.getElementById('app'));
${groundPlane()}
await Instant3D.addModel(scene, ${JSON.stringify(modelId)}, { position: [0, 0, 0] });
${FRAME_CAMERA}
`)
}

export function buildInstant3dPrimitivePreviewHtml(kind: Instant3dPrimitiveKind): string {
  const primitiveCall =
    kind === 'plane'
      ? `Instant3D.addPrimitive(scene, 'plane', { width: 3, depth: 3, color: '#8ea0b5', position: [0, 0.02, 0] });`
      : kind === 'sphere'
        ? `Instant3D.addPrimitive(scene, 'sphere', { radius: 0.75, color: '#8ea0b5', position: [0, 0.75, 0] });`
        : kind === 'cylinder'
          ? `Instant3D.addPrimitive(scene, 'cylinder', { height: 1.2, radiusTop: 0.45, radiusBottom: 0.45, color: '#8ea0b5', position: [0, 0.6, 0] });`
          : `Instant3D.addPrimitive(scene, 'box', { width: 1, height: 1, depth: 1, color: '#8ea0b5', position: [0, 0.5, 0] });`

  return previewShell(`
await Instant3DReady;
const scene = Instant3D.createScene(document.getElementById('app'));
${groundPlane()}
${primitiveCall}
${FRAME_CAMERA}
`)
}
