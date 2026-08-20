import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import type { Flip3dEnterResult, Flip3dFlight, Flip3dGhost } from './flip3d.ts'

export type Flip3dShadowReveal = 'off' | 'hold' | 'fade' | 'settle'

export type Flip3dSceneValue = {
  flip3dActive: boolean
  flip3dRestoring: boolean
  enterFlip3d: () => Flip3dEnterResult
  cycleFlip3d: (delta: 1 | -1) => void
  exitFlip3d: (windowId?: string) => void
}

export type Flip3dLayersValue = {
  flip3dEntering: boolean
  flip3dOrder: string[]
  flip3dSnapIds: string[]
  flip3dFlight: Flip3dFlight | undefined
  finishFlip3dFlight: (flightId: string) => void
  flip3dGhosts: Flip3dGhost[]
  dismissFlip3dGhostFrame: (ghostId: string) => void
}

const Flip3dSceneContext = createContext<Flip3dSceneValue | undefined>(undefined)
const Flip3dLayersContext = createContext<Flip3dLayersValue | undefined>(undefined)
const Flip3dShadowContext = createContext<Flip3dShadowReveal | undefined>(undefined)

export function Flip3dProvider({
  scene,
  layers,
  shadow,
  children,
}: {
  scene: Flip3dSceneValue
  layers: Flip3dLayersValue
  shadow: Flip3dShadowReveal
  children: ComponentChildren
}) {
  return (
    <Flip3dSceneContext.Provider value={scene}>
      <Flip3dLayersContext.Provider value={layers}>
        <Flip3dShadowContext.Provider value={shadow}>{children}</Flip3dShadowContext.Provider>
      </Flip3dLayersContext.Provider>
    </Flip3dSceneContext.Provider>
  )
}

export function useFlip3dScene(): Flip3dSceneValue {
  const context = useContext(Flip3dSceneContext)
  if (!context) {
    throw new Error('useFlip3dScene must be used within Flip3dProvider')
  }
  return context
}

export function useFlip3dLayers(): Flip3dLayersValue {
  const context = useContext(Flip3dLayersContext)
  if (!context) {
    throw new Error('useFlip3dLayers must be used within Flip3dProvider')
  }
  return context
}

export function useFlip3dShadowReveal(): Flip3dShadowReveal {
  const context = useContext(Flip3dShadowContext)
  if (context === undefined) {
    throw new Error('useFlip3dShadowReveal must be used within Flip3dProvider')
  }
  return context
}
