"use strict";
// UI sends the same keycodes as native Flow gfx; world state always lives in WASM.
const frame = document.getElementById("garden-frame");
const restart = document.getElementById("restart");
const dimension = document.getElementById("toggle-dimension");
const mode = document.getElementById("camera-mode");
const reset = document.getElementById("camera-reset");
let in3D = false;
let walking = false;

function syncControls() {
  if (dimension) {
    dimension.setAttribute("aria-pressed", String(in3D));
    dimension.firstChild.textContent = in3D ? "↙ Return to 2D " : "↗ Enter 3D ";
  }
  if (mode) {
    mode.setAttribute("aria-pressed", String(walking));
    mode.firstChild.textContent = walking ? "♧ Walk mode " : "◉ Orbit mode ";
  }
}

// The iframe is first-party and already embeds Flow's gfx event bridge.
// Hold a key for ~3 frames so the WASM loop sees it even under heavier loads.
function sendFlowKey(code, key, keyCode) {
  const win = frame?.contentWindow;
  if (!win) return;
  try {
    const runtime = win.flowGfx;
    if (runtime?.keys) {
      runtime.keys[keyCode] = 1;
      win.setTimeout(() => { runtime.keys[keyCode] = 0; }, 135);
    } else {
      win.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
      win.setTimeout(() => win.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true })), 135);
    }
  } catch (error) {
    console.warn("Garden key bridge unavailable; use the keyboard in the frame.", error);
  }
  frame.focus();
}

if (frame) frame.addEventListener("load", () => {
  in3D = false;
  walking = false;
  syncControls();
});
if (restart) restart.addEventListener("click", () => {
  frame.src = new URL("./garden/index.html?autostart=1", location.href).href;
});
if (dimension) dimension.addEventListener("click", () => {
  sendFlowKey("Tab", "Tab", 48);
  in3D = !in3D;
  syncControls();
});
if (mode) mode.addEventListener("click", () => {
  if (!in3D) {
    sendFlowKey("Tab", "Tab", 48);
    in3D = true;
  }
  sendFlowKey("KeyV", "v", 9);
  walking = !walking;
  syncControls();
});
if (reset) reset.addEventListener("click", () => {
  if (!in3D) return;
  sendFlowKey("Space", " ", 49);
});
syncControls();
