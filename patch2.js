const fs = require('fs');

const file = 'client/src/game/Game.ts';
let code = fs.readFileSync(file, 'utf-8');

code = code.replace(
  `this.audioManager.playSFX(EXPLOSION_SFX_NAME, 0.08 + audibility * 0.18);`,
  `const rate = 0.7 + Math.random() * 0.5;
        this.audioManager.playSFX(EXPLOSION_SFX_NAME, 0.15 + audibility * 0.3, rate);`
);

code = code.replace(
  `this.cameraRig.shake(0.055, 0.3);
        this.vehicleFlashTimer = Math.max(this.vehicleFlashTimer, 0.16);`,
  `this.cameraRig.shake(0.065, 0.35);
        this.vehicleFlashTimer = Math.max(this.vehicleFlashTimer, 0.2);`
);

fs.writeFileSync(file, code);
