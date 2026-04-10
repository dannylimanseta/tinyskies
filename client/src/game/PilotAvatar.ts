import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhongMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";

const MOVE_SPEED = 3.5;
const TURN_LERP = 10;

/* ── Colors ──────────────────────────────────────────────── */

const SKIN = 0xf5deb3;
const EYE = 0x2a1a0a;
const CHEEK = 0xffb0a0;
const GOGGLE_STRAP = 0x5c4033;
const GOGGLE_LENS = 0x88ccee;
const GOGGLE_FRAME = 0x44322a;
const OUTFIT = 0x8b6f47;
const BOOT = 0x4a3728;
const HAIR = 0x5c3a1e;

export class PilotAvatar {
  readonly group = new Group();

  private headGroup = new Group();
  private bodyMesh!: Mesh;
  private leftArm = new Group();
  private rightArm = new Group();
  private leftLeg = new Group();
  private rightLeg = new Group();
  private scarfTail!: Mesh;
  private leftEye!: Mesh;
  private rightEye!: Mesh;

  private walkTime = 0;
  private idleTime = 0;
  private blinkTimer = 3 + Math.random() * 3;
  private blinkPhase = 0;
  private currentHeading = 0;
  private scarfColor: number;

  constructor(scarfColor: number = 0xff4444) {
    this.scarfColor = scarfColor;
    this.buildMesh();
  }

