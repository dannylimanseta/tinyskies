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
      this.el.style.opacity = "0";
      this.el.addEventListener("transitionend", () => resolve(), { once: true });
    });
  }

  dispose() {
    this.el.remove();
  }
}
