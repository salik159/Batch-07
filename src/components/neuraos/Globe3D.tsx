'use client';

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function GlobeScene() {
  const globeRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const markersRef = useRef<THREE.Points>(null);

  const markerPositions = useMemo(() => {
    const count = 14;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const lat = (Math.random() * 160 - 80) * (Math.PI / 180);
      const lon = (Math.random() * 360 - 180) * (Math.PI / 180);
      const r = 1.62;
      arr[i * 3] = r * Math.cos(lat) * Math.cos(lon);
      arr[i * 3 + 1] = r * Math.sin(lat);
      arr[i * 3 + 2] = r * Math.cos(lat) * Math.sin(lon);
    }
    return arr;
  }, []);

  const starPositions = useMemo(() => {
    const arr = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 20;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 20;
      arr[i * 3 + 2] = -3 - Math.random() * 7;
    }
    return arr;
  }, []);

  useFrame(() => {
    if (globeRef.current) globeRef.current.rotation.y += 0.0022;
    if (innerRef.current) innerRef.current.rotation.y += 0.0022;
    if (markersRef.current) markersRef.current.rotation.y += 0.0022;
  });

  return (
    <>
      <mesh ref={globeRef}>
        <sphereGeometry args={[1.6, 28, 22]} />
        <meshBasicMaterial color="#4be3ff" wireframe transparent opacity={0.35} />
      </mesh>
      <mesh ref={innerRef}>
        <sphereGeometry args={[1.58, 28, 22]} />
        <meshBasicMaterial color="#0a2a3a" transparent opacity={0.5} />
      </mesh>
      <points ref={markersRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={markerPositions.length / 3} array={markerPositions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial color="#ffb84d" size={0.06} sizeAttenuation />
      </points>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={starPositions.length / 3} array={starPositions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial color="#4be3ff" size={0.02} transparent opacity={0.5} />
      </points>
    </>
  );
}

/** Rotating wireframe globe with glowing location markers and a starfield backdrop. */
export function Globe3D({ className = '' }: { className?: string }) {
  return (
    <div className={`w-full h-full ${className}`}>
      <Canvas camera={{ position: [0, 0, 4.6], fov: 45 }} gl={{ alpha: true, antialias: true }}>
        <GlobeScene />
      </Canvas>
    </div>
  );
}
