import { Game } from "./game/Game";

const app = document.getElementById("app")!;
const game = new Game(app);
game.start();
