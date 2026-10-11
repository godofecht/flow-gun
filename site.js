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
const pause = document.getElementById("pause");
const reseed = document.getElementById("reseed");
const expand = document.getElementById("fullscreen");
const stage = document.getElementById("stage-screen");
const engineFailure = document.getElementById("engine-failure");
const engineErrorMessage = document.getElementById("engine-error-message");
const engineRetry = document.getElementById("engine-retry");
const weatherControls = [...document.querySelectorAll("[data-weather]")];
const speciesControls = [...document.querySelectorAll("[data-species]")];

let in3D = false;
let walking = false;
let ready = false;
let loadVersion = 0;
let sampledFps = null;
let paused = false;
let weather = 0;
let brush = 2;

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
  if (pause) {
    pause.disabled = !ready;
    pause.setAttribute("aria-pressed", String(paused));
    pause.firstChild.textContent = paused ? "▶ Resume " : "Ⅱ Pause ";
  }
  if (reseed) reseed.disabled = !ready;
  for (const btn of weatherControls) {
    btn.disabled = !ready;
    btn.setAttribute("aria-pressed", String(Number(btn.dataset.weather) === weather));
  }
  for (const btn of speciesControls) {
    btn.disabled = !ready;
    btn.setAttribute("aria-pressed", String(Number(btn.dataset.species) === brush));
  }
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

function showRuntimeFailure(reason) {
  ready = false;
  if (engineFailure) engineFailure.hidden = false;
  if (engineErrorMessage) engineErrorMessage.textContent = reason;
  syncControls();
  if (status) status.textContent = "● ENGINE ERROR — RETRY TO RESTART";
}

function monitorReady(version, attempt) {
  if (version !== loadVersion) return;
  const win = getEngine();
  if (win && win.flowGfx.frames > 0) {
    ready = true;
    if (engineFailure) engineFailure.hidden = true;
    syncControls();
    measureFps(version, win.flowGfx.frames, performance.now());
  } else {
    let failureText = "";
    try {
      const embeddedStatus = frame.contentWindow.document.querySelector("#status")?.textContent || "";
      if (/fail|error|finished/i.test(embeddedStatus)) {
        failureText = frame.contentWindow.document.querySelector("#out")?.textContent?.slice(-300) || embeddedStatus;
      }
    } catch (error) { failureText = "Unable to inspect the embedded runtime."; }
    if (failureText) {
      showRuntimeFailure(failureText);
    } else if (attempt < 120) {
      window.setTimeout(() => monitorReady(version, attempt + 1), 150);
    } else {
      showRuntimeFailure("The WebAssembly canvas did not produce a frame within 18 seconds. Retry, or open the standalone viewer.");
    }
  }
}

function bindKeyboardChanges(win) {
  // The visitor can also press Tab/V directly inside the iframe. Reflect
  // genuine keyboard input, without double-counting our synthetic buttons.
  win.addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.repeat) return;
    if (event.code === "Tab") in3D = !in3D;
    if (event.code === "KeyV" && in3D) walking = !walking;
    if (event.code === "KeyP") paused = !paused;
    const climates = in3D ? ["KeyX","KeyZ","KeyC"] : ["KeyS","KeyW","KeyD"];
    const climateIndex = climates.indexOf(event.code);
    if (climateIndex >= 0) weather = climateIndex;
    if (/^Digit[1-4]$/.test(event.code)) brush = Number(event.code.slice(-1));
    syncControls();
  }, true);
}

function awaitStart() {
  ready = false;
  in3D = false;
  walking = false;
  sampledFps = null;
  paused = false;
  weather = 0;
  brush = 2;
  const version = ++loadVersion;
  if (engineFailure) engineFailure.hidden = true;
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

function restartEngine() {
  ready = false;
  if (engineFailure) engineFailure.hidden = true;
  syncControls();
  const url = new URL("./garden/index.html?autostart=1", location.href);
  url.searchParams.set("reload", String(Date.now()));
  frame.src = url.href;
}
restart?.addEventListener("click", restartEngine);
engineRetry?.addEventListener("click", restartEngine);

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

for (const btn of weatherControls) {
  btn.addEventListener("click", () => {
    const value = Number(btn.dataset.weather);
    const key = in3D ? ["KeyX","KeyZ","KeyC"][value] : ["KeyS","KeyW","KeyD"][value];
    if (!sendFlowKey(key, key.slice(-1).toLowerCase())) return;
    weather = value;
    syncControls();
  });
}
for (const btn of speciesControls) {
  btn.addEventListener("click", () => {
    const value = Number(btn.dataset.species);
    if (in3D) {
      if (!sendFlowKey("Tab","Tab")) return;
      in3D = false;
    }
    if (!sendFlowKey("Digit" + value, String(value))) return;
    brush = value;
    syncControls();
  });
}
pause?.addEventListener("click", () => {
  if (!sendFlowKey("KeyP","p")) return;
  paused = !paused;
  syncControls();
});
reseed?.addEventListener("click", () => {
  if (!sendFlowKey("KeyR","r")) return;
  paused = false;
  // A fresh garden is re-seeded without replacing the WebAssembly process.
  syncControls();
});
expand?.addEventListener("click", async () => {
  if (!stage) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch (error) {
    frame?.focus();
  }
});
document.addEventListener("fullscreenchange", () => {
  if (expand) expand.textContent = document.fullscreenElement ? "⤢ Exit" : "⛶ Expand";
});
