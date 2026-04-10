import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhongMaterial,
  SphereGeometry,
} from "three";

const MOVE_SPEED = 3.5;
const TURN_LERP  = 10;

/* ── Palette ─────────────────────────────────────────────── */

const SKIN     = 0xffd5aa;
const EYE      = 0x1c1008;
const NOSE_COL = 0xe07535;   // warm orange — the iconic AC triangle nose
const CHEEK    = 0xff8080;
const HAIR     = 0x7b5230;
const HAT      = 0x8c6848;
const HAT_BAND = 0x4e3020;
const OUTFIT   = 0xb89a6e;
const PANTS    = 0x4a5a78;   // dark trousers
const BOOT     = 0x5c3a1e;

/* ── Rig constants — local space, pre-scale ──────────────── */

const HEAD_R     = 0.40;
const HEAD_Y     = 1.52;   // head group position  (head top = 1.92)

const BODY_BOT_Y = 0.62;   // bottom of torso cylinder  (= hip joint)
const BODY_H     = 0.50;   // torso height               (top = 1.12)
const SHOULDER_Y = 1.07;   // arm pivot

const HIP_Y      = 0.62;   // leg pivot

/* ── Proportions check:
 *   head  = 0.80  (40% of 1.92)
 *   body  = 0.50  (26%)
 *   legs  = 0.62  (32%)
 *   total ≈ 1.92 → ~2.4 heads tall  — matches AC reference
 * ─────────────────────────────────────────────────────────── */

export class PilotAvatar {
  readonly group = new Group();

  /** Inner pivot — carries all bounce/sway without touching world position. */
  private readonly pivot = new Group();

  private readonly headGroup = new Group();
  private bodyMesh!: Mesh;
  private readonly leftArm  = new Group();
  private readonly rightArm = new Group();
  private readonly leftLeg  = new Group();
  private readonly rightLeg = new Group();

  private scarfTail!: Mesh;
  private leftEye!:  Mesh;
  private rightEye!: Mesh;

  private walkTime  = 0;
  private idleTime  = 0;
  private blinkTimer = 2 + Math.random() * 3;
  private blinkPhase = 0;
  private currentHeading = 0;
  private readonly scarfColor: number;

  private isJumping    = false;
  private jumpTime     = 0;
  private landingSquash = 0;
  private readonly JUMP_DUR = 0.58;
  private readonly JUMP_H   = 0.55;  // pre-scale arc height

  constructor(scarfColor = 0xff4444) {
    this.scarfColor = scarfColor;
    this.group.add(this.pivot);
    this.buildMesh();
  }

  /* ── Mesh ─────────────────────────────────────────────────── */

