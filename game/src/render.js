// Meridian Bay — renderer: three.js, pencahayaan senja, kamera
// third-person, dan mesh pemain Rio Kestrel.
// createRenderer(canvas) mengembalikan { render(state, dt), resize }.
'use strict';

function createRenderer(canvas) {
  const C = MB_CONFIG;
  const THREE = window.THREE;

  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 2.1; // golden-hour (integrasi, polish: +0.2)
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(C.colors.fog), 160, 720);

  // Pencahayaan golden-hour: hemisphere + matahari rendah dari barat.
  const hemi = new THREE.HemisphereLight(0x8a6bbf, 0x2a2233, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.8);
  sun.position.set(-120, 55, -40);
  scene.add(sun);
  const amb = new THREE.AmbientLight(0x40304f, 1.0);
  scene.add(amb);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2200);

  // ---- Mesh pemain: Rio Kestrel (jaket teal, animasi kaki) ----
  const player = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: 0x1f8a8a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x23232e });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a986 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), jacket);
  body.position.y = 1.15;
  player.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin);
  head.position.y = 1.72;
  player.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.34), dark);
  hair.position.y = 1.92;
  player.add(hair);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.26), dark);
  legL.position.set(-0.16, 0.4, 0);
  player.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.26), dark);
  legR.position.set(0.16, 0.4, 0);
  player.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), jacket);
  armL.position.set(-0.42, 1.15, 0);
  player.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), jacket);
  armR.position.set(0.42, 1.15, 0);
  player.add(armR);
  // Penanda arah hadap (strip kuning di punggung) agar gerak terbaca.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xe8b93b }));
  stripe.position.set(0, 1.35, -0.19);
  player.add(stripe);
  scene.add(player);

  // ---- Pool peds (integrasi): geng + sopir yang dibegal tidak punya
  // mesh sendiri (missions.js / vehicles.js) — render.js yang membuat
  // dan menyinkronkannya. Geng oranye-merah, sopir abu-abu, peds mati
  // terbaring. Peds traffic.js sudah punya mesh — hanya dibaringkan
  // bila mati (traffic.js hanya mengubah rotation.y).
  const pedPool = new Map();
  function pedColor(ped) {
    if (ped.gang) return 0xd83a1e;      // geng oranye-merah
    if (ped.driver) return 0x8a8a92;    // sopir abu-abu
    return 0x3a6a8a;
  }
  function ensurePedMesh(ped) {
    let m = pedPool.get(ped.id);
    if (m) return m;
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: pedColor(ped) });
    const dark = new THREE.MeshLambertMaterial({ color: 0x23232e });
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a986 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.7, 0.32), mat);
    body.position.y = 1.12;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.3), skin);
    head.position.y = 1.68;
    g.add(head);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.76, 0.24), dark);
    legL.position.set(-0.15, 0.38, 0);
    g.add(legL);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.76, 0.24), dark);
    legR.position.set(0.15, 0.38, 0);
    g.add(legR);
    scene.add(g);
    pedPool.set(ped.id, g);
    return g;
  }
  function syncPeds(state) {
    if (!state.peds) return;
    for (const ped of state.peds) {
      const dead = (ped.health || 0) <= 0;
      let mesh = ped.mesh || null;
      if (!mesh) mesh = ensurePedMesh(ped);
      if (!mesh) continue;
      if (ped._mbCreated || !ped.mesh) {
        // Mesh buatan pool ini (atau tanpa pemilik): sinkron posisi.
        mesh.position.set(ped.x, 0, ped.z);
        mesh.rotation.y = ped.heading || 0;
        ped._mbCreated = true;
      }
      if (dead) {
        // Terbaring: putar rebah (traffic.js hanya menyentuh rotation.y).
        mesh.rotation.x = Math.PI / 2;
        mesh.position.y = 0.3;
      } else if (mesh.rotation.x !== 0) {
        mesh.rotation.x = 0;
        mesh.position.y = 0;
      }
    }
  }

  let walkPhase = 0;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function render(state, dt) {
    const p = state.player;
    const cam = state.camera;

    // Posisi + arah pemain. Di dalam mobil, mesh Rio disembunyikan
    // (polish 22 Nov): sebelumnya menembus atap mobil di screenshot.
    player.visible = !p.inVehicle;
    player.position.set(p.x, p.y, p.z);
    player.rotation.y = p.heading;
    // Animasi jalan: kaki mengayun saat bergerak.
    const speed = Math.hypot(p.vx || 0, p.vz || 0);
    if (speed > 0.4) {
      walkPhase += dt * speed * 1.9;
      const swing = Math.sin(walkPhase) * 0.55;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.7;
      armR.rotation.x = swing * 0.7;
    } else {
      legL.rotation.x *= 0.8;
      legR.rotation.x *= 0.8;
      armL.rotation.x *= 0.8;
      armR.rotation.x *= 0.8;
    }

    // Peds (geng/sopir/mati) + ferris wheel berputar pelan.
    syncPeds(state);
    try {
      const w = window.__MB__ && window.__MB__.world;
      if (w && w.ferrisWheel) {
        w.ferrisWheel.rotation.z += dt * 0.12;
        if (w.ferrisCabins) {
          for (const cb of w.ferrisCabins) cb.rotation.z -= dt * 0.12;
        }
      }
    } catch (err) { /* ferris opsional */ }

    // Menu awal (polish 22 Nov): kamera sinematik di boardwalk — palem
    // berjejer, ferris wheel di ujung utara, matahari senja di atas laut.
    // Begitu game mulai, kamera kembali mengejar pemain (lerp di bawah).
    if (!state.started) {
      camera.position.set(-208, 9, -10);
      camera.lookAt(-198, 14, -186);
      renderer.render(scene, camera);
      return;
    }

    // Kamera third-person: di belakang pemain, mengikuti yaw/pitch.
    const yaw = cam.yaw;
    const pitch = cam.pitch;
    const dist = C.camDist;
    const tx = p.x - Math.sin(yaw) * Math.cos(pitch) * dist;
    const tz = p.z - Math.cos(yaw) * Math.cos(pitch) * dist;
    const ty = p.y + C.camHeight + Math.sin(pitch) * dist;
    camera.position.x += (tx - camera.position.x) * Math.min(1, dt * 7);
    camera.position.y += (ty - camera.position.y) * Math.min(1, dt * 7);
    camera.position.z += (tz - camera.position.z) * Math.min(1, dt * 7);
    camera.lookAt(p.x, p.y + 1.4, p.z);

    renderer.render(scene, camera);
  }

  return { scene: scene, camera: camera, player: player, render: render, resize: resize };
}