  private buildMesh() {
    const phong = (color: number) =>
      new MeshPhongMaterial({ color, flatShading: true });
    const smooth = (color: number) =>
      new MeshPhongMaterial({ color });

    /* ── Head ────────────────────────────────────────── */
    const headGeo = new SphereGeometry(0.4, 16, 12);
    const head = new Mesh(headGeo, smooth(SKIN));
    head.scale.y = 0.88;
    this.headGroup.add(head);

    /* ── Hair tuft ──────────────────────────────────── */
    const hairMat = phong(HAIR);
    for (let i = 0; i < 3; i++) {
      const tuft = new Mesh(
        new SphereGeometry(0.1 + i * 0.02, 5, 4),
        hairMat,
      );
      tuft.position.set(
        (i - 1) * 0.08,
        0.32 + (1 - Math.abs(i - 1)) * 0.05,
        -0.1,
      );
      tuft.scale.set(1, 0.7, 0.9);
      this.headGroup.add(tuft);
    }

    /* ── Eyes ────────────────────────────────────────── */
    const eyeGeo = new SphereGeometry(0.06, 8, 6);
    const eyeMat = smooth(EYE);
    this.leftEye = new Mesh(eyeGeo, eyeMat);
    this.leftEye.position.set(-0.13, 0.04, 0.34);
    this.headGroup.add(this.leftEye);

    this.rightEye = new Mesh(eyeGeo, eyeMat);
    this.rightEye.position.set(0.13, 0.04, 0.34);
    this.headGroup.add(this.rightEye);

    /* ── Eye highlights ─────────────────────────────── */
    const highlightGeo = new SphereGeometry(0.02, 4, 4);
    const highlightMat = new MeshPhongMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.3,
    });
    const leftHighlight = new Mesh(highlightGeo, highlightMat);
    leftHighlight.position.set(-0.10, 0.07, 0.38);
    this.headGroup.add(leftHighlight);

    const rightHighlight = new Mesh(highlightGeo, highlightMat);
    rightHighlight.position.set(0.16, 0.07, 0.38);
    this.headGroup.add(rightHighlight);

    /* ── Nose ────────────────────────────────────────── */
    const noseGeo = new SphereGeometry(0.04, 6, 5);
    const nose = new Mesh(noseGeo, smooth(SKIN));
    nose.position.set(0, -0.02, 0.38);
    nose.scale.set(0.7, 0.6, 0.6);
    this.headGroup.add(nose);

    /* ── Cheeks ──────────────────────────────────────── */
    const cheekGeo = new SphereGeometry(0.065, 8, 6);
    const cheekMat = new MeshPhongMaterial({
      color: CHEEK,
      transparent: true,
      opacity: 0.6,
    });

    const leftCheek = new Mesh(cheekGeo, cheekMat);
    leftCheek.position.set(-0.22, -0.06, 0.28);
    leftCheek.scale.set(1.1, 0.6, 0.4);
    this.headGroup.add(leftCheek);

    const rightCheek = new Mesh(cheekGeo, cheekMat);
    rightCheek.position.set(0.22, -0.06, 0.28);
    rightCheek.scale.set(1.1, 0.6, 0.4);
    this.headGroup.add(rightCheek);

    /* ── Aviator goggles ────────────────────────────── */
    const strapGeo = new TorusGeometry(0.30, 0.025, 6, 14);
    const strap = new Mesh(strapGeo, phong(GOGGLE_STRAP));
    strap.position.y = 0.18;
    strap.rotation.x = Math.PI / 2 - 0.3;
    this.headGroup.add(strap);

    const frameGeo = new TorusGeometry(0.095, 0.015, 6, 10);
    const frameMat = phong(GOGGLE_FRAME);
    const leftFrame = new Mesh(frameGeo, frameMat);
    leftFrame.position.set(-0.15, 0.22, 0.22);
    leftFrame.rotation.x = Math.PI / 2;
    this.headGroup.add(leftFrame);

    const rightFrame = new Mesh(frameGeo, frameMat);
    rightFrame.position.set(0.15, 0.22, 0.22);
    rightFrame.rotation.x = Math.PI / 2;
    this.headGroup.add(rightFrame);

    const lensGeo = new CylinderGeometry(0.08, 0.08, 0.03, 10);
    const lensMat = new MeshPhongMaterial({
      color: GOGGLE_LENS,
      specular: 0xffffff,
      shininess: 80,
      transparent: true,
      opacity: 0.85,
    });
    const leftLens = new Mesh(lensGeo, lensMat);
    leftLens.position.set(-0.15, 0.22, 0.23);
    leftLens.rotation.x = Math.PI / 2;
    this.headGroup.add(leftLens);

    const rightLens = new Mesh(lensGeo, lensMat);
    rightLens.position.set(0.15, 0.22, 0.23);
    rightLens.rotation.x = Math.PI / 2;
    this.headGroup.add(rightLens);

    const bridgeGeo = new BoxGeometry(0.04, 0.025, 0.02);
    const bridge = new Mesh(bridgeGeo, frameMat);
    bridge.position.set(0, 0.22, 0.28);
    this.headGroup.add(bridge);

    this.headGroup.position.y = 1.15;
    this.group.add(this.headGroup);

    /* ── Body ────────────────────────────────────────── */
    const bodyGeo = new CapsuleGeometry(0.28, 0.35, 6, 8);
    this.bodyMesh = new Mesh(bodyGeo, phong(OUTFIT));
    this.bodyMesh.position.y = 0.65;
    this.group.add(this.bodyMesh);

    /* ── Scarf ───────────────────────────────────────── */
    const scarfMat = phong(this.scarfColor);

    const scarfRing = new Mesh(
      new CylinderGeometry(0.3, 0.3, 0.08, 8),
      scarfMat,
    );
    scarfRing.position.y = 0.92;
    this.group.add(scarfRing);

    const scarfTailGeo = new CapsuleGeometry(0.04, 0.28, 4, 4);
    this.scarfTail = new Mesh(scarfTailGeo, scarfMat);
    this.scarfTail.position.set(0, 0.82, -0.25);
    this.scarfTail.rotation.x = 0.3;
    this.group.add(this.scarfTail);

    /* ── Arms ────────────────────────────────────────── */
    const armGeo = new CapsuleGeometry(0.08, 0.2, 4, 6);
    const armMat = phong(OUTFIT);

    const leftArmMesh = new Mesh(armGeo, armMat);
    leftArmMesh.position.y = -0.12;
    this.leftArm.add(leftArmMesh);
    this.leftArm.position.set(-0.36, 0.72, 0);
    this.leftArm.rotation.z = 0.15;
    this.group.add(this.leftArm);

    const rightArmMesh = new Mesh(armGeo, armMat);
    rightArmMesh.position.y = -0.12;
    this.rightArm.add(rightArmMesh);
    this.rightArm.position.set(0.36, 0.72, 0);
    this.rightArm.rotation.z = -0.15;
    this.group.add(this.rightArm);

    /* ── Legs ────────────────────────────────────────── */
    const legGeo = new CapsuleGeometry(0.1, 0.18, 4, 6);
    const legMat = phong(OUTFIT);

    const leftLegMesh = new Mesh(legGeo, legMat);
    leftLegMesh.position.y = -0.13;
    this.leftLeg.add(leftLegMesh);

    const leftBoot = new Mesh(
      new CylinderGeometry(0.11, 0.12, 0.1, 6),
      phong(BOOT),
    );
    leftBoot.position.y = -0.26;
    this.leftLeg.add(leftBoot);

    this.leftLeg.position.set(-0.14, 0.38, 0);
    this.group.add(this.leftLeg);

    const rightLegMesh = new Mesh(legGeo, legMat);
    rightLegMesh.position.y = -0.13;
    this.rightLeg.add(rightLegMesh);

    const rightBoot = new Mesh(
      new CylinderGeometry(0.11, 0.12, 0.1, 6),
      phong(BOOT),
    );
    rightBoot.position.y = -0.26;
    this.rightLeg.add(rightBoot);

    this.rightLeg.position.set(0.14, 0.38, 0);
    this.group.add(this.rightLeg);

    this.group.scale.setScalar(0.55);
  }

  /* ── Update ────────────────────────────────────────────── */

  update(
    dt: number,
    moveX: number,
    moveZ: number,
    bounds: number,
  ) {
    const isMoving = Math.abs(moveX) > 0.01 || Math.abs(moveZ) > 0.01;

    if (isMoving) {
      const targetHeading = Math.atan2(moveX, moveZ);
      this.currentHeading = lerpAngle(
        this.currentHeading, targetHeading, TURN_LERP * dt,
      );
      this.group.rotation.y = this.currentHeading;

      const speed = MOVE_SPEED * dt;
      this.group.position.x += moveX * speed;
      this.group.position.z += moveZ * speed;

      const half = bounds * 0.5;
      this.group.position.x = Math.max(-half, Math.min(half, this.group.position.x));
      this.group.position.z = Math.max(-half, Math.min(half, this.group.position.z));

      this.walkTime += dt * 8;
      this.animateWalk();
    } else {
      this.walkTime = 0;
      this.resetLimbs();
      this.idleTime += dt;
      this.animateIdle(dt);
    }

    this.animateScarf(dt, isMoving);
    this.animateBlink(dt);
  }

  private animateWalk() {
    const t = this.walkTime;
    const legSwing = Math.sin(t) * 0.26;
    const armSwing = Math.sin(t) * 0.17;
    const bob = Math.abs(Math.sin(t)) * 0.03;

    this.leftLeg.rotation.x = legSwing;
    this.rightLeg.rotation.x = -legSwing;
    this.leftArm.rotation.x = -armSwing;
    this.rightArm.rotation.x = armSwing;
    this.bodyMesh.position.y = 0.65 + bob;
    this.headGroup.position.y = 1.15 + bob;
    this.headGroup.rotation.z = Math.sin(t) * 0.04;
  }

  private resetLimbs() {
    this.leftLeg.rotation.x = 0;
    this.rightLeg.rotation.x = 0;
    this.leftArm.rotation.x = 0;
    this.rightArm.rotation.x = 0;
    this.bodyMesh.position.y = 0.65;
    this.headGroup.position.y = 1.15;
    this.headGroup.rotation.z = 0;
  }

  private animateIdle(dt: number) {
    const breath = Math.sin(this.idleTime * 1.5) * 0.008;
    this.bodyMesh.scale.y = 1 + breath;
    this.headGroup.position.y = 1.15 + breath * 2;
  }

  private animateBlink(dt: number) {
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase === 0) {
      this.blinkPhase = 0.12;
    }
    if (this.blinkPhase > 0) {
      this.blinkPhase -= dt;
      const shut = this.blinkPhase > 0.06;
      const sy = shut ? 0.1 : 1;
      this.leftEye.scale.y = sy;
      this.rightEye.scale.y = sy;
      if (this.blinkPhase <= 0) {
        this.blinkPhase = 0;
        this.leftEye.scale.y = 1;
        this.rightEye.scale.y = 1;
        this.blinkTimer = 2.5 + Math.random() * 4;
      }
    }
  }

  private animateScarf(dt: number, moving: boolean) {
    const time = moving ? this.walkTime : this.idleTime;
    const freq = moving ? 6 : 1.5;
    const amp = moving ? 0.25 : 0.08;
    const wave = Math.sin(time * freq) * amp;
    this.scarfTail.rotation.x = 0.3 + wave;
    this.scarfTail.rotation.z = Math.sin(time * freq * 0.7 + 1.0) * amp * 0.3;
  }

  setPosition(x: number, z: number) {
    this.group.position.set(x, 0, z);
  }

  dispose() {
    this.group.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        if (child.material instanceof MeshPhongMaterial) {
          child.material.dispose();
        }
      }
    });
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * Math.min(1, t);
}