  private buildMesh() {
    const phong  = (c: number) => new MeshPhongMaterial({ color: c, flatShading: true });
    const smooth = (c: number) => new MeshPhongMaterial({ color: c });

    /* ── HEAD — large round sphere, slightly front-flattened ── */
    const headMesh = new Mesh(new SphereGeometry(HEAD_R, 18, 14), smooth(SKIN));
    headMesh.scale.set(1.0, 0.95, 0.97);
    this.headGroup.add(headMesh);

    /* ── AVIATOR CAP — dome over upper hemisphere ────────────── */
    const capMat = phong(HAT);
    const cap = new Mesh(
      new SphereGeometry(HEAD_R + 0.018, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.50),
      capMat,
    );
    cap.position.y = 0.02;
    this.headGroup.add(cap);

    const band = new Mesh(
      new CylinderGeometry(HEAD_R + 0.018, HEAD_R + 0.018, 0.045, 14),
      phong(HAT_BAND),
    );
    band.position.y = 0.02;
    this.headGroup.add(band);

    /* ear flaps */
    const flapGeo = new CapsuleGeometry(0.065, 0.14, 4, 6);
    for (const s of [-1, 1] as const) {
      const flap = new Mesh(flapGeo, capMat);
      flap.position.set(s * (HEAD_R + 0.02), -0.06, 0);
      flap.rotation.z = -s * 0.22;
      this.headGroup.add(flap);
    }

    /* ── HAIR — small tufts at the forehead under the cap ────── */
    const hairMat = phong(HAIR);
    for (const [x, yOff] of [[-0.20, 0], [0, 0.06], [0.20, 0]] as [number, number][]) {
      const tuft = new Mesh(new SphereGeometry(0.072, 6, 4), hairMat);
      tuft.position.set(x, -0.10 + yOff, HEAD_R - 0.08);
      tuft.scale.set(1, 0.44, 0.52);
      this.headGroup.add(tuft);
    }

    /* ── EYES — large tall oval discs, AC signature ────────────
     *  SphereGeometry scaled (width=0.70, height=1.0, depth=0.26)
     *  gives a flat oval pressed against the face surface.
     *  No white-circle highlights — specular on the material creates
     *  a natural glint from the scene lights.
     * ──────────────────────────────────────────────────────────*/
    const eyeMat = new MeshPhongMaterial({
      color: EYE,
      specular: 0x555555,
      shininess: 80,
    });
    const eyeGeo = new SphereGeometry(0.110, 14, 11);

    this.leftEye  = new Mesh(eyeGeo, eyeMat);
    this.rightEye = new Mesh(eyeGeo, eyeMat);

    this.leftEye.scale.set(0.68, 1.0, 0.24);
    this.rightEye.scale.set(0.68, 1.0, 0.24);

    this.leftEye.position.set(-0.160, -0.06, HEAD_R * 0.90);
    this.rightEye.position.set( 0.160, -0.06, HEAD_R * 0.90);

    this.headGroup.add(this.leftEye, this.rightEye);

    /* ── NOSE — downward-pointing orange triangle ──────────────
     *  ConeGeometry(r, h, 3) = triangular pyramid, apex at +Y.
     *  rotation.set(PI/2, 0, -PI/2) orients the apex forward (+Z)
     *  and rotates the base triangle so the single vertex points DOWN,
     *  two at top-left / top-right — the classic ▽ AC nose.
     * ──────────────────────────────────────────────────────────*/
    const nose = new Mesh(
      new ConeGeometry(0.040, 0.058, 3),
      phong(NOSE_COL),
    );
    nose.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    nose.position.set(0, -0.09, HEAD_R * 0.90);
    this.headGroup.add(nose);

    /* ── CHEEKS ───────────────────────────────────────────────── */
    const cheekMat = new MeshPhongMaterial({ color: CHEEK, transparent: true, opacity: 0.40 });
    for (const s of [-1, 1] as const) {
      const ck = new Mesh(new SphereGeometry(0.090, 8, 6), cheekMat);
      ck.position.set(s * 0.26, -0.15, HEAD_R * 0.74);
      ck.scale.set(1.0, 0.52, 0.36);
      this.headGroup.add(ck);
    }

    this.headGroup.position.y = HEAD_Y;
    this.pivot.add(this.headGroup);

    /* ── BODY — short wide cylinder (barrel silhouette) ─────────
     *  Slightly wider at shoulders than waist.
     *  NO neck gap — head sits directly on top of the cylinder.
     * ──────────────────────────────────────────────────────────*/
    this.bodyMesh = new Mesh(
      new CylinderGeometry(0.255, 0.220, BODY_H, 10),
      phong(OUTFIT),
    );
    this.bodyMesh.position.y = BODY_BOT_Y + BODY_H * 0.5;   // = 0.87
    this.pivot.add(this.bodyMesh);

    /* ── SCARF — collar ring + dangling tail ─────────────────── */
    const scarfMat = phong(this.scarfColor);
    const ring = new Mesh(
      new CylinderGeometry(0.27, 0.27, 0.068, 10),
      scarfMat,
    );
    ring.position.y = BODY_BOT_Y + BODY_H - 0.04;   // near body top = 1.08
    this.pivot.add(ring);

    this.scarfTail = new Mesh(
      new CapsuleGeometry(0.034, 0.22, 4, 5),
      scarfMat,
    );
    this.scarfTail.position.set(0, BODY_BOT_Y + BODY_H - 0.16, -0.24);
    this.scarfTail.rotation.x = 0.5;
    this.pivot.add(this.scarfTail);

    /* ── ARMS — full length to mid-thigh, with hands ────────────
     *  Pivot at shoulder. Arm capsule + hand sphere hang downward
     *  so rotation.x creates a clean shoulder swing.
     * ──────────────────────────────────────────────────────────*/
    const armMat  = phong(OUTFIT);
    const handGeo = new SphereGeometry(0.070, 8, 6);
    const armGeo  = new CapsuleGeometry(0.070, 0.26, 4, 8);

    for (const s of [-1, 1] as const) {
      const arm = s === -1 ? this.leftArm : this.rightArm;
      const armMesh = new Mesh(armGeo, armMat);
      armMesh.position.y = -0.15;
      arm.add(armMesh);

      const hand = new Mesh(handGeo, smooth(SKIN));
      hand.position.y = -0.30;
      hand.scale.set(0.88, 0.74, 0.92);
      arm.add(hand);

      arm.position.set(s * 0.31, SHOULDER_Y, 0);
      arm.rotation.z = s * 0.18;
      this.pivot.add(arm);
    }

    /* ── LEGS — thigh (pants) + shin + boot ─────────────────────
     *  Pivot at hip. Three stacked segments per leg give visible
     *  length and a clear thigh / lower-leg / shoe read.
     * ──────────────────────────────────────────────────────────*/
    const thighGeo = new CapsuleGeometry(0.090, 0.20, 4, 8);
    const shinGeo  = new CapsuleGeometry(0.078, 0.17, 4, 8);
    const shoeGeo  = new SphereGeometry(0.094, 8, 6);

    for (const s of [-1, 1] as const) {
      const leg = s === -1 ? this.leftLeg : this.rightLeg;

      /* thigh */
      const thigh = new Mesh(thighGeo, phong(PANTS));
      thigh.position.y = -0.15;
      leg.add(thigh);

      /* shin */
      const shin = new Mesh(shinGeo, phong(OUTFIT));
      shin.position.y = -0.37;
      leg.add(shin);

      /* boot/shoe — flattened sphere for that chunky low-poly shoe */
      const shoe = new Mesh(shoeGeo, phong(BOOT));
      shoe.position.set(0, -0.55, 0.025);
      shoe.scale.set(0.84, 0.50, 1.24);
      leg.add(shoe);

      leg.position.set(s * 0.13, HIP_Y, 0);
      this.pivot.add(leg);
    }

    this.group.scale.setScalar(0.55);
  }

