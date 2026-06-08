export const THREEJS_PHYSICS_DEMO_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Three.js + Rapier Demo</title>
  <style>
    html, body, #app { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #dbe4ef; }
    .hud {
      position: fixed;
      left: 12px;
      top: 12px;
      padding: 8px 12px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.88);
      font: 600 13px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #1d1d1f;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <div class="hud">Three.js + Rapier · 箱子掉落与堆叠</div>
  <script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();

const container = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#dbe4ef');

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(5, 4, 7);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.8, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(5, 8, 4);
scene.add(keyLight);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const dynamicBodies = [];

function resize() {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
resize();
window.addEventListener('resize', resize);

function addGround(width, depth) {
  const groundGeo = new THREE.PlaneGeometry(width, depth);
  const groundMat = new THREE.MeshStandardMaterial({ color: '#9aa5b1', side: THREE.DoubleSide });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const thickness = 0.1;
  const half = thickness / 2;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -half, 0),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, half, depth / 2), body);
}

function addDynamicBox(x, y, z, size, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshStandardMaterial({ color }),
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2), body);
  dynamicBodies.push({ mesh, body });
}

function addDynamicSphere(x, y, z, radius, color) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 24),
    new THREE.MeshStandardMaterial({ color }),
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z),
  );
  world.createCollider(RAPIER.ColliderDesc.ball(radius), body);
  dynamicBodies.push({ mesh, body });
}

addGround(18, 14);

for (let row = 0; row < 3; row += 1) {
  for (let col = 0; col < 4; col += 1) {
    addDynamicBox(
      col * 0.85 - 1.275,
      1.2 + row * 0.85,
      0,
      0.75,
      row === 0 ? '#e74c3c' : row === 1 ? '#3498db' : '#2ecc71',
    );
  }
}

addDynamicSphere(2.2, 3.8, -1.2, 0.45, '#f39c12');

renderer.setAnimationLoop(() => {
  world.step();
  for (const { mesh, body } of dynamicBodies) {
    const t = body.translation();
    const r = body.rotation();
    mesh.position.set(t.x, t.y, t.z);
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
  controls.update();
  renderer.render(scene, camera);
});
  </script>
</body>
</html>`
