"use strict";
const frame = document.getElementById("garden-frame");
const restart = document.getElementById("restart");
if (frame && restart) {
  restart.addEventListener("click", () => {
    frame.src = new URL("./garden/index.html?autostart=1", window.location.href).href;
    frame.focus();
  });
}

const dimension = document.getElementById("toggle-dimension");
if (dimension && frame) {
  let elevated = false;
  dimension.addEventListener("click", () => {
    try {
      // The embedded Flow browser runtime listens to the same macOS keycode
      // mapping as the native build. Signal a real V key interaction.
      const target = frame.contentWindow;
      target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV", key: "v", bubbles: true }));
      target.setTimeout(() => target.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyV", key: "v", bubbles: true })), 110);
      elevated = !elevated;
      dimension.setAttribute("aria-pressed", String(elevated));
      dimension.firstChild.textContent = elevated ? "↙ Return to 2D " : "↗ Switch 2D / 3D ";
      frame.focus();
    } catch (error) {
      // The V key always works when the embedded garden has focus.
      frame.focus();
    }
  });
}
