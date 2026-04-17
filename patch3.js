const fs = require('fs');

const file = 'client/src/game/MeteorShower.ts';
const code = `import {
  AdditiveBlending,
  ConeGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  DodecahedronGeometry,
  Vector3,
  Points,
  BufferGeometry,
  BufferAttribute,
} from "three";
import { moveOnSphere, seededRandom, tangentFrame } from "./SphericalMath";
import { PROP_TERRAIN_SINK, surfaceDisplacementAt } from "./TerrainSurface";

const METEOR_PHASE_START = 0.5;
const METEOR_PHASE_END = 0.75;
const METEOR_POOL = 4;
const METEOR_MAX_ACTIVE = 3;

const METEOR_SPAWN_INTERVAL_MAX = 1.9;
const METEOR_SPAWN_INTERVAL_MIN = 0.9;
const METEOR_TRAVEL_TIME_MIN = 1.45;
const METEOR_TRAVEL_TIME_MAX = 2.05;

const METEOR_TARGET_SURFACE_DIST_MIN = 0.8;
const METEOR_TARGET_SURFACE_DIST_MAX = 1.55;
const METEOR_TARGET_HEADING_SPREAD = 0.95;

const METEOR_SPAWN_HEIGHT_MIN = 1.7;
const METEOR_SPAWN_HEIGHT_MAX = 2.4;
const METEOR_SIDE_SWAY = 0.55;
const METEOR_FORWARD_SWAY = 0.35;

const METEOR_HEAD_RADIUS = 0.085;
const METEOR_TRAIL_RADIUS = 0.16;
const METEOR_TRAIL_LENGTH = 3.2;

const TARGET_GLOW_OFFSET = 0.028;
const TARGET_GLOW_SCALE_MIN = 0.2;
const TARGET_GLOW_SCALE_MAX = 0.32;

const IMPACT_DOME_LIFE = 0.35;
const IMPACT_SHOCKWAVE_LIFE = 0.42;
const IMPACT_DOME_SCALE_MIN = 0.14;
const IMPACT_DOME_SCALE_MAX = 0.85;
const IMPACT_SHOCKWAVE_SCALE_MIN = 0.12;
const IMPACT_SHOCKWAVE_SCALE_MAX = 0.75;

const SPARK_COUNT = 300;

const noiseGLSL = \`
float hash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1.0,0.0,0.0)), f.x),
        mix(hash3(i + vec3(0.0,1.0,0.0)), hash3(i + vec3(1.0,1.0,0.0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0.0,0.0,1.0)), hash3(i + vec3(1.0,0.0,1.0)), f.x),
        mix(hash3(i + vec3(0.0,1.0,1.0)), hash3(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z);
}
\`;

const headVert = \`
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;
const headFrag = \`
uniform float uTime;
varying vec3 vPos;
\${noiseGLSL}
void main() {
  float n = noise3(vPos * 35.0 + uTime * 3.0);
  float crack = smoothstep(0.35, 0.6, n);
  vec3 rock = vec3(0.08, 0.03, 0.01);
  vec3 lavaCore = vec3(1.0, 0.9, 0.2);
  vec3 lavaEdge = vec3(1.0, 0.2, 0.0);
  vec3 lava = mix(lavaEdge, lavaCore, crack);
  vec3 col = mix(rock, lava, crack * 0.8 + 0.2);
  gl_FragColor = vec4(col, 1.0);
}
\`;

const trailVert = \`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;
const trailFrag = \`
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
\${noiseGLSL}
void main() {
  float fade = 1.0 - vUv.y;
  float n = noise3(vec3(vUv.x * 12.0, vUv.y * 6.0 - uTime * 15.0, uTime * 2.0));
  float core = smoothstep(0.2, 0.8, fade) * smoothstep(0.1, 0.9, n);
  vec3 col = mix(vec3(1.0, 0.1, 0.0), vec3(1.0, 0.9, 0.3), core);
  float alpha = smoothstep(0.0, 0.3, fade) * n * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
\`;

const domeVert = \`
varying vec3 vPos;
varying vec2 vUv;
void main() {
  vPos = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;
const domeFrag = \`
uniform float uProgress;
uniform float uTime;
varying vec3 vPos;
varying vec2 vUv;
\${noiseGLSL}
void main() {
  float n = noise3(vPos * 4.0 - vec3(0.0, uTime * 4.0, 0.0));
  float edgeFade = smoothstep(1.0, 0.8, uProgress);
  float heightFade = smoothstep(1.0, 0.1, vPos.y);
  float fire = smoothstep(uProgress - 0.4, uProgress + 0.1, n * heightFade);
  vec3 col = mix(vec3(1.0, 0.1, 0.0), vec3(1.0, 0.8, 0.2), fire);
  float alpha = fire * edgeFade * (1.0 - uProgress);
  gl_FragColor = vec4(col, alpha);
}
\`;

const shockwaveVert = \`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;
const shockwaveFrag = \`
varying vec2 vUv;
uniform float uOpacity;
uniform float uInnerR;
uniform float uOuterR;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float ringMid = (uInnerR + uOuterR) * 0.5;
  float ringW = (uOuterR - uInnerR) * 0.5;
  float ring = 1.0 - smoothstep(0.0, ringW, abs(d - ringMid));
  vec3 col = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.8, 0.3), smoothstep(uInnerR, uOuterR, d));
  gl_FragColor = vec4(col, ring * uOpacity);
}
\`;

const sparkVert = \`
attribute float aLife;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (35.0 * vLife) / max(-mvPos.z, 0.1);
  gl_Position = projectionMatrix * mvPos;
}
\`;
const sparkFrag = \`
varying float vLife;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  vec3 col = mix(vec3(1.0, 0.1, 0.0), vec3(1.0, 0.9, 0.3), vLife);
  float alpha = (1.0 - d) * vLife;
  gl_FragColor = vec4(col, alpha);
}
\`;

type MeteorState = {
  active: boolean;
  exploding: boolean;
  flightT: number;
  flightDur: number;
  explodeT: number;
  pulseOffset: number;
  start: Vector3;
  impact: Vector3;
  pos: Vector3;
  dir: Vector3;
  normal: Vector3;
  head: Mesh;
  headMat: ShaderMaterial;
  trail: Mesh;
  trailMat: ShaderMaterial;
  glow: Mesh;
  glowMat: MeshBasicMaterial;
  shockwave: Mesh;
  shockwaveMat: ShaderMaterial;
  dome: Mesh;
  domeMat: ShaderMaterial;
};

const _refUp = new Vector3(0, 1, 0);
const _trailForward = new Vector3(0, -1, 0);
const _refPlaneNormal = new Vector3(0, 0, 1);
const _targetNormal = new Vector3();
const _spawnForward = new Vector3();
const _spawnSide = new Vector3();
const _tmpImpact = new Vector3();

export class MeteorShower {
  readonly group = new Group();
  onImpact?: (worldPos: Vector3, distanceToPlayer: number) => void;

  private meteors: MeteorState[] = [];
  private spawnTimer = 0.35;
  private spawnSerial = 0;
  private time = 0;

  private sparks: { pos: Vector3; vel: Vector3; life: number; maxLife: number }[] = [];
  private sparksPos: Float32Array;
  private sparksLife: Float32Array;
  private sparksGeo: BufferGeometry;
  private sparksPoints: Points;
  private nextSpark = 0;

  constructor(
    private globeRadius: number,
    private worldSeed: number,
    private terrainType: string,
  ) {
    for (let i = 0; i < METEOR_POOL; i++) {
      this.meteors.push(this.createMeteor());
    }

    this.sparksPos = new Float32Array(SPARK_COUNT * 3);
    this.sparksLife = new Float32Array(SPARK_COUNT);
    for (let i = 0; i < SPARK_COUNT; i++) {
      this.sparks.push({ pos: new Vector3(), vel: new Vector3(), life: 0, maxLife: 1 });
    }
    this.sparksGeo = new BufferGeometry();
    this.sparksGeo.setAttribute("position", new BufferAttribute(this.sparksPos, 3));
    this.sparksGeo.setAttribute("aLife", new BufferAttribute(this.sparksLife, 1));
    
    const sparksMat = new ShaderMaterial({
      vertexShader: sparkVert,
      fragmentShader: sparkFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.sparksPoints = new Points(this.sparksGeo, sparksMat);
    this.sparksPoints.frustumCulled = false;
    this.sparksPoints.renderOrder = 338;
    this.group.add(this.sparksPoints);
  }

  private createMeteor(): MeteorState {
    const headGeo = new DodecahedronGeometry(METEOR_HEAD_RADIUS, 1);
    const posAttr = headGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      const r = 1.0 + (Math.random() - 0.5) * 0.3;
      posAttr.setXYZ(i, x * r, y * r, z * r);
    }
    headGeo.computeVertexNormals();

    const headMat = new ShaderMaterial({
      vertexShader: headVert,
      fragmentShader: headFrag,
      uniforms: { uTime: { value: 0 } },
    });
    const head = new Mesh(headGeo, headMat);
    head.visible = false;
    head.renderOrder = 340;

    const trailMat = new ShaderMaterial({
      vertexShader: trailVert,
      fragmentShader: trailFrag,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const trail = new Mesh(
      new ConeGeometry(METEOR_TRAIL_RADIUS, METEOR_TRAIL_LENGTH, 16, 4, true),
      trailMat,
    );
    trail.visible = false;
    trail.renderOrder = 335;

    const glowMat = new MeshBasicMaterial({
      color: 0xffba73,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const glow = new Mesh(new RingGeometry(0.45, 1, 24), glowMat);
    glow.visible = false;
    glow.renderOrder = 330;

    const shockwaveMat = new ShaderMaterial({
      vertexShader: shockwaveVert,
      fragmentShader: shockwaveFrag,
      uniforms: {
        uOpacity: { value: 0 },
        uInnerR: { value: 0 },
        uOuterR: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const shockwave = new Mesh(new RingGeometry(0.5, 1, 24), shockwaveMat);
    shockwave.visible = false;
    shockwave.renderOrder = 345;

    const domeMat = new ShaderMaterial({
      vertexShader: domeVert,
      fragmentShader: domeFrag,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const dome = new Mesh(new SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.visible = false;
    dome.renderOrder = 346;

    this.group.add(glow);
    this.group.add(trail);
    this.group.add(head);
    this.group.add(shockwave);
    this.group.add(dome);

    return {
      active: false,
      exploding: false,
      flightT: 0,
      flightDur: 1,
      explodeT: 0,
      pulseOffset: 0,
      start: new Vector3(),
      impact: new Vector3(),
      pos: new Vector3(),
      dir: new Vector3(0, -1, 0),
      normal: new Vector3(0, 1, 0),
      head,
      headMat,
      trail,
      trailMat,
      glow,
      glowMat,
      shockwave,
      shockwaveMat,
      dome,
      domeMat,
    };
  }

  private phaseIntensity(moonProgress: number): number {
    if (moonProgress < METEOR_PHASE_START || moonProgress >= METEOR_PHASE_END) return 0;
    return MathUtils.smoothstep(moonProgress, METEOR_PHASE_START, METEOR_PHASE_END);
  }

  private activeFlightCount(): number {
    let count = 0;
    for (const meteor of this.meteors) {
      if (meteor.active && !meteor.exploding) count++;
    }
    return count;
  }

  private deactivateMeteor(meteor: MeteorState) {
    meteor.active = false;
    meteor.exploding = false;
    meteor.head.visible = false;
    meteor.trail.visible = false;
    meteor.glow.visible = false;
    meteor.shockwave.visible = false;
    meteor.dome.visible = false;
    meteor.shockwaveMat.uniforms.uOpacity.value = 0;
    meteor.domeMat.uniforms.uProgress.value = 1;
  }

  reset() {
    this.spawnTimer = 0.35;
    for (const meteor of this.meteors) {
      this.deactivateMeteor(meteor);
    }
    for (const spark of this.sparks) {
      spark.life = 0;
    }
  }

  private spawnMeteor(playerQ: Quaternion, playerHeading: number) {
    const meteor = this.meteors.find((m) => !m.active);
    if (!meteor) return;

    const rand = seededRandom(
      (this.worldSeed * 92821 + this.spawnSerial * 68917 + 17) >>> 0,
    );
    this.spawnSerial++;

    const heading = playerHeading + (rand() - 0.5) * 2 * METEOR_TARGET_HEADING_SPREAD;
    const surfaceDist = MathUtils.lerp(
      METEOR_TARGET_SURFACE_DIST_MIN,
      METEOR_TARGET_SURFACE_DIST_MAX,
      rand(),
    );
    const impactQ = moveOnSphere(playerQ, heading, surfaceDist / this.globeRadius);
    const frame = tangentFrame(impactQ);

    _targetNormal.copy(_refUp).applyQuaternion(impactQ).normalize();
    const disp = surfaceDisplacementAt(
      this.worldSeed,
      this.terrainType,
      _targetNormal.x,
      _targetNormal.y,
      _targetNormal.z,
    );
    const surfaceR = this.globeRadius + disp - PROP_TERRAIN_SINK + TARGET_GLOW_OFFSET;

    meteor.normal.copy(_targetNormal);
    meteor.impact.copy(_targetNormal).multiplyScalar(surfaceR);
    meteor.start.copy(meteor.impact);

    _spawnForward
      .copy(frame.north)
      .multiplyScalar(Math.cos(heading))
      .addScaledVector(frame.east, Math.sin(heading))
      .normalize();
    _spawnSide.crossVectors(_spawnForward, frame.up).normalize();

    meteor.start
      .addScaledVector(
        meteor.normal,
        MathUtils.lerp(METEOR_SPAWN_HEIGHT_MIN, METEOR_SPAWN_HEIGHT_MAX, rand()),
      )
      .addScaledVector(_spawnSide, (rand() - 0.5) * 2 * METEOR_SIDE_SWAY)
      .addScaledVector(_spawnForward, MathUtils.lerp(0.05, METEOR_FORWARD_SWAY, rand()));

    meteor.pos.copy(meteor.start);
    meteor.dir.copy(meteor.impact).sub(meteor.start).normalize();
    meteor.flightT = 0;
    meteor.flightDur = MathUtils.lerp(METEOR_TRAVEL_TIME_MIN, METEOR_TRAVEL_TIME_MAX, rand());
    meteor.explodeT = 0;
    meteor.pulseOffset = rand() * Math.PI * 2;
    meteor.active = true;
    meteor.exploding = false;

    meteor.glow.position.copy(meteor.impact);
    meteor.glow.quaternion.setFromUnitVectors(_refPlaneNormal, meteor.normal);
    meteor.glow.visible = true;
    meteor.shockwave.position.copy(meteor.impact);
    meteor.shockwave.quaternion.copy(meteor.glow.quaternion);
    meteor.shockwave.visible = false;
    
    meteor.dome.position.copy(meteor.impact);
    meteor.dome.quaternion.setFromUnitVectors(_refUp, meteor.normal);
    meteor.dome.visible = false;
  }

  private triggerImpact(meteor: MeteorState, playerPos: Vector3) {
    meteor.exploding = true;
    meteor.explodeT = 0;
    meteor.head.visible = false;
    meteor.trail.visible = false;
    meteor.glow.visible = false;
    meteor.shockwave.visible = true;
    meteor.dome.visible = true;
    this.onImpact?.(_tmpImpact.copy(meteor.impact), playerPos.distanceTo(meteor.impact));
    
    // Spawn a burst of sparks on impact
    for (let i = 0; i < 15; i++) {
      this.emitSpark(meteor.impact, meteor.normal, 2.5);
    }
  }

  private emitSpark(pos: Vector3, normal: Vector3, speedMult = 1.0) {
    const spark = this.sparks[this.nextSpark]!;
    this.nextSpark = (this.nextSpark + 1) % SPARK_COUNT;
    
    spark.pos.copy(pos);
    spark.pos.addScaledVector(normal, Math.random() * 0.1);
    
    const spread = 0.8;
    spark.vel.set(
      (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * spread
    );
    spark.vel.addScaledVector(normal, 0.5 + Math.random() * 0.5);
    spark.vel.normalize().multiplyScalar((0.5 + Math.random() * 1.5) * speedMult);
    
    spark.maxLife = 0.4 + Math.random() * 0.6;
    spark.life = spark.maxLife;
  }

  update(
    dt: number,
    moonProgress: number,
    playerQ: Quaternion,
    playerHeading: number,
    playerPos: Vector3,
  ) {
    this.time += dt;

    const intensity = this.phaseIntensity(moonProgress);
    if (intensity > 0) {
      this.spawnTimer -= dt;
      while (this.spawnTimer <= 0 && this.activeFlightCount() < METEOR_MAX_ACTIVE) {
        this.spawnMeteor(playerQ, playerHeading);
        this.spawnTimer += MathUtils.lerp(
          METEOR_SPAWN_INTERVAL_MAX,
          METEOR_SPAWN_INTERVAL_MIN,
          intensity,
        );
      }
    } else {
      this.spawnTimer = Math.max(this.spawnTimer, 0.45);
    }

    for (const meteor of this.meteors) {
      if (!meteor.active) continue;

      if (!meteor.exploding) {
        meteor.flightT += dt;
        const rawT = Math.min(meteor.flightT / meteor.flightDur, 1);
        const t = rawT * rawT * (3 - 2 * rawT);
        meteor.pos.lerpVectors(meteor.start, meteor.impact, t);

        meteor.head.visible = true;
        meteor.head.position.copy(meteor.pos);
        meteor.head.scale.setScalar(0.92 + 0.12 * Math.sin(this.time * 22 + meteor.pulseOffset));
        meteor.headMat.uniforms.uTime.value = this.time;

        meteor.trail.visible = true;
        meteor.trail.position
          .copy(meteor.pos)
          .addScaledVector(meteor.dir, -METEOR_TRAIL_LENGTH * 0.5);
        meteor.trail.quaternion.setFromUnitVectors(_trailForward, meteor.dir);
        meteor.trail.scale.setScalar(1);
        meteor.trailMat.uniforms.uTime.value = this.time;
        meteor.trailMat.uniforms.uOpacity.value = MathUtils.lerp(0.4, 0.95, 1 - rawT);

        // Emit sparks while flying
        if (Math.random() < dt * 30) {
          this.emitSpark(meteor.pos, meteor.dir.clone().negate(), 0.4);
        }

        const glowPulse = 0.82 + 0.18 * Math.sin(this.time * 9 + meteor.pulseOffset);
        const glowScale = MathUtils.lerp(TARGET_GLOW_SCALE_MIN, TARGET_GLOW_SCALE_MAX, rawT);
        meteor.glow.visible = true;
        meteor.glow.scale.setScalar(glowScale * glowPulse);
        meteor.glowMat.opacity = MathUtils.lerp(0.16, 0.42, rawT) * glowPulse;

        if (rawT >= 1) {
          this.triggerImpact(meteor, playerPos);
        }
        continue;
      }

      meteor.explodeT += dt;

      const domeT = Math.min(meteor.explodeT / IMPACT_DOME_LIFE, 1);
      meteor.dome.visible = domeT < 1;
      meteor.dome.scale.setScalar(
        MathUtils.lerp(IMPACT_DOME_SCALE_MIN, IMPACT_DOME_SCALE_MAX, domeT),
      );
      meteor.domeMat.uniforms.uTime.value = this.time;
      meteor.domeMat.uniforms.uProgress.value = domeT;

      const waveT = Math.min(meteor.explodeT / IMPACT_SHOCKWAVE_LIFE, 1);
      meteor.shockwave.visible = waveT < 1;
      meteor.shockwave.scale.setScalar(
        MathUtils.lerp(IMPACT_SHOCKWAVE_SCALE_MIN, IMPACT_SHOCKWAVE_SCALE_MAX, waveT),
      );
      meteor.shockwaveMat.uniforms.uInnerR.value = Math.max(0, waveT - 0.2);
      meteor.shockwaveMat.uniforms.uOuterR.value = waveT;
      meteor.shockwaveMat.uniforms.uOpacity.value = (1 - waveT * waveT) * 0.85;

      if (waveT >= 1) {
        this.deactivateMeteor(meteor);
      }
    }

    // Update sparks
    let activeSparks = false;
    for (let i = 0; i < SPARK_COUNT; i++) {
      const spark = this.sparks[i]!;
      if (spark.life <= 0) {
        this.sparksLife[i] = 0;
        this.sparksPos[i * 3] = 0;
        this.sparksPos[i * 3 + 1] = -1000;
        this.sparksPos[i * 3 + 2] = 0;
        continue;
      }
      activeSparks = true;
      spark.life -= dt;
      spark.pos.addScaledVector(spark.vel, dt);
      spark.vel.multiplyScalar(0.95); // drag
      
      this.sparksLife[i] = Math.max(0, spark.life / spark.maxLife);
      this.sparksPos[i * 3] = spark.pos.x;
      this.sparksPos[i * 3 + 1] = spark.pos.y;
      this.sparksPos[i * 3 + 2] = spark.pos.z;
    }
    
    if (activeSparks) {
      this.sparksGeo.attributes.position!.needsUpdate = true;
      this.sparksGeo.attributes.aLife!.needsUpdate = true;
    }
  }

  dispose() {
    for (const meteor of this.meteors) {
      this.deactivateMeteor(meteor);
      meteor.head.geometry.dispose();
      meteor.headMat.dispose();
      meteor.trail.geometry.dispose();
      meteor.trailMat.dispose();
      meteor.glow.geometry.dispose();
      meteor.glowMat.dispose();
      meteor.shockwave.geometry.dispose();
      meteor.shockwaveMat.dispose();
      meteor.dome.geometry.dispose();
      meteor.domeMat.dispose();
    }
    this.meteors = [];
    this.sparksGeo.dispose();
    (this.sparksPoints.material as ShaderMaterial).dispose();
    this.group.parent?.remove(this.group);
  }
}
`;

fs.writeFileSync(file, code);
