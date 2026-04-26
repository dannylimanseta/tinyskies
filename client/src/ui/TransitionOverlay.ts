export type TransitionFadeOutOptions = {
  /** Time to go from current opacity to fully black. Default 0.5s. */
  durationSec?: number;
  /** Centered on top of the black overlay, cleared in {@link fadeIn} / {@link setMessage}. */
  message?: string;
  /** Extra time to keep full black (and message) before resolving. */
  holdAtFullSec?: number;
};

export class TransitionOverlay {
  private el: HTMLDivElement;
  private labelEl: HTMLDivElement | null = null;

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

  setMessage(text: string | null) {
    if (text) {
      if (!this.labelEl) {
        this.labelEl = document.createElement("div");
        Object.assign(this.labelEl.style, {
          position: "absolute",
          inset: "0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          fontFamily: "'Domine', Georgia, serif",
          fontSize: "1.45rem",
          fontWeight: "500",
          letterSpacing: "0.04em",
          lineHeight: "1.5",
          textAlign: "center",
          whiteSpace: "pre-line",
          maxWidth: "min(32rem, 92vw)",
          minWidth: "0",
          margin: "0 auto",
          padding: "0 1.25rem",
          boxSizing: "border-box",
          color: "#ede8e3",
        } as CSSStyleDeclaration);
        this.el.appendChild(this.labelEl);
      }
      this.labelEl.textContent = text;
    } else {
      if (this.labelEl) {
        this.labelEl.textContent = "";
        this.labelEl.remove();
        this.labelEl = null;
      }
    }
  }

  fadeOut(options?: TransitionFadeOutOptions): Promise<void> {
    const durationSec = options?.durationSec ?? 0.5;
    const holdAtFullSec = options?.holdAtFullSec ?? 0;
    this.setMessage(options?.message ?? null);
    this.el.style.transition = `opacity ${durationSec}s ease`;
    void this.el.offsetHeight;
    this.el.style.opacity = "1";
    return new Promise((resolve) => {
      this.el.addEventListener(
        "transitionend",
        () => {
          if (holdAtFullSec > 0) {
            setTimeout(resolve, holdAtFullSec * 1000);
          } else {
            resolve();
          }
        },
        { once: true },
      );
    });
  }

  fadeIn(): Promise<void> {
    return new Promise((resolve) => {
      this.setMessage(null);
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
    this.setMessage(null);
    this.el.remove();
  }
}
