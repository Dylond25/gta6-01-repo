// Meridian Bay — keyboard and mouse input.
// createInput() reads the keyboard and the mouse and hands main.js one
// tidy object per frame: WASD movement, look deltas, and edge-triggered
// actions (enter/exit car, steal, jump, pause, mute, attack). It owns
// pointer lock for the camera and clears itself when the window blurs,
// so a stuck key can never keep Rio walking forever.
(function (global) {
  'use strict';

  function createInput(canvas) {
    var keys = {};       // code -> true while held
    var pressed = {};    // code -> true once, until main.js consumes it
    var lookDX = 0;      // accumulated mouse-x since last read
    var lookDY = 0;      // accumulated mouse-y since last read
    var attackQueued = false;
    var locked = false;
    var dragging = false;
    var lastX = 0;
    var lastY = 0;

    function onKeyDown(e) {
      if (e.repeat) return;
      keys[e.code] = true;
      pressed[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
    }
    function onKeyUp(e) {
      keys[e.code] = false;
    }
    function onBlur() {
      keys = {};
      dragging = false;
    }
    function onMouseDown(e) {
      if (e.button === 0) {
        attackQueued = true;
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        if (!locked && canvas.requestPointerLock) {
          try {
            var p = canvas.requestPointerLock();
            if (p && p.catch) p.catch(function () { /* pointer lock denied */ });
          } catch (err) { /* pointer lock unavailable */ }
        }
      }
    }
    function onMouseUp() {
      dragging = false;
    }
    function onMouseMove(e) {
      if (locked) {
        lookDX += e.movementX || 0;
        lookDY += e.movementY || 0;
      } else if (dragging) {
        lookDX += e.clientX - lastX;
        lookDY += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    }
    function onLockChange() {
      locked = document.pointerLockElement === canvas;
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onLockChange);

    // Edge-triggered: true once per physical press, then cleared.
    function consume(code) {
      if (pressed[code]) {
        pressed[code] = false;
        return true;
      }
      return false;
    }

    return {
      // Movement axes for this frame, each -1, 0 or 1. Forward is W / Up.
      moveF: function () {
        var f = 0;
        if (keys['KeyW'] || keys['ArrowUp']) f += 1;
        if (keys['KeyS'] || keys['ArrowDown']) f -= 1;
        return f;
      },
      moveS: function () {
        var s = 0;
        if (keys['KeyD'] || keys['ArrowRight']) s += 1;
        if (keys['KeyA'] || keys['ArrowLeft']) s -= 1;
        return s;
      },
      run: function () {
        return !!(keys['ShiftLeft'] || keys['ShiftRight']);
      },
      // Mouse-look deltas since the last read; reading zeroes them.
      readLook: function () {
        var d = { dx: lookDX, dy: lookDY };
        lookDX = 0;
        lookDY = 0;
        return d;
      },
      // One-shot actions, each true once per press.
      enterVehicle: function () { return consume('KeyE'); },
      steal: function () { return consume('KeyF'); },
      jump: function () { return consume('Space'); },
      pause: function () { return consume('KeyP'); },
      mute: function () { return consume('KeyM'); },
      attack: function () {
        if (attackQueued) {
          attackQueued = false;
          return true;
        }
        return false;
      },
      start: function () { return consume('Enter'); },
      isLocked: function () { return locked; },
    };
  }

  global.createInput = createInput;
})(typeof window !== 'undefined' ? window : globalThis);
