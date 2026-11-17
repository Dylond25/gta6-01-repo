// Meridian Bay — game loop + state bersama (Agent 1, core world).
// main.js membuat objek `state` sesuai kontrak design draft, menjalankan
// loop fixed-step 60 Hz, dan me-wire modul Agent 2/3 HANYA BILA ADA
// (feature-detect + try/catch) sehingga game jalan standalone.
// Modul Agent 2: createVehicles/updateVehicles/tryEnterVehicle/
// tryStealVehicle, createTraffic/updateTraffic, createPolice/
// updatePolice/setWanted, createCombat/attack.
// Modul Agent 3: createMissions/updateMissions, createHUD,
// saveGame/loadGame, audio.
'use strict';

(function () {
  const C = MB_CONFIG;

  // ---- State bersama (kontrak) ----
  const state = {
    player: {
      x: 0, y: 0, z: 0, heading: 0,
      vx: 0, vy: 0, vz: 0,
      onGround: true, inVehicle: false, vehicleId: null,
      health: 100, money: 250,
    },
    wanted: { level: 0, cooldown: 0 },
    time: { phase: C.timeOfDay, t: 0 },
    mission: { id: 0, text: 'Jelajahi Meridian Bay.', status: 'idle' },
    vehicles: [],
    peds: [],
    police: [],
    camera: { yaw: 0, pitch: C.camPitchStart, dist: C.camDist },
    paused: false,
    muted: false,
    started: false,
    over: false,
    won: false,
  };

  // ---- Boot ----
  const canvas = document.getElementById('game');
  const world = createWorld();
  const renderer = createRenderer(canvas);
  renderer.scene.add(world.group);
  const input = createInput(canvas);
  state.player.x = world.spawn.x;
  state.player.z = world.spawn.z;
  state.player.heading = world.spawn.yaw;
  state.camera.yaw = world.spawn.yaw;

  // Modul Agent 2/3 bila sudah dimuat (dipanggil aman di bawah).
  let vehiclesApi = null;
  let trafficApi = null;
  let policeApi = null;
  let combatApi = null;
  let missionsApi = null;
  let hudApi = null;
  let audioApi = null;
  if (typeof createVehicles === 'function') {
    try { vehiclesApi = createVehicles(world); } catch (err) { vehiclesApi = null; }
  }
  if (typeof createTraffic === 'function') {
    try { trafficApi = createTraffic(world); } catch (err) { trafficApi = null; }
  }
  if (typeof createPolice === 'function') {
    try { policeApi = createPolice(); } catch (err) { policeApi = null; }
  }
  if (typeof createCombat === 'function') {
    try { combatApi = createCombat(); } catch (err) { combatApi = null; }
  }
  if (typeof createMissions === 'function') {
    try { missionsApi = createMissions(); } catch (err) { missionsApi = null; }
  }
  if (typeof createHUD === 'function') {
    try { hudApi = createHUD(); } catch (err) { hudApi = null; }
  }

  // ---- HUD fallback (dipakai bila hud.js Agent 3 belum ada) ----
  const hudEl = document.getElementById('hud');
  const hudMoney = document.getElementById('hud-money');
  const hudHealth = document.getElementById('hud-health');
  const hudStars = document.getElementById('hud-stars');
  const hudObjective = document.getElementById('hud-objective');
  const minimap = document.getElementById('minimap');
  const mm = minimap ? minimap.getContext('2d') : null;

  function drawMinimap() {
    if (!mm || !minimap) return;
    const w = minimap.width;
    const h = minimap.height;
    const b = world.bounds;
    const sx = function (x) { return ((x + b) / (2 * b)) * w; };
    const sz = function (z) { return ((z + b) / (2 * b)) * h; };
    mm.fillStyle = 'rgba(10, 12, 26, 0.72)';
    mm.fillRect(0, 0, w, h);
    // Jalan.
    mm.strokeStyle = 'rgba(200, 200, 210, 0.55)';
    mm.lineWidth = 2;
    for (const r of world.roads) {
      mm.beginPath();
      if (r.axis === 'x') { mm.moveTo(0, sz(r.at)); mm.lineTo(w, sz(r.at)); }
      else { mm.moveTo(sx(r.at), 0); mm.lineTo(sx(r.at), h); }
      mm.stroke();
    }
    // Polisi (merah) dan kendaraan (kuning).
    for (const v of state.vehicles) {
      mm.fillStyle = '#e8b93b';
      mm.fillRect(sx(v.x) - 2, sz(v.z) - 2, 4, 4);
    }
    for (const p of state.police) {
      mm.fillStyle = '#ff4d4d';
      mm.beginPath();
      mm.arc(sx(p.x), sz(p.z), 3, 0, Math.PI * 2);
      mm.fill();
    }
    // Pemain (teal, dengan arah).
    const px = sx(state.player.x);
    const pz = sz(state.player.z);
    mm.fillStyle = '#2dd4bf';
    mm.beginPath();
    mm.arc(px, pz, 4, 0, Math.PI * 2);
    mm.fill();
    mm.strokeStyle = '#ffffff';
    mm.beginPath();
    mm.moveTo(px, pz);
    mm.lineTo(px + Math.sin(state.player.heading) * 8,
      pz + Math.cos(state.player.heading) * 8);
    mm.stroke();
  }

  function drawHudFallback() {
    if (hudApi) return; // HUD asli Agent 3 yang menggambar.
    if (!hudEl) return;
    hudEl.style.display = state.started && !state.over ? 'block' : 'none';
    if (hudMoney) hudMoney.textContent = '$' + state.player.money;
    if (hudHealth) {
      hudHealth.textContent = 'HP ' + Math.max(0, Math.round(state.player.health));
      hudHealth.style.color = state.player.health > 30 ? '#7dff9a' : '#ff6b6b';
    }
    if (hudStars) {
      let s = '';
      for (let i = 0; i < 5; i++) s += i < state.wanted.level ? '★' : '☆';
      hudStars.textContent = s;
    }
    if (hudObjective) hudObjective.textContent = state.mission.text;
    drawMinimap();
  }

  // ---- Overlay start / game over ----
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const overlayBtn = document.getElementById('overlay-btn');

  function showOverlay(title, text, btn) {
    if (!overlay) return;
    overlay.style.display = 'flex';
    if (overlayTitle) overlayTitle.textContent = title;
    if (overlayText) overlayText.textContent = text;
    if (overlayBtn) overlayBtn.textContent = btn;
  }
  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
  }
  if (overlayBtn) {
    overlayBtn.addEventListener('click', function () {
      if (state.over) resetRun();
      startGame();
    });
  }

  function startGame() {
    state.started = true;
    state.over = false;
    state.won = false;
    hideOverlay();
    if (canvas.requestPointerLock) {
      try { canvas.requestPointerLock(); } catch (err) { /* abaikan */ }
    }
  }

  function gameOver(won) {
    state.over = true;
    state.won = won;
    if (won) {
      showOverlay('MERIDIAN BAY — TAMAT',
        'Rio menyelesaikan pelarian besar. Skor: $' + state.player.money + '.',
        'MAIN LAGI');
    } else {
      showOverlay('GAME OVER',
        'Rio tertangkap / tumbang. Uang: $' + state.player.money + '.',
        'ULANGI MISI');
    }
    if (document.exitPointerLock) document.exitPointerLock();
  }

  function resetRun() {
    state.player.x = world.spawn.x;
    state.player.z = world.spawn.z;
    state.player.y = 0;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.vz = 0;
    state.player.health = 100;
    state.player.money = 250;
    state.player.inVehicle = false;
    state.wanted.level = 0;
    state.wanted.cooldown = 0;
    state.mission = { id: 0, text: 'Jelajahi Meridian Bay.', status: 'idle' };
    state.vehicles = [];
    state.peds = [];
    state.police = [];
    state.over = false;
    state.won = false;
  }
  // ---- Collision: pemain (lingkaran) vs gedung (AABB), geser dinding ----
  function collide(x, z, r) {
    for (const b of world.colliders) {
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) {
        return b;
      }
    }
    return null;
  }

  function movePlayer(dt, ax, az, running) {
    const p = state.player;
    const speed = running ? C.runSpeed : C.walkSpeed;
    const yaw = state.camera.yaw;
    // Sumbu input relatif terhadap arah kamera: maju = arah pandang
    // kamera (sin yaw, cos yaw), kanan = (-cos yaw, sin yaw).
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const mx = (fx * -az + rx * ax) * speed;
    const mz = (fz * -az + rz * ax) * speed;
    p.vx = mx;
    p.vz = mz;
    // Gerak X lalu Z supaya menempel dan bergeser di dinding.
    const nx = p.x + mx * dt;
    if (!collide(nx, p.z, C.playerRadius)) p.x = nx;
    const nz = p.z + mz * dt;
    if (!collide(p.x, nz, C.playerRadius)) p.z = nz;
    // Batas kota.
    p.x = mbClamp(p.x, -world.bounds, world.bounds);
    p.z = mbClamp(p.z, -world.bounds, world.bounds);
    // Hadap mengikuti arah gerak.
    if (Math.hypot(mx, mz) > 0.5) {
      p.heading = Math.atan2(mx, mz);
    }
    // Lompat + gravitasi.
    if (input.once.jump && p.onGround) {
      p.vy = C.jumpSpeed;
      p.onGround = false;
    }
    if (!p.onGround) {
      p.vy += C.gravity * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        p.onGround = true;
      }
    }
  }

  // ---- Update satu langkah (dt detik) ----
  function update(dt) {
    state.time.t += dt;
    // Kamera dari mouse.
    const look = input.consumeLook();
    state.camera.yaw -= look.dx * 0.0032;
    state.camera.pitch = mbClamp(
      state.camera.pitch + look.dy * 0.0026,
      C.camPitchMin, C.camPitchMax);

    if (input.once.pause) state.paused = !state.paused;
    if (input.once.mute) state.muted = !state.muted;
    if (state.paused || !state.started || state.over) return;

    const a = input.axis();
    if (!state.player.inVehicle) {
      movePlayer(dt, a.x, a.z, a.run);
    }

    // Aksi E / F / klik — delegasi ke modul Agent 2 bila ada.
    if (input.once.enter && typeof tryEnterVehicle === 'function') {
      try { tryEnterVehicle(state); } catch (err) { /* abaikan */ }
    }
    if (input.once.steal && typeof tryStealVehicle === 'function') {
      try { tryStealVehicle(state); } catch (err) { /* abaikan */ }
    }
    if (input.once.attack) {
      if (typeof attack === 'function') {
        try { attack(state); } catch (err) { /* abaikan */ }
      }
    }

    // Modul Agent 2/3 per frame (bila ada).
    if (vehiclesApi && typeof updateVehicles === 'function') {
      try { updateVehicles(state, dt); } catch (err) { /* abaikan */ }
    }
    if (trafficApi && typeof updateTraffic === 'function') {
      try { updateTraffic(state, dt); } catch (err) { /* abaikan */ }
    }
    if (policeApi && typeof updatePolice === 'function') {
      try { updatePolice(state, dt); } catch (err) { /* abaikan */ }
    }
    if (missionsApi && typeof updateMissions === 'function') {
      try { updateMissions(state, dt); } catch (err) { /* abaikan */ }
    }
    if (hudApi && typeof updateHUD === 'function') {
      try { updateHUD(state, dt); } catch (err) { /* abaikan */ }
    }

    // Wanted cooldown: bersembunyi menurunkan bintang perlahan.
    if (state.wanted.level > 0) {
      state.wanted.cooldown -= dt;
      if (state.wanted.cooldown <= 0) {
        state.wanted.level = Math.max(0, state.wanted.level - 1);
        state.wanted.cooldown = 12;
      }
    }

    // Kalah / menang.
    if (state.player.health <= 0) {
      gameOver(false);
    } else if (state.mission.status === 'done' && state.mission.id === 5) {
      gameOver(true);
    }
  }

  // ---- Loop fixed-step 60 Hz ----
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // jeda tab panjang tidak meledak
    acc += dt;
    const step = 1 / 60;
    let n = 0;
    while (acc >= step && n < 5) {
      update(step);
      acc -= step;
      n++;
    }
    if (!state.paused) {
      renderer.render(state, Math.min(dt, 0.05));
    }
    drawHudFallback();
    if (input.once.start && !state.started) startGame();
    input.endFrame();
  }

  // Overlay awal: judul + kontrol.
  showOverlay('MERIDIAN BAY',
    'Rio Kestrel, kurir yang terlilit utang. Jelajahi kota pelabuhan di senja hari — ' +
    'jalan kaki, curi mobil, hindari polisi, selesaikan misi. ' +
    'Gerak: ' + C.controls.move + ' · Lari: Shift · Lompat: Spasi · ' +
    'Masuk mobil: E · Curi: F · Serang: klik kiri · Jeda: P.',
    'MULAI');
  window.__MB__ = { state: state, world: world };
  window.__MB_READY__ = true;
  requestAnimationFrame(frame);
})();