  /* ── Update ──────────────────────────────────────────────────── */

  update(dt: number, moveX: number, moveZ: number, bounds: number, jump = false) {
    const isMoving = Math.abs(moveX) > 0.01 || Math.abs(moveZ) > 0.01;

    if (isMoving) {
      const targetHeading = Math.atan2(moveX, moveZ);
      this.currentHeading = lerpAngle(this.currentHeading, targetHeading, TURN_LERP * dt);
      this.group.rotation.y = this.currentHeading;

      const speed = MOVE_SPEED * dt;
      this.group.position.x += moveX * speed;
      this.group.position.z += moveZ * speed;
      const half = bounds * 0.5;
      this.group.position.x = Math.max(-half, Math.min(half, this.group.position.x));
      this.group.position.z = Math.max(-half, Math.min(half, this.group.position.z));

      this.walkTime += dt * 10;
      this.idleTime  = 0;
      this.animateWalk();
    } else {
      this.idleTime += dt;
      this.walkTime  = 0;
      this.animateIdle(dt);
    }

    /* trigger jump (only when not already airborne) */
    if (jump && !this.isJumping) {
      this.isJumping  = true;
      this.jumpTime   = 0;
    }

    /* jump arc — owns pivot.position.y exclusively while airborne so the
     * walk bob underneath can't shrink the visible height */
    if (this.isJumping) {
      this.jumpTime += dt;
      const t = this.jumpTime / this.JUMP_DUR;
      if (t >= 1) {
        this.isJumping     = false;
        this.jumpTime      = 0;
        this.landingSquash = 1;
      } else {
        const arc = Math.sin(t * Math.PI);

        /* override Y — consistent height whether walking or standing */
        this.pivot.position.y = arc * this.JUMP_H;

        /* front/back leg split: left kicks forward, right kicks back */
        const split = arc * 0.70;
        this.leftLeg.rotation.x  = -split;
        this.rightLeg.rotation.x =  split;

        /* arms counter-swing to match legs (opposite phase) */
        const armFlight = arc * 0.40;
        this.leftArm.rotation.x  =  armFlight;
        this.rightArm.rotation.x = -armFlight;
      }
    }

    /* landing squash — decays back to neutral */
    this.landingSquash = Math.max(0, this.landingSquash - dt * 7);
    if (this.landingSquash > 0) {
      const sq = this.landingSquash;
      this.bodyMesh.scale.set(1 + sq * 0.10, 1 - sq * 0.13, 1 + sq * 0.10);
    }

    this.animateScarf(isMoving);
    this.animateBlink(dt);
  }

