import {
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhongMaterial,
  SphereGeometry,
} from "three";

const MOVE_SPEED = 3.5;
const TURN_LERP = 10;

/* ── Warm, pastel Animal-Crossing palette ─────────────────── */

const SKIN = 0xffddc0;
const EYE = 0x2d1b0e;
const CHEEK = 0xff9999;
const OUTFIT = 0xc4a882;
const BOOT = 0x6b4c3b;
const HAIR = 0x7b5b3a;
const HAT = 0x8b6f4e;
const HAT_BAND = 0x5c4033;

export class PilotAvatar {
  readonly group = new Group();

  /** Inner pivot for bounce/waddle without touching world position. */
  private pivot = new Group();

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
  private blinkTimer = 2.5 + Math.random() * 3;
  private blinkPhase = 0;
  private currentHeading = 0;
  private scarfColor: number;

  private readonly HEAD_Y = 0.88;
  private readonly BODY_Y = 0.38;
  private readonly ARM_Y = 0.42;

  constructor(scarfColor: number = 0xff4444) {
    this.scarfColor = scarfColor;
    this.group.add(this.pivot);
    this.buildMesh();
  }

  /* ── Mesh construction ────────────────────────────────────── */

  private buildMesh() {
    const phong = (color: number) =>
      new MeshPhongMaterial({ color, flatShading: true });
    const smooth = (color: number) =>
      new MeshPhongMaterial({ color });

    /* ── Head (big chibi sphere) ──────────────────────── */
    const head = new Mesh(new SphereGeometry(0.4, 16, 14), smooth(SKIN));
    head.scale.y = 0.93;
    this.headGroup.add(head);

    /* ── Aviator cap ─────────────────────────────────── */
    const capMat = phong(HAT);
    const cap = new Mesh(
      new SphereGeometry(0.41, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.48),
      capMat,
    );
    cap.position.y = 0.04;
    this.headGroup.add(cap);

    const band = new Mesh(
      new CylinderGeometry(0.41, 0.41, 0.035, 14),
      phong(HAT_BAND),
    );
    band.position.y = 0.04;
    this.headGroup.add(band);

    const flapGeo = new CapsuleGeometry(0.055, 0.1, 4, 6);
    const leftFlap = new Mesh(flapGeo, capMat);
    leftFlap.position.set(-0.33, -0.04, 0);
    leftFlap.rotation.z = 0.3;
    this.headGroup.add(leftFlap);

    const rightFlap = new Mesh(flapGeo, capMat);
    rightFlap.position.set(0.33, -0.04, 0);
    rightFlap.rotation.z = -0.3;
    this.headGroup.add(rightFlap);

    /* ── Hair tufts peeking from cap ─────────────────── */
    const hairMat = phong(HAIR);
    const tuftGeo = new SphereGeometry(0.07, 6, 5);

    for (const xOff of [-0.16, 0.16]) {
      const tuft = new Mesh(tuftGeo, hairMat);
      tuft.position.set(xOff, -0.02, 0.32);
      tuft.scale.set(1.0, 0.55, 0.65);
      this.headGroup.add(tuft);
    }

    const centerTuft = new Mesh(
      new SphereGeometry(0.06, 5, 4),
      hairMat,
    );
    centerTuft.position.set(0, 0.08, 0.35);
    centerTuft.scale.set(0.8, 0.5, 0.6);
    this.headGroup.add(centerTuft);

    /* ── Eyes (big round beads) ───────────────────────── */
    const eyeGeo = new SphereGeometry(0.082, 10, 8);
    const eyeMat = smooth(EYE);

    this.leftEye = new Mesh(eyeGeo, eyeMat);
    this.leftEye.position.set(-0.15, -0.02, 0.34);
    this.headGroup.add(this.leftEye);

    this.rightEye = new Mesh(eyeGeo, eyeMat);
    this.rightEye.position.set(0.15, -0.02, 0.34);
    this.headGroup.add(this.rightEye);

    /* ── Eye highlights (large = cuter) ──────────────── */
    const hlMat = new MeshPhongMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.5,
    });

    const hl1Geo = new SphereGeometry(0.035, 6, 6);
    const leftHl = new Mesh(hl1Geo, hlMat);
    leftHl.position.set(-0.12, 0.01, 0.40);
    this.headGroup.add(leftHl);

    const rightHl = new Mesh(hl1Geo, hlMat);
    rightHl.position.set(0.18, 0.01, 0.40);
    this.headGroup.add(rightHl);

    const hl2Geo = new SphereGeometry(0.017, 4, 4);
    const leftHl2 = new Mesh(hl2Geo, hlMat);
    leftHl2.position.set(-0.17, -0.04, 0.39);
    this.headGroup.add(leftHl2);

    const rightHl2 = new Mesh(hl2Geo, hlMat);
    rightHl2.position.set(0.13, -0.04, 0.39);
    this.headGroup.add(rightHl2);

    /* ── Tiny nose ────────────────────────────────────── */
    const nose = new Mesh(
      new SphereGeometry(0.025, 6, 5),
      smooth(0xeec8a0),
    );
    nose.position.set(0, -0.1, 0.37);
    this.headGroup.add(nose);

    /* ── Rosy cheeks ──────────────────────────────────── */
    const cheekGeo = new SphereGeometry(0.065, 8, 6);
    const cheekMat = new MeshPhongMaterial({
      color: CHEEK,
      transparent: true,
      opacity: 0.5,
    });

    const leftCheek = new Mesh(cheekGeo, cheekMat);
    leftCheek.position.set(-0.25, -0.1, 0.24);
    leftCheek.scale.set(1.0, 0.5, 0.4);
    this.headGroup.add(leftCheek);

    const rightCheek = new Mesh(cheekGeo, cheekMat);
    rightCheek.position.set(0.25, -0.1, 0.24);
    rightCheek.scale.set(1.0, 0.5, 0.4);
    this.headGroup.add(rightCheek);

    this.headGroup.position.y = this.HEAD_Y;
    this.pivot.add(this.headGroup);

    /* ── Body (small round capsule) ───────────────────── */
    this.bodyMesh = new Mesh(
      new CapsuleGeometry(0.2, 0.12, 8, 10),
      phong(OUTFIT),
    );
    this.bodyMesh.position.y = this.BODY_Y;
    this.pivot.add(this.bodyMesh);

    /* ── Scarf ───────────────────────────────────────── */
    const scarfMat = phong(this.scarfColor);

    const scarfRing = new Mesh(
      new CylinderGeometry(0.22, 0.22, 0.055, 10),
      scarfMat,
    );
    scarfRing.position.y = 0.56;
    this.pivot.add(scarfRing);

    this.scarfTail = new Mesh(
      new CapsuleGeometry(0.032, 0.18, 4, 4),
      scarfMat,
    );
    this.scarfTail.position.set(0, 0.50, -0.18);
    this.scarfTail.rotation.x = 0.4;
    this.pivot.add(this.scarfTail);

    /* ── Arms (tiny nubs) ────────────────────────────── */
    const armGeo = new CapsuleGeometry(0.055, 0.1, 4, 6);
    const armMat = phong(OUTFIT);

    const leftArmMesh = new Mesh(armGeo, armMat);
    leftArmMesh.position.y = -0.06;
    this.leftArm.add(leftArmMesh);
    this.leftArm.position.set(-0.26, this.ARM_Y, 0);
    this.leftArm.rotation.z = 0.2;
    this.pivot.add(this.leftArm);

    const rightArmMesh = new Mesh(armGeo, armMat);
    rightArmMesh.position.y = -0.06;
    this.rightArm.add(rightArmMesh);
    this.rightArm.position.set(0.26, this.ARM_Y, 0);
    this.rightArm.rotation.z = -0.2;
    this.pivot.add(this.rightArm);

    /* ── Legs (short stumps + rounded feet) ──────────── */
    const legGeo = new CapsuleGeometry(0.075, 0.05, 4, 6);
    const legMat = phong(OUTFIT);
    const bootMat = phong(BOOT);
    const footGeo = new SphereGeometry(0.085, 6, 5);

    const leftLegMesh = new Mesh(legGeo, legMat);
    leftLegMesh.position.y = -0.04;
    this.leftLeg.add(leftLegMesh);

    const leftFoot = new Mesh(footGeo, bootMat);
    leftFoot.position.set(0, -0.09, 0.015);
    leftFoot.scale.set(0.85, 0.5, 1.1);
    this.leftLeg.add(leftFoot);

    this.leftLeg.position.set(-0.11, 0.14, 0);
    this.pivot.add(this.leftLeg);

    const rightLegMesh = new Mesh(legGeo, legMat);
    rightLegMesh.position.y = -0.04;
    this.rightLeg.add(rightLegMesh);

    const rightFoot = new Mesh(footGeo, bootMat);
    rightFoot.position.set(0, -0.09, 0.015);
    rightFoot.scale.set(0.85, 0.5, 1.1);
    this.rightLeg.add(rightFoot);

    this.rightLeg.position.set(0.11, 0.14, 0);
    this.pivot.add(this.rightLeg);

    this.group.scale.setScalar(0.6);
  }

  /* ── Update ────────────────────────────────────────────────── */

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

      this.walkTime += dt * 9;
      this.idleTime = 0;
      this.animateWalk();
    } else {
      this.walkTime = 0;
      this.idleTime += dt;
      this.animateIdle(dt);
    }

    this.animateScarf(dt, isMoving);
    this.animateBlink(dt);
  }

  /* ── Walk: bouncy hop + waddle + squash-stretch ──────────── */

  private animateWalk() {
    const t = this.walkTime;

    const bounce = Math.abs(Math.sin(t)) * 0.055;
    this.pivot.position.y = bounce;

    const squashAmt = Math.abs(Math.sin(t));
    this.bodyMesh.scale.set(
      1 + squashAmt * 0.03,
      1 - squashAmt * 0.05,
      1 + squashAmt * 0.03,
    );

    const waddle = Math.sin(t) * 0.045;
    this.pivot.rotation.z = waddle;
    this.headGroup.rotation.z = -waddle * 0.3;

    const legSwing = Math.sin(t) * 0.22;
    this.leftLeg.rotation.x = legSwing;
    this.rightLeg.rotation.x = -legSwing;

    const armSwing = Math.sin(t) * 0.14;
    this.leftArm.rotation.x = -armSwing;
    this.rightArm.rotation.x = armSwing;

    this.headGroup.position.y = this.HEAD_Y;
  }

  /* ── Idle: gentle breathing + sway ───────────────────────── */

  private animateIdle(dt: number) {
    this.pivot.position.y *= Math.max(0, 1 - dt * 10);
    this.pivot.rotation.z *= Math.max(0, 1 - dt * 10);

    this.leftLeg.rotation.x = 0;
    this.rightLeg.rotation.x = 0;
    this.leftArm.rotation.x = 0;
    this.rightArm.rotation.x = 0;

    const breath = Math.sin(this.idleTime * 1.8) * 0.012;
    this.bodyMesh.scale.set(
      1 - breath * 0.4,
      1 + breath,
      1 - breath * 0.4,
    );
    this.headGroup.position.y = this.HEAD_Y + breath * 2.5;

    const sway = Math.sin(this.idleTime * 0.7) * 0.012;
    this.headGroup.rotation.z = sway;
  }

  /* ── Blink ────────────────────────────────────────────────── */

  private animateBlink(dt: number) {
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase === 0) {
      this.blinkPhase = 0.15;
    }
    if (this.blinkPhase > 0) {
      this.blinkPhase -= dt;
      const shut = this.blinkPhase > 0.075;
      const sy = shut ? 0.08 : 1;
      this.leftEye.scale.y = sy;
      this.rightEye.scale.y = sy;
      if (this.blinkPhase <= 0) {
        this.blinkPhase = 0;
        this.leftEye.scale.y = 1;
        this.rightEye.scale.y = 1;
        this.blinkTimer = 2 + Math.random() * 3;
      }
    }
  }

  /* ── Scarf flutter ────────────────────────────────────────── */

  private animateScarf(dt: number, moving: boolean) {
    const time = moving ? this.walkTime : this.idleTime;
    const freq = moving ? 6 : 1.5;
    const amp = moving ? 0.3 : 0.08;
    this.scarfTail.rotation.x = 0.4 + Math.sin(time * freq) * amp;
    this.scarfTail.rotation.z = Math.sin(time * freq * 0.7 + 1.0) * amp * 0.4;
  }

  /* ── Public API ───────────────────────────────────────────── */

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
