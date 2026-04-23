import {
  Group,
  BufferGeometry,
  BufferAttribute,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  Vector3,
  InstancedMesh,
  Object3D,
  Euler,
} from "three";

const SHARD_COUNT = 12;
const POOL_SIZE = 4;
const LIFETIME = 0.55;
const DIAMOND_COLOR: [number, number, number] = [0.2, 1.0, 0.8];

export type RingCollectVFXOptions = {
  /** Additive shard tint; defaults to cold diamond green-cyan. */
  shardRgb?: [number, number, number];
};

const shardVert = `
varying vec3 vNorm;
void main() {
  vec4 instancePos = instanceMatrix * vec4(position, 1.0);
  vNorm = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * instancePos;
}
`;

const shardFrag = `
uniform vec3 color;
uniform float globalAlpha;
varying vec3 vNorm;

void main() {
  float light = 0.7 + 0.3 * abs(dot(vNorm, normalize(vec3(1.0, 2.0, 0.5))));
  gl_FragColor = vec4(color * light * 2.5, globalAlpha);
}
`;

interface ShardState {
  velocity: Vector3;
  rotVelocity: Euler;
  rotation: Euler;
  startPos: Vector3;
  scaleXYZ: Vector3;
  alpha: number;
}

interface VFXInstance {
  group: Group;
  shards: InstancedMesh;
  shardMat: ShaderMaterial;
  states: ShardState[];
  life: number;
  active: boolean;
  center: Vector3;
  upDir: Vector3;
  /** Per-burst; falls back to {@link DIAMOND_COLOR} in the update loop when null. */
  shardTint: [number, number, number] | null;
}

const _dummy = new Object3D();
const _pos = new Vector3();

