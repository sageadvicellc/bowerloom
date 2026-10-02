import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  AdditiveBlending,
  CatmullRomCurve3,
  Color,
  Group,
  Mesh,
  Vector3,
} from "three";
import { stages } from "./content";
import StaticWorkshop from "./StaticWorkshop";

type Point = [number, number, number];
const locations: Point[] = [
  [-3.65, 0, 1.7],
  [-1.6, 0.38, -1.6],
  [1.8, 0.16, -1.6],
  [3.8, -0.1, 1.6],
];
const trees: Point[] = [
  [-5, -0.2, -0.6],
  [-4.8, 0, -2.4],
  [-3.2, 0.1, -3.2],
  [0, 0.1, -3.65],
  [3.2, 0, -3.3],
  [5.15, -0.2, -0.6],
  [5.4, -0.3, 2.4],
  [-4.9, -0.3, 3.4],
];

function Block({
  position,
  size,
  color = "#293732",
  rotation = [0, 0, 0],
  emissive = false,
}: {
  position: Point;
  size: Point;
  color?: string;
  rotation?: Point;
  emissive?: boolean;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        metalness={0.35}
        roughness={0.65}
        emissive={emissive ? color : "#000"}
        emissiveIntensity={emissive ? 1.3 : 0}
      />
    </mesh>
  );
}

function Tree({ position, index }: { position: Point; index: number }) {
  const height = 2.5 + (index % 3) * 0.45;
  return (
    <group position={position} rotation={[0, index * 0.81, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.16, height, 7]} />
        <meshStandardMaterial color="#594737" roughness={1} />
      </mesh>
      {[0, 1, 2].map((layer) => (
        <mesh
          key={layer}
          position={[0, height - 0.55 + layer * 0.42, 0]}
          castShadow
        >
          <coneGeometry args={[0.72 - layer * 0.17, 1.15, 7]} />
          <meshStandardMaterial
            color={layer === 2 ? "#3d5c31" : "#253f2c"}
            roughness={0.95}
          />
        </mesh>
      ))}
      <mesh position={[0.05, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.43, 9]} />
        <meshStandardMaterial color="#283c24" />
      </mesh>
    </group>
  );
}

function Island({ selected, color }: { selected: boolean; color: string }) {
  return (
    <>
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.8, 3.8]} />
        <shaderMaterial
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          uniforms={{
            glowColor: { value: new Color(color) },
            strength: { value: selected ? 0.32 : 0.12 },
          }}
          vertexShader="varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}"
          fragmentShader="varying vec2 vUv; uniform vec3 glowColor; uniform float strength; void main(){float d=length(vUv-.5);float glow=pow(max(0.0,1.0-d*2.0),2.0);gl_FragColor=vec4(glowColor,glow*strength);}"
        />
      </mesh>
      <mesh position={[0, -0.22, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[1.25, 1.05, 0.42, 12]} />
        <meshStandardMaterial color="#314433" roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.54, 0]} rotation={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[1.05, 0.56, 0.38, 7]} />
        <meshStandardMaterial color="#172c2b" roughness={1} />
      </mesh>
      <mesh position={[0, 0.015, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.16, selected ? 0.029 : 0.013, 5, 48]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 2 : 0.5}
        />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Block
          key={i}
          position={[
            Math.sin(i * 1.05) * 1.12,
            0.08,
            Math.cos(i * 1.05) * 1.12,
          ]}
          size={[0.09, 0.12, 0.14]}
          color="#687350"
        />
      ))}
    </>
  );
}

