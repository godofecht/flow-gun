"use strict";
const frame = document.getElementById("garden-frame");
const restart = document.getElementById("restart");
if (frame && restart) {
  restart.addEventListener("click", () => {
    frame.src = new URL("./garden/index.html", window.location.href).href;
    frame.focus();
  });
}
