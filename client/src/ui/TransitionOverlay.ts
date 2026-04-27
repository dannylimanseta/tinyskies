export type TransitionFadeOutOptions = {
  /** Time to go from current opacity to fully black. Default 0.5s. */
  durationSec?: number;
  /** Centered on top of the overlay, cleared in {@link fadeIn} / {@link setMessage}. */
  message?: string;
  /** Extra time to hold at full opacity (with message) before resolving. */
  holdAtFullSec?: number;
  /** Overlay background colour. Defaults to '#000' (black). */
  bgColor?: string;
  /** Message text colour. Defaults to '#ede8e3' (near-white). */
  textColor?: string;
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
    const durationSec   = options?.durationSec   ?? 0.5;
    const holdAtFullSec = options?.holdAtFullSec  ?? 0;
    const textColor     = options?.textColor ?? "#ede8e3";

    if (options?.bgColor) this.el.style.background = options.bgColor;
    this.setMessage(null); // clear any old label

    // Split by blank line — if we get multiple sentences, stagger them.
    const rawMsg  = options?.message ?? null;
    const sentences = rawMsg
      ? rawMsg.split("\n\n").map((s) => s.trim()).filter(Boolean)
      : [];
    const stagger = sentences.length > 1;

    if (!stagger && rawMsg) {
      this.setMessage(rawMsg);
      if (this.labelEl) this.labelEl.style.color = textColor;
    }

    this.el.style.transition = `opacity ${durationSec}s ease`;
    void this.el.offsetHeight;
    this.el.style.opacity = "1";

    return new Promise((resolve) => {
      this.el.addEventListener(
        "transitionend",
        () => {
          if (stagger && sentences.length > 0) {
            // Shared container matching the existing label layout.
            const wrap = document.createElement("div");
            Object.assign(wrap.style, {
              position: "absolute",
              inset: "0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              fontFamily: "'Domine', Georgia, serif",
              fontSize: "1.45rem",
              fontWeight: "500",
              letterSpacing: "0.04em",
              lineHeight: "1.6",
              textAlign: "center",
              maxWidth: "min(32rem, 92vw)",
              margin: "0 auto",
              padding: "0 1.25rem",
              boxSizing: "border-box",
              gap: "0.6em",
            } as CSSStyleDeclaration);
            this.el.appendChild(wrap);
            this.labelEl = wrap;

            // Spread sentences evenly across holdAtFullSec.
            const spacing = (holdAtFullSec * 1000) / (sentences.length + 0.4);
            sentences.forEach((text, i) => {
              const p = document.createElement("p");
              p.textContent = text;
              Object.assign(p.style, {
                margin: "0",
                opacity: "0",
                transform: "translateY(10px)",
                transition: "opacity 0.65s ease, transform 0.65s ease",
                color: textColor,
              } as CSSStyleDeclaration);
              wrap.appendChild(p);

              setTimeout(() => {
                p.style.opacity = "1";
                p.style.transform = "translateY(0)";
              }, i * spacing);
            });
          }

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
      this.el.style.background = "#000"; // reset to black for next use
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
