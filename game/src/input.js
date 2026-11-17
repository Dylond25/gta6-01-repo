// Meridian Bay — input: keyboard + mouse.
// createInput() mengembalikan objek aksi yang dibaca main.js tiap
// frame. Aksi sekali-tekan (jump/enter/steal/pause/mute/attack/start)
// adalah edge-triggered: main.js mengonsumsinya, lalu input
// membersihkannya di akhir frame lewat endFrame().
'use strict';

function createInput(canvas) {
  const keys = {};
  const look = { dx: 0, dy: 0 };
  const once = {
    jump: false, enter: false, steal: false,
    pause: false, mute: false, attack: false, start: false,
  };
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let locked = false;

  function keyName(e) {
    return (e.key || '').toLowerCase();
  }

  window.addEventListener('keydown', function (e) {
    const k = keyName(e);
    if (k === ' ' || k === 'arrowup' || k === 'arrowdown' ||
        k === 'arrowleft' || k === 'arrowright') {
      e.preventDefault();
    }
    if (e.repeat) return;
    keys[k] = true;
    if (k === ' ') once.jump = true;
    if (k === 'e') once.enter = true;
    if (k === 'f') once.steal = true;
    if (k === 'p') once.pause = true;
    if (k === 'm') once.mute = true;
    if (k === 'enter') once.start = true;
  });
  window.addEventListener('keyup', function (e) {
    keys[keyName(e)] = false;
  });
  window.addEventListener('blur', function () {
    for (const k in keys) keys[k] = false;
    dragging = false;
  });

  // Mouse: pointer lock bila tersedia, fallback drag.
  canvas.addEventListener('click', function () {
    if (canvas.requestPointerLock) {
      try { canvas.requestPointerLock(); } catch (err) { /* abaikan */ }
    }
  });
  document.addEventListener('pointerlockchange', function () {
    locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', function (e) {
    if (locked) {
      look.dx += e.movementX || 0;
      look.dy += e.movementY || 0;
    } else if (dragging) {
      look.dx += e.clientX - lastX;
      look.dy += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  canvas.addEventListener('mousedown', function (e) {
    if (e.button === 0) {
      once.attack = true;
      if (!locked) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    }
  });
  window.addEventListener('mouseup', function () {
    dragging = false;
  });

  function axis() {
    let x = 0;
    let z = 0;
    if (keys['w'] || keys['arrowup']) z -= 1;
    if (keys['s'] || keys['arrowdown']) z += 1;
    if (keys['a'] || keys['arrowleft']) x -= 1;
    if (keys['d'] || keys['arrowright']) x += 1;
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, z: z / len, run: !!(keys['shift']) };
  }

  function consumeLook() {
    const d = { dx: look.dx, dy: look.dy };
    look.dx = 0;
    look.dy = 0;
    return d;
  }

  function endFrame() {
    once.jump = false;
    once.enter = false;
    once.steal = false;
    once.pause = false;
    once.mute = false;
    once.attack = false;
    once.start = false;
  }

  return {
    keys: keys,
    once: once,
    axis: axis,
    consumeLook: consumeLook,
    endFrame: endFrame,
  };
}
