import { inject } from "@vercel/analytics";
import { Game } from "./game/Game";
import { ProgressionManager } from "./game/ProgressionManager";

// Initialize Vercel Web Analytics
inject();

if (import.meta.env.DEV) {
  const params = new URLSearchParams(window.location.search);
  if (params.has("clearSave")) {
    ProgressionManager.clearAll();
    params.delete("clearSave");
    const q = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`,
    );
  }
}

const app = document.getElementById("app")!;
const game = new Game(app);
game.start();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    game.dispose();
    app.innerHTML = "";
  });
}
