import { catalogEntryById, type Instant3dPrimitiveKind } from './asset-catalog.ts'

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

const PREVIEW_SETUP = `
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const container = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#dbe4ef');

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(2.2, 1.6, 2.8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.35, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(5, 8, 4);
scene.add(keyLight);

function resize() {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
resize();
window.addEventListener('resize', resize);

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.5);
  camera.position.set(center.x + maxDim * 1.8, center.y + maxDim * 1.2, center.z + maxDim * 2.2);
  controls.target.copy(center);
  controls.update();
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(6, 6),
  new THREE.MeshStandardMaterial({ color: '#c9bdb1', side: THREE.DoubleSide }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
scene.add(ground);
`

const PREVIEW_LOOP = `
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
`

export function buildScene3dModelPreviewHtml(modelId: string): string {
  const entry = catalogEntryById(modelId)
  const url = entry?.url ?? ''
  return previewShell(`
${PREVIEW_SETUP}
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const gltf = await new GLTFLoader().loadAsync(${JSON.stringify(url)});
const model = gltf.scene;
model.position.set(0, 0, 0);
scene.add(model);
frameObject(model);
${PREVIEW_LOOP}
`)
}

export function buildScene3dPrimitivePreviewHtml(kind: Instant3dPrimitiveKind): string {
  const meshSetup =
    kind === 'plane'
      ? `const mesh = new THREE.Mesh(
  new THREE.PlaneGeometry(3, 3),
  new THREE.MeshStandardMaterial({ color: '#8ea0b5', side: THREE.DoubleSide }),
);
mesh.rotation.x = -Math.PI / 2;
mesh.position.y = 0.02;`
      : kind === 'sphere'
        ? `const mesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.75, 24, 24),
  new THREE.MeshStandardMaterial({ color: '#8ea0b5' }),
);
mesh.position.y = 0.75;`
        : kind === 'cylinder'
          ? `const mesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.45, 0.45, 1.2, 24),
  new THREE.MeshStandardMaterial({ color: '#8ea0b5' }),
);
mesh.position.y = 0.6;`
          : `const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#8ea0b5' }),
);
mesh.position.y = 0.5;`

  return previewShell(`
${PREVIEW_SETUP}
${meshSetup}
scene.add(mesh);
frameObject(mesh);
${PREVIEW_LOOP}
`)
}
