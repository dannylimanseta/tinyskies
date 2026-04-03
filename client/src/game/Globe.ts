import {
  Mesh,
  SphereGeometry,
  MeshPhongMaterial,
  ShaderMaterial,
  BackSide,
  AdditiveBlending,
  Group,
  Color,
  ConeGeometry,
  Vector3,
  MathUtils,
  Quaternion,
  type Scene,
} from "three";

const ATMOSPHERE_VERTEX = `
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ATMOSPHERE_FRAGMENT = `
uniform vec3 glowColor;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vec3 viewDir = normalize(-vPosition);
  float rim = 1.0 - dot(vNormal, viewDir);
  float intensity = smoothstep(0.0, 1.0, rim) * pow(rim, 1.5) * 0.35;
  gl_FragColor = vec4(glowColor * intensity, intensity);
}
`;

const TREE_COUNT = 200;
const CLOUD_COUNT = 30;
const CLOUD_ALTITUDE = 0.6;
const CLOUD_DRIFT_SPEED = 0.015;

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export class Globe {
  readonly group = new Group();
  readonly radius: number;
  private surfaceMesh!: Mesh;
  private atmosphereMesh!: Mesh;
  private cloudRing = new Group();
  private cloudDriftAxis = new Vector3(0.2, 1, 0.1).normalize();

  constructor(radius: number = 5, _texture: string = "earth") {
    this.radius = radius;
    this.createSurface();
    this.createTrees();
    this.createClouds();
    this.createAtmosphere();
  }

  private createSurface() {
    const geo = new SphereGeometry(this.radius, 64, 64);
    const mat = new MeshPhongMaterial({
      color: 0x4a8f3f,
      shininess: 8,
      flatShading: true,
    });

    this.surfaceMesh = new Mesh(geo, mat);
    this.surfaceMesh.receiveShadow = true;
    this.group.add(this.surfaceMesh);
  }

  private createTrees() {
    const rand = seededRandom(42);

    const greenShades = [0x2d6b1e, 0x3a8a2a, 0x1e5a14, 0x4a9f38];
    const foliageMats = greenShades.map(
      (c) => new MeshPhongMaterial({ color: c, flatShading: true }),
    );

    for (let i = 0; i < TREE_COUNT; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);

      const surfacePos = new Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      ).multiplyScalar(this.radius);

      const normal = surfacePos.clone().normalize();
      const treeScale = MathUtils.lerp(0.04, 0.1, rand());
      const mat = foliageMats[Math.floor(rand() * foliageMats.length)];

      const coneH = treeScale * 2.5;
      const coneR = treeScale * 0.9;
      const cone = new Mesh(
        new ConeGeometry(coneR, coneH, 5),
        mat,
      );
      cone.castShadow = true;

      cone.position.copy(surfacePos).addScaledVector(normal, coneH * 0.15);
      cone.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal);

      this.group.add(cone);
    }
  }

  private createClouds() {
    const rand = seededRandom(77);
    const cloudMat = new MeshPhongMaterial({
      color: 0xffe8cc,
      transparent: true,
      opacity: 0.25,
      flatShading: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    const puffGeo = new SphereGeometry(1, 6, 5);
    const cloudAlt = this.radius + CLOUD_ALTITUDE;

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const cloud = new Group();

      // 3-5 puffs per cloud cluster
      const puffCount = 3 + Math.floor(rand() * 3);
      for (let p = 0; p < puffCount; p++) {
        const puff = new Mesh(puffGeo, cloudMat);
        const scale = MathUtils.lerp(0.08, 0.18, rand());
        puff.scale.set(
          scale * MathUtils.lerp(1.2, 2.0, rand()),
          scale * MathUtils.lerp(0.5, 0.8, rand()),
          scale * MathUtils.lerp(1.0, 1.5, rand()),
        );
        puff.position.set(
          (rand() - 0.5) * 0.3,
          (rand() - 0.5) * 0.06,
          (rand() - 0.5) * 0.2,
        );
        puff.castShadow = true;
        cloud.add(puff);
      }

      // Place on sphere at cloud altitude
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const pos = new Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      );
      const normal = pos.clone().normalize();

      cloud.position.copy(normal).multiplyScalar(cloudAlt);
      cloud.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal);

      this.cloudRing.add(cloud);
    }

    this.group.add(this.cloudRing);
  }

  private createAtmosphere() {
    const geo = new SphereGeometry(this.radius * 1.25, 48, 48);
    const mat = new ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      uniforms: {
        glowColor: { value: new Color(0xeeddbb) },
      },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });

    this.atmosphereMesh = new Mesh(geo, mat);
    this.group.add(this.atmosphereMesh);
  }

  update(dt: number) {
    const q = new Quaternion().setFromAxisAngle(
      this.cloudDriftAxis,
      CLOUD_DRIFT_SPEED * dt,
    );
    this.cloudRing.quaternion.premultiply(q);
  }

  addTo(scene: Scene) {
    scene.add(this.group);
  }

  dispose() {
    this.surfaceMesh.geometry.dispose();
    (this.surfaceMesh.material as MeshPhongMaterial).dispose();
    this.atmosphereMesh.geometry.dispose();
    (this.atmosphereMesh.material as ShaderMaterial).dispose();
  }
}
