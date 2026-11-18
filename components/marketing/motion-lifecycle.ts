/** Animation policy shared with the scene's mocked lifecycle checks. */
export interface SceneAnimation {
  play(): void;
  pause(): void;
  cancel(): void;
}
export function manageSceneMotion(element: HTMLElement, start: () => SceneAnimation[]) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const supported = typeof IntersectionObserver !== "undefined";
  let visible = false;
  let paused = false;
  let animations: SceneAnimation[] = [];
  function sync() {
    if (preference.matches || !supported) {
      animations.forEach((animation) => animation.cancel());
      animations = [];
      element.dataset.motion = "static";
      return;
    }
    const running = visible && !document.hidden && !paused;
    if (running && !animations.length) animations = start();
    animations.forEach((animation) => running ? animation.play() : animation.pause());
    element.dataset.motion = running ? "playing" : "paused";
  }
  // Unsupported observers leave a complete static illustration rather than a background loop.
  const observer = !supported ? null : new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  }, { threshold: 0.15 });
  observer?.observe(element);
  preference.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  sync();
  return {
    setPaused(value: boolean) { paused = value; sync(); },
    destroy() {
      observer?.disconnect();
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      animations.forEach((animation) => animation.cancel());
    },
  };
}
