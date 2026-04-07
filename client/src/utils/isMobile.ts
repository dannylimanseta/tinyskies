export function isMobile(): boolean {
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const smallScreen = window.innerWidth <= 1024;
  return hasTouch && smallScreen;
}
