import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/**
 * @param {Array<{ id: string, label: string, url: string }>} catalog
 */
export function createInstant3dApi(catalog) {
  const catalogById = Object.create(null)
  for (const entry of catalog) {
    catalogById[entry.id] = entry
  }

  const loader = new GLTFLoader()
  /** @type {Map<string, THREE.Group>} */
  const modelCache = new Map()

  /** @type {Set<{ dispose: () => void }>} */
  const activeScenes = new Set()

  /**
   * @param {number[] | undefined} value
   * @param {[number, number, number]} fallback
   */
  function vec3(value, fallback) {
    if (!Array.isArray(value) || value.length < 3) {
      return fallback
    }
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0]
  }

  /**
   * @param {import('./instant3d-types.js').Instant3dModelOptions | undefined} options
   * @param {[number, number, number] | undefined} rotationBase
   */
  function applyTransform(object, options, rotationBase) {
    const position = vec3(options?.position, [0, 0, 0])
    const rotation = vec3(options?.rotation, [0, 0, 0])
    const base = rotationBase ?? [0, 0, 0]
    const scaleValue = options?.scale
    object.position.set(position[0], position[1], position[2])
    object.rotation.set(base[0] + rotation[0], base[1] + rotation[1], base[2] + rotation[2])
    if (typeof scaleValue === 'number') {
      object.scale.setScalar(scaleValue)
    } else if (Array.isArray(scaleValue) && scaleValue.length >= 3) {
      object.scale.set(Number(scaleValue[0]) || 1, Number(scaleValue[1]) || 1, Number(scaleValue[2]) || 1)
    }
  }

  /**
   * @param {{ id: string, url: string }} entry
   */
  async function loadModel(entry) {
    if (modelCache.has(entry.id)) {
      return modelCache.get(entry.id).clone(true)
    }
    const gltf = await loader.loadAsync(entry.url)
    modelCache.set(entry.id, gltf.scene)
    return gltf.scene.clone(true)
  }

  /**
   * @param {HTMLElement} container
   */
  function createScene(container) {
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#dbe4ef')

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200)
    camera.position.set(4, 3, 6)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    container.replaceChildren(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0.5, 0)

    scene.add(new THREE.AmbientLight(0xffffff, 0.75))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1)
    keyLight.position.set(5, 8, 4)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xbfd7ff, 0.35)
    fillLight.position.set(-4, 3, -2)
    scene.add(fillLight)

    let frameId = 0
    const tick = () => {
      frameId = requestAnimationFrame(tick)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    const onResize = () => {
      const nextWidth = Math.max(container.clientWidth, 1)
      const nextHeight = Math.max(container.clientHeight, 1)
      camera.aspect = nextWidth / nextHeight
      camera.updateProjectionMatrix()
      renderer.setSize(nextWidth, nextHeight)
    }
    window.addEventListener('resize', onResize)

    const handle = {
      scene,
      camera,
      renderer,
      controls,
      dispose() {
        cancelAnimationFrame(frameId)
        window.removeEventListener('resize', onResize)
        controls.dispose()
        renderer.dispose()
        activeScenes.delete(handle)
      },
    }

    activeScenes.add(handle)
    return handle
  }

  /**
   * @param {ReturnType<typeof createScene>} sceneHandle
   * @param {string} modelId
   * @param {import('./instant3d-types.js').Instant3dModelOptions | undefined} options
   */
  async function addModel(sceneHandle, modelId, options) {
    const entry = catalogById[modelId]
    if (!entry) {
      throw new Error(`未知 modelId: ${modelId}`)
    }
    const object = await loadModel(entry)
    applyTransform(object, options)
    sceneHandle.scene.add(object)
    return object
  }

  /**
   * @param {ReturnType<typeof createScene>} sceneHandle
   * @param {'box' | 'sphere' | 'cylinder' | 'plane'} type
   * @param {import('./instant3d-types.js').Instant3dPrimitiveOptions | undefined} options
   */
  function addPrimitive(sceneHandle, type, options) {
    let geometry
    const color = options?.color ?? '#8ea0b5'

    switch (type) {
      case 'sphere':
        geometry = new THREE.SphereGeometry(options?.radius ?? 0.5, 24, 24)
        break
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(
          options?.radiusTop ?? 0.4,
          options?.radiusBottom ?? 0.4,
          options?.height ?? 1,
          24,
        )
        break
      case 'plane': {
        const width = options?.width ?? 8
        const depth = options?.depth ?? options?.height ?? 8
        geometry = new THREE.PlaneGeometry(width, depth)
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }),
        )
        applyTransform(mesh, options, [-Math.PI / 2, 0, 0])
        sceneHandle.scene.add(mesh)
        return mesh
      }
      case 'box':
      default:
        geometry = new THREE.BoxGeometry(options?.width ?? 1, options?.height ?? 1, options?.depth ?? 1)
        break
    }

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }))
    applyTransform(mesh, options)
    sceneHandle.scene.add(mesh)
    return mesh
  }

  return {
    catalog,
    ready: Promise.resolve(true),
    listModels() {
      return catalog.map((entry) => entry.id)
    },
    createScene,
    addModel,
    addPrimitive,
    disposeAll() {
      for (const handle of activeScenes) {
        handle.dispose()
      }
    },
  }
}
