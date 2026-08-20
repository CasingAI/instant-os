/**
 * 持久截图页：整批识别只建一次 WebGL。
 * 每个模型：加载 → 多视角截图 → 卸掉几何/材质/纹理，保留 renderer。
 * 截图直接压到视觉模型够用的尺寸，避免父页再囤大图。
 */
export function buildModelVisionCaptureRuntimeHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:#cfd8e3; }
#stage { position:absolute; inset:0; }
canvas { display:block; }
</style>
</head>
<body>
<div id="stage"></div>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SIZE = 640;
const THUMB_SIZE = 320;
const VIEW_QUALITY = 0.92;
const THUMB_QUALITY = 0.88;
const MESSAGE_TYPE = 'instant-model-vision-capture';

const container = document.getElementById('stage');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfd8e3');

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400);
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: 'low-power',
});
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.style.width = SIZE + 'px';
renderer.domElement.style.height = SIZE + 'px';
container.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const key = new THREE.DirectionalLight(0xffffff, 1.05);
key.position.set(4, 7, 3);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.35);
fill.position.set(-3, 2, -2);
scene.add(fill);

const grid = new THREE.GridHelper(8, 8, 0x7a8796, 0xb0bac6);
scene.add(grid);

const loader = new GLTFLoader();
let axisRig;
let activeRoot;
let busy = false;

function makeAxisLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 64);
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(text, 64, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.55, 0.28, 1);
  return sprite;
}

function addAxisRig(length) {
  if (axisRig) {
    scene.remove(axisRig);
    disposeObject(axisRig);
    axisRig = undefined;
  }
  const group = new THREE.Group();
  group.add(new THREE.AxesHelper(length));

  const xLabel = makeAxisLabel('+X', '#e74c3c');
  xLabel.position.set(length * 1.12, 0.05, 0);
  group.add(xLabel);

  const yLabel = makeAxisLabel('+Y', '#27ae60');
  yLabel.position.set(0.05, length * 1.12, 0);
  group.add(yLabel);

  const zLabel = makeAxisLabel('+Z', '#2980b9');
  zLabel.position.set(0, 0.05, length * 1.12);
  group.add(zLabel);

  const origin = makeAxisLabel('O', '#2c3e50');
  origin.position.set(0, 0.18, 0);
  origin.scale.set(0.4, 0.2, 1);
  group.add(origin);

  scene.add(group);
  axisRig = group;
}

function disposeMaterial(material) {
  if (!material) return;
  const keys = Object.keys(material);
  for (let i = 0; i < keys.length; i += 1) {
    const value = material[keys[i]];
    if (value && value.isTexture) {
      value.dispose();
    }
  }
  material.dispose();
}

function disposeObject(root) {
  if (!root) return;
  root.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (child.material) {
      if (Array.isArray(child.material)) {
        for (let i = 0; i < child.material.length; i += 1) {
          disposeMaterial(child.material[i]);
        }
      } else {
        disposeMaterial(child.material);
      }
    }
  });
}

function clearActiveModel() {
  if (!activeRoot) return;
  scene.remove(activeRoot);
  disposeObject(activeRoot);
  activeRoot = undefined;
  if (typeof loader.manager?.removeHandler === 'function') {
    // no-op placeholder; GLTFLoader has no global cache clear API in this build
  }
}

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.35);
  return { center, maxDim };
}

function placeCamera(mode, center, maxDim) {
  const dist = maxDim * 2.35;
  if (mode === 'iso') {
    camera.position.set(center.x + dist * 0.95, center.y + dist * 0.75, center.z + dist * 0.95);
  } else if (mode === 'top') {
    camera.position.set(center.x, center.y + dist * 1.55, center.z + 0.001);
  } else if (mode === 'front') {
    camera.position.set(center.x, center.y + maxDim * 0.35, center.z + dist * 1.35);
  } else {
    camera.position.set(center.x + dist * 1.35, center.y + maxDim * 0.35, center.z);
  }
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

function captureJpeg(quality) {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/jpeg', quality);
}

function captureThumbnail() {
  renderer.setSize(THUMB_SIZE, THUMB_SIZE, false);
  renderer.domElement.style.width = THUMB_SIZE + 'px';
  renderer.domElement.style.height = THUMB_SIZE + 'px';
  const dataUrl = captureJpeg(THUMB_QUALITY);
  renderer.setSize(SIZE, SIZE, false);
  renderer.domElement.style.width = SIZE + 'px';
  renderer.domElement.style.height = SIZE + 'px';
  return dataUrl;
}

function post(payload) {
  parent.postMessage({ type: MESSAGE_TYPE, ...payload }, '*');
}

async function captureModel(modelUrl, requestId) {
  clearActiveModel();
  const gltf = await loader.loadAsync(modelUrl);
  const model = gltf.scene;
  model.position.set(0, 0, 0);
  scene.add(model);
  activeRoot = model;

  const { center, maxDim } = frameObject(model);
  addAxisRig(Math.max(maxDim * 0.85, 0.6));

  const specs = [
    { id: 'iso', label: '斜视（等轴）' },
    { id: 'top', label: '俯视（看清道路/瓦片朝向）' },
    { id: 'front', label: '正视（相机在 +Z）' },
    { id: 'side', label: '侧视（相机在 +X）' },
  ];
  const views = [];
  for (const spec of specs) {
    placeCamera(spec.id, center, maxDim);
    views.push({ id: spec.id, label: spec.label, dataUrl: captureJpeg(VIEW_QUALITY) });
  }

  placeCamera('iso', center, maxDim);
  const thumbnailDataUrl = captureThumbnail();

  // 立刻卸模，把纹理/几何还给 GPU；renderer 留给下一条
  clearActiveModel();
  renderer.renderLists?.dispose?.();

  post({ ok: true, requestId, views, thumbnailDataUrl });
}

function shutdown() {
  clearActiveModel();
  if (axisRig) {
    scene.remove(axisRig);
    disposeObject(axisRig);
    axisRig = undefined;
  }
  try {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    const gl = renderer.getContext();
    const lose = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  } catch (_) {}
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== MESSAGE_TYPE) return;
  if (data.action === 'shutdown') {
    shutdown();
    post({ ok: true, action: 'shutdown' });
    return;
  }
  if (data.action !== 'capture') return;
  if (busy) {
    post({ ok: false, requestId: data.requestId, error: '截图会话忙' });
    return;
  }
  if (typeof data.modelUrl !== 'string' || !data.modelUrl) {
    post({ ok: false, requestId: data.requestId, error: '缺少模型 URL' });
    return;
  }
  busy = true;
  captureModel(data.modelUrl, data.requestId)
    .catch((error) => {
      clearActiveModel();
      post({
        ok: false,
        requestId: data.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      busy = false;
    });
});

post({ ok: true, action: 'ready' });
</script>
</body>
</html>`
}
