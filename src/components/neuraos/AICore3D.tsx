'use client';

import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CoreAccent } from './types';

const DEFAULT_ACCENT: CoreAccent = {
  glow: '75,227,255',
  inner: '#eafcff',
  shell: '#4be3ff',
  particles: '#8fedff',
};

function makeRadialTexture(rgb: string) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(0.4, `rgba(${rgb},.35)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

interface CoreSceneProps {
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  accent: CoreAccent;
  intensity: React.MutableRefObject<number>; // 0..1, drives pulse amplitude (e.g. voice/thinking activity)
}

function CoreScene({ mouseRef, accent, intensity }: CoreSceneProps) {
  const group = useRef<THREE.Group>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const ringRefs = useRef<THREE.Mesh[]>([]);
  useThree(); // ensures scene is attached; camera/size not needed directly here

  const shellGeo = useMemo(() => new THREE.IcosahedronGeometry(1.4, 3), []);
  const basePositions = useMemo(
    () => shellGeo.attributes.position.array.slice() as Float32Array,
    [shellGeo]
  );

  const particlePositions = useMemo(() => {
    const count = 900;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.8 + Math.random() * 0.3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, []);

  const glowTexture = useMemo(() => makeRadialTexture(accent.glow), [accent.glow]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const amp = 0.06 + intensity.current * 0.09;

    const pos = shellRef.current?.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        const ix = i * 3;
        const bx = basePositions[ix], by = basePositions[ix + 1], bz = basePositions[ix + 2];
        const len = Math.sqrt(bx * bx + by * by + bz * bz);
        const nx = bx / len, ny = by / len, nz = bz / len;
        const noise = Math.sin(bx * 2.6 + t * 1.4) * Math.cos(by * 2.6 - t * 1.1) * Math.sin(bz * 2.6 + t * 0.9);
        const disp = 1 + noise * amp + Math.sin(t * 1.8) * 0.018;
        pos.setXYZ(i, nx * len * disp, ny * len * disp, nz * len * disp);
      }
      pos.needsUpdate = true;
    }

    if (shellRef.current) {
      shellRef.current.rotation.y += 0.0023;
      shellRef.current.rotation.x += 0.0009;
    }
    if (particlesRef.current) {
      particlesRef.current.rotation.y -= 0.0011;
      particlesRef.current.rotation.x += 0.0005;
    }
    if (innerRef.current) {
      innerRef.current.rotation.y += 0.004;
      innerRef.current.rotation.x += 0.0016;
      const pulse = 1 + Math.sin(t * 2.4) * (0.07 + intensity.current * 0.08) + Math.sin(t * 3.1) * 0.03;
      innerRef.current.scale.setScalar(pulse);
    }
    const speeds = [0.006, -0.004, 0.003];
    ringRefs.current.forEach((ring, i) => {
      ring.rotation.z += (speeds[i] ?? 0.004) * (1 + intensity.current);
    });

    if (group.current) {
      group.current.rotation.y += (mouseRef.current.x * 0.45 - group.current.rotation.y) * 0.045;
      group.current.rotation.x += (-mouseRef.current.y * 0.32 - group.current.rotation.x) * 0.045;
    }
  });

  const ringDefs = [
    { r: 2.05, tilt: [1.1, 0.3, 0] as [number, number, number], color: accent.shell },
    { r: 2.32, tilt: [0.4, 1.2, 0.2] as [number, number, number], color: '#3e8fff' },
    { r: 2.58, tilt: [1.4, 0.9, 0.6] as [number, number, number], color: accent.particles },
  ];

  return (
    <group ref={group}>
      <sprite scale={[6.2, 6.2, 1]}>
        <spriteMaterial map={glowTexture} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>

      <mesh ref={innerRef}>
        <icosahedronGeometry args={[0.6, 1]} />
        <meshBasicMaterial color={accent.inner} transparent opacity={0.92} />
      </mesh>

      <mesh ref={shellRef} geometry={shellGeo}>
        <meshBasicMaterial color={accent.shell} wireframe transparent opacity={0.5} />
      </mesh>

      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={particlePositions.length / 3} array={particlePositions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial color={accent.particles} size={0.024} transparent opacity={0.75} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {ringDefs.map((def, i) => (
        <mesh
          key={i}
          ref={(el) => { if (el) ringRefs.current[i] = el; }}
          rotation={def.tilt}
        >
          <torusGeometry args={[def.r, 0.004, 8, 128]} />
          <meshBasicMaterial color={def.color} transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

interface AICore3DProps {
  className?: string;
  accent?: CoreAccent;
  /** 0..1 external activity level (e.g. voice amplitude, "thinking" intensity) that drives pulse strength */
  activity?: number;
}

/**
 * The NeuraOS AI Core — a living, faceted 3D orb built from an organically-displaced
 * wireframe icosahedron shell, a pulsing inner core, an orbiting particle field and
 * three tilted data rings. Reacts to pointer position (parallax tilt) and an optional
 * external `activity` value (0..1) for syncing pulse intensity to voice/thinking state.
 */
export function AICore3D({ className = '', accent = DEFAULT_ACCENT, activity = 0.3 }: AICore3DProps) {
  const mouseRef = useRef({ x: 0, y: 0 });
  const intensityRef = useRef(activity);
  intensityRef.current = activity;

  return (
    <div
      className={`w-full h-full ${className}`}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        mouseRef.current.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      }}
      onPointerLeave={() => { mouseRef.current.x = 0; mouseRef.current.y = 0; }}
    >
      <Canvas camera={{ position: [0, 0, 5.6], fov: 42 }} gl={{ alpha: true, antialias: true }}>
        <CoreScene mouseRef={mouseRef} accent={accent} intensity={intensityRef} />
      </Canvas>
    </div>
  );
}
