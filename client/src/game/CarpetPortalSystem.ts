import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from "three";
import { CARPET_HOVER_HEIGHT, type Carpet } from "./Carpet";
import {
  cartesianFromSpherical,
  moveOnSphere,
  tangentFrame,
} from "./SphericalMath";
import { surfaceAltitudeAt } from "./TerrainSurface";

const PORTAL_COLORS = [0x00aaff, 0xff7700] as const;
const PORTAL_PLACE_AHEAD = 0.18;
const PORTAL_RADIUS = 0.19;
const PORTAL_TUBE_RADIUS = 0.022;
const PORTAL_TRIGGER_RADIUS = 0.14;
const PORTAL_ARM_DISTANCE = 0.38;
const PORTAL_EXIT_PUSH = 0.22;
const PORTAL_COOLDOWN_SEC = 0.3;

type PortalEndpoint = {
  id: number;
  qPosition: Quaternion;
  heading: number;
  altitude: number;
  minAltitude: number;
  worldPosition: Vector3;
  up: Vector3;
  forward: Vector3;
  right: Vector3;
  visual: PortalVisual;
  armed: boolean;
};

export interface PortalUpdateResult {
  didTeleport: boolean;
}

class PortalVisual {
  readonly group = new Group();
  private readonly scaledGroup = new Group();
  private readonly ring: Mesh;
  private readonly glow: Mesh;
  private readonly inner: Mesh;
  private readonly swirl: Mesh;
  private readonly swirl2: Mesh;
  private readonly materials: (MeshBasicMaterial | ShaderMaterial)[];
  private readonly phase: number;