function createShardGeometry(): BufferGeometry {
  const geo = new BufferGeometry();
  const s = 0.035;
  const r = () => (Math.random() - 0.5) * s * 0.7;
  const verts = new Float32Array([
    r(), s * (1.0 + Math.random() * 0.6), r(),
    -s * (0.6 + Math.random() * 0.8), -s * (0.3 + Math.random() * 0.4), s * (0.2 + Math.random() * 0.4),
    s * (0.6 + Math.random() * 0.8), -s * (0.3 + Math.random() * 0.4), -s * (0.2 + Math.random() * 0.4),
  ]);
  geo.setAttribute("position", new BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

export class RingCollectVFX {
  readonly group = new Group();
  private pool: VFXInstance[] = [];
  private shardGeos: BufferGeometry[] = [];

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      const geo = createShardGeometry();
      this.shardGeos.push(geo);
      this.pool.push(this.createInstance(geo));
    }
  }

  private createInstance(shardGeo: BufferGeometry): VFXInstance {
    const vfxGroup = new Group();
    vfxGroup.visible = false;

    const shardMat = new ShaderMaterial({
      vertexShader: shardVert,
      fragmentShader: shardFrag,
      uniforms: {
        color: { value: DIAMOND_COLOR },
        globalAlpha: { value: 1 },
      },
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });

    const shards = new InstancedMesh(shardGeo, shardMat, SHARD_COUNT);
    shards.frustumCulled = false;
    vfxGroup.add(shards);

    this.group.add(vfxGroup);

    const states: ShardState[] = [];
    for (let i = 0; i < SHARD_COUNT; i++) {
      states.push({
        velocity: new Vector3(),
        rotVelocity: new Euler(),
        rotation: new Euler(),
        startPos: new Vector3(),
        scaleXYZ: new Vector3(),
        alpha: 1,
      });
    }

    return {
      group: vfxGroup,
      shards,
      shardMat,
      states,
      life: 0,
      active: false,
      center: new Vector3(),
      upDir: new Vector3(0, 1, 0),
      shardTint: null,
    };
  }

  play(worldPos: Vector3, _tier: number, options?: RingCollectVFXOptions) {
    const inst = this.pool.find((p) => !p.active);
    if (!inst) return;

    inst.active = true;
    inst.life = 0;
    inst.center.copy(worldPos);
    inst.upDir.copy(worldPos).normalize();
    inst.group.visible = true;
    const tint = options?.shardRgb;
    inst.shardTint = tint ? [tint[0], tint[1], tint[2]] : null;
    const base: [number, number, number] = tint ?? DIAMOND_COLOR;
    inst.shardMat.uniforms.color.value = [base[0], base[1], base[2]];

    for (let i = 0; i < SHARD_COUNT; i++) {
      const s = inst.states[i];

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * 0.8 + 0.2;
      const speed = 1.0 + Math.random() * 1.2;

      const outward = inst.upDir.clone().multiplyScalar(phi * speed);
      const tangentX = Math.cos(theta) * (1 - phi) * speed;
      const tangentZ = Math.sin(theta) * (1 - phi) * speed;

      const arbX = new Vector3(1, 0, 0);
      if (Math.abs(inst.upDir.dot(arbX)) > 0.9) arbX.set(0, 0, 1);
      const tangent1 = new Vector3().crossVectors(inst.upDir, arbX).normalize();
      const tangent2 = new Vector3().crossVectors(inst.upDir, tangent1).normalize();

      s.velocity
        .copy(outward)
        .addScaledVector(tangent1, tangentX)
        .addScaledVector(tangent2, tangentZ);

      s.startPos.copy(worldPos);

      s.rotVelocity.set(
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
      );
      s.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );

      s.scaleXYZ.set(
        0.4 + Math.random() * 1.2,
        0.4 + Math.random() * 1.2,
        0.4 + Math.random() * 1.2,
      );
      s.alpha = 0.4 + Math.random() * 0.6;

      _dummy.position.copy(worldPos);
      _dummy.scale.copy(s.scaleXYZ);
      _dummy.rotation.copy(s.rotation);
      _dummy.updateMatrix();
      inst.shards.setMatrixAt(i, _dummy.matrix);
    }
    inst.shards.instanceMatrix.needsUpdate = true;
  }

  update(dt: number) {
    for (const inst of this.pool) {
      if (!inst.active) continue;

      inst.life += dt;
      const progress = inst.life / LIFETIME;

      if (progress >= 1) {
        inst.active = false;
        inst.group.visible = false;
        inst.shardTint = null;
        continue;
      }

      // Fade out while shards drift (no pull toward player).
      const fade = Math.pow(1 - progress, 1.35);
      const brightness = 1.0 + (1 - progress) * 1.2;
      const avgAlpha = inst.states.reduce((sum, st) => sum + st.alpha, 0) / SHARD_COUNT;

      const base = inst.shardTint ?? DIAMOND_COLOR;
      inst.shardMat.uniforms.globalAlpha.value = fade * avgAlpha;
      inst.shardMat.uniforms.color.value = [
        base[0] * brightness,
        base[1] * brightness,
        base[2] * brightness,
      ];

      for (let i = 0; i < SHARD_COUNT; i++) {
        const s = inst.states[i];
        const t = inst.life;
        const damp = 1 / (1 + t * 0.85);

        _pos.set(
          inst.center.x + s.velocity.x * t * damp,
          inst.center.y + s.velocity.y * t * damp,
          inst.center.z + s.velocity.z * t * damp,
        );

        s.rotation.x += s.rotVelocity.x * dt;
        s.rotation.y += s.rotVelocity.y * dt;
        s.rotation.z += s.rotVelocity.z * dt;

        const shrink = 1 - progress * 0.55;

        _dummy.position.copy(_pos);
        _dummy.rotation.copy(s.rotation);
        _dummy.scale.set(
          s.scaleXYZ.x * shrink,
          s.scaleXYZ.y * shrink,
          s.scaleXYZ.z * shrink,
        );
        _dummy.updateMatrix();
        inst.shards.setMatrixAt(i, _dummy.matrix);
      }
      inst.shards.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const geo of this.shardGeos) geo.dispose();
    for (const inst of this.pool) {
      inst.shardMat.dispose();
      inst.shards.dispose();
      this.group.remove(inst.group);
    }
    this.pool.length = 0;
  }
}
