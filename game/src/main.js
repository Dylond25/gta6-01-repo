// Meridian Bay — game loop and shared state.
// main.js builds the one `state` object every module talks through, runs
// the 60 Hz fixed-step loop, moves Rio on foot, and wires in the other
// agents' modules ONLY when they exist yet: Agent 2 (vehicles, traffic,
// police, combat) and Agent 3 (missions, HUD, audio) land in the repo on
// their own schedule, so every call to them is feature-detected and
// guarded. The core world plays standalone without them.
(function (global) {
  'use strict';

  var cfg = global.MB_CONFIG;

  function makeState(spawn) {
    return {
      player: {
        x: spawn.x, y: 0, z: spawn.z,
        vx: 0, vz: 0, vy: 0,
        heading: Math.PI,           // facing down the street at spawn
        onFoot: true,
        inVehicle: false,
        vehicleId: null,
        health: cfg.playerHealth,
        money: cfg.startMoney,
        grounded: true,
      },
      wanted: { level: 0, cooldown: 0 },
      time: { phase: 'dusk', elapsed: 0 },
      mission: { id: 0, text: 'Jelajahi Meridian Bay', status: 'idle' },
      vehicles: [],
      peds: [],
      police: [],
      camera: { yaw: Math.PI, pitch: 0.12 },
      started: false,
      paused: false,
      over: false,
      muted: false,
    };
  }

  // A tiny built-in HUD, used ONLY while Agent 3's hud.js is absent.
  // It shows health, money, wanted stars and the current objective so the
  // core world already reads as a game in screenshots.
  function makeFallbackHud(state) {
    var box = document.createElement('div');
    box.id = 'mb-fallback-hud';
    box.style.cssText = [
      'position:fixed;top:14px;left:14px;z-index:5;color:#fff;',
      'font:600 15px/1.5 system-ui,sans-serif;text-shadow:0 1px 4px #000;',
      'pointer-events:none;white-space:pre;',
    ].join('');
    document.body.appendChild(box);
    var hint = document.createElement('div');
    hint.style.cssText = [
      'position:fixed;bottom:12px;left:14px;z-index:5;color:#fff;',
      'font:500 12px/1.5 system-ui,sans-serif;text-shadow:0 1px 4px #000;',
      'pointer-events:none;opacity:0.85;',
    ].join('');
    hint.textContent = 'WASD gerak · mouse kamera · Spasi lompat · E mobil · F curi · P jeda · M suara';
    document.body.appendChild(hint);
    return {
      update: function () {
        var stars = '';
        for (var i = 0; i < cfg.maxWanted; i++) {
          stars += i < state.wanted.level ? '★' : '☆';
        }
        box.textContent =
          'MERIDIAN BAY\n' +
          '❤ ' + Math.max(0, Math.round(state.player.health)) +
          '   $' + state.player.money + '\n' +
          stars + '\n' +
          state.mission.text;
      },
      remove: function () {
        if (box.parentNode) box.parentNode.removeChild(box);
        if (hint.parentNode) hint.parentNode.removeChild(hint);
      },
    };
  }

  function makeStartOverlay(onStart) {
    var ov = document.createElement('div');
    ov.id = 'mb-start';
    ov.style.cssText = [
      'position:fixed;inset:0;z-index:10;display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;cursor:pointer;',
      'background:linear-gradient(180deg,rgba(43,26,74,0.25) 0%,rgba(20,10,40,0.78) 100%);',
      'color:#fff;font-family:system-ui,sans-serif;text-align:center;',
    ].join('');
    ov.innerHTML =
      '<div style="font-size:64px;font-weight:900;letter-spacing:6px;' +
      'text-shadow:0 4px 24px rgba(255,138,61,0.65)">MERIDIAN BAY</div>' +
      '<div style="font-size:18px;margin-top:6px;opacity:0.9">' +
      'Rio Kestrel &middot; kurir yang terlilit utang &middot; satu kota, senja, dan jalan keluar</div>' +
      '<div style="margin-top:34px;font-size:17px;font-weight:700;' +
      'border:2px solid #ffb347;border-radius:10px;padding:12px 26px;' +
      'background:rgba(255,154,60,0.16)">KLIK UNTUK MULAI</div>' +
      '<div style="margin-top:16px;font-size:13px;opacity:0.75">' +
      'WASD gerak &middot; mouse kamera &middot; E masuk mobil &middot; F curi mobil &middot; Spasi lompat</div>';
    ov.addEventListener('click', onStart);
    document.body.appendChild(ov);
    return ov;
  }

  // Axis-separated movement against building boxes: slide along walls
  // instead of sticking to them.
  function moveWithCollision(state, world, dx, dz) {
    var p = state.player;
    var r = cfg.playerRadius;
    var nx = p.x + dx;
    var hit = false;
    for (var i = 0; i < world.colliders.length; i++) {
      var c = world.colliders[i];
      if (nx + r > c.minX && nx - r < c.maxX &&
          p.z + r > c.minZ && p.z - r < c.maxZ) { hit = true; break; }
    }
    if (!hit) p.x = nx;
    var nz = p.z + dz;
    hit = false;
    for (var j = 0; j < world.colliders.length; j++) {
      var c2 = world.colliders[j];
      if (p.x + r > c2.minX && p.x - r < c2.maxX &&
          nz + r > c2.minZ && nz - r < c2.maxZ) { hit = true; break; }
    }
    if (!hit) p.z = nz;
    var b = world.bounds;
    if (p.x < b.minX + 1) p.x = b.minX + 1;
    if (p.x > b.maxX - 1) p.x = b.maxX - 1;
    if (p.z < b.minZ + 1) p.z = b.minZ + 1;
    if (p.z > b.maxZ - 1) p.z = b.maxZ - 1;
  }

  // Call an optional module function only when it exists, and never let
  // a module's error kill the frame.
  function tryCall(fn, state, dt) {
    if (typeof fn !== 'function') return;
    try {
      fn(state, dt);
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[meridian] module error:', err && err.message);
      }
    }
  }

  function boot() {
    var canvas = document.getElementById('game');
    var world = global.createWorld();
    var renderer = global.createRenderer(canvas);
    renderer.scene.add(world.group);
    var input = global.createInput(canvas);
    var state = makeState(world.spawn);

    // Optional modules, wired only when their scripts have loaded.
    var vehicles = null;
    var traffic = null;
    var police = null;
    var combat = null;
    var missions = null;
    var hud = null;
    var audio = null;
    if (typeof global.createVehicles === 'function') {
      try { vehicles = global.createVehicles(world); } catch (e) { /* standalone */ }
    }
    if (typeof global.createTraffic === 'function') {
      try { traffic = global.createTraffic(world); } catch (e) { /* standalone */ }
    }
    if (typeof global.createPolice === 'function') {
      try { police = global.createPolice(); } catch (e) { /* standalone */ }
    }
    if (typeof global.createCombat === 'function') {
      try { combat = global.createCombat(); } catch (e) { /* standalone */ }
    }
    if (typeof global.createMissions === 'function') {
      try { missions = global.createMissions(); } catch (e) { /* standalone */ }
    }
    if (typeof global.createHUD === 'function') {
      try { hud = global.createHUD(); } catch (e) { /* standalone */ }
    }
    if (typeof global.createAudio === 'function') {
      try { audio = global.createAudio(); } catch (e) { /* standalone */ }
    }
    var fallbackHud = hud ? null : makeFallbackHud(state);
    if (hud && fallbackHud) fallbackHud.remove();

    var overlay = makeStartOverlay(function () {
      state.started = true;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (audio && typeof audio.resume === 'function') audio.resume();
    });
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Enter' && !state.started) {
        state.started = true;
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
    });

    var last = performance.now();
    var acc = 0;

    function update(dt) {
      state.time.elapsed += dt;
      // camera orbit from the mouse
      var look = input.readLook();
      state.camera.yaw -= look.dx * 0.0028;
      state.camera.pitch += look.dy * 0.0022;
      if (state.camera.pitch < cfg.camPitchMin) state.camera.pitch = cfg.camPitchMin;
      if (state.camera.pitch > cfg.camPitchMax) state.camera.pitch = cfg.camPitchMax;
      if (input.pause()) state.paused = !state.paused;
      if (input.mute()) {
        state.muted = !state.muted;
        if (audio && typeof audio.setMuted === 'function') audio.setMuted(state.muted);
      }
      if (state.paused || !state.started || state.over) return;

      var p = state.player;
      if (p.onFoot && !p.inVehicle) {
        var mf = input.moveF();
        var ms = input.moveS();
        var speed = input.run() ? cfg.runSpeed : cfg.walkSpeed;
        var yaw = state.camera.yaw;
        // forward is where the camera looks; strafe is perpendicular
        var fx = Math.sin(yaw);
        var fz = Math.cos(yaw);
        var rx = Math.cos(yaw);
        var rz = -Math.sin(yaw);
        var mx = fx * mf + rx * ms;
        var mz = fz * mf + rz * ms;
        var len = Math.hypot(mx, mz);
        if (len > 0) {
          mx /= len;
          mz /= len;
          moveWithCollision(state, world, mx * speed * dt, mz * speed * dt);
          p.vx = mx * speed;
          p.vz = mz * speed;
          p.heading = Math.atan2(mx, mz);
        } else {
          p.vx = 0;
          p.vz = 0;
        }
        if (input.jump() && p.grounded) {
          p.vy = cfg.jumpSpeed;
          p.grounded = false;
        }
        p.vy -= cfg.gravity * dt;
        p.y += p.vy * dt;
        if (p.y <= 0) {
          p.y = 0;
          p.vy = 0;
          p.grounded = true;
        }
        if (input.enterVehicle() && typeof global.tryEnterVehicle === 'function') {
          tryCall(global.tryEnterVehicle, state, dt);
        }
        if (input.steal() && typeof global.tryStealVehicle === 'function') {
          tryCall(global.tryStealVehicle, state, dt);
        }
        if (input.attack() && typeof global.attack === 'function') {
          tryCall(global.attack, state, dt);
        }
      }

      // Agent 2 gameplay systems, when present. The contract names these
      // as globals (updateVehicles / updateTraffic / updatePolice), so call
      // them directly rather than as methods on the create* return value.
      tryCall(global.updateVehicles, state, dt);
      tryCall(global.updateTraffic, state, dt);
      tryCall(global.updatePolice, state, dt);
      // Agent 3 missions, when present (global updateMissions per contract).
      tryCall(global.updateMissions, state, dt);
      if (hud && typeof hud.update === 'function') {
        try { hud.update(state, dt); } catch (e) { /* standalone */ }
      } else if (typeof global.updateHUD === 'function') {
        tryCall(global.updateHUD, state, dt);
      } else if (fallbackHud) {
        fallbackHud.update();
      }
      if (audio && typeof audio.update === 'function') {
        try { audio.update(state, dt); } catch (e) { /* standalone */ }
      }

      // Wanted stars cool down while hidden.
      if (state.wanted.level > 0) {
        state.wanted.cooldown -= dt;
        if (state.wanted.cooldown <= 0) {
          state.wanted.level -= 1;
          state.wanted.cooldown = cfg.wantedCooldown;
        }
      }
      if (p.health <= 0 && !state.over) {
        state.over = true;
        var go = document.createElement('div');
        go.style.cssText = [
          'position:fixed;inset:0;z-index:10;display:flex;flex-direction:column;',
          'align-items:center;justify-content:center;color:#fff;cursor:pointer;',
          'background:rgba(20,5,20,0.82);font-family:system-ui,sans-serif;',
        ].join('');
        go.innerHTML = '<div style="font-size:52px;font-weight:900">RIO TERTANGKAP</div>' +
          '<div style="margin-top:10px;opacity:0.85">Klik untuk mencoba lagi</div>';
        go.addEventListener('click', function () { window.location.reload(); });
        document.body.appendChild(go);
      }
    }

    function frame(now) {
      requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, cfg.maxFrameDt);
      last = now;
      acc += dt;
      var steps = 0;
      while (acc >= cfg.fixedDt && steps < 5) {
        update(cfg.fixedDt);
        acc -= cfg.fixedDt;
        steps++;
      }
      renderer.render(state, dt);
    }
    requestAnimationFrame(frame);

    // Handle for debugging and for Playwright checks.
    global.__meridian = { state: state, world: world };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