function Bench() {
  return (
    <group>
      <Block position={[0, 0.42, 0]} size={[1.3, 0.13, 0.8]} color="#827550" />
      {[-0.48, 0.48].map((x) => (
        <Block key={x} position={[x, 0.2, 0]} size={[0.09, 0.42, 0.58]} />
      ))}
      <mesh position={[-0.27, 0.68, 0]}>
        <cylinderGeometry args={[0.15, 0.22, 0.39, 12]} />
        <meshStandardMaterial color="#6b8581" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[-0.27, 0.9, 0]}>
        <sphereGeometry args={[0.13, 12, 8]} />
        <meshStandardMaterial
          color="#d9ff87"
          emissive="#c9f53a"
          emissiveIntensity={2}
        />
      </mesh>
      <Block
        position={[0.3, 0.54, 0.05]}
        size={[0.39, 0.05, 0.34]}
        color="#14382e"
      />
      <Block
        position={[0.72, 1.25, -0.55]}
        size={[0.055, 2.5, 0.055]}
        color="#75734e"
      />
      <group position={[0, 1.97, -0.45]} rotation={[-0.25, 0, 0.08]}>
        <Block position={[0, 0, 0]} size={[1.9, 0.06, 1.05]} color="#8d905b" />
        {[-0.65, -0.22, 0.22, 0.65].map((x) => (
          <Block
            key={x}
            position={[x, 0.05, 0]}
            size={[0.39, 0.025, 0.91]}
            color="#203938"
          />
        ))}
        {[-0.25, 0.25].map((z) => (
          <Block
            key={z}
            position={[0, 0.08, z]}
            size={[1.79, 0.016, 0.012]}
            color="#b2be76"
          />
        ))}
      </group>
    </group>
  );
}

function Archive() {
  return (
    <group>
      <Block position={[0, 0.16, 0]} size={[1.1, 0.3, 0.85]} color="#263e39" />
      {[-0.32, 0, 0.32].map((x, i) => (
        <group key={x} position={[x, 0.63 + i * 0.13, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.13, 0.13, 0.7 + i * 0.25, 6]} />
            <meshStandardMaterial
              color="#568d80"
              metalness={0.4}
              roughness={0.3}
            />
          </mesh>
          <mesh position={[0, 0.38 + i * 0.13, 0]}>
            <octahedronGeometry args={[0.21]} />
            <meshStandardMaterial
              color="#9feadd"
              emissive="#68bbae"
              emissiveIntensity={0.65}
              metalness={0.6}
              roughness={0.2}
            />
          </mesh>
          <Block
            position={[0, 0.08, 0.14]}
            size={[0.07, 0.2, 0.035]}
            color="#83DDD0"
            emissive
          />
        </group>
      ))}
      <mesh position={[0, 1.68, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.7, 0.014, 5, 40]} />
        <meshStandardMaterial
          color="#83DDD0"
          emissive="#83DDD0"
          emissiveIntensity={1}
        />
      </mesh>
    </group>
  );
}

function DraftTable() {
  return (
    <group>
      <Block position={[0, 0.55, 0]} size={[1.4, 0.11, 0.88]} color="#a48557" />
      {[-0.53, 0.53].map((x) => (
        <Block key={x} position={[x, 0.25, 0]} size={[0.07, 0.52, 0.7]} />
      ))}
      {[0, 1, 2].map((i) => (
        <group
          key={i}
          position={[-0.18 + i * 0.1, 0.64 + i * 0.026, 0.04]}
          rotation={[0, i * 0.1 - 0.15, 0]}
        >
          <Block
            position={[0, 0, 0]}
            size={[0.58, 0.017, 0.57]}
            color="#dfd1a9"
          />
          {[0, 1, 2, 3].map((j) => (
            <Block
              key={j}
              position={[0, 0.012, -0.18 + j * 0.09]}
              size={[j === 3 ? 0.21 : 0.4, 0.004, 0.02]}
              color="#716746"
            />
          ))}
        </group>
      ))}
      <Block
        position={[0.48, 0.82, -0.3]}
        size={[0.045, 0.5, 0.045]}
        color="#91a578"
      />
      <mesh position={[0.48, 1.11, -0.3]} rotation={[0, 0, 0.2]}>
        <coneGeometry args={[0.16, 0.18, 12]} />
        <meshStandardMaterial
          color="#F2BE75"
          emissive="#F2BE75"
          emissiveIntensity={0.7}
        />
      </mesh>
      <pointLight
        position={[0.45, 1, -0.2]}
        color="#f2be75"
        intensity={1.4}
        distance={2}
      />
    </group>
  );
}