  constructor(colorHex: number, phase: number) {
    this.phase = phase;
    this.group.matrixAutoUpdate = false;

    // Portal 2 portals are tall and narrow
    this.scaledGroup.scale.set(0.65, 1.25, 1.0);
    this.group.add(this.scaledGroup);

    const ringMat = new MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    const glowMat = new MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.35,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    
    const portalShaderMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(colorHex) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;

        void main() {
          vec2 uv = vUv - 0.5;
          float r = length(uv) * 2.0; // 0 to 1
          if (r > 1.0) discard;

          float a = atan(uv.y, uv.x);

          // Swirling vortex effect
          float angleOffset = r * 4.0 - uTime * 5.0;
          float swirl1 = sin(a * 3.0 + angleOffset) * 0.5 + 0.5;
          float swirl2 = sin(a * 5.0 - angleOffset * 1.5) * 0.5 + 0.5;
          
          float energy = swirl1 * swirl2;
          
          // Dark center, bright fiery edge
          float edgeGlow = pow(r, 3.0) * 2.0;
          float centerDarkness = smoothstep(0.2, 0.6, r);
          
          vec3 finalColor = mix(vec3(0.0), uColor, centerDarkness);
          finalColor += uColor * energy * edgeGlow;
          finalColor += vec3(1.0) * pow(r, 8.0); // White hot very edge

          // Fade out at the very edge to blend with the ring
          float alpha = smoothstep(1.0, 0.95, r) * centerDarkness;

          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    const swirlMat = new MeshBasicMaterial({
      color: 0xffffff, // White hot core
      transparent: true,
      opacity: 0.7,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    const swirl2Mat = new MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.6,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });

    this.materials = [ringMat, glowMat, portalShaderMat, swirlMat, swirl2Mat];
    
    // Thinner border
    this.ring = new Mesh(new TorusGeometry(PORTAL_RADIUS, PORTAL_TUBE_RADIUS * 0.6, 18, 56), ringMat);
    this.glow = new Mesh(new CircleGeometry(PORTAL_RADIUS * 1.3, 40), glowMat);
    // The inner void is now our cool shader
    this.inner = new Mesh(new CircleGeometry(PORTAL_RADIUS * 0.95, 40), portalShaderMat);
    this.swirl = new Mesh(new TorusGeometry(PORTAL_RADIUS * 0.95, PORTAL_TUBE_RADIUS * 0.4, 12, 36), swirlMat);
    this.swirl2 = new Mesh(new TorusGeometry(PORTAL_RADIUS * 0.98, PORTAL_TUBE_RADIUS * 0.6, 12, 36), swirl2Mat);

    this.glow.position.z = -0.012;
    this.inner.position.z = -0.004;
    this.swirl.position.z = 0.008;
    this.swirl2.position.z = 0.012;

    this.scaledGroup.add(this.glow);
    this.scaledGroup.add(this.inner);
    this.scaledGroup.add(this.swirl);
    this.scaledGroup.add(this.swirl2);
    this.scaledGroup.add(this.ring);
  }

  applyPose(worldPosition: Vector3, right: Vector3, up: Vector3, forward: Vector3) {
    const m = new Matrix4().makeBasis(right, up, forward);
    m.setPosition(worldPosition);
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;
  }

  update(time: number) {
    const pulse = 1 + Math.sin(time * 8.0 + this.phase) * 0.02;
    this.ring.scale.setScalar(pulse);
    this.glow.scale.setScalar(0.95 + Math.sin(time * 4.0 + this.phase) * 0.05);
    
    // Update shader time
    const shaderMat = this.materials[2] as ShaderMaterial;
    if (shaderMat.uniforms) {
      shaderMat.uniforms.uTime.value = time + this.phase;
    }
    
    // Portal 2 swirling energy
    this.swirl.rotation.z = -time * 3.5 - this.phase;
    this.swirl2.rotation.z = time * 2.8 + this.phase * 0.5;
    
    // Wobble the swirl slightly
    this.swirl.scale.setScalar(1 + Math.sin(time * 12.0) * 0.03);
    this.swirl2.scale.setScalar(1 + Math.cos(time * 9.0) * 0.04);
  }

  dispose() {
    this.ring.geometry.dispose();
    this.glow.geometry.dispose();
    this.inner.geometry.dispose();
    this.swirl.geometry.dispose();
    this.swirl2.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}

export class CarpetPortalSystem {
  readonly group = new Group();
  private readonly globeRadius: number;
  private readonly seed: number;
  private readonly terrainType: string;
  private readonly portals: PortalEndpoint[] = [];
  private lastPlayerWorldPos: Vector3 | null = null;
  private cooldown = 0;
  private time = 0;
  private nextPortalId = 0;

  constructor(globeRadius: number, seed: number, terrainType: string) {
    this.globeRadius = globeRadius;
    this.seed = seed;
    this.terrainType = terrainType;
  }

  placePortal(carpet: Carpet) {
    const qPosition = moveOnSphere(
      carpet.qPosition,
      carpet.heading,
      PORTAL_PLACE_AHEAD / this.globeRadius,
    );
    const frame = tangentFrame(qPosition);
    const minAltitude =
      surfaceAltitudeAt(this.seed, this.terrainType, frame.up.x, frame.up.y, frame.up.z) +
      CARPET_HOVER_HEIGHT;
    const altitude = Math.max(carpet.altitude, minAltitude);
    const worldPosition = cartesianFromSpherical(qPosition, altitude, this.globeRadius);
    const forward = this.headingVector(qPosition, carpet.heading);
    const right = new Vector3().crossVectors(forward, frame.up).normalize();

    const visual = new PortalVisual(
      PORTAL_COLORS[this.nextPortalId % PORTAL_COLORS.length]!,
      this.nextPortalId * 0.73,
    );
    visual.applyPose(worldPosition, right, frame.up, forward);

    if (this.portals.length === 2) {
      const oldest = this.portals.shift()!;
      this.group.remove(oldest.visual.group);
      oldest.visual.dispose();
    }

    this.group.add(visual.group);
    this.portals.push({
      id: this.nextPortalId++,
      qPosition,
      heading: carpet.heading,
      altitude,
      minAltitude,
      worldPosition,
      up: frame.up.clone(),
      forward,
      right,
      visual,
      armed: false,
    });
  }

  syncToCarpet(carpet: Carpet) {
    this.lastPlayerWorldPos = cartesianFromSpherical(
      carpet.qPosition,
      carpet.altitude,
      this.globeRadius,
    );
    this.cooldown = 0;
    const armDistSq = PORTAL_ARM_DISTANCE * PORTAL_ARM_DISTANCE;
    for (const portal of this.portals) {
      portal.armed = this.lastPlayerWorldPos.distanceToSquared(portal.worldPosition) > armDistSq;
    }
  }

  update(dt: number, carpet: Carpet): PortalUpdateResult {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const portal of this.portals) {
      portal.visual.update(this.time);
    }

    const currentWorldPos = cartesianFromSpherical(
      carpet.qPosition,
      carpet.altitude,
      this.globeRadius,
    );

    if (!this.lastPlayerWorldPos) {
      this.lastPlayerWorldPos = currentWorldPos;
      this.updateArming(currentWorldPos);
      return { didTeleport: false };
    }

    this.updateArming(currentWorldPos);

    if (this.cooldown > 0 || this.portals.length < 2) {
      this.lastPlayerWorldPos.copy(currentWorldPos);
      return { didTeleport: false };
    }

    const hit = this.findHit(this.lastPlayerWorldPos, currentWorldPos);
    if (!hit) {
      this.lastPlayerWorldPos.copy(currentWorldPos);
      return { didTeleport: false };
    }

    const entry = this.portals[hit.entryIndex]!;
    const exit = this.portals[hit.entryIndex === 0 ? 1 : 0]!;
    const incomingDir = this.headingVector(carpet.qPosition, carpet.heading);
    const exitHeading = this.mapHeading(incomingDir, entry, exit);
    const exitQPosition = moveOnSphere(
      exit.qPosition,
      exitHeading,
      PORTAL_EXIT_PUSH / this.globeRadius,
    );
    const exitUp = tangentFrame(exitQPosition).up;
    const safeFloor =
      surfaceAltitudeAt(this.seed, this.terrainType, exitUp.x, exitUp.y, exitUp.z) +
      CARPET_HOVER_HEIGHT;
    const exitAltitude = Math.max(exit.altitude, exit.minAltitude, safeFloor);

    carpet.teleportTo(exitQPosition, exitHeading, exitAltitude, carpet.speed);
    this.cooldown = PORTAL_COOLDOWN_SEC;
    for (const portal of this.portals) {
      portal.armed = false;
    }

    this.lastPlayerWorldPos = cartesianFromSpherical(
      carpet.qPosition,
      carpet.altitude,
      this.globeRadius,
    );
    return { didTeleport: true };
  }

  dispose() {
    for (const portal of this.portals) {
      portal.visual.dispose();
    }
    this.portals.length = 0;
    this.group.clear();
    this.lastPlayerWorldPos = null;
  }

  private updateArming(playerWorldPos: Vector3) {
    for (const portal of this.portals) {
      if (!portal.armed && playerWorldPos.distanceToSquared(portal.worldPosition) > PORTAL_ARM_DISTANCE * PORTAL_ARM_DISTANCE) {
        portal.armed = true;
      }
    }
  }

  private findHit(start: Vector3, end: Vector3): { entryIndex: number; t: number } | null {
    let bestHit: { entryIndex: number; t: number } | null = null;
    for (let i = 0; i < this.portals.length; i++) {
      const portal = this.portals[i]!;
      if (!portal.armed) continue;
      const t = this.segmentPortalIntersection(start, end, portal);
      if (t === null) continue;
      if (!bestHit || t < bestHit.t) {
        bestHit = { entryIndex: i, t };
      }
    }
    return bestHit;
  }

  private segmentPortalIntersection(start: Vector3, end: Vector3, portal: PortalEndpoint): number | null {
    const seg = end.clone().sub(start);
    const denom = portal.forward.dot(seg);
    if (Math.abs(denom) < 1e-5) return null;

    const startDepth = portal.forward.dot(start.clone().sub(portal.worldPosition));
    const endDepth = portal.forward.dot(end.clone().sub(portal.worldPosition));
    if (startDepth * endDepth > 0) return null;

    const t = -startDepth / denom;
    if (t < 0 || t > 1) return null;

    const hitPoint = start.clone().addScaledVector(seg, t);
    const relative = hitPoint.sub(portal.worldPosition);
    const rightDist = relative.dot(portal.right);
    const upDist = relative.dot(portal.up);
    const radial = Math.sqrt(rightDist * rightDist + upDist * upDist);
    if (radial > PORTAL_TRIGGER_RADIUS) return null;

    return t;
  }

  private mapHeading(incomingDir: Vector3, entry: PortalEndpoint, exit: PortalEndpoint): number {
    const mappedDir = exit.forward.clone().multiplyScalar(incomingDir.dot(entry.forward));
    mappedDir.addScaledVector(exit.right, incomingDir.dot(entry.right));
    mappedDir.addScaledVector(exit.up, incomingDir.dot(entry.up));
    mappedDir.addScaledVector(exit.up, -mappedDir.dot(exit.up));
    if (mappedDir.lengthSq() < 1e-5) {
      mappedDir.copy(exit.forward);
    } else {
      mappedDir.normalize();
    }

    const exitFrame = tangentFrame(exit.qPosition);
    const heading = Math.atan2(
      mappedDir.dot(exitFrame.east),
      mappedDir.dot(exitFrame.north),
    );
    return ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  private headingVector(qPosition: Carpet["qPosition"], heading: number): Vector3 {
    const frame = tangentFrame(qPosition);
    return new Vector3()
      .addScaledVector(frame.north, Math.cos(heading))
      .addScaledVector(frame.east, Math.sin(heading))
      .normalize();
  }
}
