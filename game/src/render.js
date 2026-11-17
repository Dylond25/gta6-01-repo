// Meridian Bay — renderer: three.js, pencahayaan senja, kamera
// third-person, dan mesh pemain Rio Kestrel.
// createRenderer(canvas) mengembalikan { render(state, dt), resize }.
'use strict';

function createRenderer(canvas) {
  const C = MB_CONFIG;
  const THREE = window.THREE;

  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(C.colors.fog), 160, 720);

  // Pencahayaan senja: hemisphere + matahari rendah dari barat.
  const hemi = new THREE.HemisphereLight(0x8a6bbf, 0x2a2233, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.2);
  sun.position.set(-120, 55, -40);
  scene.add(sun);
  const amb = new THREE.AmbientLight(0x40304f, 0.75);
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

    // Posisi + arah pemain.
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
