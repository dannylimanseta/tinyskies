import {
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  type PerspectiveCamera,
} from "three";

const LINE_COUNT = 6;
const SPAWN_RADIUS_MIN = 0.15;
const SPAWN_RADIUS_MAX = 0.8;
const SPAWN_DEPTH_MIN = 0.5;
const SPAWN_DEPTH_MAX = 2.0;
const LINE_WIDTH = 0.024;
const BASE_LENGTH = 0.08;
const MAX_LENGTH = 0.25;
const SPEED_THRESHOLD = 0.8;
const MAX_SPEED = 3.0;

interface Streak {
  x: number;
  y: number;
  z: number;
  drift: number;
  mesh: Mesh;
  material: ShaderMaterial;
}

function createStreakMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      globalOpacity: { value: 0.0 },
      life: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float globalOpacity;
      uniform float life;
      varying vec2 vUv;
      void main() {
        float along = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.4, vUv.x);
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        across = across * across;
        float fade = smoothstep(0.0, 0.3, life) * smoothstep(1.0, 0.7, life);
        float a = along * across * fade * globalOpacity;
        gl_FragColor = vec4(1.0, 0.98, 0.9, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
}

export class SpeedLines {
  readonly group = new Group();
  private streaks: Streak[] = [];
  private geo: PlaneGeometry;

  constructor() {
    this.geo = new PlaneGeometry(1, LINE_WIDTH);

    for (let i = 0; i < LINE_COUNT; i++) {
      const mat = createStreakMaterial();
      const mesh = new Mesh(this.geo, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.streaks.push(this.spawnStreak(mesh, mat));
    }
  }

  private spawnStreak(mesh: Mesh, material: ShaderMaterial): Streak {
    const angle = Math.random() * Math.PI * 2;
    const r = SPAWN_RADIUS_MIN + Math.random() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
    const zStart = -(SPAWN_DEPTH_MIN + Math.random() * (SPAWN_DEPTH_MAX - SPAWN_DEPTH_MIN));
    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      z: zStart,
      drift: 1.5 + Math.random() * 2,
      mesh,
      material,
    };
  }

  update(dt: number, planeSpeed: number, camera: PerspectiveCamera) {
    const speedFactor = Math.max(0, (planeSpeed - SPEED_THRESHOLD) / (MAX_SPEED - SPEED_THRESHOLD));
    const globalOp = speedFactor * 0.18;

    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);

    const lineLen = BASE_LENGTH + (MAX_LENGTH - BASE_LENGTH) * speedFactor;
    const totalTravel = SPAWN_DEPTH_MAX - 0.2;

    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i];

      s.z += s.drift * speedFactor * dt;

      if (s.z > -0.2) {
        const newS = this.spawnStreak(s.mesh, s.material);
        this.streaks[i] = newS;
        continue;
      }

      const distFromStart = (-s.z - 0.2);
      const life = 1.0 - (distFromStart / totalTravel);

      s.material.uniforms.globalOpacity.value = globalOp;
      s.material.uniforms.life.value = life;

      s.mesh.position.set(s.x, s.y, s.z);
      s.mesh.rotation.z = Math.atan2(s.y, s.x);
      s.mesh.scale.set(lineLen, 1, 1);
    }
  }

  dispose() {
    this.geo.dispose();
    for (const s of this.streaks) s.material.dispose();
  }
}
