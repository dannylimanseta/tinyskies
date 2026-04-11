export class TransitionOverlay {
  private el: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    Object.assign(this.el.style, {
      position: "absolute",
      inset: "0",
      background: "#000",
      opacity: "0",
      pointerEvents: "none",
      transition: "opacity 0.5s ease",
      zIndex: "9999",
    } as CSSStyleDeclaration);
    container.appendChild(this.el);
  }

  fadeOut(): Promise<void> {
    return new Promise((resolve) => {
      this.el.style.opacity = "1";
      this.el.addEventListener("transitionend", () => resolve(), { once: true });
    });
  }

  fadeIn(): Promise<void> {
    return new Promise((resolve) => {
      // Re-enable CSS transition in case setOpacity() disabled it.
      this.el.style.transition = "opacity 0.8s ease";
      // Force a reflow so the browser registers the restored transition
      // before we change the opacity value.
      void this.el.offsetHeight;
      this.el.style.opacity = "0";
      this.el.addEventListener("transitionend", () => resolve(), { once: true });
    });
  }

  /** Set opacity instantly (no CSS transition). Useful for frame-by-frame control. */
  setOpacity(v: number) {
    this.el.style.transition = "none";
    this.el.style.opacity = String(Math.max(0, Math.min(1, v)));
  }

  dispose() {
    this.el.remove();
  }
}