function ReviewGate() {
  return (
    <group>
      <Block position={[0, 0.1, 0]} size={[1.2, 0.18, 0.8]} color="#5b5b40" />
      {[-0.5, 0.5].map((x) => (
        <Block
          key={x}
          position={[x, 0.86, 0]}
          size={[0.14, 1.5, 0.16]}
          color="#6f6f45"
        />
      ))}
      <Block position={[0, 1.64, 0]} size={[1.18, 0.13, 0.2]} color="#8d9251" />
      <mesh position={[0, 0.95, 0.02]}>
        <torusGeometry args={[0.37, 0.025, 7, 48]} />
        <meshStandardMaterial
          color="#C9F53A"
          emissive="#C9F53A"
          emissiveIntensity={2}
        />
      </mesh>
      <Block
        position={[-0.09, 0.92, 0.02]}
        size={[0.035, 0.22, 0.03]}
        rotation={[0, 0, 0.62]}
        color="#C9F53A"
        emissive
      />
      <Block
        position={[0.07, 0.98, 0.02]}
        size={[0.035, 0.35, 0.03]}
        rotation={[0, 0, -0.65]}
        color="#C9F53A"
        emissive
      />
      <mesh position={[0, 0.34, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.27, 24]} />
        <meshStandardMaterial
          color="#c9f53a"
          emissive="#c9f53a"
          emissiveIntensity={0.5}
        />
      </mesh>
    </group>
  );
}

function Station({
  index,
  selected,
  onSelect,
}: {
  index: number;
  selected: number;
  onSelect: (i: number) => void;
}) {
  const pick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(index);
  };
  return (
    <group position={locations[index]} onClick={pick}>
      <Island selected={selected === index} color={stages[index].color} />
      {
        [
          <Bench key="bench" />,
          <Archive key="archive" />,
          <DraftTable key="draft" />,
          <ReviewGate key="review" />,
        ][index]
      }
      <pointLight
        position={[0, 0.8, 0]}
        color={stages[index].color}
        intensity={selected === index ? 3 : 1}
        distance={3}
      />
    </group>
  );
}

function Connection({
  from,
  to,
  active,
  index,
}: {
  from: Point;
  to: Point;
  active: boolean;
  index: number;
}) {
  const pulse = useRef<Mesh>(null);
  const curve = useMemo(
    () =>
      new CatmullRomCurve3([
        new Vector3(from[0], from[1] - 0.15, from[2]),
        new Vector3((from[0] + to[0]) / 2, 0.5, (from[2] + to[2]) / 2),
        new Vector3(to[0], to[1] - 0.15, to[2]),
      ]),
    [from, to],
  );
  useFrame(({ clock }) => {
    if (active && pulse.current)
      pulse.current.position.copy(
        curve.getPoint((clock.elapsedTime * 0.16 + index * 0.31) % 1),
      );
  });
  return (
    <>
      <mesh>
        <tubeGeometry args={[curve, 32, 0.034, 5, false]} />
        <meshStandardMaterial
          color="#758c3a"
          emissive="#C9F53A"
          emissiveIntensity={0.6}
        />
      </mesh>
      <mesh ref={pulse} position={from}>
        <sphereGeometry args={[0.085, 8, 6]} />
        <meshBasicMaterial color="#e6ff9a" />
      </mesh>
    </>
  );
}

function Rig({ children, active }: { children: ReactNode; active: boolean }) {
  const group = useRef<Group>(null);
  useFrame(({ pointer }, delta) => {
    if (!active || !group.current) return;
    const blend = Math.min(delta * 2, 0.08);
    group.current.rotation.y +=
      (pointer.x * 0.075 - group.current.rotation.y) * blend;
    group.current.rotation.x +=
      (-pointer.y * 0.025 - group.current.rotation.x) * blend;
  });
  return <group ref={group}>{children}</group>;
}

function ContextGuard({ onFailure }: { onFailure: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const fail = (event: Event) => {
      event.preventDefault();
      onFailure();
    };
    canvas.addEventListener("webglcontextlost", fail);
    return () => canvas.removeEventListener("webglcontextlost", fail);
  }, [gl, onFailure]);
  return null;
}

