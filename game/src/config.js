// Meridian Bay — konfigurasi inti (Agent 1, core world).
// Semua konstanta game tinggal di sini supaya modul lain tidak
// mengulang angka yang sama. Tanpa dependensi luar.
'use strict';

const MB_CONFIG = {
  title: 'Meridian Bay',
  hero: 'Rio Kestrel',
  saveKey: 'meridian-bay.save.v1',

  // Kota: grid blok + jalan.
  blockSize: 42,        // lebar satu blok bangunan (meter)
  roadWidth: 12,        // lebar jalan
  blocks: 8,            // blok per sisi (grid 8x8)
  blockTop: 0.12,       // tinggi trotoar/blok di atas jalan
  maxBuildingH: 74,     // tinggi menara tertinggi
  minBuildingH: 14,     // tinggi menara terendah

  // Pemain.
  walkSpeed: 5.2,
  runSpeed: 8.4,
  jumpSpeed: 7.5,
  gravity: -21,
  playerRadius: 0.55,
  playerHeight: 1.8,

  // Kamera third-person.
  camDist: 7.5,
  camHeight: 2.6,
  camPitchMin: 0.05,
  camPitchMax: 1.1,
  camPitchStart: 0.38,

  // Waktu dalam game (senja, tetap — pencahayaan dusk).
  timeOfDay: 'dusk',

  // Palet senja pelabuhan.
  colors: {
    skyTop: '#3a2560',
    skyMid: '#8a4a72',
    skyHorizon: '#ff8a45',
    sun: '#ffb36b',
    fog: '#46305e',
    ground: '#3a3a44',
    road: '#2f2f3a',
    sidewalk: '#55555f',
    lineCenter: '#e8b93b',
    lineEdge: '#d8d8d8',
    sea: '#17384f',
    pier: '#6b4a2f',
    lampHead: '#ffd98a',
  },

  // Kontrol (juga ditampilkan di overlay start).
  controls: {
    move: 'WASD / panah',
    run: 'Shift',
    jump: 'Spasi',
    enterCar: 'E',
    stealCar: 'F',
    attack: 'Klik kiri',
    pause: 'P',
    mute: 'M',
  },
};

// RNG deterministik (mulberry32): kota yang sama di setiap load.
function mbRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mbClamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function mbLerp(a, b, t) {
  return a + (b - a) * t;
}