  /* ── Walk — AC lateral hip-sway ──────────────────────────────
   *
   *  The defining motion is the SIDE-TO-SIDE body rock, not a
   *  vertical bounce.  The whole pivot shifts left/right with
   *  each step while the torso tilts in the same direction — the
   *  classic penguin waddle.  Vertical bounce is very small (≈2%).
   *  Leg swing is moderate (short stride, feet barely lift).
   *  Arms stay close and swing gently.
   *  Head counter-tilts to remain roughly level.
   *
   * ─────────────────────────────────────────────────────────── */
  private animateWalk() {
    const t  = this.walkTime;
    const sw = Math.sin(t);  // oscillates -1..1 per step

    /* PRIMARY: whole body rocks left / right (local X = perpendicular to travel) */
    this.pivot.position.x = sw * 0.065;

    /* Torso tilts in the direction of the sway */
    this.pivot.rotation.z = sw * 0.085;

    /* Vertical hop — skipped while airborne so jump owns Y exclusively */
    if (!this.isJumping) {
      this.pivot.position.y = Math.abs(sw) * 0.08;
    }

    /* Head counter-tilts to stay roughly level */
    this.headGroup.position.y = HEAD_Y;
    this.headGroup.rotation.z = -sw * 0.035;

    /* Legs — short stride, moderate swing */
    const legSwing = sw * 0.30;
    this.leftLeg.rotation.x  =  legSwing;
    this.rightLeg.rotation.x = -legSwing;

    /* Arms — close to body, tight swing */
    const armSwing = sw * 0.12;
    this.leftArm.rotation.x  = -armSwing;
    this.rightArm.rotation.x =  armSwing;
  }

  /* ── Idle — gentle breathing + sleepy head sway ──────────── */

  private animateIdle(dt: number) {
    const decay = Math.max(0, 1 - dt * 14);
    this.pivot.position.x *= decay;
    this.pivot.rotation.z *= decay;
    /* don't touch Y while airborne — jump owns it */
    if (!this.isJumping) this.pivot.position.y *= decay;

    this.leftLeg.rotation.x  *= decay;
    this.rightLeg.rotation.x *= decay;
    this.leftArm.rotation.x  *= decay;
    this.rightArm.rotation.x *= decay;

    const breath = Math.sin(this.idleTime * 1.6) * 0.013;
    this.bodyMesh.scale.set(1 - breath * 0.28, 1 + breath, 1 - breath * 0.28);
    this.headGroup.position.y = HEAD_Y + breath * 3.2;
    this.headGroup.rotation.z = Math.sin(this.idleTime * 0.6) * 0.016;
  }

  /* ── Blink ────────────────────────────────────────────────── */

  private animateBlink(dt: number) {
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase === 0) {
      this.blinkPhase = 0.14;
    }
    if (this.blinkPhase > 0) {
      this.blinkPhase -= dt;
      const shut = this.blinkPhase > 0.07;
      const sy = shut ? 0.07 : 1;
      this.leftEye.scale.y  = sy;
      this.rightEye.scale.y = sy;
      if (this.blinkPhase <= 0) {
        this.blinkPhase = 0;
        this.leftEye.scale.y  = 1;
        this.rightEye.scale.y = 1;
        this.blinkTimer = 2 + Math.random() * 3.5;
      }
    }
  }

  /* ── Scarf flutter ────────────────────────────────────────── */

  private animateScarf(moving: boolean) {
    const time = moving ? this.walkTime : this.idleTime;
    const freq = moving ? 5.5 : 1.4;
    const amp  = moving ? 0.28 : 0.07;
    this.scarfTail.rotation.x = 0.5 + Math.sin(time * freq) * amp;
    this.scarfTail.rotation.z = Math.sin(time * freq * 0.7 + 1.1) * amp * 0.35;
  }

  /* ── Public API ───────────────────────────────────────────── */

  setPosition(x: number, z: number) {
    this.group.position.set(x, 0, z);
  }

  dispose() {
    this.group.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        if (child.material instanceof MeshPhongMaterial) child.material.dispose();
      }
    });
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * Math.min(1, t);
}