export default function Workshop({
  selected,
  onSelect,
  active,
  onFailure,
}: {
  selected: number;
  onSelect: (i: number) => void;
  active: boolean;
  onFailure: () => void;
}) {
  return (
    <Canvas
      aria-hidden="true"
      tabIndex={-1}
      dpr={[1, 1.5]}
      frameloop={active ? "always" : "demand"}
      shadows="percentage"
      camera={{ position: [10, 9.7, 13.8], fov: 39, near: 0.1, far: 65 }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      fallback={<StaticWorkshop selected={selected} />}
      onCreated={({ camera }) => camera.lookAt(0, 0.45, 0)}
    >
      <ContextGuard onFailure={onFailure} />
      <fog attach="fog" args={["#07090C", 23, 43]} />
      <ambientLight intensity={0.65} color="#94b9ae" />
      <hemisphereLight args={["#d6e5b0", "#102c21", 1.8]} />
      <directionalLight
        position={[-3, 9, 4]}
        intensity={3.3}
        color="#ffdaa1"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-bias={-0.001}
      />
      <directionalLight position={[3, 5, -5]} intensity={2} color="#7bd6b8" />
      <Rig active={active}>
        <mesh position={[0, -0.9, 0]} receiveShadow>
          <cylinderGeometry args={[6.25, 5.8, 0.32, 48]} />
          <meshStandardMaterial color="#13211b" roughness={1} />
        </mesh>
        <mesh position={[0, -1.16, 0]}>
          <cylinderGeometry args={[5.8, 4.9, 0.25, 20]} />
          <meshStandardMaterial color="#101b1c" roughness={1} />
        </mesh>
        {[2.5, 4.5, 6.1].map((r) => (
          <mesh
            key={r}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.73, 0]}
          >
            <torusGeometry args={[r, 0.015, 5, 72]} />
            <meshStandardMaterial
              color="#506749"
              emissive="#496033"
              emissiveIntensity={0.3}
            />
          </mesh>
        ))}
        {trees.map((position, index) => (
          <Tree key={index} position={position} index={index} />
        ))}
        {locations.map((_, index) => (
          <Station
            key={index}
            index={index}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
        {locations.slice(0, -1).map((from, index) => (
          <Connection
            key={index}
            from={from}
            to={locations[index + 1]}
            active={active}
            index={index}
          />
        ))}
        <group position={[0.2, 4, -1]} rotation={[Math.PI / 2, 0.25, 0]}>
          <mesh>
            <torusGeometry args={[0.82, 0.035, 7, 64]} />
            <meshStandardMaterial
              color="#e4df98"
              emissive="#d0df75"
              emissiveIntensity={1.5}
            />
          </mesh>
          <mesh>
            <torusGeometry args={[0.66, 0.012, 5, 48]} />
            <meshStandardMaterial
              color="#b6d769"
              emissive="#b6d769"
              emissiveIntensity={1}
            />
          </mesh>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Block
              key={i}
              position={[
                Math.sin((i * Math.PI) / 4) * 0.74,
                Math.cos((i * Math.PI) / 4) * 0.74,
                0,
              ]}
              size={[0.03, 0.15, 0.03]}
              rotation={[0, 0, (-i * Math.PI) / 4]}
              color="#d9e685"
              emissive
            />
          ))}
        </group>
        <pointLight
          position={[0.2, 3.5, -1]}
          color="#e8ef95"
          intensity={6}
          distance={10}
        />
        {Array.from({ length: 22 }, (_, i) => (
          <mesh
            key={i}
            position={[
              Math.sin(i * 13.1) * 5,
              0.35 + (i % 6) * 0.27,
              Math.cos(i * 7.3) * 4.5,
            ]}
          >
            <sphereGeometry args={[0.023, 5, 4]} />
            <meshBasicMaterial color={i % 3 === 0 ? "#e9ca88" : "#b1d481"} />
          </mesh>
        ))}
        {Array.from({ length: 15 }, (_, i) => (
          <mesh
            key={i}
            position={[
              Math.sin(i * 2.31) * 5.4,
              -0.55,
              Math.cos(i * 2.31) * 5.1,
            ]}
            rotation={[0, i * 0.7, 0.1]}
            castShadow
          >
            <dodecahedronGeometry args={[0.15 + (i % 3) * 0.09, 0]} />
            <meshStandardMaterial color="#3b4a36" roughness={1} />
          </mesh>
        ))}
      </Rig>
    </Canvas>
  );
}
