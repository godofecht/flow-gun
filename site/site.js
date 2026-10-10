"use strict";

/*
 * Controls for the actual Flow -> WebAssembly canvas, not a second simulation.
 * The Flow runtime (gfx_wasm.c) maps DOM KeyboardEvents to macOS keycodes,
 * and latches short key taps until the native Flow loop observes them.
 */
const frame = document.getElementById("garden-frame");
const restart = document.getElementById("restart");
const dimension = document.getElementById("toggle-dimension");
const mode = document.getElementById("camera-mode");
const reset = document.getElementById("camera-reset");
const status = document.getElementById("garden-runtime");

let in3D = false;
let walking = false;
let ready = false;
let loadVersion = 0;
let sampledFps = null;

function syncControls() {
  dimension?.setAttribute("aria-pressed", String(in3D));
  mode?.setAttribute("aria-pressed", String(walking));
  if (dimension) {
    dimension.firstChild.textContent = in3D ? "↙ Return to 2D " : "↗ Enter 3D ";
    dimension.disabled = !ready;
  }
  if (mode) {
    mode.firstChild.textContent = walking ? "♧ Walk mode " : "◉ Orbit mode ";
    mode.disabled = !ready;
  }
  if (reset) reset.disabled = !ready || !in3D;
  if (status) {
    status.textContent = ready
      ? (sampledFps === null ? "● FLOW ENGINE READY" : `● FLOW ENGINE · ${sampledFps} FPS`)
      : "○ LOADING FLOW ENGINE…";
    status.dataset.ready = String(ready);
  }
}

function getEngine() {
  try {
    const win = frame?.contentWindow;
    return win?.flowGfx?.canvas && win.flowGfx.keys ? win : null;
  } catch (error) {
    // Keep buttons disabled if a browser blocks iframe access.
    return null;
  }
}

function sendFlowKey(code, key) {
  const win = getEngine();
  if (!ready || !win) return false;
  // Dispatch to the runtime's actual keydown/up listeners. Its 'release'
  // state keeps the press alive until the Flow render loop polls it.
  const init = { code, key, bubbles: true, cancelable: true };
  win.dispatchEvent(new win.KeyboardEvent("keydown", init));
  win.dispatchEvent(new win.KeyboardEvent("keyup", init));
  frame.focus();
  return true;
}

// Actual WebAssembly frame counter, not an estimated browser refresh rate.
function measureFps(version, beforeFrames, beforeTime) {
  window.setTimeout(() => {
    if (version !== loadVersion || !ready) return;
    const current = getEngine()?.flowGfx?.frames;
    if (typeof current !== "number") return;
    const now = performance.now();
    sampledFps = Math.max(0, Math.round((current - beforeFrames) * 1000 / (now - beforeTime)));
    syncControls();
    measureFps(version, current, now);
  }, 1000);
}

function monitorReady(version, attempt) {
  if (version !== loadVersion) return;
  const win = getEngine();
  if (win && win.flowGfx.frames > 0) {
    ready = true;
    syncControls();
    measureFps(version, win.flowGfx.frames, performance.now());
  } else if (attempt < 240) {
    window.setTimeout(() => monitorReady(version, attempt + 1), 150);
  } else if (status) {
    status.textContent = "WEBASSEMBLY NOT READY — RESTART TO RETRY";
  }
}

function bindKeyboardChanges(win) {
  // The visitor can also press Tab/V directly inside the iframe. Reflect
  // genuine keyboard input, without double-counting our synthetic buttons.
  win.addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.repeat) return;
    if (event.code === "Tab") in3D = !in3D;
    if (event.code === "KeyV" && in3D) walking = !walking;
    syncControls();
  }, true);
}

function awaitStart() {
  ready = false;
  in3D = false;
  walking = false;
  sampledFps = null;
  const version = ++loadVersion;
  syncControls();
  try {
    const win = frame.contentWindow;
    if (win) bindKeyboardChanges(win);
  } catch (error) {
    // A non-same-origin embed can still be navigated using physical keys.
  }
  monitorReady(version, 0);
}

frame?.addEventListener("load", awaitStart);

restart?.addEventListener("click", () => {
  ready = false;
  syncControls();
  frame.src = new URL("./garden/index.html?autostart=1", location.href).href;
});

dimension?.addEventListener("click", () => {
  if (!sendFlowKey("Tab", "Tab")) return;
  in3D = !in3D;
  syncControls();
});

mode?.addEventListener("click", () => {
  if (!in3D) {
    if (!sendFlowKey("Tab", "Tab")) return;
    in3D = true;
  }
  if (!sendFlowKey("KeyV", "v")) return;
  walking = !walking;
  syncControls();
});

reset?.addEventListener("click", () => {
  if (in3D) sendFlowKey("Space", " ");
});

syncControls();
