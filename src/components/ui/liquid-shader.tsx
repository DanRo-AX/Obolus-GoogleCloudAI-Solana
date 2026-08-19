import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export interface InteractiveNebulaShaderProps {
  hasActiveReminders?: boolean
  hasUpcomingReminders?: boolean
  disableCenterDimming?: boolean
  className?: string
  position?: 'fixed' | 'absolute'
}

/**
 * Animated WebGL nebula. It can fill the viewport or a positioned parent,
 * which lets the chat reuse the same shader inside the generating AI avatar.
 */
export function InteractiveNebulaShader({
  hasActiveReminders = false,
  hasUpcomingReminders = false,
  disableCenterDimming = false,
  className = '',
  position = 'fixed',
}: InteractiveNebulaShaderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  const initialUniformsRef = useRef({
    hasActiveReminders,
    hasUpcomingReminders,
    disableCenterDimming,
  })

  useEffect(() => {
    const material = materialRef.current
    if (!material) return
    material.uniforms.hasActiveReminders.value = hasActiveReminders
    material.uniforms.hasUpcomingReminders.value = hasUpcomingReminders
    material.uniforms.disableCenterDimming.value = disableCenterDimming
  }, [hasActiveReminders, hasUpcomingReminders, disableCenterDimming])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.className = 'block size-full'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const clock = new THREE.Clock()

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `

    const fragmentShader = `
      precision mediump float;
      uniform vec2 iResolution;
      uniform float iTime;
      uniform vec2 iMouse;
      uniform bool hasActiveReminders;
      uniform bool hasUpcomingReminders;
      uniform bool disableCenterDimming;
      varying vec2 vUv;

      #define t iTime
      mat2 m(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
      float map(vec3 p){
        p.xz *= m(t*0.4);
        p.xy *= m(t*0.3);
        vec3 q = p*2. + t;
        return length(p + vec3(sin(t*0.7))) * log(length(p)+1.0)
             + sin(q.x + sin(q.z + sin(q.y))) * 0.5 - 1.0;
      }

      void mainImage(out vec4 O, in vec2 fragCoord) {
        vec2 uv = fragCoord / min(iResolution.x, iResolution.y) - vec2(.9, .5);
        uv.x += .4;
        vec3 col = vec3(0.0);
        float d = 2.5;

        for (int i = 0; i <= 5; i++) {
          vec3 p = vec3(0,0,5.) + normalize(vec3(uv, -1.)) * d;
          float rz = map(p);
          float f  = clamp((rz - map(p + 0.1)) * 0.5, -0.1, 1.0);

          vec3 base = hasActiveReminders
            ? vec3(0.05,0.2,0.5) + vec3(4.0,2.0,5.0)*f
            : hasUpcomingReminders
            ? vec3(0.05,0.3,0.1) + vec3(2.0,5.0,1.0)*f
            : vec3(0.1,0.3,0.4) + vec3(5.0,2.5,3.0)*f;

          col = col * base + smoothstep(2.5, 0.0, rz) * 0.7 * base;
          d += min(rz, 1.0);
        }

        float dist   = distance(fragCoord, iResolution*0.5);
        float radius = min(iResolution.x, iResolution.y) * 0.5;
        float dim    = disableCenterDimming
                     ? 1.0
                     : smoothstep(radius*0.3, radius*0.5, dist);

        O = vec4(col, 1.0);
        if (!disableCenterDimming) {
          O.rgb = mix(O.rgb * 0.3, O.rgb, dim);
        }
      }

      void main() {
        mainImage(gl_FragColor, vUv * iResolution);
      }
    `

    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new THREE.Vector2() },
      iMouse: { value: new THREE.Vector2() },
      hasActiveReminders: { value: initialUniformsRef.current.hasActiveReminders },
      hasUpcomingReminders: { value: initialUniformsRef.current.hasUpcomingReminders },
      disableCenterDimming: { value: initialUniformsRef.current.disableCenterDimming },
    }

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
    })
    materialRef.current = material
    const geometry = new THREE.PlaneGeometry(2, 2)
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const onResize = () => {
      const width = Math.max(1, container.clientWidth)
      const height = Math.max(1, container.clientHeight)
      renderer.setSize(width, height, false)
      uniforms.iResolution.value.set(width, height)
    }
    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(container)
    onResize()

    renderer.setAnimationLoop(() => {
      uniforms.iTime.value = clock.getElapsedTime()
      renderer.render(scene, camera)
    })

    return () => {
      resizeObserver.disconnect()
      renderer.setAnimationLoop(null)
      materialRef.current = null
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={`${position === 'fixed' ? 'fixed' : 'absolute'} inset-0 overflow-hidden bg-background ${className}`}
      aria-hidden="true"
    />
  )
}

export default InteractiveNebulaShader
