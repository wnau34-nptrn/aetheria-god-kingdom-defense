import { createFixedStepper } from '../systems/fixed-step.js';
import { chooseFoodTree } from '../systems/food-target.js';
import { RESOURCE_INFO, availableNode, nearestResourceNode, depositCargo } from '../systems/economy.js';
import { createEconomyControls } from '../ui/economy-controls.js';
import { recruitmentIssue, constructionRequirement } from '../systems/command-rules.js';
import { createDecisionControls } from '../ui/decision-controls.js';
import { PROGRESS_KEY, parseProgress } from '../systems/progress-save.js';

(() => {
  'use strict';
  let economy, decisionUI;
  let pendingDilemmaIdx = null;

  class SimplexNoise2D {
    constructor(seed = 1337) { this.reseed(seed); }
    reseed(seed) {
      this.p = new Uint8Array(256); this.perm = new Uint8Array(512); this.permMod12 = new Uint8Array(512);
      for (let i = 0; i < 256; i++) this.p[i] = i;
      let s = seed >>> 0;
      for (let i = 255; i > 0; i--) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const j = s % (i + 1), tmp = this.p[i]; this.p[i] = this.p[j]; this.p[j] = tmp;
      }
      for (let i = 0; i < 512; i++) { this.perm[i] = this.p[i & 255]; this.permMod12[i] = this.perm[i] % 12; }
    }
    noise2D(xin, yin) {
      const grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
      const F2 = 0.5 * (Math.sqrt(3.0) - 1.0), G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
      const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s), t = (i + j) * G2;
      const x0 = xin - (i - t), y0 = yin - (j - t);
      const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1.0 + 2.0 * G2, y2 = y0 - 1.0 + 2.0 * G2;
      const ii = i & 255, jj = j & 255;
      const gi0 = this.permMod12[ii + this.perm[jj]], gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]], gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]];
      let n0 = 0, n1 = 0, n2 = 0;
      let t0 = 0.5 - x0*x0 - y0*y0; if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (grad3[gi0][0]*x0 + grad3[gi0][1]*y0); }
      let t1 = 0.5 - x1*x1 - y1*y1; if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (grad3[gi1][0]*x1 + grad3[gi1][1]*y1); }
      let t2 = 0.5 - x2*x2 - y2*y2; if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (grad3[gi2][0]*x2 + grad3[gi2][1]*y2); }
      return 70.0 * (n0 + n1 + n2);
    }
    fbm(x, y, octaves = 4, persistence = 0.5, lacunarity = 2.0) {
      let total = 0, amp = 1, freq = 1, maxVal = 0;
      for (let i = 0; i < octaves; i++) { total += this.noise2D(x * freq, y * freq) * amp; maxVal += amp; amp *= persistence; freq *= lacunarity; }
      return total / maxVal;
    }
  }
  const simplex = new SimplexNoise2D(42026);

  class ProceduralAudioEngine {
    constructor() { this.ctx = null; this.enabled = false; this.volWind = 0.55; this.volWater = 0.65; this.volSfx = 0.75; }
    init() {
      if (this.ctx) { this.updateVolumes(); return; }
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext; if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        const bufferSize = this.ctx.sampleRate * 3, noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate), data = noiseBuffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + white * 0.0990460; b1 = 0.96300 * b1 + white * 0.2965164; b2 = 0.57000 * b2 + white * 1.0526913;
          data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.08;
        }
        const windSrc = this.ctx.createBufferSource(); windSrc.buffer = noiseBuffer; windSrc.loop = true;
        this.windFilter = this.ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 340; this.windFilter.Q.value = 3.2;
        this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.08 * this.volWind;
        windSrc.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.ctx.destination); windSrc.start(0);

        const waterSrc = this.ctx.createBufferSource(); waterSrc.buffer = noiseBuffer; waterSrc.loop = true;
        const waterFilter = this.ctx.createBiquadFilter(); waterFilter.type = 'lowpass'; waterFilter.frequency.value = 920;
        this.waterGain = this.ctx.createGain(); this.waterGain.gain.value = 0.09 * this.volWater;
        waterSrc.connect(waterFilter); waterFilter.connect(this.waterGain); this.waterGain.connect(this.ctx.destination); waterSrc.start(0);
        this.enabled = true; this.updateVolumes();
      } catch (e) {}
    }
    toggle() { if (!this.ctx) { this.init(); return this.enabled; } this.enabled = !this.enabled; this.updateVolumes(); return this.enabled; }
    updateVolumes() {
      const button = document.getElementById('btn-toggle-audio');
      if (button) { button.textContent = this.enabled ? '🔊 เสียง: เปิด' : '🔇 เสียง: ปิด'; button.classList.toggle('active', this.enabled); button.setAttribute('aria-pressed', String(this.enabled)); }
      if (!this.ctx) return;
      if (this.enabled && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      const now = this.ctx.currentTime;
      if (this.windGain) this.windGain.gain.setTargetAtTime(this.enabled ? 0.12 * this.volWind : 0, now, 0.1);
      if (this.waterGain) this.waterGain.gain.setTargetAtTime(this.enabled ? 0.11 * this.volWater : 0, now, 0.1);
    }
    modulateAmbience(elapsedTime, camHeight) {
      if (!this.ctx || !this.enabled || !this.windFilter) return;
      const lfo = Math.sin(elapsedTime * 0.45) * 120 + Math.cos(elapsedTime * 0.19) * 70;
      this.windFilter.frequency.setTargetAtTime(280 + Math.max(0, Math.min(300, (camHeight - 10) * 3.5)) + lfo, this.ctx.currentTime, 0.15);
    }
    playVillageBell(urgent = false) {
      if (!this.ctx || !this.enabled) return;
      try {
        const now = this.ctx.currentTime, baseFreq = urgent ? 587.33 : 523.25;
        [1, 2.0, 2.42, 3.0, 4.18].forEach((ratio, idx) => {
          const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
          osc.type = idx % 2 === 0 ? 'sine' : 'triangle'; osc.frequency.setValueAtTime(baseFreq * ratio, now);
          const gVal = [0.22, 0.12, 0.09, 0.05, 0.03][idx] * this.volSfx, dec = [2.8, 2.1, 1.5, 1.0, 0.6][idx];
          gain.gain.setValueAtTime(0.0001, now); gain.gain.linearRampToValueAtTime(gVal, now + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, now + dec);
          osc.connect(gain); gain.connect(this.ctx.destination); osc.start(now); osc.stop(now + dec + 0.05);
        });
      } catch (e) {}
    }
    playLightningThunder() {
      if (!this.ctx || !this.enabled) return;
      try {
        const now = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(920, now); osc.frequency.exponentialRampToValueAtTime(52, now + 0.35);
        gain.gain.setValueAtTime(0.28 * this.volSfx, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        osc.connect(gain); gain.connect(this.ctx.destination); osc.start(now); osc.stop(now + 0.4);
      } catch (e) {}
    }
    playMeteorImpact() {
      if (!this.ctx || !this.enabled) return;
      try {
        const now = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(160, now); osc.frequency.exponentialRampToValueAtTime(22, now + 1.6);
        gain.gain.setValueAtTime(0.45 * this.volSfx, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 1.65);
        osc.connect(gain); gain.connect(this.ctx.destination); osc.start(now); osc.stop(now + 1.7);
      } catch (e) {}
    }
    playBlessChime() {
      if (!this.ctx || !this.enabled) return;
      try {
        const now = this.ctx.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
          osc.type = 'sine'; osc.frequency.setValueAtTime(freq, now + i * 0.07);
          gain.gain.setValueAtTime(0.11 * this.volSfx, now + i * 0.07); gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.65);
          osc.connect(gain); gain.connect(this.ctx.destination); osc.start(now + i * 0.07); osc.stop(now + i * 0.07 + 0.7);
        });
      } catch (e) {}
    }
    playWorkTick(isMetal = false) {
      if (!this.ctx || !this.enabled) return;
      try {
        const now = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        osc.type = isMetal ? 'triangle' : 'sine'; osc.frequency.setValueAtTime(isMetal ? 1180 : 210, now); osc.frequency.exponentialRampToValueAtTime(isMetal ? 420 : 85, now + 0.07);
        gain.gain.setValueAtTime(0.05 * this.volSfx, now); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
        osc.connect(gain); gain.connect(this.ctx.destination); osc.start(now); osc.stop(now + 0.08);
      } catch (e) {}
    }
  }
  const audio = new ProceduralAudioEngine();
  audio.updateVolumes();

  const canvas = document.getElementById('game-canvas');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6ec6ff);
  scene.fog = new THREE.FogExp2(0x8fd3fe, 0.0028);

  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.5, 650);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const camCtrl = {
    target: new THREE.Vector3(0, 4, 0), theta: 0.58, phi: 0.92, radius: 96,
    targetTheta: 0.58, targetPhi: 0.92, targetRadius: 96,
    isDragging: false, isPanning: false, lastX: 0, lastY: 0,
    shakeTime: 0, shakeIntensity: 0, followEntity: null, keys: {},
    reset() { this.followEntity = null; this.target.set(0, 4, 0); this.targetTheta = 0.58; this.targetPhi = 0.92; this.targetRadius = 96; },
    triggerShake(intensity = 1.5, duration = 0.45) { this.shakeIntensity = Math.max(this.shakeIntensity, intensity); this.shakeTime = Math.max(this.shakeTime, duration); },
    update(dt) {
      const panSpeed = 32 * dt, fX = -Math.sin(this.theta), fZ = -Math.cos(this.theta), rX = Math.cos(this.theta), rZ = -Math.sin(this.theta);
      if (this.keys['KeyW'] || this.keys['ArrowUp']) { this.target.x += fX * panSpeed; this.target.z += fZ * panSpeed; this.followEntity = null; }
      if (this.keys['KeyS'] || this.keys['ArrowDown']) { this.target.x -= fX * panSpeed; this.target.z -= fZ * panSpeed; this.followEntity = null; }
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) { this.target.x -= rX * panSpeed; this.target.z -= rZ * panSpeed; this.followEntity = null; }
      if (this.keys['KeyD'] || this.keys['ArrowRight']) { this.target.x += rX * panSpeed; this.target.z += rZ * panSpeed; this.followEntity = null; }
      if (this.followEntity && this.followEntity.mesh && this.followEntity.alive !== false) this.target.lerp(this.followEntity.mesh.position, 0.12);
      this.target.x = THREE.MathUtils.clamp(this.target.x, -105, 105);
      this.target.z = THREE.MathUtils.clamp(this.target.z, -105, 105);
      this.theta += (this.targetTheta - this.theta) * 0.14;
      this.phi += (this.targetPhi - this.phi) * 0.14;
      this.radius += (this.targetRadius - this.radius) * 0.14;
      const sinPhi = Math.sin(this.phi);
      let cx = this.target.x + this.radius * sinPhi * Math.sin(this.theta);
      let cy = this.target.y + this.radius * Math.cos(this.phi);
      let cz = this.target.z + this.radius * sinPhi * Math.cos(this.theta);
      if (this.shakeTime > 0) {
        this.shakeTime -= dt;
        const s = this.shakeIntensity * (this.shakeTime / 0.5);
        cx += (Math.random() - 0.5) * s * 2; cy += (Math.random() - 0.5) * s * 2; cz += (Math.random() - 0.5) * s * 2;
      }
      camera.position.set(cx, cy, cz);
      camera.lookAt(this.target);
    }
  };

  const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x3f6212, 0.65);
  scene.add(hemiLight);
  const sunLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
  sunLight.position.set(60, 85, 40);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048; sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10; sunLight.shadow.camera.far = 240;
  sunLight.shadow.camera.left = -72; sunLight.shadow.camera.right = 72; sunLight.shadow.camera.top = 72; sunLight.shadow.camera.bottom = -72;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  const moonLight = new THREE.DirectionalLight(0x60a5fa, 0.0);
  moonLight.position.set(-60, 75, -40);
  scene.add(moonLight);

  const templePointLight = new THREE.PointLight(0xffb703, 1.4, 34); templePointLight.position.set(0, 9, 0); scene.add(templePointLight);
  const portalPointLight = new THREE.PointLight(0xa855f7, 1.8, 36); portalPointLight.position.set(68, 9, -58); scene.add(portalPointLight);
  const defensePointLight = new THREE.PointLight(0xff9f1c, 0.0, 28); defensePointLight.position.set(38, 7, -30); scene.add(defensePointLight);
  const godFxPointLight = new THREE.PointLight(0x38bdf8, 0.0, 42); godFxPointLight.position.set(0, 15, 0); scene.add(godFxPointLight);

  const celestialGroup = new THREE.Group(); scene.add(celestialGroup);
  const sunOrb = new THREE.Mesh(new THREE.SphereGeometry(7.5, 20, 20), new THREE.MeshBasicMaterial({ color: 0xfde047 }));
  sunOrb.add(new THREE.Mesh(new THREE.SphereGeometry(12.0, 20, 20), new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.32 })));
  celestialGroup.add(sunOrb);

  const moonOrb = new THREE.Mesh(new THREE.SphereGeometry(5.5, 20, 20), new THREE.MeshBasicMaterial({ color: 0xe0f2fe }));
  moonOrb.add(new THREE.Mesh(new THREE.SphereGeometry(8.8, 16, 16), new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.25 })));
  celestialGroup.add(moonOrb);

  const starCount = 850, starGeo = new THREE.BufferGeometry(), starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * 2.0 * Math.PI, phi = Math.acos(2.0 * Math.random() - 1.0), r = 240 + Math.random() * 60;
    starPos[i*3] = r * Math.sin(phi) * Math.cos(theta); starPos[i*3+1] = Math.abs(r * Math.cos(phi)) + 15; starPos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xf8fafc, size: 1.5, transparent: true, opacity: 0.0 });
  scene.add(new THREE.Points(starGeo, starMat));

  const ISLAND_RADIUS = 112, GRID_SEGMENTS = 84, GRID_SIZE = 240;
  let currentCivEra = 1;
  const islandGroup = new THREE.Group(); scene.add(islandGroup);
  let terrainGeo = null, terrainMesh = null, undersideMesh = null, riverMesh = null;
  const userHeightOffsets = new Float32Array((GRID_SEGMENTS + 1) * (GRID_SEGMENTS + 1));

  function getRiverCenterX(z) { return -14.0 + Math.sin(z * 0.045 + 0.4) * 8.5 + (z / 98) * 6.0; }
  function getRiverWidth(z) {
    if (z < -62) return 0;
    if (z < -46) return Math.max(4.0, 9.5 - Math.abs(z + 54) * 0.6);
    return 3.8 + Math.max(0, (z + 46) / 145) * 2.4;
  }
  function getIslandMask(x, z) {
    const r = Math.hypot(x, z), angle = Math.atan2(z, x);
    const coastNoise = simplex.fbm(Math.cos(angle) * 1.6 + x * 0.012, Math.sin(angle) * 1.6 + z * 0.012, 3) * 12.0;
    const effectiveR = r + coastNoise;
    if (effectiveR >= ISLAND_RADIUS) return 0;
    const edgeStart = ISLAND_RADIUS - 18.0;
    if (effectiveR <= edgeStart) return 1.0;
    const t = (ISLAND_RADIUS - effectiveR) / 18.0;
    return t * t * (3 - 2 * t);
  }
  function isPointOnRoad(x, z) {
    // Main East-West Highway (from Farmland -42,14 across South Bridge z=14 to Town & Market 28,14)
    if (x >= -44 && x <= 32 && Math.abs(z - 14.0) < 2.1) return true;
    // North-South Town Avenue (from North Outpost z=-28 through Sanctuary 0,0 to South Ranch z=36)
    if (z >= -28 && z <= 38 && Math.abs(x - 2.0 - Math.sin(z * 0.08) * 2.5) < 2.2) return true;
    // Frontier Military Road toward Northeast Watchtowers (from 2, -16 to 52, -46)
    if (x >= 2 && x <= 54 && z >= -48 && z <= -14) {
      const expectedZ = -16 - ((x - 2) / 52) * 30;
      if (Math.abs(z - expectedZ) < 2.0) return true;
    }
    return false;
  }
  function computeProceduralBaseHeight(x, z) {
    const mask = getIslandMask(x, z);
    if (mask <= 0.001) return -6.5;
    const n1 = simplex.fbm(x * 0.014, z * 0.014, 4, 0.5, 2.0) * 9.5;
    const n2 = simplex.fbm(x * 0.04 + 10, z * 0.04 + 10, 2) * 1.8;
    let h = 3.2 + (n1 + n2) * mask;

    // Vast Flat Central, Western Farmland, and Eastern Town Plains (radius 68!)
    const distPlains = Math.hypot(x * 0.85, z - 4);
    if (distPlains < 68) {
      const f = Math.max(0, 1 - distPlains / 68);
      const smoothF = f * f * (3 - 2 * f);
      h = THREE.MathUtils.lerp(h, 4.15 + simplex.noise2D(x * 0.03, z * 0.03) * 0.32, smoothF * 0.92);
    }

    // Majestic Northern Mountain Range (-38, -62) & Northwest Peaks
    const distMountain = Math.hypot(x + 36, z + 60);
    if (distMountain < 36) {
      const mf = Math.max(0, 1 - distMountain / 36);
      h += mf * mf * 18.5 * mask;
    }
    const distEastPeak = Math.hypot(x - 32, z + 68);
    if (distEastPeak < 28) {
      const mf2 = Math.max(0, 1 - distEastPeak / 28);
      h += mf2 * mf2 * 14.0 * mask;
    }

    // Distant Demon Portal Obsidian Plateau far out at (68, -58)
    const distPortal = Math.hypot(x - 68, z + 58);
    if (distPortal < 18) {
      const pf = Math.max(0, 1 - distPortal / 18);
      h = THREE.MathUtils.lerp(h, 5.6, pf * 0.88);
    }

    // Carve River Channel from z = -62 to Southern Waterfall z = 102
    if (z >= -62 && z <= 104) {
      const rx = getRiverCenterX(z), rw = getRiverWidth(z), distRiver = Math.abs(x - rx);
      if (distRiver < rw * 2.1) {
        const rf = Math.max(0, 1 - distRiver / (rw * 2.1));
        h = Math.min(h, 3.6 - ((z + 62) / 164) * 2.2) - (rf * rf) * 4.5;
      }
    }
    return h;
  }
  function getTerrainHeightAt(x, z) {
    const half = GRID_SIZE / 2;
    if (Math.abs(x) > half || Math.abs(z) > half) return -6.5;
    const gx = ((x + half) / GRID_SIZE) * GRID_SEGMENTS, gz = ((z + half) / GRID_SIZE) * GRID_SEGMENTS;
    const ix = Math.max(0, Math.min(GRID_SEGMENTS - 1, Math.floor(gx))), iz = Math.max(0, Math.min(GRID_SEGMENTS - 1, Math.floor(gz)));
    const fx = gx - ix, fz = gz - iz, stride = GRID_SEGMENTS + 1;
    const o00 = userHeightOffsets[iz * stride + ix], o10 = userHeightOffsets[iz * stride + (ix + 1)];
    const o01 = userHeightOffsets[(iz + 1) * stride + ix], o11 = userHeightOffsets[(iz + 1) * stride + (ix + 1)];
    return computeProceduralBaseHeight(x, z) + (o00 * (1 - fx) + o10 * fx) * (1 - fz) + (o01 * (1 - fx) + o11 * fx) * fz;
  }
  window._getTerrainHeightAt = getTerrainHeightAt;
  function getWaterLevelAt(z) { return 2.55 - ((z + 62) / 164) * 2.2; }
  function isPointInRiver(x, z) {
    if (z < -62 || z > 100) return false;
    return Math.abs(x - getRiverCenterX(z)) < getRiverWidth(z) * 1.25;
  }
  function isOnBridgeDeck(x, z) {
    const levels = currentCivEra >= 3 ? [14, -16] : [14];
    return levels.some(bz => Math.abs(z - bz) <= 2.2 && Math.abs(x - getRiverCenterX(bz)) <= getRiverWidth(bz) * 1.45 + 4.4);
  }
  function getTerrainSlopeAt(x, z) {
    const eps = 1.2;
    return Math.hypot((getTerrainHeightAt(x + eps, z) - getTerrainHeightAt(x - eps, z)) / (2 * eps), (getTerrainHeightAt(x, z + eps) - getTerrainHeightAt(x, z - eps)) / (2 * eps));
  }

  function rebuildTerrainVertices() {
    if (!terrainGeo) return;
    const posAttr = terrainGeo.attributes.position, colAttr = terrainGeo.attributes.color, count = posAttr.count, c = new THREE.Color();
    if (!terrainGeo.userData.baseXZ) {
      const bx = new Float32Array(count), bz = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        let x = posAttr.getX(i), z = posAttr.getZ(i);
        const r = Math.hypot(x, z), angle = Math.atan2(z, x);
        const coastNoise = simplex.fbm(Math.cos(angle) * 1.6 + x * 0.02, Math.sin(angle) * 1.6 + z * 0.02, 3) * 7.5;
        const maxR = ISLAND_RADIUS - coastNoise;
        if (r > maxR) { x = Math.cos(angle) * maxR; z = Math.sin(angle) * maxR; posAttr.setXYZ(i, x, -4.5, z); }
        bx[i] = posAttr.getX(i); bz[i] = posAttr.getZ(i);
      }
      terrainGeo.userData.baseXZ = { bx, bz };
    }
    const { bx, bz } = terrainGeo.userData.baseXZ;
    for (let i = 0; i < count; i++) {
      const x = bx[i], z = bz[i], mask = getIslandMask(x, z);
      const y = (mask <= 0.015) ? -4.2 : (computeProceduralBaseHeight(x, z) + userHeightOffsets[i]);
      posAttr.setXYZ(i, x, y, z);
      const distRiver = Math.abs(x - getRiverCenterX(z)), rw = getRiverWidth(z), waterY = getWaterLevelAt(z);
      if (mask <= 0.02) c.setHex(0x334155);
      else if (z >= -62 && distRiver < rw * 1.35 && y < waterY + 0.55) c.setHex(y < waterY - 0.3 ? 0x1e3a5f : 0xe2c792);
      else if (y > 14.5) c.setHex(0xf1f5f9);
      else if (y > 9.2) c.setHex(0x64748b);
      else if (y > 6.2) c.setHex(0x2d6a4f);
      else if (y > 1.8) { const v = simplex.noise2D(x * 0.12, z * 0.12) * 0.05; c.setRGB(0.24 + v, 0.64 + v * 1.2, 0.30 + v); }
      else c.setHex(0x475569);
      if (currentCivEra >= 2 && !isPointInRiver(x, z) && isPointOnRoad(x, z)) {
        c.lerp(new THREE.Color(currentCivEra >= 3 ? 0xd6bfa3 : 0x9c7a54), currentCivEra >= 3 ? 0.78 : 0.48);
      }
      const dPortal = Math.hypot(x - 68, z + 58);
      if (dPortal < 18.5) c.lerp(new THREE.Color(0x3b1d5e), Math.max(0, 1 - dPortal / 18.5) * 0.78);
      colAttr.setXYZ(i, c.r, c.g, c.b);
    }
    posAttr.needsUpdate = true; colAttr.needsUpdate = true; terrainGeo.computeVertexNormals();
  }

  function buildFloatingIslandMeshes() {
    if (terrainMesh) { islandGroup.remove(terrainMesh); terrainGeo.dispose(); }
    if (undersideMesh) { islandGroup.remove(undersideMesh); undersideMesh.geometry.dispose(); }
    if (riverMesh) { islandGroup.remove(riverMesh); riverMesh.geometry.dispose(); }

    terrainGeo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE, GRID_SEGMENTS, GRID_SEGMENTS);
    terrainGeo.rotateX(-Math.PI / 2);
    terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(terrainGeo.attributes.position.count * 3), 3));
    rebuildTerrainVertices();

    terrainMesh = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05, flatShading: false }));
    terrainMesh.receiveShadow = true; terrainMesh.castShadow = false;
    islandGroup.add(terrainMesh);

    const underGeo = new THREE.ConeGeometry(ISLAND_RADIUS * 0.94, 48, 44, 10, false);
    underGeo.rotateX(Math.PI); underGeo.translate(0, -24.5, 0);
    const uPos = underGeo.attributes.position, uCol = new Float32Array(uPos.count * 3), uc = new THREE.Color();
    for (let i = 0; i < uPos.count; i++) {
      let vx = uPos.getX(i), vy = uPos.getY(i), vz = uPos.getZ(i);
      const angle = Math.atan2(vz, vx), coastMod = simplex.fbm(Math.cos(angle) * 1.6 + vx * 0.02, Math.sin(angle) * 1.6 + vz * 0.02, 3) * 6.5;
      if (vy > -3.0) {
        const scaleRim = Math.max(0.5, (ISLAND_RADIUS - coastMod) / (ISLAND_RADIUS * 0.94));
        vx *= scaleRim; vz *= scaleRim; vy = -1.2 + simplex.noise2D(vx * 0.08, vz * 0.08) * 1.4;
      } else {
        const crag = simplex.fbm(vx * 0.07, vy * 0.09 + vz * 0.07, 3) * 5.2, factor = Math.min(1, Math.abs(vy) / 44);
        vx += Math.cos(angle) * crag * (1 - factor * 0.4); vz += Math.sin(angle) * crag * (1 - factor * 0.4);
      }
      uPos.setXYZ(i, vx, vy, vz);
      uc.setHex(vy < -34 ? 0x38bdf8 : (vy < -18 ? 0x1e293b : 0x475569));
      uCol[i*3] = uc.r; uCol[i*3+1] = uc.g; uCol[i*3+2] = uc.b;
    }
    underGeo.setAttribute('color', new THREE.Float32BufferAttribute(uCol, 3)); underGeo.computeVertexNormals();
    undersideMesh = new THREE.Mesh(underGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.15, flatShading: false }));
    undersideMesh.receiveShadow = true; undersideMesh.castShadow = false;
    islandGroup.add(undersideMesh);

    const riverGeo = new THREE.PlaneGeometry(1, 1, 10, 48);
    riverGeo.rotateX(-Math.PI / 2);
    const rPos = riverGeo.attributes.position;
    for (let i = 0; i < rPos.count; i++) {
      const u = rPos.getX(i), v = rPos.getZ(i), z = THREE.MathUtils.lerp(-60, 96.5, v + 0.5);
      rPos.setXYZ(i, getRiverCenterX(z) + u * getRiverWidth(z) * 2.5, getWaterLevelAt(z), z);
    }
    riverGeo.computeVertexNormals();
    riverMesh = new THREE.Mesh(riverGeo, new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0284c7, emissiveIntensity: 0.22, roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.86 }));
    islandGroup.add(riverMesh);
  }
  buildFloatingIslandMeshes();

  const floatingRocks = [];
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.85, roughness: 0.2 });
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2, crystal = new THREE.Mesh(new THREE.OctahedronGeometry(2.4, 0), crystalMat);
    crystal.scale.set(1, 2.8, 1); crystal.position.set(Math.cos(ang) * 14, -29 - (i % 3) * 4, Math.sin(ang) * 14);
    islandGroup.add(crystal);
  }
  const satRockMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 });
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2 + Math.random() * 0.3, dist = 62 + Math.random() * 24, yBase = -16 + (Math.random() - 0.5) * 24;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.8 + Math.random() * 2.6, 0), satRockMat);
    rock.scale.set(1.2, 0.8, 1.1); rock.position.set(Math.cos(ang) * dist, yBase, Math.sin(ang) * dist);
    scene.add(rock);
    floatingRocks.push({ mesh: rock, ang, dist, yBase, speed: 0.05 + Math.random() * 0.06, phase: Math.random() * 6 });
  }

  const waterfallGroup = new THREE.Group(); scene.add(waterfallGroup);
  const wfLipX = getRiverCenterX(96.2), wfLipZ = 96.2, wfLipY = getWaterLevelAt(96.2);
  const wfCurtain = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5.2, 52, 16, 12, true), new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.62, side: THREE.DoubleSide }));
  wfCurtain.position.set(wfLipX, wfLipY - 26, wfLipZ + 1.2);
  waterfallGroup.add(wfCurtain);

  const wfParticleCount = 280, wfGeo = new THREE.BufferGeometry(), wfPositions = new Float32Array(wfParticleCount * 3), wfVelocities = [];
  for (let i = 0; i < wfParticleCount; i++) {
    wfPositions[i*3] = wfLipX + (Math.random() - 0.5) * 6.5; wfPositions[i*3+1] = wfLipY - Math.random() * 52; wfPositions[i*3+2] = wfLipZ + Math.random() * 3.5;
    wfVelocities.push({ vx: (Math.random() - 0.5) * 1.8, vy: -(12 + Math.random() * 14), vz: 1.2 + Math.random() * 2.2 });
  }
  wfGeo.setAttribute('position', new THREE.Float32BufferAttribute(wfPositions, 3));
  waterfallGroup.add(new THREE.Points(wfGeo, new THREE.PointsMaterial({ color: 0xe0f2fe, size: 1.35, transparent: true, opacity: 0.82 })));

  const clouds = [], cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, transparent: true, opacity: 0.88 });
  for (let i = 0; i < 24; i++) {
    const cGroup = new THREE.Group(), puffs = 3 + (i % 4);
    for (let p = 0; p < puffs; p++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(4.5 + Math.random() * 3.2, 12, 10), cloudMat);
      puff.position.set((p - puffs / 2) * 4.5, (Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 3.2); puff.scale.set(1.3, 0.62, 1.1);
      cGroup.add(puff);
    }
    cGroup.position.set((Math.random() - 0.5) * 240, -18 - Math.random() * 26, (Math.random() - 0.5) * 240);
    scene.add(cGroup);
    clouds.push({ mesh: cGroup, speed: 2.2 + Math.random() * 3.2, bobPhase: Math.random() * Math.PI * 2 });
  }

  const worldObjectsGroup = new THREE.Group(); scene.add(worldObjectsGroup);
  const trees = [], ores = [], buildings = [], agents = [], monsters = [], projectiles = [], fxParticles = [], wagons = [], livestock = [], windmills = [], boats = [], cropFields = [];
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.85 });
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.72 });
  const oakMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.72 });
  const fruitMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xbe123c, emissiveIntensity: 0.35, roughness: 0.25 });
  const windowLightMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xf59e0b, emissiveIntensity: 0.0, roughness: 0.2 });

  let templeObj = null, portalObj = null, portalRingMesh = null;

  function isNearBuildingFoundation(x, z, extraMargin = 0) {
    for (const b of buildings) {
      if (Math.hypot(x - b.x, z - b.z) < (b.type === 'temple' ? 8.0 : 5.8) + extraMargin) return true;
    }
    for (const cf of cropFields) {
      if (Math.hypot(x - cf.x, z - cf.z) < 5.8 + extraMargin) return true;
    }
    if (currentCivEra >= 2 && Math.hypot(x - 24, z - 31) < 9.5 + extraMargin) return true; // Livestock corral
    if (currentCivEra >= 2 && Math.hypot(x - 2.5, z - 9.5) < 3.5 + extraMargin) return true; // Town well
    if (portalObj && Math.hypot(x - portalObj.x, z - portalObj.z) < 8.5 + extraMargin) return true;
    return false;
  }
  function getBuildingPlacementIssue(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || getIslandMask(x, z) < 0.42) return 'อยู่นอกพื้นที่เกาะที่สร้างได้';
    if (isPointInRiver(x, z)) return 'อยู่ในแม่น้ำ';
    if (isPointOnRoad(x, z)) return 'กีดขวางถนน';
    const h = getTerrainHeightAt(x, z), waterY = getWaterLevelAt(z);
    if (h < waterY + 0.75) return 'พื้นดินต่ำใกล้ระดับน้ำเกินไป';
    if (h > 5.6) return 'พื้นที่สูงเกินระดับที่สร้างได้';
    if (getTerrainSlopeAt(x, z) > 0.22) return 'พื้นดินลาดชันเกินไป';
    if (isNearBuildingFoundation(x, z, 0.5)) return 'ใกล้อาคาร แปลงนา หรือสิ่งปลูกสร้างเกินไป';
    return null;
  }
  function canPlaceBuildingAt(x, z) {
    return getBuildingPlacementIssue(x, z) === null;
  }
  function clearFootprintResources(x, z, radius = 3.2) {
    for (let i = trees.length - 1; i >= 0; i--) if (Math.hypot(trees[i].x - x, trees[i].z - z) < radius) { worldObjectsGroup.remove(trees[i].mesh); trees.splice(i, 1); }
    for (let i = ores.length - 1; i >= 0; i--) if (Math.hypot(ores[i].x - x, ores[i].z - z) < radius) { worldObjectsGroup.remove(ores[i].mesh); ores.splice(i, 1); }
  }

  // Shared high-detail procedural materials with explicit matType for shader realism
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x5c3418, roughness: 0.88, matType: 2 });
  const darkTimberMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.82, matType: 2 });
  const warmTimberMat = new THREE.MeshStandardMaterial({ color: 0x854d0e, roughness: 0.78, matType: 2 });
  const cutStoneMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.80, matType: 3 });
  const lightStoneMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.72, matType: 3 });
  const marbleStoneMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.45, matType: 3 });
  const stuccoCreamMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.74, matType: 3 });
  const redBrickMat = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.78, matType: 3 });
  const thatchRoofMat = new THREE.MeshStandardMaterial({ color: 0xca8a04, roughness: 0.84, matType: 4 });
  const terracottaTileMat = new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.58, matType: 4 });
  const slateRoofMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.48, matType: 4 });
  const royalGoldMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.65, roughness: 0.25, matType: 6 });

  function bakeStaticGroup(group, keepDynamic = []) {
    const keepSet = new Set(keepDynamic);
    const toBake = [];
    for (const ch of group.children) {
      if (keepSet.has(ch) || ch.material === windowLightMat || (ch.material && (ch.material.isBasic || ch.material.transparent)) || !ch.isMesh) continue;
      toBake.push(ch);
    }
    if (toBake.length <= 1) return;
    const verts = [], norms = [], cols = [], indices = [];
    let vOffset = 0;
    for (const m of toBake) {
      const geom = m.geometry;
      if (!geom || !geom.attributes.position) continue;
      if (!geom.attributes.normal) geom.computeVertexNormals();
      const pos = geom.attributes.position, norm = geom.attributes.normal, idx = geom.index;
      const mat = m.material || new THREE.MeshStandardMaterial();
      const cr = mat.color ? mat.color.r : 1, cg = mat.color ? mat.color.g : 1, cb = mat.color ? mat.color.b : 1;
      const cx = Math.cos(m.rotation.x), sx = Math.sin(m.rotation.x);
      const cy = Math.cos(m.rotation.y), sy = Math.sin(m.rotation.y);
      const cz = Math.cos(m.rotation.z), sz = Math.sin(m.rotation.z);
      const m00 = cy*cz, m01 = cy*sz, m02 = -sy;
      const m10 = sx*sy*cz - cx*sz, m11 = sx*sy*sz + cx*cz, m12 = sx*cy;
      const m20 = cx*sy*cz + sx*sz, m21 = cx*sy*sz - sx*cz, m22 = cx*cy;
      const scx = m.scale.x, scy = m.scale.y, scz = m.scale.z;
      const px = m.position.x, py = m.position.y, pz = m.position.z;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i) * scx, vy = pos.getY(i) * scy, vz = pos.getZ(i) * scz;
        verts.push(m00*vx + m10*vy + m20*vz + px, m01*vx + m11*vy + m21*vz + py, m02*vx + m12*vy + m22*vz + pz);
        const nx = norm.getX(i) / (scx || 1), ny = norm.getY(i) / (scy || 1), nz = norm.getZ(i) / (scz || 1);
        const rnx = m00*nx + m10*ny + m20*nz, rny = m01*nx + m11*ny + m21*nz, rnz = m02*nx + m12*ny + m22*nz;
        const nl = Math.hypot(rnx, rny, rnz) || 1;
        norms.push(rnx / nl, rny / nl, rnz / nl);
        cols.push(cr, cg, cb);
      }
      if (idx) {
        for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vOffset);
      } else {
        for (let i = 0; i < pos.count; i++) indices.push(i + vOffset);
      }
      vOffset += pos.count;
      group.remove(m);
    }
    const mergedGeo = new THREE.BufferGeometry();
    mergedGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    mergedGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(norms), 3));
    mergedGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
    mergedGeo.setIndex(indices);
    const mergedMesh = new THREE.Mesh(mergedGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, matType: 99 }));
    mergedMesh.castShadow = true; mergedMesh.receiveShadow = true;
    group.add(mergedMesh);
  }
  function flattenAndBakeGroup(group, keepDynamic = []) {
    const keepSet = new Set(keepDynamic);
    // Flatten one level of child sub-groups (such as buildPitchedGableRoof) before baking
    for (let i = group.children.length - 1; i >= 0; i--) {
      const ch = group.children[i];
      if (!ch.isMesh && ch.children && ch.children.length > 0 && !keepSet.has(ch)) {
        for (let j = ch.children.length - 1; j >= 0; j--) {
          const sub = ch.children[j];
          if (sub.isMesh) {
            sub.position.x += ch.position.x;
            sub.position.y += ch.position.y;
            sub.position.z += ch.position.z;
            ch.remove(sub);
            group.add(sub);
          }
        }
        if (ch.children.length === 0) group.remove(ch);
      }
    }
    bakeStaticGroup(group, keepDynamic);
  }

  function buildPitchedGableRoof(w, l, h, roofMat, gableMat, timberMat) {
    const rg = new THREE.Group();
    const halfW = w * 0.52;
    const slopeLen = Math.hypot(halfW, h) + 0.28;
    const angle = Math.atan2(h, halfW);
    const roofL = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.18, l + 0.5), roofMat);
    roofL.position.set(-halfW * 0.5, h * 0.5, 0);
    roofL.rotation.z = angle;
    rg.add(roofL);
    const roofR = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.18, l + 0.5), roofMat);
    roofR.position.set(halfW * 0.5, h * 0.5, 0);
    roofR.rotation.z = -angle;
    rg.add(roofR);
    // Ridge beam & front/back finials
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, l + 0.68), timberMat);
    ridge.position.set(0, h + 0.04, 0);
    rg.add(ridge);
    // Front & back gable wall triangles + bargeboard rafters
    for (const sideZ of [-1, 1]) {
      // Exact flush triangular gable wall prism (front & back faces)
      const gw = w * 0.5, gh = h, gd = 0.12, gz = sideZ * (l * 0.5 - 0.08);
      const triGeo = new THREE.BufferGeometry();
      const triVerts = new Float32Array([
        // Front face
        -gw, 0, gz + gd,   gw, 0, gz + gd,   0, gh, gz + gd,
        // Back face
         gw, 0, gz - gd,  -gw, 0, gz - gd,   0, gh, gz - gd
      ]);
      triGeo.setAttribute('position', new THREE.BufferAttribute(triVerts, 3));
      triGeo.setIndex([0, 1, 2, 3, 4, 5]);
      triGeo.computeVertexNormals();
      rg.add(new THREE.Mesh(triGeo, gableMat));
      // King-post vertical timber stud in center of gable
      const kingPost = new THREE.Mesh(new THREE.BoxGeometry(0.14, gh * 0.92, 0.28), timberMat);
      kingPost.position.set(0, gh * 0.46, gz);
      rg.add(kingPost);
      const bargeL = new THREE.Mesh(new THREE.BoxGeometry(slopeLen + 0.1, 0.22, 0.14), timberMat);
      bargeL.position.set(-halfW * 0.5, h * 0.5, sideZ * (l * 0.5 + 0.22));
      bargeL.rotation.z = angle;
      rg.add(bargeL);
      const bargeR = new THREE.Mesh(new THREE.BoxGeometry(slopeLen + 0.1, 0.22, 0.14), timberMat);
      bargeR.position.set(halfW * 0.5, h * 0.5, sideZ * (l * 0.5 + 0.22));
      bargeR.rotation.z = -angle;
      rg.add(bargeR);
      const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.65, 6), timberMat);
      finial.position.set(0, h + 0.32, sideZ * (l * 0.5 + 0.22));
      rg.add(finial);
    }
    return rg;
  }

  function createVillageBridge(bz = 14.0, era = currentCivEra) {
    const bx = getRiverCenterX(bz), bankY = 4.12, g = new THREE.Group();
    g.position.set(bx, bankY, bz);
    const riverSlope = (getRiverCenterX(bz + 2) - getRiverCenterX(bz - 2)) / 4.0;
    g.rotation.y = Math.atan2(riverSlope, 1.0) * 0.35;
    g.castShadow = true;
    const rw = getRiverWidth(bz) * 2.8 + 5.5;

    if (era === 1) {
      // Era 1: Rustic Timber Trestle & Plank Footbridge with Rope-and-Post Handrails
      for (const lz of [-1.1, 1.1]) {
        const stringer = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, rw, 8), barkMat);
        stringer.rotation.z = Math.PI / 2; stringer.position.set(0, -0.05, lz); g.add(stringer);
      }
      const plankCount = Math.floor(rw * 1.6);
      for (let i = 0; i < plankCount; i++) {
        const px = -rw * 0.48 + (i / (plankCount - 1)) * rw * 0.96;
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 2.8), i % 2 === 0 ? warmTimberMat : barkMat);
        plank.position.set(px, 0.14, 0); g.add(plank);
      }
      for (const px of [-rw * 0.42, -rw * 0.14, rw * 0.14, rw * 0.42]) {
        for (const pz of [-1.25, 1.25]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 3.2, 6), barkMat);
          post.position.set(px, -0.45, pz); g.add(post);
        }
      }
      for (const pz of [-1.25, 1.25]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, rw, 6), warmTimberMat);
        rail.rotation.z = Math.PI / 2; rail.position.set(0, 0.85, pz); g.add(rail);
      }
    } else {
      // Era 2-4: Arched Stone & Timber Bridge with Parapet Balustrades, Stone Piers & Wrought-Iron Streetlamps
      const stoneMat = era >= 4 ? marbleStoneMat : cutStoneMat;
      const deckMat = era >= 4 ? lightStoneMat : warmTimberMat;
      const lanternMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xf59e0b, emissiveIntensity: 1.1, roughness: 0.2 });

      // Main cambered deck + individual transverse planks/slabs
      const deck = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.42, 3.8), stoneMat);
      deck.position.y = 0.08; g.add(deck);
      const slabCount = Math.floor(rw * 1.2);
      for (let i = 0; i < slabCount; i++) {
        const px = -rw * 0.46 + (i / Math.max(1, slabCount - 1)) * rw * 0.92;
        const archLift = Math.cos((px / (rw * 0.5)) * (Math.PI * 0.4)) * 0.18;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 3.5), deckMat);
        slab.position.set(px, 0.30 + archLift * 0.3, 0); g.add(slab);
      }
      for (const side of [-1, 1]) {
        const ramp = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.34, 3.8), stoneMat);
        ramp.position.set(side * (rw * 0.5 + 1.2), -0.14, 0);
        ramp.rotation.z = -side * 0.15; g.add(ramp);
      }
      // Stone Cutwater Piers & Parapet Balustrade Pillars
      for (const px of [-rw * 0.44, -rw * 0.16, rw * 0.16, rw * 0.44]) {
        for (const pz of [-1.72, 1.72]) {
          const pier = new THREE.Mesh(new THREE.BoxGeometry(0.78, 3.6, 0.78), cutStoneMat);
          pier.position.set(px, -0.75, pz); g.add(pier);
          const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.05, 0.52), stoneMat);
          pillar.position.set(px, 0.78, pz); g.add(pillar);
          if (Math.abs(px) > rw * 0.3) {
            const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.35, 6), darkTimberMat);
            lampPost.position.set(px, 1.65, pz); g.add(lampPost);
            const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.34), lanternMat);
            lantern.position.set(px, 2.35, pz); g.add(lantern);
            const lCap = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.24, 4), darkTimberMat);
            lCap.position.set(px, 2.65, pz); lCap.rotation.y = Math.PI / 4; g.add(lCap);
          }
        }
      }
      for (const pz of [-1.72, 1.72]) {
        const parapet = new THREE.Mesh(new THREE.BoxGeometry(rw + 0.6, 0.52, 0.32), stoneMat);
        parapet.position.set(0, 0.55, pz); g.add(parapet);
        const coping = new THREE.Mesh(new THREE.BoxGeometry(rw + 0.8, 0.14, 0.44), era >= 4 ? royalGoldMat : lightStoneMat);
        coping.position.set(0, 0.86, pz); g.add(coping);
      }
    }
    flattenAndBakeGroup(g);
    worldObjectsGroup.add(g);
  }

  function createTownWell(x, z) {
    const y = getTerrainHeightAt(x, z), g = new THREE.Group();
    g.castShadow = true; g.position.set(x, y, z);
    // Octagonal cobblestone plaza steps + stone well curb + winch roller + bucket + shingled roof
    const step1 = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.25, 8), cutStoneMat); step1.position.y = 0.12; g.add(step1);
    const step2 = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 0.28, 8), lightStoneMat); step2.position.y = 0.36; g.add(step2);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.32, 0.95, 12), cutStoneMat); wall.position.y = 0.88; g.add(wall);
    const coping = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.14, 8, 16), lightStoneMat);
    coping.rotation.x = Math.PI / 2; coping.position.y = 1.35; g.add(coping);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.85, 12), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.12 }));
    water.position.y = 0.85; g.add(water);
    for (const sx of [-1.08, 1.08]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.1, 0.22), darkTimberMat);
      post.position.set(sx, 2.1, 0); g.add(post);
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.65, 0.14), warmTimberMat);
      brace.position.set(sx * 0.78, 2.75, 0); brace.rotation.z = sx > 0 ? 0.55 : -0.55; g.add(brace);
    }
    const winch = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8), warmTimberMat);
    winch.rotation.z = Math.PI / 2; winch.position.set(0, 2.35, 0); g.add(winch);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.36, 8), barkMat);
    bucket.position.set(0, 1.75, 0); g.add(bucket);
    const roof = buildPitchedGableRoof(2.6, 2.2, 1.1, terracottaTileMat, stuccoCreamMat, darkTimberMat);
    roof.position.y = 2.95; g.add(roof);
    flattenAndBakeGroup(g);
    worldObjectsGroup.add(g);
  }

  function createMarketStall(x, z, awningColor = 0xe11d48, rotY = 0) {
    clearFootprintResources(x, z, 2.8);
    const y = getTerrainHeightAt(x, z), g = new THREE.Group();
    g.castShadow = true; g.position.set(x, y, z); g.rotation.y = rotY;
    const clothMat = new THREE.MeshStandardMaterial({ color: awningColor, roughness: 0.58, matType: 5 });
    const creamMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.62, matType: 5 });

    // Cobblestone floor pad & timber counter with front apron planks
    const pad = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 2.4), cutStoneMat); pad.position.y = 0.07; g.add(pad);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.92, 1.38), warmTimberMat); counter.position.set(0, 0.52, 0.15); g.add(counter);
    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 1.52), darkTimberMat); counterTop.position.set(0, 1.0, 0.15); g.add(counterTop);

    for (const px of [-1.32, 1.32]) {
      for (const pz of [-0.68, 0.68]) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.55, 0.15), darkTimberMat);
        pole.position.set(px, 1.32, pz); g.add(pole);
      }
    }
    // 7-Stripe Pitched Merchant Awning + Front Valance Fringe
    for (let s = -3; s <= 3; s++) {
      const m = (s % 2 === 0) ? clothMat : creamMat;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 2.05), m);
      stripe.position.set(s * 0.42, 2.58, 0.06); stripe.rotation.x = 0.22; g.add(stripe);
      const valance = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.08), m);
      valance.position.set(s * 0.42, 2.28, 1.04); g.add(valance);
    }
    // Tilted Wooden Produce Crates with Detailed Goods (Apples, Golden Bread, Emeralds/Cabbages, Wine Amphorae)
    const goodsColors = [0xe11d48, 0xf59e0b, 0x16a34a, 0x9333ea];
    for (let b = 0; b < 4; b++) {
      const bx = -1.02 + b * 0.68;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.26, 0.68), barkMat);
      crate.position.set(bx, 1.15, 0.18); crate.rotation.x = 0.18; g.add(crate);
      const gMat = new THREE.MeshStandardMaterial({ color: goodsColors[b], roughness: 0.45 });
      for (const [gx, gz] of [[-0.12, -0.1], [0.12, -0.1], [0, 0.12]]) {
        const item = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), gMat);
        item.position.set(bx + gx, 1.32, 0.18 + gz); g.add(item);
      }
    }
    // Hanging Lantern + Side Barrels & Sacks
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), windowLightMat);
    lantern.position.set(1.32, 2.15, 0.78); g.add(lantern);
    const barrel1 = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.92, 10), warmTimberMat);
    barrel1.position.set(1.75, 0.52, 0.25); g.add(barrel1);
    const sack = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 8), new THREE.MeshStandardMaterial({ color: 0xd6b386, roughness: 0.9 }));
    sack.scale.set(1.0, 1.25, 0.85); sack.position.set(-1.72, 0.45, 0.35); g.add(sack);

    flattenAndBakeGroup(g);
    worldObjectsGroup.add(g);
    const stall = { type: 'market', name: '🎪 แผงลอยตลาดนัด (Market Stall)', mesh: g, x, z, hp: 140, maxHp: 140, progress: 1.0 };
    g.userData.entity = stall; buildings.push(stall); return stall;
  }

  function createWindmill(x, z) {
    clearFootprintResources(x, z, 4.8);
    const y = getTerrainHeightAt(x, z), g = new THREE.Group();
    g.castShadow = true; g.position.set(x, y, z);

    // 1) Octagonal Cut-Stone Base Tower + Arched Entry Door
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.4, 0.55, 8), cutStoneMat); plinth.position.y = 0.28; g.add(plinth);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.95, 2.4, 8), cutStoneMat); base.position.y = 1.65; g.add(base);
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.65, 0.35), lightStoneMat); doorFrame.position.set(0, 1.1, 2.68); g.add(doorFrame);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.48, 0.40), darkTimberMat); door.position.set(0, 1.05, 2.70); g.add(door);

    // 2) Wrap-around Wooden Reefing Stage (Balcony Deck + Handrails + 8 Diagonal Struts)
    const stageDeck = new THREE.Mesh(new THREE.CylinderGeometry(3.45, 3.45, 0.22, 12), warmTimberMat); stageDeck.position.y = 2.85; g.add(stageDeck);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.6, 0.18), darkTimberMat);
      strut.position.set(Math.sin(a) * 2.85, 2.15, Math.cos(a) * 2.85);
      strut.rotation.y = a; strut.rotation.x = -0.45; g.add(strut);
      const railPost = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.85, 0.14), darkTimberMat);
      railPost.position.set(Math.sin(a) * 3.3, 3.32, Math.cos(a) * 3.3); g.add(railPost);
    }
    const stageRail = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.07, 6, 16), warmTimberMat);
    stageRail.rotation.x = Math.PI / 2; stageRail.position.y = 3.72; g.add(stageRail);

    // 3) Tapered Octagonal Smock-Mill Tower with 8 Timber Corner Ribs & Windows
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.68, 2.42, 4.9, 8), stuccoCreamMat); tower.position.y = 5.25; g.add(tower);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.18, 5.0, 0.18), darkTimberMat);
      rib.position.set(Math.sin(a) * 2.02, 5.25, Math.cos(a) * 2.02);
      rib.rotation.y = a; rib.rotation.x = -0.14; g.add(rib);
    }
    for (const wy of [4.2, 6.0]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.25), windowLightMat);
      win.position.set(0, wy, 2.05 - (wy - 3.0) * 0.14); g.add(win);
    }

    // 4) Domed Shingle Cap + Rear Tail-Pole
    const capCollar = new THREE.Mesh(new THREE.CylinderGeometry(1.88, 1.88, 0.35, 12), darkTimberMat); capCollar.position.y = 7.75; g.add(capCollar);
    const capDome = new THREE.Mesh(new THREE.SphereGeometry(1.82, 14, 10), terracottaTileMat);
    capDome.scale.set(1.0, 0.95, 1.22); capDome.position.set(0, 8.1, 0.15); g.add(capDome);
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.85, 8), royalGoldMat); finial.position.set(0, 9.9, 0.15); g.add(finial);

    // 5) Rotating Rotor Hub & 4 Detailed Lattice-Grid Wooden Sails
    const rotor = new THREE.Group(); rotor.position.set(0, 7.85, 2.25);
    const neckShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 1.2, 10), darkTimberMat);
    neckShaft.rotation.x = Math.PI / 2; neckShaft.position.z = -0.35; rotor.add(neckShaft);
    const hubCap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 10), royalGoldMat);
    hubCap.position.z = 0.25; rotor.add(hubCap);

    const canvasMat = new THREE.MeshStandardMaterial({ color: 0xfefce8, roughness: 0.55, matType: 5 });
    for (let i = 0; i < 4; i++) {
      const bladeGroup = new THREE.Group(); bladeGroup.rotation.z = (i * Math.PI) / 2;
      // Main whip stock beam
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.20, 5.2, 0.20), darkTimberMat); spar.position.y = 2.6; bladeGroup.add(spar);
      // Outer leading/trailing frame bars
      const outerBar = new THREE.Mesh(new THREE.BoxGeometry(0.10, 4.2, 0.10), warmTimberMat);
      outerBar.position.set(0.98, 2.95, 0.08); outerBar.rotation.y = 0.20; bladeGroup.add(outerBar);
      // 7 Horizontal lattice rungs
      for (let r = 0; r < 7; r++) {
        const rung = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.08, 0.08), warmTimberMat);
        rung.position.set(0.48, 1.05 + r * 0.64, 0.04); rung.rotation.y = 0.20; bladeGroup.add(rung);
      }
      // Billowing canvas sail cloth
      const sail = new THREE.Mesh(new THREE.BoxGeometry(0.92, 4.0, 0.05), canvasMat);
      sail.position.set(0.52, 2.95, 0.02); sail.rotation.y = 0.20; bladeGroup.add(sail);
      rotor.add(bladeGroup);
    }
    flattenAndBakeGroup(g, [rotor]);
    g.add(rotor);
    worldObjectsGroup.add(g);
    const wm = { type: 'windmill', name: '🌾 กังหันลมโรงสีข้าว (Grain Windmill)', mesh: g, rotor, x, z, hp: 300, maxHp: 300, progress: 1.0 };
    g.userData.entity = wm; buildings.push(wm); windmills.push(wm); return wm;
  }

  function createCropField(x, z, isWheat = true, hasScarecrow = false) {
    clearFootprintResources(x, z, 5.5);
    const y = getTerrainHeightAt(x, z), g = new THREE.Group();
    g.position.set(x, y, z);
    const soilMat = new THREE.MeshStandardMaterial({ color: 0x3e1f0d, roughness: 0.94 });
    const cropMat = new THREE.MeshStandardMaterial({ color: isWheat ? 0xeab308 : 0x16a34a, roughness: 0.72, matType: 1 });
    const headMat = new THREE.MeshStandardMaterial({ color: isWheat ? 0xfde047 : 0x4ade80, roughness: 0.65, matType: 1 });

    const bed = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.16, 7.8), soilMat); bed.position.y = 0.08; g.add(bed);
    for (let r = -2.5; r <= 2.5; r += 1.0) {
      const furrow = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.24, 0.46), soilMat); furrow.position.set(0, 0.18, r); g.add(furrow);
      for (let c = -2.8; c <= 2.8; c += 0.65) {
        if (isWheat) {
          const sheaf = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.08, 0.92, 6), cropMat);
          sheaf.position.set(c, 0.58, r); sheaf.castShadow = true; g.add(sheaf);
          const ear = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), headMat);
          ear.scale.set(1.0, 1.6, 1.0); ear.position.set(c, 1.02, r); g.add(ear);
        } else {
          const outerLeaf = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), cropMat);
          outerLeaf.scale.set(1.2, 0.65, 1.2); outerLeaf.position.set(c, 0.32, r); outerLeaf.castShadow = true; g.add(outerLeaf);
          const heart = new THREE.Mesh(new THREE.SphereGeometry(0.20, 8, 6), headMat);
          heart.position.set(c, 0.44, r); g.add(heart);
        }
      }
    }
    // Split-rail wooden fence with corner & mid posts
    for (const fx of [-3.8, 0, 3.8]) {
      for (const fz of [-3.8, 0, 3.8]) {
        if (fx === 0 && fz === 0) continue;
        const fPost = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.95, 6), barkMat);
        fPost.position.set(fx, 0.48, fz); g.add(fPost);
      }
    }
    for (const side of [-3.8, 3.8]) {
      for (const ry of [0.38, 0.72]) {
        const railH = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.10, 0.10), warmTimberMat); railH.position.set(0, ry, side); g.add(railH);
        const railV = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 7.6), warmTimberMat); railV.position.set(side, ry, 0); g.add(railV);
      }
    }
    if (hasScarecrow) {
      const sc = new THREE.Group(); sc.position.set(0, 0.2, 0); sc.castShadow = true;
      sc.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.0, 6), barkMat));
      const cross = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.11, 0.11), barkMat); cross.position.y = 1.42; sc.add(cross);
      const coat = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.92, 8), new THREE.MeshStandardMaterial({ color: 0xb45309, matType: 5 })); coat.position.y = 1.22; sc.add(coat);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), new THREE.MeshStandardMaterial({ color: 0xfde047 })); head.position.y = 1.75; sc.add(head);
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.42, 8), thatchRoofMat); hat.position.y = 2.05; sc.add(hat);
      g.add(sc);
    }
    flattenAndBakeGroup(g);
    worldObjectsGroup.add(g);
    const cf = { type: 'farm', name: isWheat ? '🌾 แปลงนาข้าวสาลีทองคำ (Wheat Field)' : '🥬 แปลงพืชผักสวนครัว (Vegetable Patch)', mesh: g, x, z };
    g.userData.entity = cf; cropFields.push(cf); return cf;
  }

  function buildHorseMesh(coatHex = 0x7c2d12, maneHex = 0x1e1b4b, hasSaddle = false) {
    const hg = new THREE.Group(); hg.castShadow = true;
    const coatMat = new THREE.MeshStandardMaterial({ color: coatHex, roughness: 0.62 });
    const maneMat = new THREE.MeshStandardMaterial({ color: maneHex, roughness: 0.82 });
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.68, 1.55), coatMat); body.position.set(0, 1.08, 0); hg.add(body);
    const rump = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), coatMat); rump.position.set(0, 1.12, -0.68); hg.add(rump);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), coatMat); chest.position.set(0, 1.10, 0.68); hg.add(chest);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.88, 10), coatMat);
    neck.position.set(0, 1.55, 0.76); neck.rotation.x = 0.52; hg.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.62), coatMat);
    head.position.set(0, 1.88, 1.06); head.rotation.x = 0.38; hg.add(head);
    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.78, 0.18), maneMat);
    mane.position.set(0, 1.62, 0.64); mane.rotation.x = 0.52; hg.add(mane);
    for (const ex of [-0.10, 0.10]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 6), coatMat); ear.position.set(ex, 2.08, 0.92); hg.add(ear);
    }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.14, 0.75, 8), maneMat);
    tail.position.set(0, 0.95, -1.02); tail.rotation.x = -0.35; hg.add(tail);
    if (hasSaddle) {
      const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.68), darkTimberMat);
      saddle.position.set(0, 1.42, 0.05); hg.add(saddle);
    }
    const legs = [];
    for (const [lx, lz] of [[-0.22, 0.55], [0.22, 0.55], [-0.22, -0.55], [0.22, -0.55]]) {
      const legG = new THREE.Group(); legG.position.set(lx, 0.85, lz);
      const legM = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.065, 0.82, 8), coatMat); legM.position.y = -0.38; legG.add(legM);
      const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.14, 8), hoofMat); hoof.position.y = -0.78; legG.add(hoof);
      hg.add(legG); legs.push(legG);
    }
    return { mesh: hg, legs };
  }

  function createHorseWagon(waypoints, coatHex = 0x7c2d12) {
    const startPt = waypoints[0], y = getTerrainHeightAt(startPt[0], startPt[1]);
    const g = new THREE.Group(); g.castShadow = true; g.position.set(startPt[0], y, startPt[1]);

    const horse = buildHorseMesh(coatHex, 0x1e1b4b, true);
    horse.mesh.position.set(0, 0, 2.35);
    g.add(horse.mesh);

    const ironMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.4, matType: 6 });
    for (const sx of [-0.38, 0.38]) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), darkTimberMat);
      shaft.rotation.x = Math.PI / 2; shaft.position.set(sx, 0.95, 1.35); g.add(shaft);
    }
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.22, 2.90), warmTimberMat); bed.position.set(0, 0.72, -0.45); g.add(bed);
    for (const sx of [-0.80, 0.80]) {
      const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 2.90), warmTimberMat); sideWall.position.set(sx, 1.08, -0.45); g.add(sideWall);
    }
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.65, 0.12), warmTimberMat); backWall.position.set(0, 1.08, -1.85); g.add(backWall);

    // Canvas canopy hoop over back of wagon + cargo load
    for (const hz of [-0.2, -1.0, -1.75]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.04, 6, 12), darkTimberMat);
      hoop.position.set(0, 1.35, hz); g.add(hoop);
    }
    const hay1 = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.85), thatchRoofMat);
    hay1.position.set(-0.32, 1.12, -0.35); g.add(hay1);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.78, 10), darkTimberMat);
    barrel.position.set(0.36, 1.18, -0.95); g.add(barrel);

    const driverTorso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.20, 0.58, 8), new THREE.MeshStandardMaterial({ color: 0x0284c7 }));
    driverTorso.position.set(0, 1.25, 0.62); g.add(driverTorso);
    const driverHead = new THREE.Mesh(new THREE.SphereGeometry(0.20, 8, 8), new THREE.MeshStandardMaterial({ color: 0xfcd34d }));
    driverHead.position.set(0, 1.68, 0.62); g.add(driverHead);
    const driverHat = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.06, 10), thatchRoofMat);
    driverHat.position.set(0, 1.84, 0.62); g.add(driverHat);

    const wheels = [];
    for (const [wx, wz] of [[-0.92, 0.35], [0.92, 0.35], [-0.92, -1.25], [0.92, -1.25]]) {
      const wGroup = new THREE.Group(); wGroup.position.set(wx, 0.52, wz);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.07, 8, 16), ironMat);
      rim.rotation.y = Math.PI / 2; wGroup.add(rim);
      for (let sp = 0; sp < 4; sp++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.88, 0.06), warmTimberMat);
        spoke.rotation.x = (sp * Math.PI) / 4; wGroup.add(spoke);
      }
      g.add(wGroup); wheels.push(wGroup);
    }

    worldObjectsGroup.add(g);
    const wagon = { type: 'wagon', name: '🐎 เกวียนเทียมม้าขนส่งสินค้า (Horse-Drawn Wagon)', mesh: g, horseLegs: horse.legs, wheels, waypoints, wpIndex: 1, x: startPt[0], z: startPt[1], speed: 5.2, walkCycle: Math.random() * 10 };
    g.userData.entity = wagon; wagons.push(wagon); return wagon;
  }

  function createLivestockPasture(cx, cz) {
    clearFootprintResources(cx, cz, 9.0);
    const y = getTerrainHeightAt(cx, cz), g = new THREE.Group();
    g.position.set(cx, y, cz);
    const r = 8.8;
    for (let i = 0; i < 16; i++) {
      const a1 = (i / 16) * Math.PI * 2, a2 = ((i + 1) / 16) * Math.PI * 2;
      const px = Math.cos(a1) * r, pz = Math.sin(a1) * r;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.20, 1.35, 8), barkMat);
      post.position.set(px, 0.68, pz); g.add(post);
      const dx = Math.cos(a2) * r - px, dz = Math.sin(a2) * r - pz, segLen = Math.hypot(dx, dz);
      const mx = px + dx * 0.5, mz = pz + dz * 0.5, segRot = Math.atan2(dx, dz);
      for (const ry of [0.52, 0.98]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, segLen), warmTimberMat);
        rail.position.set(mx, ry, mz); rail.rotation.y = segRot; g.add(rail);
      }
    }
    // Small wooden hay manger & water trough inside corral
    const trough = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 0.85), darkTimberMat);
    trough.position.set(-2.5, 0.25, -2.0); g.add(trough);
    const hayPile = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.2, 8), thatchRoofMat);
    hayPile.position.set(2.5, 0.6, -2.2); g.add(hayPile);
    worldObjectsGroup.add(g);

    for (let h = 0; h < 3; h++) {
      const ha = (h / 3) * Math.PI * 2, hx = cx + Math.cos(ha) * 4.2, hz = cz + Math.sin(ha) * 4.2;
      const horseObj = buildHorseMesh([0x7c2d12, 0xd97706, 0xf8fafc][h], 0x1e293b, false);
      horseObj.mesh.position.set(hx, getTerrainHeightAt(hx, hz), hz);
      worldObjectsGroup.add(horseObj.mesh);
      const ent = { type: 'animal', name: '🐎 ม้าสายพันธุ์แท้ (Pasture Horse)', mesh: horseObj.mesh, legs: horseObj.legs, homeX: cx, homeZ: cz, x: hx, z: hz, tx: hx, tz: hz, timer: Math.random() * 4, speed: 2.8, walkCycle: Math.random() * 10 };
      horseObj.mesh.userData.entity = ent; livestock.push(ent);
    }

    const woolMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.92 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
    for (let s = 0; s < 6; s++) {
      const sa = (s / 6) * Math.PI * 2 + 0.4, sr = 2.0 + (s % 2) * 3.2;
      const sx = cx + Math.cos(sa) * sr, sz = cz + Math.sin(sa) * sr;
      const sg = new THREE.Group(); sg.castShadow = true; sg.position.set(sx, getTerrainHeightAt(sx, sz), sz);
      const wool = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), woolMat); wool.scale.set(1, 0.85, 1.3); wool.position.y = 0.55; sg.add(wool);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), faceMat); head.position.set(0, 0.68, 0.52); sg.add(head);
      const legs = [];
      for (const [lx, lz] of [[-0.16, 0.25], [0.16, 0.25], [-0.16, -0.25], [0.16, -0.25]]) {
        const lg = new THREE.Group(); lg.position.set(lx, 0.35, lz);
        const lm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.38, 6), faceMat); lm.position.y = -0.18; lg.add(lm);
        sg.add(lg); legs.push(lg);
      }
      worldObjectsGroup.add(sg);
      const ent = { type: 'animal', name: '🐑 แกะขนปุยในทุ่งหญ้า (Grazing Sheep)', mesh: sg, legs, homeX: cx, homeZ: cz, x: sx, z: sz, tx: sx, tz: sz, timer: Math.random() * 4, speed: 1.6, walkCycle: Math.random() * 10 };
      sg.userData.entity = ent; livestock.push(ent);
    }
  }

  function createFishingPier(pz = 2.0) {
    const rx = getRiverCenterX(pz), rw = getRiverWidth(pz), wy = getWaterLevelAt(pz);
    const px = rx + rw + 1.2, g = new THREE.Group();
    g.castShadow = true; g.position.set(px, wy, pz);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.24, 2.0), warmTimberMat); deck.position.set(-1.2, 0.75, 0); g.add(deck);
    for (const dx of [-3.1, -1.2, 0.7]) {
      for (const dz of [-0.85, 0.85]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.1, 8), barkMat); post.position.set(dx, 0.25, dz); g.add(post);
      }
    }
    const lanternPost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.5, 6), darkTimberMat);
    lanternPost.position.set(-3.1, 1.45, 0.85); g.add(lanternPost);
    const lanternOrb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), windowLightMat);
    lanternOrb.position.set(-3.1, 2.2, 0.85); g.add(lanternOrb);
    worldObjectsGroup.add(g);

    const boatG = new THREE.Group(); boatG.castShadow = true; boatG.position.set(rx + 1.2, wy + 0.15, pz + 2.4);
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.52, 2.8, 10), warmTimberMat);
    hull.rotation.x = Math.PI / 2; hull.scale.set(1.0, 1.0, 0.45); boatG.add(hull);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.2, 6), barkMat);
    mast.position.set(0, 1.1, 0.2); boatG.add(mast);
    const sail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 1.1), new THREE.MeshStandardMaterial({ color: 0xfef3c7, matType: 5 }));
    sail.position.set(0, 1.25, -0.2); boatG.add(sail);
    worldObjectsGroup.add(boatG);
    boats.push({ mesh: boatG, baseY: wy + 0.15 });
  }

  // 🎪⛵ High-Detail Steampunk Sky Caravan Airship + Festive Hot-Air Balloons!
  const skyAirships = [];
  let ancientRelicObj = null;

  function createHotAirBalloon(cx, y, cz, colorA = 0x0284c7, colorB = 0xfbbf24, radX = 24, radZ = 18, speed = 0.09, phase = 0) {
    const g = new THREE.Group();
    g.position.set(cx + Math.cos(phase) * radX, y, cz + Math.sin(phase) * radZ);
    const matA = new THREE.MeshStandardMaterial({ color: colorA, roughness: 0.48, matType: 5 });
    const matB = new THREE.MeshStandardMaterial({ color: colorB, roughness: 0.48, matType: 5 });

    // Classic teardrop hot-air balloon envelope with 8 alternating vertical gores
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.35, 16, 12), matA);
    dome.scale.set(1.0, 1.18, 1.0); dome.position.y = 3.8; g.add(dome);
    for (let k = 0; k < 4; k++) {
      const rib = new THREE.Mesh(new THREE.SphereGeometry(2.38, 12, 10), matB);
      rib.scale.set(0.32, 1.19, 1.02); rib.position.y = 3.8; rib.rotation.y = (k * Math.PI) / 4; g.add(rib);
    }
    // Tapered lower throat cone & golden equator bunting band
    const throat = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 0.68, 1.8, 12), matB);
    throat.position.y = 2.15; g.add(throat);
    const eqBand = new THREE.Mesh(new THREE.TorusGeometry(2.34, 0.11, 8, 24), royalGoldMat);
    eqBand.rotation.x = Math.PI / 2; eqBand.position.y = 3.65; g.add(eqBand);
    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.85, 0.35, 10), royalGoldMat);
    topCap.position.y = 6.55; g.add(topCap);

    // Blazing Burner Flame inside the throat mouth
    const burnerFlame = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.95, 8), new THREE.MeshBasicMaterial({ color: 0xff9f1c }));
    burnerFlame.position.y = 1.35; g.add(burnerFlame);

    // 4 Suspension Ropes & Woven Wicker Gondola Basket with Sandbags
    for (const [rx, rz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.35, 6), darkTimberMat);
      rope.position.set(rx, 0.95, rz); g.add(rope);
    }
    const basket = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.82, 1.15), warmTimberMat);
    basket.position.y = 0.25; g.add(basket);
    const basketRim = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.14, 1.28), darkTimberMat);
    basketRim.position.y = 0.68; g.add(basketRim);
    for (const sx of [-0.66, 0.66]) {
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), new THREE.MeshStandardMaterial({ color: 0xd6b386 }));
      bag.scale.set(0.8, 1.3, 0.8); bag.position.set(sx, 0.35, 0.35); g.add(bag);
    }

    flattenAndBakeGroup(g, [burnerFlame]);
    worldObjectsGroup.add(g);
    const balloon = {
      type: 'airship',
      name: '🎈 บอลลูนตรวจการณ์ลอยฟ้า (Sky Observation Balloon)',
      mesh: g, burnerFlame,
      centerX: cx, centerZ: cz, radX, radZ, orbitSpeed: speed,
      baseY: y, x: g.position.x, z: g.position.z,
      hp: 350, maxHp: 350, orbitAngle: phase
    };
    g.userData.entity = balloon;
    skyAirships.push(balloon);
    return balloon;
  }

  function createSkyAirship(x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.castShadow = true;

    const balloonMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.48, matType: 5 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.52, matType: 5 });
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xfef9c3, roughness: 0.55, matType: 5 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

    // 1) Streamlined Dirigible Envelope with Longitudinal Gore Ribs & 3 Fitted 3D Golden Harness Rings (NO flat box!)
    const env = new THREE.Mesh(new THREE.SphereGeometry(3.15, 20, 14), balloonMat);
    env.scale.set(1.05, 0.82, 2.38);
    env.position.y = 4.85;
    g.add(env);

    for (const rotZ of [-0.95, -0.45, 0.45, 0.95]) {
      const rib = new THREE.Mesh(new THREE.SphereGeometry(3.18, 16, 12), stripeMat);
      rib.scale.set(0.16, 0.83, 2.39);
      rib.position.y = 4.85;
      rib.rotation.z = rotZ;
      g.add(rib);
    }
    for (const [rz, rScale] of [[-2.4, 0.86], [0, 1.0], [2.4, 0.86]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.75 * rScale, 0.11, 8, 24), royalGoldMat);
      ring.position.set(0, 4.85, rz);
      ring.scale.set(1.18, 0.94, 1.0);
      g.add(ring);
    }
    // Nose Mooring Cone & Cruciform Stabilizer Tail Fins
    const noseCone = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.65, 10), royalGoldMat);
    noseCone.rotation.x = Math.PI / 2; noseCone.position.set(0, 4.85, 7.85); g.add(noseCone);
    const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.8, 10), royalGoldMat);
    tailCone.rotation.x = -Math.PI / 2; tailCone.position.set(0, 4.85, -7.85); g.add(tailCone);
    for (const finRot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const finG = new THREE.Group(); finG.position.set(0, 4.85, -6.1); finG.rotation.z = finRot;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.10, 2.1, 2.2), sailMat);
      fin.position.y = 1.85; fin.rotation.x = -0.25; finG.add(fin);
      const finTrim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.15, 0.16), royalGoldMat);
      finTrim.position.set(0, 1.85, -1.05); finG.add(finTrim);
      g.add(finG);
    }

    // 2) 8 Angled Suspension Rigging Cables + Glowing Aether Furnace Core
    for (const sz of [-2.4, 0, 2.4]) {
      for (const side of [-1, 1]) {
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.2, 6), darkTimberMat);
        cable.position.set(side * 1.35, 2.55, sz);
        cable.rotation.z = -side * 0.24;
        g.add(cable);
      }
    }
    const furnaceCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), glowMat);
    furnaceCore.position.set(0, 2.45, 0); g.add(furnaceCore);
    const furnaceRing = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.07, 6, 16), royalGoldMat);
    furnaceRing.rotation.x = Math.PI / 2; furnaceRing.position.set(0, 2.45, 0); g.add(furnaceRing);

    // 3) Detailed Wooden Sky-Galleon Hull, Forecastle, Captain's Sterncastle Cabin & Glowing Windows
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.15, 6.2), darkTimberMat);
    hull.position.y = 0.65; g.add(hull);
    const mainDeck = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.16, 6.3), warmTimberMat);
    mainDeck.position.y = 1.25; g.add(mainDeck);
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.35, 6.8), royalGoldMat);
    keel.position.y = 0.05; g.add(keel);

    // Raised Aft Sterncastle Cabin with 5 Glowing Windows & Pitched Roof
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.15, 2.2), barkMat);
    cabin.position.set(0, 1.75, -1.95); g.add(cabin);
    const cabinRoof = new THREE.Mesh(new THREE.BoxGeometry(2.38, 0.18, 2.45), warmTimberMat);
    cabinRoof.position.set(0, 2.38, -1.95); g.add(cabinRoof);
    for (const wx of [-0.65, 0, 0.65]) {
      const winAft = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.45, 0.12), windowLightMat);
      winAft.position.set(wx, 1.82, -3.05); g.add(winAft);
    }
    for (const side of [-1, 1]) {
      const winSide = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.65), windowLightMat);
      winSide.position.set(side * 1.08, 1.82, -1.95); g.add(winSide);
      // Bulwark side railings & golden shields
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 4.2), warmTimberMat);
      rail.position.set(side * 1.16, 1.48, 0.9); g.add(rail);
      for (const shZ of [-0.4, 0.9, 2.2]) {
        const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.08, 8), royalGoldMat);
        shield.rotation.z = Math.PI / 2; shield.position.set(side * 1.24, 1.05, shZ); g.add(shield);
      }
    }

    // Bow Forecastle & Golden Bowsprit Figurehead
    const forecastle = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.65, 1.5), barkMat);
    forecastle.position.set(0, 1.55, 2.4); g.add(forecastle);
    const prow = new THREE.Mesh(new THREE.ConeGeometry(1.12, 2.4, 6), royalGoldMat);
    prow.rotation.x = Math.PI / 2; prow.position.set(0, 0.95, 4.2); g.add(prow);

    // Billowing Lateral Wing-Sails with Wooden Yardarms
    for (const side of [-1, 1]) {
      const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 3.6, 6), darkTimberMat);
      spar.rotation.z = Math.PI / 2; spar.position.set(side * 2.4, 1.15, 0.4); g.add(spar);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 1.65), sailMat);
      wing.position.set(side * 2.5, 1.05, -0.35);
      wing.rotation.z = side * 0.14; wing.rotation.x = 0.12; g.add(wing);
    }

    // Rear Spinning Twin-Blade Propeller & Rudder
    const propGroup = new THREE.Group();
    propGroup.position.set(0, 0.75, -3.35);
    const propHub = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), royalGoldMat);
    propGroup.add(propHub);
    for (let b = 0; b < 4; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.28, 0.08), royalGoldMat);
      blade.rotation.z = (b * Math.PI) / 4;
      propGroup.add(blade);
    }
    flattenAndBakeGroup(g, [propGroup, furnaceCore]);
    g.add(propGroup);

    worldObjectsGroup.add(g);
    const ship = {
      type: 'airship',
      name: '🎪 เรือเหาะพ่อค้าแห่งนภา (Sky Caravan Airship)',
      mesh: g,
      propeller: propGroup,
      burnerFlame: furnaceCore,
      centerX: -8, centerZ: 14, radX: 20, radZ: 13, orbitSpeed: 0.14,
      baseX: x, baseY: y, baseZ: z,
      x, z, hp: 500, maxHp: 500,
      orbitAngle: Math.atan2(z, x)
    };
    g.userData.entity = ship;
    skyAirships.push(ship);
    return ship;
  }

  function createAncientRelicMonolith(x, z) {
    clearFootprintResources(x, z, 3.5);
    const y = getTerrainHeightAt(x, z), g = new THREE.Group();
    g.position.set(x, y, z);
    g.castShadow = true;

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3b0764, emissive: 0x6b21a8, emissiveIntensity: 0.55, roughness: 0.25, matType: 6 });
    const runeMat = new THREE.MeshBasicMaterial({ color: 0xfde047 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xe879f9 });

    const step1 = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.42, 8), cutStoneMat); step1.position.y = 0.21; g.add(step1);
    const step2 = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.2, 0.48, 8), lightStoneMat); step2.position.y = 0.65; g.add(step2);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const miniOb = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.6, 4), cutStoneMat);
      miniOb.position.set(Math.cos(a) * 2.1, 1.1, Math.sin(a) * 2.1);
      miniOb.rotation.z = -Math.cos(a) * 0.15; miniOb.rotation.x = Math.sin(a) * 0.15; g.add(miniOb);
    }

    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.42), stoneMat);
    crystal.scale.set(0.85, 2.35, 0.85);
    crystal.position.y = 3.4;
    g.add(crystal);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.10, 8, 24), ringMat);
    ring.rotation.x = Math.PI / 3;
    ring.position.y = 3.4;
    g.add(ring);

    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.48), runeMat);
    gem.position.y = 6.1;
    g.add(gem);

    worldObjectsGroup.add(g);
    ancientRelicObj = {
      type: 'relic',
      name: '🔮 แท่นศิลาโบราณเรืองแสง (Ancient Runic Monolith)',
      mesh: g, crystal, ring, gem,
      x, z, hp: 600, maxHp: 600
    };
    g.userData.entity = ancientRelicObj;
    return ancientRelicObj;
  }

  function createCentralTemple(era = currentCivEra) {
    const g = new THREE.Group(); g.castShadow = true; g.position.set(0, getTerrainHeightAt(0, 0), 0);
    let flame = null, title = '';

    if (era === 1) {
      title = '🔥 กองไฟศักดิ์สิทธิ์และเสาโทเท็มชนเผ่า (Sacred Tribal Bonfire & Totem)';
      const stonePlinth = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.1, 0.36, 12), cutStoneMat);
      stonePlinth.position.y = 0.18; g.add(stonePlinth);
      const dirtRing = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.1, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.95 }));
      dirtRing.position.y = 0.32; g.add(dirtRing);
      // 8 Megalithic Standing Trilithon Stones with lintel caps
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rock = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.3 + (i % 2) * 0.4, 0.52), cutStoneMat);
        rock.position.set(Math.cos(a) * 4.1, 1.3, Math.sin(a) * 4.1);
        rock.rotation.y = -a; g.add(rock);
      }
      for (let l = 0; l < 6; l++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2.6, 6), barkMat);
        log.position.y = 0.52; log.rotation.z = Math.PI / 2.5; log.rotation.y = (l / 6) * Math.PI; g.add(log);
      }
      flame = new THREE.Mesh(new THREE.OctahedronGeometry(1.05), new THREE.MeshBasicMaterial({ color: 0xff9f1c }));
      flame.scale.set(0.85, 1.8, 0.85); flame.position.y = 1.65; g.add(flame);
      // Carved Multi-Tiered Totem Pole with Thunderbird Wings
      const totem = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.58, 5.6, 10), barkMat);
      totem.position.set(0, 2.9, -2.5); g.add(totem);
      for (const ty of [1.8, 3.1, 4.4]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.28, 10), royalGoldMat);
        band.position.set(0, ty, -2.5); g.add(band);
      }
      const wings = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.55, 0.24), royalGoldMat);
      wings.position.set(0, 4.6, -2.5); g.add(wings);
      const totemTop = new THREE.Mesh(new THREE.OctahedronGeometry(0.62), new THREE.MeshStandardMaterial({ color: 0xef4444, matType: 6 }));
      totemTop.position.set(0, 5.9, -2.5); g.add(totemTop);
    } else if (era === 2) {
      title = '🏛️ ศาลเจ้าหินโบราณและศาลาประชาคม (Ancient Village Shrine)';
      const base1 = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.1, 0.65, 12), cutStoneMat); base1.position.y = 0.32; g.add(base1);
      const base2 = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.1, 0.60, 12), lightStoneMat); base2.position.y = 0.92; g.add(base2);
      const hall = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.6, 4.0), stuccoCreamMat); hall.position.y = 2.50; g.add(hall);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 2.8, 10), darkTimberMat);
        pil.position.set(Math.cos(a) * 3.6, 2.55, Math.sin(a) * 3.6); g.add(pil);
      }
      const roof1 = new THREE.Mesh(new THREE.ConeGeometry(5.1, 1.85, 8), thatchRoofMat); roof1.position.y = 4.55; g.add(roof1);
      const roof2 = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.0, 8), terracottaTileMat); roof2.position.y = 5.85; g.add(roof2);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 8), royalGoldMat); spire.position.y = 7.25; g.add(spire);
      flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.68), new THREE.MeshBasicMaterial({ color: 0xfde047 }));
      flame.position.set(0, 2.25, 4.0); g.add(flame);
    } else {
      title = era === 4 ? '✨ มหาวิหารจักรวรรดิเอเธอเรียม (Celestial Aetherium Pantheon)' : '🏛️ มหาวิหารเทพเจ้าแห่งนภา (Royal Sanctum of Aetheria)';
      const step1 = new THREE.Mesh(new THREE.CylinderGeometry(6.0, 6.6, 0.75, 16), cutStoneMat); step1.position.y = 0.38; g.add(step1);
      const step2 = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.8, 0.75, 16), marbleStoneMat); step2.position.y = 1.1; g.add(step2);
      const step3 = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.1, 0.70, 16), marbleStoneMat); step3.position.y = 1.8; g.add(step3);
      for (let d = 0; d < 4; d++) {
        const stGroup = new THREE.Group(); stGroup.rotation.y = (d * Math.PI) / 2;
        for (let s = 0; s < 4; s++) {
          const st = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.42, 0.65), marbleStoneMat);
          st.position.set(0, 0.22 + s * 0.44, 4.4 + (3 - s) * 0.48); stGroup.add(st);
        }
        g.add(stGroup);
      }
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2, cx = Math.cos(a) * 3.85, cz = Math.sin(a) * 3.85;
        const colBase = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.38, 0.88), lightStoneMat); colBase.position.set(cx, 2.3, cz); g.add(colBase);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 4.2, 12), marbleStoneMat); shaft.position.set(cx, 4.5, cz); g.add(shaft);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.38, 0.86), royalGoldMat); cap.position.set(cx, 6.7, cz); g.add(cap);
      }
      const innerRotunda = new THREE.Mesh(new THREE.CylinderGeometry(2.65, 2.75, 4.5, 16), stuccoCreamMat);
      innerRotunda.position.y = 4.4; g.add(innerRotunda);
      const entablature = new THREE.Mesh(new THREE.CylinderGeometry(4.55, 4.4, 0.85, 16), marbleStoneMat); entablature.position.y = 7.25; g.add(entablature);
      const goldFrieze = new THREE.Mesh(new THREE.TorusGeometry(4.48, 0.16, 8, 24), royalGoldMat);
      goldFrieze.rotation.x = Math.PI / 2; goldFrieze.position.y = 7.25; g.add(goldFrieze);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(4.05, 20, 14), era === 4 ? slateRoofMat : royalGoldMat);
      dome.scale.set(1, 0.76, 1); dome.position.y = 7.65; g.add(dome);
      for (let r = 0; r < 4; r++) {
        const rib = new THREE.Mesh(new THREE.SphereGeometry(4.10, 14, 10), royalGoldMat);
        rib.scale.set(0.12, 0.78, 1.02); rib.position.y = 7.65; rib.rotation.y = (r * Math.PI) / 4; g.add(rib);
      }
      const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.12, 1.5, 8), marbleStoneMat); cupola.position.y = 10.8; g.add(cupola);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(1.15, 1.8, 8), royalGoldMat); spire.position.y = 12.2; g.add(spire);
      const altar = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, 1.15, 8), royalGoldMat); altar.position.y = 2.65; g.add(altar);
      flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.82), new THREE.MeshBasicMaterial({ color: 0xfde047 })); flame.position.y = 3.9; g.add(flame);

      if (era === 4) {
        const halo = new THREE.Mesh(new THREE.TorusGeometry(5.8, 0.16, 8, 28), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
        halo.rotation.x = Math.PI / 2; halo.position.y = 9.4; g.add(halo);
        for (let k = 0; k < 4; k++) {
          const ka = (k / 4) * Math.PI * 2 + Math.PI / 4;
          const crys = new THREE.Mesh(new THREE.OctahedronGeometry(0.88), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
          crys.scale.set(0.7, 2.3, 0.7); crys.position.set(Math.cos(ka) * 6.8, 5.6, Math.sin(ka) * 6.8); g.add(crys);
        }
      }
    }

    flattenAndBakeGroup(g, flame ? [flame] : []);
    worldObjectsGroup.add(g);
    templeObj = { type: 'temple', name: title, mesh: g, flameMesh: flame, x: 0, z: 0, hp: 400 + era * 200, maxHp: 400 + era * 200 };
    g.userData.entity = templeObj; buildings.push(templeObj);
  }

  function createVoidPortal() {
    const px = 68, pz = -58, py = getTerrainHeightAt(px, pz), g = new THREE.Group();
    g.castShadow = true; g.position.set(px, py, pz); g.lookAt(0, py, 0);
    const obMat = new THREE.MeshStandardMaterial({ color: 0x1e1b4b, emissive: 0x3b0764, emissiveIntensity: 0.45, roughness: 0.3, matType: 3 });
    const runeMat = new THREE.MeshStandardMaterial({ color: 0xd8b4fe, emissive: 0xa855f7, emissiveIntensity: 1.1, roughness: 0.2, matType: 6 });

    const dais1 = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 6.0, 0.6, 8), cutStoneMat);
    dais1.position.y = 0.3; g.add(dais1);
    const dais2 = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.9, 0.55, 8), obMat);
    dais2.position.y = 0.85; g.add(dais2);

    for (const side of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(1.5, 7.8, 1.5), obMat); pil.position.set(side * 2.95, 4.4, 0); g.add(pil);
      for (const ry of [2.4, 4.4, 6.4]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.28, 1.65), runeMat); band.position.set(side * 2.95, ry, 0); g.add(band);
      }
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.70, 2.6, 6), obMat);
      horn.position.set(side * 3.45, 8.9, 0); horn.rotation.z = -side * 0.35; g.add(horn);
    }

    const arch = new THREE.Mesh(new THREE.BoxGeometry(8.0, 1.5, 1.9), obMat); arch.position.set(0, 8.2, 0); g.add(arch);
    const crest = new THREE.Mesh(new THREE.OctahedronGeometry(1.2), runeMat); crest.position.set(0, 9.7, 0); g.add(crest);

    portalRingMesh = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.26, 8, 24), new THREE.MeshBasicMaterial({ color: 0xc084fc }));
    portalRingMesh.position.set(0, 4.4, 0); g.add(portalRingMesh);
    const vortex = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.25, 0.22, 20), new THREE.MeshBasicMaterial({ color: 0x7e22ce, transparent: true, opacity: 0.78 }));
    vortex.rotation.x = Math.PI / 2; vortex.position.set(0, 4.4, 0); g.add(vortex);

    worldObjectsGroup.add(g);
    portalObj = { type: 'portal', name: 'ประตูมิติอเวจี (Void Rift Portal)', mesh: g, vortex, x: px, z: pz, hp: 9999, maxHp: 9999 };
    g.userData.entity = portalObj;
  }

  const _treeGeomCache = {};
  function getBakedTreeGeometry(species, variant) {
    const key = species + '_' + variant;
    if (_treeGeomCache[key]) return _treeGeomCache[key];

    const g = new THREE.Group();
    const leafDarkMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.72, matType: 1 });
    const leafMidMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.68, matType: 1 });
    const leafSunMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.64, matType: 1 });
    const pineDarkMat = new THREE.MeshStandardMaterial({ color: 0x064e3b, roughness: 0.75, matType: 1 });
    const pineLightMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.70, matType: 1 });
    const blossomMat = new THREE.MeshStandardMaterial({ color: 0xfda4af, roughness: 0.55, matType: 1 });

    // 4 Gnarled Root Buttresses flaring into the ground
    for (let r = 0; r < 4; r++) {
      const ra = (r / 4) * Math.PI * 2 + variant * 0.4;
      const root = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.95, 5), barkMat);
      root.position.set(Math.cos(ra) * 0.34, 0.38, Math.sin(ra) * 0.34);
      root.rotation.z = -Math.cos(ra) * 0.52; root.rotation.x = Math.sin(ra) * 0.52;
      g.add(root);
    }

    if (species === 'pine') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.48, 3.4, 7), barkMat);
      trunk.position.y = 1.7; g.add(trunk);
      for (let l = 0; l < 6; l++) {
        const tierR = 2.08 - l * 0.27;
        const tierH = 1.55 - l * 0.08;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(tierR, tierH, 7), l % 2 === 0 ? pineDarkMat : pineLightMat);
        cone.position.y = 1.65 + l * 0.86;
        cone.rotation.y = l * 0.48 + variant * 0.3;
        g.add(cone);
      }
    } else {
      const lowerTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.50, 1.55, 7), barkMat);
      lowerTrunk.position.y = 0.78; g.add(lowerTrunk);
      const upperTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 1.25, 7), barkMat);
      upperTrunk.position.set(0.05, 1.95, -0.04); upperTrunk.rotation.z = -0.08; g.add(upperTrunk);

      const branchAngles = [0.2, 1.75, 3.3, 4.85];
      for (let b = 0; b < 4; b++) {
        const ba = branchAngles[b] + variant * 0.25;
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.18, 1.55, 5), barkMat);
        branch.position.set(Math.cos(ba) * 0.58, 2.35 + (b % 2) * 0.18, Math.sin(ba) * 0.58);
        branch.rotation.z = -Math.cos(ba) * 0.68;
        branch.rotation.x = Math.sin(ba) * 0.68;
        g.add(branch);
      }

      const crownClusters = [
        [1.12, 2.75, 0.25, 1.15, 0.78, 1.05, leafDarkMat],
        [-1.10, 2.78, 0.30, 1.12, 0.76, 1.08, leafDarkMat],
        [0.25, 2.72, 1.12, 1.14, 0.75, 1.10, leafDarkMat],
        [-0.22, 2.76, -1.10, 1.12, 0.78, 1.06, leafDarkMat],
        [0.68, 3.25, 0.65, 1.22, 0.85, 1.15, leafMidMat],
        [-0.70, 3.28, 0.60, 1.18, 0.82, 1.18, leafMidMat],
        [0.62, 3.22, -0.68, 1.20, 0.84, 1.14, leafMidMat],
        [-0.65, 3.30, -0.62, 1.16, 0.84, 1.16, leafMidMat],
        [0, 3.90, 0, 1.32, 0.88, 1.28, leafSunMat],
        [0.48, 3.72, 0.22, 0.98, 0.82, 0.95, leafSunMat],
        [-0.45, 3.75, -0.25, 0.96, 0.80, 0.98, leafSunMat]
      ];
      for (const [cx, cy, cz, sx, sy, sz, mat] of crownClusters) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 6), mat);
        puff.position.set(cx, cy, cz);
        puff.scale.set(sx, sy, sz);
        g.add(puff);
      }
      if (species === 'fruit') {
        for (let bl = 0; bl < 4; bl++) {
          const ba = (bl / 4) * Math.PI * 2 + 0.4;
          const blossom = new THREE.Mesh(new THREE.SphereGeometry(0.26, 6, 5), blossomMat);
          blossom.scale.set(1.2, 0.6, 1.2);
          blossom.position.set(Math.cos(ba) * 0.95, 3.78, Math.sin(ba) * 0.95);
          g.add(blossom);
        }
      }
    }
    flattenAndBakeGroup(g);
    _treeGeomCache[key] = g.children[0].geometry;
    return _treeGeomCache[key];
  }

  let _sharedFruitClusterGeo = null;
  function getSharedFruitClusterGeo() {
    if (_sharedFruitClusterGeo) return _sharedFruitClusterGeo;
    const fg = new THREE.Group();
    for (let f = 0; f < 7; f++) {
      const ang = (f / 7) * Math.PI * 2;
      const rDist = 1.36 + (f % 2) * 0.20;
      const apple = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 6), fruitMat);
      apple.position.set(Math.cos(ang) * rDist, 2.52 + (f % 3) * 0.34, Math.sin(ang) * rDist);
      fg.add(apple);
    }
    flattenAndBakeGroup(fg);
    _sharedFruitClusterGeo = fg.children[0].geometry;
    return _sharedFruitClusterGeo;
  }

  function createTree(x, z, species = 'oak', initialGrowth = 0.85) {
    const y = getTerrainHeightAt(x, z), g = new THREE.Group();
    g.castShadow = true; g.position.set(x, y, z);
    const variant = Math.abs(Math.floor(x * 7 + z * 13)) % 3;
    const bodyMesh = new THREE.Mesh(
      getBakedTreeGeometry(species, variant),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, matType: 99 })
    );
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    g.add(bodyMesh);
    g.rotation.y = ((x * 17 + z * 31) % 628) * 0.01;

    const fruitMeshes = [];
    if (species === 'fruit') {
      const fMesh = new THREE.Mesh(getSharedFruitClusterGeo(), fruitMat);
      g.add(fMesh);
      fruitMeshes.push(fMesh);
    }
    g.scale.setScalar(initialGrowth);
    worldObjectsGroup.add(g);
    const tree = { type: 'tree', species, name: species === 'fruit' ? '🌳 ต้นผลไม้ทิพย์ (Orchard Fruit Tree)' : (species === 'pine' ? '🌲 ต้นสนอัลไพน์ (Alpine Spruce)' : '🌳 ต้นโอ๊กโบราณ (Ancient Oak)'), mesh: g, fruitMeshes, x, z, growth: initialGrowth, hasFruit: species === 'fruit' && initialGrowth >= 0.75, woodAmount: 25 };
    g.userData.entity = tree; trees.push(tree); return tree;
  }

  function createOreNode(x, z, isGold = false) {
    const y = getTerrainHeightAt(x, z), g = new THREE.Group();
    g.castShadow = true; g.position.set(x, y, z);
    const rockMat = new THREE.MeshStandardMaterial({ color: isGold ? 0x475569 : 0x64748b, roughness: 0.82, matType: 3 });
    for (const [rx, ry, rz, rs, rotY] of [[0,0.68,0,1.22,0.2],[0.78,0.46,0.38,0.82,1.1],[-0.68,0.42,-0.35,0.76,2.3],[0.25,0.38,-0.75,0.68,0.7]]) {
      const rMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(rs), rockMat);
      rMesh.position.set(rx, ry, rz); rMesh.scale.set(1.25, 0.85, 1.15); rMesh.rotation.y = rotY; g.add(rMesh);
    }
    const veinMat = new THREE.MeshStandardMaterial({ color: isGold ? 0xfbbf24 : 0x38bdf8, emissive: isGold ? 0xd97706 : 0x0284c7, emissiveIntensity: 0.48, metalness: 0.75, roughness: 0.18, matType: 6 });
    for (let i = 0; i < 6; i++) {
      const crys = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.10, 5), veinMat);
      const a = (i / 6) * Math.PI * 2;
      crys.position.set(Math.cos(a) * 0.52, 1.12 + (i % 2) * 0.22, Math.sin(a) * 0.52);
      crys.rotation.z = -Math.cos(a) * 0.42; crys.rotation.x = Math.sin(a) * 0.42;
      g.add(crys);
    }
    flattenAndBakeGroup(g);
    worldObjectsGroup.add(g);
    const ore = { type: 'ore', name: isGold ? '✨ สายแร่ทองคำศักดิ์สิทธิ์ (Sacred Gold Vein)' : '⛏️ สายแร่ศิลาคริสตัล (Crystal Iron Vein)', mesh: g, x, z, oreAmount: 50 };
    g.userData.entity = ore; ores.push(ore); return ore;
  }

  function createHouse(x, z, builtProgress = 1.0, era = currentCivEra) {
    clearFootprintResources(x, z, 3.4);
    const y = getTerrainHeightAt(x, z), g = new THREE.Group();
    g.castShadow = true; g.position.set(x, y, z); g.rotation.y = Math.atan2(-x, -z);
    let houseName = '';

    if (era === 1) {
      // ERA 1: Detailed Tribal Hide & Timber Lodge with Stone Base, 8 Lodge Poles, Entrance Awning & Campfire
      houseName = '⛺ กระโจมชนเผ่าดึกดำบรรพ์ (Tribal Hide Lodge)';
      const hideBaseMat = new THREE.MeshStandardMaterial({ color: 0xc29b61, roughness: 0.88, matType: 5 });
      const hideMidMat = new THREE.MeshStandardMaterial({ color: 0xd6b386, roughness: 0.86, matType: 5 });
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.85, matType: 5 });

      const ringPlinth = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.25, 0.30, 10), cutStoneMat);
      ringPlinth.position.y = 0.15; g.add(ringPlinth);
      const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.95, 1.25, 10), hideBaseMat);
      tier1.position.y = 0.90; g.add(tier1);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.40, 0.32, 10), stripeMat);
      band.position.y = 1.55; g.add(band);
      const tier2 = new THREE.Mesh(new THREE.ConeGeometry(1.28, 1.75, 10), hideMidMat);
      tier2.position.y = 2.45; g.add(tier2);

      for (let p = 0; p < 7; p++) {
        const pa = (p / 7) * Math.PI * 2;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 4.1, 6), barkMat);
        pole.position.set(Math.cos(pa) * 0.25, 2.0, Math.sin(pa) * 0.25);
        pole.rotation.z = Math.cos(pa) * 0.32; pole.rotation.x = Math.sin(pa) * 0.32; g.add(pole);
      }
      // Timber Entrance Canopy & Painted Tribal Shield
      for (const sx of [-0.58, 0.58]) {
        const ePost = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.45, 6), barkMat);
        ePost.position.set(sx, 0.85, 1.85); g.add(ePost);
      }
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.12, 0.85), warmTimberMat);
      canopy.position.set(0, 1.55, 1.65); canopy.rotation.x = 0.22; g.add(canopy);
      const doorFlap = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.25, 0.18), darkTimberMat);
      doorFlap.position.set(0, 0.82, 1.62); g.add(doorFlap);
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 8), royalGoldMat);
      shield.rotation.x = Math.PI / 2; shield.position.set(0, 1.85, 1.45); g.add(shield);

    } else if (era === 2) {
      // ERA 2: Rectangular Timber-Framed & Thatch Country Cottage with Stone Chimney, Shutters & Flower Boxes
      houseName = '🛖 บ้านไม้ดินเหนียวมุงจาก (Timber & Thatch Cottage)';
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.48, 2.8), cutStoneMat); plinth.position.y = 0.24; g.add(plinth);
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.24, 0.55), lightStoneMat); step.position.set(0, 0.12, 1.58); g.add(step);
      const walls = new THREE.Mesh(new THREE.BoxGeometry(2.88, 1.85, 2.52), stuccoCreamMat); walls.position.y = 1.38; g.add(walls);

      // Corner timber posts, horizontal belt beams & diagonal cross-braces
      for (const cx of [-1.42, 1.42]) {
        for (const cz of [-1.24, 1.24]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.92, 0.18), darkTimberMat);
          post.position.set(cx, 1.38, cz); g.add(post);
        }
      }
      const topPlate = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 2.64), darkTimberMat); topPlate.position.y = 2.28; g.add(topPlate);
      const roof = buildPitchedGableRoof(3.1, 2.75, 1.35, thatchRoofMat, stuccoCreamMat, darkTimberMat);
      roof.position.y = 2.32; g.add(roof);

      // Cobblestone Side Chimney
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.62, 2.95, 0.62), cutStoneMat);
      chimney.position.set(1.52, 1.75, -0.35); g.add(chimney);
      const chimPot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.45, 8), terracottaTileMat);
      chimPot.position.set(1.52, 3.35, -0.35); g.add(chimPot);

      // Door, Framed Windows with Open Shutters & Flower Boxes
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.38, 0.16), warmTimberMat); door.position.set(0, 1.12, 1.26); g.add(door);
      for (const [wx, wz, rotY] of [[-0.86, 1.26, 0], [0.86, 1.26, 0], [-1.45, 0.15, -Math.PI / 2]]) {
        const wGroup = new THREE.Group(); wGroup.position.set(wx, 1.48, wz); wGroup.rotation.y = rotY;
        wGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.58, 0.12), windowLightMat));
        wGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.07, 0.16), darkTimberMat));
        wGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.64, 0.16), darkTimberMat));
        for (const sSide of [-0.36, 0.36]) {
          const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.58, 0.08), warmTimberMat);
          shutter.position.set(sSide, 0, 0.06); g.add(wGroup); wGroup.add(shutter);
        }
        const fBox = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.22), darkTimberMat);
        fBox.position.set(0, -0.34, 0.12); wGroup.add(fBox);
        const blooms = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.14, 0.16), new THREE.MeshStandardMaterial({ color: 0xe11d48, matType: 1 }));
        blooms.position.set(0, -0.22, 0.12); wGroup.add(blooms);
      }

    } else if (era === 3) {
      // ERA 3: Two-Story Jettied Medieval Half-Timbered Tudor Townhouse with Roof Dormer & Brick Chimney
      houseName = '🏠 บ้านโครงไม้ทูดอร์ 2 ชั้น (Medieval Tudor Townhouse)';
      // 1st Floor: Cut-Stone Ground Arcade
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.45, 3.0), cutStoneMat); plinth.position.y = 0.22; g.add(plinth);
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.26, 0.65), lightStoneMat); step.position.set(0, 0.13, 1.68); g.add(step);
      const floor1 = new THREE.Mesh(new THREE.BoxGeometry(2.90, 1.55, 2.75), cutStoneMat); floor1.position.y = 1.18; g.add(floor1);

      // Wooden Corbel Brackets supporting the overhanging 2nd floor jetty
      for (const bx of [-1.25, -0.45, 0.45, 1.25]) {
        for (const bz of [-1.42, 1.42]) {
          const corbel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 0.28), darkTimberMat);
          corbel.position.set(bx, 1.88, bz); g.add(corbel);
        }
      }

      // 2nd Floor: Overhanging Jettied Tudor Half-Timbered Story
      const floor2 = new THREE.Mesh(new THREE.BoxGeometry(3.32, 1.65, 3.15), stuccoCreamMat); floor2.position.y = 2.75; g.add(floor2);
      const jettyBeam = new THREE.Mesh(new THREE.BoxGeometry(3.42, 0.20, 3.25), darkTimberMat); jettyBeam.position.y = 1.95; g.add(jettyBeam);
      const eavesBeam = new THREE.Mesh(new THREE.BoxGeometry(3.42, 0.20, 3.25), darkTimberMat); eavesBeam.position.y = 3.55; g.add(eavesBeam);
      for (const sx of [-1.62, -0.82, 0, 0.82, 1.62]) {
        for (const sz of [-1.55, 1.55]) {
          const stud = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.65, 0.14), darkTimberMat);
          stud.position.set(sx, 2.75, sz); g.add(stud);
        }
      }
      // Steep Terracotta Tile Roof + Protruding Front Dormer Window
      const mainRoof = buildPitchedGableRoof(3.45, 3.25, 1.65, terracottaTileMat, stuccoCreamMat, darkTimberMat);
      mainRoof.position.y = 3.58; g.add(mainRoof);

      const dormerBox = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 1.15), stuccoCreamMat);
      dormerBox.position.set(0, 4.18, 1.05); g.add(dormerBox);
      const dormerRoof = buildPitchedGableRoof(1.25, 1.25, 0.58, terracottaTileMat, stuccoCreamMat, darkTimberMat);
      dormerRoof.position.set(0, 4.58, 1.08); g.add(dormerRoof);
      const dormerWin = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.14), windowLightMat);
      dormerWin.position.set(0, 4.18, 1.64); g.add(dormerWin);

      // Tall Red-Brick Chimney Stack with Twin Clay Pots
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.68, 4.6, 0.68), redBrickMat);
      chimney.position.set(1.62, 2.65, -0.65); g.add(chimney);
      const chimCrown = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.22, 0.82), lightStoneMat);
      chimCrown.position.set(1.62, 4.98, -0.65); g.add(chimCrown);
      for (const pz of [-0.80, -0.50]) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.42, 8), terracottaTileMat);
        pot.position.set(1.62, 5.25, pz); g.add(pot);
      }

      // Doorway, Porch Canopy, Hanging Lantern & Mullioned Windows
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.42, 0.16), darkTimberMat); door.position.set(0, 1.08, 1.40); g.add(door);
      const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.14, 0.72), terracottaTileMat);
      porchRoof.position.set(0, 1.82, 1.65); porchRoof.rotation.x = 0.28; g.add(porchRoof);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.20, 8, 8), windowLightMat);
      lantern.position.set(0.68, 1.62, 1.78); g.add(lantern);

      for (const [wx, wy, wz] of [[-0.92, 1.25, 1.40], [0.92, 1.25, 1.40], [-1.05, 2.75, 1.58], [0, 2.75, 1.58], [1.05, 2.75, 1.58]]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.68, 0.14), windowLightMat);
        win.position.set(wx, wy, wz); g.add(win);
        const sill = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.12, 0.22), darkTimberMat);
        sill.position.set(wx, wy - 0.36, wz + 0.05); g.add(sill);
      }

    } else {
      // ERA 4: Grand Imperial Aetherium Villa & Neoclassical Manor with Portico Columns, Hip Roof & Arcane Lanterns
      houseName = '🏛️ คฤหาสน์จักรวรรดิหลังคาทอง (Imperial Aetherium Manor)';
      const podium = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.58, 3.5), marbleStoneMat); podium.position.y = 0.29; g.add(podium);
      const goldTrim = new THREE.Mesh(new THREE.BoxGeometry(3.88, 0.12, 3.58), royalGoldMat); goldTrim.position.y = 0.58; g.add(goldTrim);
      const mainHall = new THREE.Mesh(new THREE.BoxGeometry(3.35, 2.85, 2.95), marbleStoneMat); mainHall.position.set(0, 1.98, -0.15); g.add(mainHall);
      const midCornice = new THREE.Mesh(new THREE.BoxGeometry(3.52, 0.18, 3.12), royalGoldMat); midCornice.position.set(0, 1.95, -0.15); g.add(midCornice);
      const topCornice = new THREE.Mesh(new THREE.BoxGeometry(3.58, 0.22, 3.18), royalGoldMat); topCornice.position.set(0, 3.38, -0.15); g.add(topCornice);

      // 4-Column Front Classical Portico + Pediment
      for (const cx of [-1.25, -0.42, 0.42, 1.25]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 2.65, 10), marbleStoneMat);
        col.position.set(cx, 1.90, 1.52); g.add(col);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.20, 0.38), royalGoldMat);
        cap.position.set(cx, 3.22, 1.52); g.add(cap);
      }
      const porticoRoof = buildPitchedGableRoof(2.9, 0.85, 0.75, slateRoofMat, marbleStoneMat, royalGoldMat);
      porticoRoof.position.set(0, 3.35, 1.38); g.add(porticoRoof);

      // Two-Tiered Imperial Cobalt-Blue & Gold Roof + Octagonal Cupola Lantern
      const mainRoof = buildPitchedGableRoof(3.65, 3.25, 1.55, slateRoofMat, marbleStoneMat, royalGoldMat);
      mainRoof.position.set(0, 3.45, -0.15); g.add(mainRoof);
      const cupolaBase = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.75, 0.85, 8), marbleStoneMat);
      cupolaBase.position.set(0, 5.15, -0.15); g.add(cupolaBase);
      const cupolaGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.65, 8), windowLightMat);
      cupolaGlow.position.set(0, 5.20, -0.15); g.add(cupolaGlow);
      const cupolaSpire = new THREE.Mesh(new THREE.ConeGeometry(0.82, 0.95, 8), royalGoldMat);
      cupolaSpire.position.set(0, 5.95, -0.15); g.add(cupolaSpire);

      // Grand Arched Door & Tall Golden-Framed Windows
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.88, 1.55, 0.16), royalGoldMat); door.position.set(0, 1.32, 1.34); g.add(door);
      for (const wy of [1.28, 2.68]) {
        for (const wx of [-1.05, 1.05]) {
          if (wy < 1.5 && Math.abs(wx) < 0.5) continue;
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.78, 0.16), windowLightMat);
          win.position.set(wx, wy, 1.34); g.add(win);
        }
      }
    }

    flattenAndBakeGroup(g);
    g.scale.setScalar(0.3 + 0.7 * builtProgress);
    worldObjectsGroup.add(g);
    const house = { type: 'house', name: houseName, mesh: g, x, z, progress: builtProgress, hp: 140 + era * 40, maxHp: 140 + era * 40 };
    g.userData.entity = house; buildings.push(house); return house;
  }

  function createWatchtower(x, z, builtProgress = 1.0, era = currentCivEra) {
    clearFootprintResources(x, z, 3.4);
    const y = getTerrainHeightAt(x, z), g = new THREE.Group();
    g.castShadow = true; g.position.set(x, y, z);
    let crystal = null, towerName = '';

    if (era <= 2) {
      // ERA 1 & ERA 2: Fortified Timber Lookout Tower with Diagonal X-Bracing, Parapet Deck, Shingled Roof & Braziers
      towerName = '🗼 หอคอยไม้สังเกตการณ์ชนเผ่า (Timber Lookout Tower)';
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.35, 0.45, 8), cutStoneMat); plinth.position.y = 0.22; g.add(plinth);
      for (const [px, pz] of [[-1.15,-1.15],[1.15,-1.15],[-1.15,1.15],[1.15,1.15]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 4.9, 8), barkMat);
        leg.position.set(px * 0.92, 2.55, pz * 0.92);
        leg.rotation.z = px * 0.06; leg.rotation.x = -pz * 0.06;
        g.add(leg);
      }
      // Diagonal X-bracing beams on all 4 sides
      for (let side = 0; side < 4; side++) {
        const sg = new THREE.Group(); sg.rotation.y = (side * Math.PI) / 2;
        for (const dir of [-1, 1]) {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.14), warmTimberMat);
          brace.position.set(0, 2.1, 1.05); brace.rotation.z = dir * 0.72; sg.add(brace);
        }
        const midBeam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.18), darkTimberMat);
        midBeam.position.set(0, 3.2, 1.02); sg.add(midBeam);
        g.add(sg);
      }
      const platform = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.36, 3.0), darkTimberMat); platform.position.y = 4.75; g.add(platform);
      for (const side of [-1, 1]) {
        const wallX = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.78, 0.18), warmTimberMat); wallX.position.set(0, 5.25, side * 1.42); g.add(wallX);
        const wallZ = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 3.0), warmTimberMat); wallZ.position.set(side * 1.42, 5.25, 0); g.add(wallZ);
      }
      for (const sx of [-1.25, 1.25]) for (const sz of [-1.25, 1.25]) {
        const pPost = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.85, 6), barkMat);
        pPost.position.set(sx, 5.75, sz); g.add(pPost);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.55, 1.85, 4), thatchRoofMat);
      roof.position.y = 7.25; roof.rotation.y = Math.PI / 4; g.add(roof);
      crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.52), new THREE.MeshBasicMaterial({ color: 0xff9f1c }));
      crystal.position.y = 5.65; g.add(crystal);
    } else {
      // ERA 3 & ERA 4: Octagonal Stone Fortress Keep Watchtower with Arrow Slits, Machicolations, Crenellations & Royal Banner Flag
      towerName = era === 4 ? '✨ ป้อมปราการเวทมนตร์จักรวรรดิ (Imperial Arcane Bastion)' : '🗼 ป้อมปราการหินใบเสมา (Royal Stone Watchtower)';
      const mainStone = era === 4 ? marbleStoneMat : lightStoneMat;
      const roofTile = era === 4 ? royalGoldMat : slateRoofMat;

      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.65, 1.25, 8), cutStoneMat); plinth.position.y = 0.62; g.add(plinth);
      for (let b = 0; b < 4; b++) {
        const ba = (b / 4) * Math.PI * 2;
        const buttress = new THREE.Mesh(new THREE.BoxGeometry(0.72, 4.2, 0.95), cutStoneMat);
        buttress.position.set(Math.cos(ba) * 1.72, 2.1, Math.sin(ba) * 1.72); buttress.rotation.y = -ba; g.add(buttress);
      }
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.58, 1.92, 5.2, 8), mainStone); shaft.position.y = 3.1; g.add(shaft);
      for (const by of [2.4, 4.2]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(1.82, 1.82, 0.24, 8), era === 4 ? royalGoldMat : darkTimberMat);
        band.position.y = by; g.add(band);
      }
      // Glowing arrow-slit windows around the shaft
      for (let w = 0; w < 4; w++) {
        const wa = (w / 4) * Math.PI * 2 + Math.PI / 4;
        const slit = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.95, 0.24), windowLightMat);
        slit.position.set(Math.cos(wa) * 1.68, 3.35, Math.sin(wa) * 1.68); slit.rotation.y = -wa; g.add(slit);
      }
      // Corbeled Machicolation Gallery & 8 Crenellated Merlons
      const corbel = new THREE.Mesh(new THREE.CylinderGeometry(2.18, 1.65, 0.65, 8), cutStoneMat); corbel.position.y = 5.65; g.add(corbel);
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.18, 0.45, 8), mainStone); deck.position.y = 6.15; g.add(deck);
      for (let m = 0; m < 8; m++) {
        const ma = (m / 8) * Math.PI * 2;
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.65, 0.38), mainStone);
        merlon.position.set(Math.cos(ma) * 2.02, 6.65, Math.sin(ma) * 2.02); merlon.rotation.y = -ma; g.add(merlon);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.35, 2.65, 8), roofTile); roof.position.y = 8.15; g.add(roof);
      // Royal Pennon Banner Flag fluttering from spire
      const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.8, 6), royalGoldMat);
      flagPole.position.set(0, 9.8, 0); g.add(flagPole);
      const banner = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.48, 0.06), new THREE.MeshStandardMaterial({ color: 0xe11d48, matType: 5 }));
      banner.position.set(0.58, 10.35, 0); g.add(banner);

      crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.65), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      crystal.position.y = 11.1; g.add(crystal);
    }

    flattenAndBakeGroup(g, crystal ? [crystal] : []);
    g.scale.setScalar(0.3 + 0.7 * builtProgress);
    worldObjectsGroup.add(g);
    const tower = { type: 'tower', name: towerName, mesh: g, crystal, x, z, progress: builtProgress, hp: 200 + era * 60, maxHp: 200 + era * 60, fireCooldown: 0 };
    g.userData.entity = tower; buildings.push(tower); return tower;
  }

    let nextAgentId = 1;
  const thaiNames = ['คีริน','อารยา','ธาม','ลลนา','ภาคิน','รินรดา','กวี','นารา','อัคคี','วายุ','ปฐพี','วารี','เมฆา','ทิวา','ราตรี','แสงดาว'];

  // Detailed Articulated Human Character (Villager & Royal Knight Soldier)
  function createAgent(x, z, role = 'villager') {
    // Fixed city spawn coordinates can overlap the river's walking exclusion band.
    // Place people on the nearest bank, while preserving legitimate bridge spawns.
    if (isPointInRiver(x, z) && !isOnBridgeDeck(x, z)) {
      const center = getRiverCenterX(z), side = x >= center ? 1 : -1;
      x = center + side * (getRiverWidth(z) * 1.25 + 0.6);
    }
    const y = getTerrainHeightAt(x, z), g = new THREE.Group();
    g.castShadow = true; g.position.set(x, y, z);

    const isSoldier = role === 'soldier';
    const tunicColor = isSoldier ? 0x1d4ed8 : ([0x059669, 0xd97706, 0x0284c7, 0xb45309][nextAgentId % 4]);
    const pantsColor = isSoldier ? 0x334155 : 0x451a03;
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xfcd34d, roughness: 0.55 });
    const tunicMat = new THREE.MeshStandardMaterial({ color: tunicColor, metalness: isSoldier ? 0.45 : 0.05, roughness: isSoldier ? 0.35 : 0.78 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.8 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.78, roughness: 0.22 });

    // 1) Articulated Left & Right Legs + Boots
    const leftLeg = new THREE.Group(); leftLeg.position.set(-0.16, 0.68, 0);
    const lThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.58, 10), pantsMat); lThigh.position.y = -0.26; leftLeg.add(lThigh);
    const lBoot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.28), bootMat); lBoot.position.set(0, -0.56, 0.04); leftLeg.add(lBoot);
    g.add(leftLeg);

    const rightLeg = new THREE.Group(); rightLeg.position.set(0.16, 0.68, 0);
    const rThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.58, 10), pantsMat); rThigh.position.y = -0.26; rightLeg.add(rThigh);
    const rBoot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.28), bootMat); rBoot.position.set(0, -0.56, 0.04); rightLeg.add(rBoot);
    g.add(rightLeg);

    // 2) Anatomical Upper Torso, Tunic Skirt & Leather Belt
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.72, 12), tunicMat); torso.position.y = 1.04; g.add(torso);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.27, 0.12, 12), bootMat); belt.position.y = 0.76; g.add(belt);
    if (isSoldier) {
      // Breastplate & Flowing Royal Cape + Shoulder Pauldrons
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.58, 0.36), steelMat); plate.position.y = 1.08; g.add(plate);
      const cape = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.92, 0.08), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.7 }));
      cape.position.set(0, 0.92, -0.24); cape.rotation.x = 0.18; g.add(cape);
      for (const sx of [-0.36, 0.36]) {
        const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), steelMat); pauldron.position.set(sx, 1.34, 0); g.add(pauldron);
      }
    }

    // 3) Neck, Sculpted Head, Eyes & Hat / Knight Helmet
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 0.18, 8), skinMat); neck.position.y = 1.44; g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skinMat); head.position.y = 1.68; g.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
    for (const ex of [-0.09, 0.09]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.038, 6, 6), eyeMat); eye.position.set(ex, 1.71, 0.23); g.add(eye);
    }

    if (isSoldier) {
      const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.29, 0.34, 12), steelMat); helm.position.y = 1.78; g.add(helm);
      const plume = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.28, 0.38), new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.6 }));
      plume.position.set(0, 2.04, -0.05); g.add(plume);
    } else {
      // Woven Straw Sun-Hat or Hair Crown
      if (nextAgentId % 2 === 0) {
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.48, 0.06, 14), new THREE.MeshStandardMaterial({ color: 0xfde047, roughness: 0.8 }));
        brim.position.y = 1.88; g.add(brim);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.24, 12), new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.8 }));
        crown.position.y = 2.0; g.add(crown);
      } else {
        const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.85 }));
        hair.position.set(0, 1.74, -0.03); g.add(hair);
      }
    }

    // 4) Articulated Right Arm + Detailed Sword / Woodcutter Axe
    const rightArm = new THREE.Group(); rightArm.position.set(0.36, 1.32, 0);
    const rArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.56, 8), isSoldier ? steelMat : tunicMat); rArmMesh.position.y = -0.22; rightArm.add(rArmMesh);
    const rHand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), skinMat); rHand.position.y = -0.50; rightArm.add(rHand);
    if (isSoldier) {
      const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.7 }));
      hilt.position.set(0, -0.50, 0.22); rightArm.add(hilt);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.92, 0.14), steelMat);
      blade.position.set(0, -0.50, 0.68); blade.rotation.x = Math.PI / 2; rightArm.add(blade);
    } else {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.65, 6), trunkMat);
      handle.position.set(0, -0.50, 0.25); handle.rotation.x = Math.PI / 2; rightArm.add(handle);
      const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.22), steelMat);
      axeHead.position.set(0, -0.50, 0.52); rightArm.add(axeHead);
    }
    g.add(rightArm);

    // 5) Articulated Left Arm + Kite Shield & Night Torch
    const leftArm = new THREE.Group(); leftArm.position.set(-0.36, 1.32, 0);
    const lArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.56, 8), isSoldier ? steelMat : tunicMat); lArmMesh.position.y = -0.22; leftArm.add(lArmMesh);
    if (isSoldier) {
      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.72, 0.54), new THREE.MeshStandardMaterial({ color: 0x1e40af, metalness: 0.5, roughness: 0.35 }));
      shield.position.set(-0.12, -0.28, 0.18); leftArm.add(shield);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 0.32), new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.7 }));
      trim.position.set(-0.13, -0.28, 0.18); leftArm.add(trim);
    }
    const torchGroup = new THREE.Group(); torchGroup.position.set(0, -0.44, 0.32);
    torchGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.55, 6), trunkMat));
    const flameOrb = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), new THREE.MeshBasicMaterial({ color: 0xff9f1c }));
    flameOrb.position.y = 0.35; torchGroup.add(flameOrb); torchGroup.visible = false;
    leftArm.add(torchGroup); g.add(leftArm);

    const carryBundle = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.36, 0.42), new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.8 }));
    carryBundle.position.set(0, 1.12, -0.34); carryBundle.visible = false; g.add(carryBundle);

    const stateGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: 0x34d399 }));
    stateGem.position.y = 2.38; g.add(stateGem);
    worldObjectsGroup.add(g);

    if (role === 'child') g.scale.setScalar(0.64);
    const id = nextAgentId++, name = thaiNames[(id - 1) % thaiNames.length] + ' #' + id;
    const rolePrefix = {
      soldier: '⚔️ อัศวิน ',
      farmer: '🌾 ชาวนา ',
      merchant: '🎪 พ่อค้า ',
      fisherman: '🎣 ชาวประมง ',
      child: '👧 เด็กน้อย ',
      villager: '🧑‍🔧 ช่างเมือง '
    }[role] || '🧑‍🌾 ชาวบ้าน ';
    const agent = {
      id, type: 'agent', role, name: rolePrefix + name,
      mesh: g, rightArm, leftArm, leftLeg, rightLeg, torchGroup, flameOrb, stateGem, carryBundle, x, z,
      hp: isSoldier ? 160 : 90, maxHp: isSoldier ? 160 : 90, hunger: 15 + Math.random() * 25,
      state: isSoldier ? 'PATROL' : 'GATHER', stateLabel: isSoldier ? 'ลาดตระเวน' : 'ตัดไม้/ขุดแร่',
      targetObj: null, workTimer: 0, carryType: null, carryAmount: 0, walkCycle: Math.random() * 10, alive: true
    };
    g.userData.entity = agent; agents.push(agent); return agent;
  }

  // Detailed Bipedal Horned Winged Demon / Void Brute Monster
  function spawnMonster(waveLevel = 1) {
    if (!portalObj) return;
    const isBoss = Math.random() < 0.28, angle = Math.random() * Math.PI * 2;
    const sx = portalObj.x + Math.cos(angle) * 2.5, sz = portalObj.z + Math.sin(angle) * 2.5, sy = getTerrainHeightAt(sx, sz);
    const g = new THREE.Group(); g.castShadow = true; g.position.set(sx, sy, sz);
    const scale = isBoss ? 1.42 : 1.05;

    const skinMat = new THREE.MeshStandardMaterial({
      color: isBoss ? 0x4c1d95 : 0x311042,
      emissive: isBoss ? 0x7e22ce : 0x581c87,
      emissiveIntensity: 0.38,
      roughness: 0.42
    });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.4 });
    const magmaMat = new THREE.MeshBasicMaterial({ color: isBoss ? 0xf43f5e : 0xff0055 });

    // 1) Articulated Demon Hind Legs
    const leftLeg = new THREE.Group(); leftLeg.position.set(-0.26 * scale, 0.75 * scale, 0);
    const lLegMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * scale, 0.11 * scale, 0.72 * scale, 8), skinMat); lLegMesh.position.y = -0.32 * scale; leftLeg.add(lLegMesh);
    g.add(leftLeg);

    const rightLeg = new THREE.Group(); rightLeg.position.set(0.26 * scale, 0.75 * scale, 0);
    const rLegMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * scale, 0.11 * scale, 0.72 * scale, 8), skinMat); rLegMesh.position.y = -0.32 * scale; rightLeg.add(rLegMesh);
    g.add(rightLeg);

    // 2) Muscular V-Tapered Demon Torso & Glowing Core
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.48 * scale, 0.28 * scale, 0.95 * scale, 10), skinMat);
    torso.position.y = 1.18 * scale; g.add(torso);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.24 * scale, 0), magmaMat);
    core.position.set(0, 1.22 * scale, 0.36 * scale); g.add(core);

    // 3) Horned Demon Head, Glowing Eyes & Curved Ram Horns
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34 * scale, 10, 10), skinMat);
    head.position.set(0, 1.82 * scale, 0.12 * scale); g.add(head);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075 * scale, 6, 6), magmaMat);
      eye.position.set(side * 0.14 * scale, 1.86 * scale, 0.40 * scale); g.add(eye);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.11 * scale, 0.68 * scale, 8), hornMat);
      horn.position.set(side * 0.28 * scale, 2.15 * scale, 0.02 * scale);
      horn.rotation.z = -side * 0.55; horn.rotation.x = -0.25; g.add(horn);
    }

    // 4) Demon Bat Wings on Back
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.85 * scale, 0.52 * scale, 0.06 * scale), hornMat);
      wing.position.set(side * 0.62 * scale, 1.48 * scale, -0.28 * scale);
      wing.rotation.z = side * 0.38; wing.rotation.y = -side * 0.32; g.add(wing);
    }

    // 5) Muscular Clawed Arms + Void Cleaver Weapon
    const leftArm = new THREE.Group(); leftArm.position.set(-0.52 * scale, 1.48 * scale, 0);
    const lArm = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * scale, 0.11 * scale, 0.72 * scale, 8), skinMat); lArm.position.y = -0.28 * scale; leftArm.add(lArm);
    g.add(leftArm);

    const rightArm = new THREE.Group(); rightArm.position.set(0.52 * scale, 1.48 * scale, 0);
    const rArm = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * scale, 0.11 * scale, 0.72 * scale, 8), skinMat); rArm.position.y = -0.28 * scale; rightArm.add(rArm);
    const cleaver = new THREE.Mesh(new THREE.BoxGeometry(0.12 * scale, 0.85 * scale, 0.28 * scale), magmaMat);
    cleaver.position.set(0, -0.58 * scale, 0.35 * scale); cleaver.rotation.x = Math.PI / 3; rightArm.add(cleaver);
    g.add(rightArm);

    worldObjectsGroup.add(g);
    const eraScale = 1 + (state.civEra - 1) * 0.45;
    const isBrute = !isBoss && (Math.random() < 0.40);
    if (isBrute) g.scale.setScalar(1.26);
    const baseHp = isBoss ? (420 + waveLevel * 95) : (isBrute ? (220 + waveLevel * 52) : (130 + waveLevel * 32));
    const maxHp = Math.round(baseHp * eraScale);
    const baseDmg = isBoss ? 34 : (isBrute ? 24 : 15);
    const m = {
      type: 'monster', isBoss, isBrute,
      name: isBoss ? '🔥 จอมอสูรแม่ทัพอเวจี (Void Overlord)' : (isBrute ? '🪨 โกเลมศิลาทมิฬ (Siege Brute)' : '🐾 อสูรเงาว่องไว (Shadow Stalker)'),
      mesh: g, leftLeg, rightLeg, leftArm, rightArm, x: sx, z: sz,
      hp: maxHp, maxHp, dmg: Math.round(baseDmg * eraScale),
      speed: isBoss ? 5.4 : (isBrute ? 6.0 : 8.0), attackTimer: 0, alive: true
    };
    g.userData.entity = m; monsters.push(m);
  }

  const ERA_INFO = {
    1: { badge: '🔥 ยุคที่ 1: ชนเผ่าดึกดำบรรพ์', nextLabel: '🏛️ ความก้าวหน้าสู่ยุคที่ 2 (เกษตรกรรม)' },
    2: { badge: '🌾 ยุคที่ 2: ชุมชนเกษตรกรรม', nextLabel: '🏛️ ความก้าวหน้าสู่ยุคที่ 3 (เมืองการค้า)' },
    3: { badge: '🏰 ยุคที่ 3: เมืองศักดินาและการค้า', nextLabel: '🏛️ ความก้าวหน้าสู่ยุคที่ 4 (จักรวรรดิเวท)' },
    4: { badge: '✨ ยุคที่ 4: จักรวรรดิเอเธอเรียม', nextLabel: '✨ บรรลุยุคทองสูงสุดแล้ว (Max Era)' }
  };

  function populateWorld(era = 1, resetNature = false) {
    currentCivEra = era;
    rebuildTerrainVertices();
    const keepNature = !resetNature && trees.length > 0;
    if (!keepNature) {
      while (worldObjectsGroup.children.length > 0) worldObjectsGroup.remove(worldObjectsGroup.children[0]);
      trees.length = ores.length = 0;
    } else {
      // Remove only civilization structures, units, wagons, livestock, farms, boats (keep natural trees & ores!)
      const natureSet = new Set([...trees.map(t => t.mesh), ...ores.map(o => o.mesh)]);
      for (let i = worldObjectsGroup.children.length - 1; i >= 0; i--) {
        if (!natureSet.has(worldObjectsGroup.children[i])) {
          worldObjectsGroup.remove(worldObjectsGroup.children[i]);
        }
      }
    }
    for (const p of projectiles) if (p.mesh) scene.remove(p.mesh);
    buildings.length = agents.length = monsters.length = projectiles.length = wagons.length = livestock.length = windmills.length = boats.length = cropFields.length = skyAirships.length = 0; ancientRelicObj = null;

    // 1) Central Monument & Distant Void Portal (68, -58)
    createCentralTemple(era);
    createVoidPortal();
    createAncientRelicMonolith(-22, -20);
    createSkyAirship(-6, 13.2, 14);
    createHotAirBalloon(14, 14.8, 8, 0x0284c7, 0xfbbf24, 16, 12, 0.09, 0.8);
    createHotAirBalloon(-18, 15.5, -6, 0x10b981, 0xf43f5e, 15, 11, -0.08, 2.5);

    // 2) Bridges across the River
    createVillageBridge(14.0, era);
    if (era >= 3) createVillageBridge(-16.0, era);

    // 3) Era-Specific Houses & Districts
    const era1Houses = [[-6.5, 5.2], [7.8, 5.5], [5.2, -6.2]];
    const era2Houses = [...era1Houses, [-23, 6], [12, -8], [6, 22]];
    const era3Houses = [...era2Houses, [23, -4], [27, 6], [-29, -4], [14, 22]];
    const era4Houses = [...era3Houses, [-22, -14], [8, -21]];
    const activeHouses = era === 1 ? era1Houses : (era === 2 ? era2Houses : (era === 3 ? era3Houses : era4Houses));
    for (const [hx, hz] of activeHouses) createHouse(hx, hz, 1.0, era);

    // 4) Era 2+: Village Well, Windmill, Crop Fields, Fishing Pier & Livestock Pasture
    if (era >= 2) {
      createTownWell(2.5, 9.5);
      createFishingPier(2.0);
      createWindmill(-34, 8);
      createCropField(-28, 20, true, true);
      createCropField(-38, 20, false, false);
      if (era >= 3) {
        createCropField(-28, 30, true, false);
        createCropField(-38, 30, false, true);
      }
      createLivestockPasture(24, 31);
      if (era === 2) {
        const bSouthX = getRiverCenterX(14.0);
        createHorseWagon([[-30, 14], [bSouthX, 14], [4, 14], [bSouthX, 14]], 0x7c2d12);
      }
    }

    // 5) Era 3+: Bustling Marketplace & Horse-Drawn Cargo Wagons
    if (era >= 3) {
      createMarketStall(15.5, 11.0, 0xe11d48, 0.15);
      createMarketStall(20.5, 11.0, 0x0284c7, -0.15);
      createMarketStall(15.5, 17.5, 0x16a34a, 3.0);
      createMarketStall(20.5, 17.5, 0x9333ea, 3.2);

      const bSouthX = getRiverCenterX(14.0), bNorthX = getRiverCenterX(-16.0);
      createHorseWagon([[-32, 14], [bSouthX, 14], [4, 14], [22, 14], [4, 14], [bSouthX, 14]], 0x7c2d12);
      createHorseWagon([[4, -20], [4, 2], [4, 14], [18, 14], [14, 25], [4, 14]], 0x92400e);
      if (era >= 4) {
        createHorseWagon([[-25, 10], [-25, -16], [bNorthX, -16], [6, -16], [bNorthX, -16], [-25, -16]], 0x451a03);
      }
    }

    // 6) Era-Scaled Frontier Watchtowers
    const towerCoords = [[28, -20], [36, -28], [44, -36], [32, -34]];
    for (let t = 0; t < era; t++) createWatchtower(towerCoords[t][0], towerCoords[t][1], 1.0, era);

    // 7) Scatter Forests & Ore Nodes (only on initial world creation or island regen)
    let placedTrees = keepNature ? 999 : 0, attempts = 0;
    while (placedTrees < 90 && attempts < 550) {
      attempts++;
      const angle = Math.random() * Math.PI * 2, dist = 16 + Math.random() * 82;
      const tx = Math.cos(angle) * dist, tz = Math.sin(angle) * dist;
      if (getIslandMask(tx, tz) < 0.28 || isPointInRiver(tx, tz) || isPointOnRoad(tx, tz) || isNearBuildingFoundation(tx, tz, 2.5)) continue;
      if (Math.hypot(tx + 33, tz - 24) < 15 || Math.hypot(tx - 24, tz - 31) < 12) continue;
      const h = getTerrainHeightAt(tx, tz);
      if (h > 11.5 || h < getWaterLevelAt(tz) + 0.4 || getTerrainSlopeAt(tx, tz) > 0.55) continue;
      createTree(tx, tz, h > 6.8 ? 'pine' : (placedTrees % 3 === 0 ? 'fruit' : 'oak'), 0.7 + Math.random() * 0.45);
      placedTrees++;
    }
    let placedOres = keepNature ? 999 : 0; attempts = 0;
    while (placedOres < 22 && attempts < 350) {
      attempts++;
      const angle = Math.random() * Math.PI * 2, dist = 22 + Math.random() * 74;
      const ox = Math.cos(angle) * dist, oz = Math.sin(angle) * dist;
      if (getIslandMask(ox, oz) < 0.30 || isPointInRiver(ox, oz) || isPointOnRoad(ox, oz) || isNearBuildingFoundation(ox, oz, 2.5)) continue;
      if (Math.hypot(ox + 33, oz - 24) < 14 || Math.hypot(ox - 24, oz - 31) < 12) continue;
      createOreNode(ox, oz, placedOres % 4 === 0); placedOres++;
    }

    // 8) Spawn Era-Scaled Population
    if (era === 1) {
      // Small Tribal Clan: 4 Gatherers, 1 Child, 2 Tribal Warriors
      for (let v = 0; v < 4; v++) { const a = (v / 4) * Math.PI * 2; createAgent(Math.cos(a) * 5.5, Math.sin(a) * 5.5, 'villager'); }
      createAgent(2.5, 4.5, 'child');
      createAgent(12, -10, 'soldier'); createAgent(15, -8, 'soldier');
    } else if (era === 2) {
      // Agricultural Village: Farmers, Fishermen, Children, Villagers, Guards
      createAgent(-28, 18, 'farmer'); createAgent(-36, 22, 'farmer');
      createAgent(getRiverCenterX(2.0) + 5.5, 2.0, 'fisherman');
      for (let c = 0; c < 3; c++) createAgent(2 + Math.cos(c * 2) * 4, 9 + Math.sin(c * 2) * 4, 'child');
      for (let v = 0; v < 5; v++) { const a = (v / 5) * Math.PI * 2; createAgent(Math.cos(a) * 7, Math.sin(a) * 7, 'villager'); }
      for (let s = 0; s < 3; s++) createAgent(26 + s * 3, -18 - s * 2, 'soldier');
    } else {
      // Era 3 & Era 4: Full Bustling Kingdom / Imperial Metropolis
      createAgent(-28, 18, 'farmer'); createAgent(-36, 22, 'farmer'); createAgent(-29, 28, 'farmer'); createAgent(-37, 29, 'farmer');
      createAgent(16, 12, 'merchant'); createAgent(20, 12, 'merchant'); createAgent(18, 16, 'merchant');
      createAgent(getRiverCenterX(2.0) + 5.5, 2.0, 'fisherman'); createAgent(getRiverCenterX(4.0) + 5.5, 4.0, 'fisherman');
      for (let c = 0; c < (era === 4 ? 6 : 4); c++) createAgent(2 + Math.cos(c * 1.2) * 5, 9 + Math.sin(c * 1.2) * 5, 'child');
      for (let v = 0; v < (era === 4 ? 7 : 5); v++) { const a = (v / 6) * Math.PI * 2; createAgent(Math.cos(a) * 9, Math.sin(a) * 9, 'villager'); }
      for (let s = 0; s < (era === 4 ? 7 : 5); s++) { const a = (s / 6) * Math.PI * 2; createAgent(34 + Math.cos(a) * 4, -26 + Math.sin(a) * 4, 'soldier'); }
    }
  }
  populateWorld(1);

    const state = {
    day: 1, timeOfDay: 8.2, timeScale: 1.0, isNight: false, siegeTriggeredTonight: false, secondWaveTonight: false, civEra: 1, civProgress: 0,
    food: 35, wood: 20, ore: 15, faith: 60, maxFaith: 200,
    activePower: 'observe', terraMode: 'raise', terraRadius: 8, selectedEntity: null,
    historyPop: [12, 12, 12], historyRes: [160, 160, 160], historyFaith: [120, 120, 120],
    sampleTimer: 0, autoBuild: false, autoBuildCooldown: 4.0
  };

  const logContainer = document.getElementById('event-log');
  function addLog(msg, type = 'info') {
    const h = Math.floor(state.timeOfDay), m = Math.floor((state.timeOfDay % 1) * 60);
    const div = document.createElement('div');
    div.className = 'log-entry' + (type === 'warn' ? ' warn' : (type === 'bless' ? ' bless' : ''));
    div.innerHTML = `<span class="log-time">[วันที่ ${state.day} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}]</span>${msg}`;
    logContainer.prepend(div);
    while (logContainer.children.length > 25) logContainer.removeChild(logContainer.lastChild);
  }
  function reportActionIssue(message) {
    addLog(message, 'warn');
    showDilemmaToast(message);
  }
  addLog('อาณาจักรลอยฟ้า Aetheria กำเนิดขึ้น! ชาวบ้านเริ่มออกเก็บทรัพยากรและสร้างเมือง', 'bless');

  const reticleGroup = new THREE.Group();
  const reticleRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.18, 32), new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  reticleRing.rotation.x = -Math.PI / 2; reticleGroup.add(reticleRing);
  const reticleFill = new THREE.Mesh(new THREE.RingGeometry(0.05, 1, 32), new THREE.MeshBasicMaterial({ color: 0xfde047, side: THREE.DoubleSide, transparent: true, opacity: 0.16 }));
  reticleFill.rotation.x = -Math.PI / 2; reticleGroup.add(reticleFill);
  reticleGroup.visible = false; scene.add(reticleGroup);

  function spawnBurstParticles(x, y, z, colorHex, count = 16, speed = 8, size = 0.32, life = 0.85) {
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 1 }), geo = new THREE.OctahedronGeometry(size, 0);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat.clone()); m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, spd = (0.3 + Math.random() * 0.7) * speed;
      scene.add(m); fxParticles.push({ mesh: m, vx: Math.cos(a)*spd, vy: (0.4+Math.random()*0.8)*speed, vz: Math.sin(a)*spd, gravity: 16, life, maxLife: life });
    }
  }
  function spawnShockwaveRing(x, y, z, colorHex = 0xf97316, maxRadius = 16, duration = 0.75) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.2, 32), new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.35, z); scene.add(ring);
    fxParticles.push({ mesh: ring, isShockwave: true, maxRadius, life: duration, maxLife: duration });
  }
  function triggerScreenFlash() { const fl = document.getElementById('screen-flash'); fl.style.opacity = '0.85'; setTimeout(() => { fl.style.opacity = '0'; }, 90); }
  function evolveToEra(targetEra) {
    targetEra = Math.max(1, Math.min(4, targetEra));
    economy?.reset();
    state.selectedEntity = null; camCtrl.followEntity = null;
    const inspCard = document.getElementById('inspector-card'); if (inspCard) inspCard.classList.remove('visible');
    state.civEra = targetEra;
    state.civProgress = targetEra >= 4 ? 100 : 0;
    populateWorld(targetEra);
    audio.playBlessChime();
    spawnShockwaveRing(0, getTerrainHeightAt(0, 0), 0, 0xfbbf24, 38, 1.2);
    spawnBurstParticles(0, getTerrainHeightAt(0, 0) + 6.5, 0, 0xfde047, 18, 10, 0.18, 0.75);
    document.querySelectorAll('[data-era]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.era, 10) === targetEra));
    const info = ERA_INFO[targetEra];
    const badge = document.getElementById('era-top-badge');
    if (badge) badge.textContent = info.badge;
    const lbl = document.getElementById('civ-progress-label');
    if (lbl) lbl.textContent = info.nextLabel;
    addLog(`🏛️ วิวัฒนาการครั้งประวัติศาสตร์! ชนเผ่าพัฒนาเข้าสู่ "${info.badge}" เรียบร้อยแล้ว!`, 'bless');
    updateHUD();
  }

  function syncWorldObjectsElevation() {
    for (const t of trees) t.mesh.position.y = getTerrainHeightAt(t.x, t.z);
    for (const o of ores) o.mesh.position.y = getTerrainHeightAt(o.x, o.z);
    for (const b of buildings) b.mesh.position.y = getTerrainHeightAt(b.x, b.z);
    for (const cf of cropFields) cf.mesh.position.y = getTerrainHeightAt(cf.x, cf.z);
    for (const an of livestock) an.mesh.position.y = getTerrainHeightAt(an.x, an.z);
    for (const wg of wagons) wg.mesh.position.y = getTerrainHeightAt(wg.x, wg.z);
    if (portalObj) portalObj.mesh.position.y = getTerrainHeightAt(portalObj.x, portalObj.z);
    for (const a of agents) a.mesh.position.y = getTerrainHeightAt(a.x, a.z);
    for (const m of monsters) m.mesh.position.y = getTerrainHeightAt(m.x, m.z);
  }

  function castRainPower(tx, tz) {
    if (state.faith < 15) { reportActionIssue('พลังศรัทธาไม่พอสำหรับเสกฝนทิพย์ (ต้องการ 15 ✨)'); return; }
    state.faith -= 15; audio.playBlessChime();
    const ty = getTerrainHeightAt(tx, tz);
    godFxPointLight.color.setHex(0x38bdf8); godFxPointLight.intensity = 2.5; godFxPointLight.position.set(tx, ty + 10, tz);
    const cloudGroup = new THREE.Group(); cloudGroup.position.set(tx, ty + 14, tz);
    const rCloudMat = new THREE.MeshStandardMaterial({ color: 0xbae6fd, roughness: 0.7 });
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(2.5, 10, 8), rCloudMat);
      puff.position.set((i - 2) * 1.8, (i % 2) * 0.6, (Math.random() - 0.5) * 2); puff.scale.set(1.2, 0.6, 1.1); cloudGroup.add(puff);
    }
    scene.add(cloudGroup); fxParticles.push({ mesh: cloudGroup, vx: 0, vy: 0.4, vz: 0, gravity: 0, life: 3.2, maxLife: 3.2 });
    const dropMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 }), dropGeo = new THREE.BoxGeometry(0.08, 1.2, 0.08);
    for (let i = 0; i < 40; i++) {
      const drop = new THREE.Mesh(dropGeo, dropMat.clone()), a = Math.random() * Math.PI * 2, r = Math.random() * 11;
      drop.position.set(tx + Math.cos(a) * r, ty + 6 + Math.random() * 8, tz + Math.sin(a) * r); scene.add(drop);
      fxParticles.push({ mesh: drop, vx: 0, vy: -18, vz: 0, gravity: 0, life: 0.85, maxLife: 0.85 });
    }
    spawnShockwaveRing(tx, ty, tz, 0x34d399, 13, 0.9);
    let grownCount = 0;
    for (const t of trees) {
      if (Math.hypot(t.x - tx, t.z - tz) <= 13.5) {
        t.growth = Math.min(1.25, t.growth + 0.55); t.mesh.scale.setScalar(t.growth); t.woodAmount = 35;
        if (t.species === 'fruit') { t.hasFruit = true; t.fruitMeshes.forEach(fm => { fm.visible = true; }); }
        grownCount++;
      }
    }
    for (let s = 0; s < 2; s++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 7, nx = tx + Math.cos(a) * r, nz = tz + Math.sin(a) * r, nh = getTerrainHeightAt(nx, nz);
      if (getIslandMask(nx, nz) > 0.35 && !isPointInRiver(nx, nz) && !isNearBuildingFoundation(nx, nz, 1.2) && !trees.some(t => Math.hypot(t.x - nx, t.z - nz) < 2.4) && nh > getWaterLevelAt(nz) + 0.5 && nh < 7.8 && getTerrainSlopeAt(nx, nz) < 0.45) {
        createTree(nx, nz, 'fruit', 1.0); grownCount++;
      }
    }
    for (const ag of agents) if (Math.hypot(ag.x - tx, ag.z - tz) <= 13.5) { ag.hp = ag.maxHp; ag.hunger = Math.max(0, ag.hunger - 35); }
    state.food += 18; addLog(`🌧️ เสกฝนทิพย์โปรยปราย! ต้นไม้เติบโตและออกผล ${grownCount} ต้น (+18 อาหาร)`, 'bless');
  }

  let lastTerraWarnTime = 0;
  function applyTerraforming(tx, tz, dir = 1, dt = 0.05) {
    if (state.faith < 0.5) return false;
    if (isNearBuildingFoundation(tx, tz, state.terraRadius * 0.6)) {
      const now = performance.now();
      if (now - lastTerraWarnTime > 1800) { lastTerraWarnTime = now; reportActionIssue('🚫 ไม่สามารถปรับความสูงต่ำของพื้นดินในบริเวณที่มีสิ่งปลูกสร้างตั้งอยู่ได้!'); }
      return false;
    }
    const posAttr = terrainGeo.attributes.position, radius = state.terraRadius;
    let modified = false;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i), vz = posAttr.getZ(i), dist = Math.hypot(vx - tx, vz - tz);
      if (dist < radius && getIslandMask(vx, vz) > 0.12) {
        if (isNearBuildingFoundation(vx, vz, 2.5) || isPointInRiver(vx, vz)) continue;
        const falloff = Math.cos((dist / radius) * (Math.PI / 2));
        userHeightOffsets[i] = THREE.MathUtils.clamp(userHeightOffsets[i] + dir * falloff * 11.5 * dt, -6.0, 14.5);
        modified = true;
      }
    }
    if (modified) {
      state.faith = Math.max(0, state.faith - 3.5 * dt);
      for (let i = trees.length - 1; i >= 0; i--) {
        const t = trees[i];
        if (Math.hypot(t.x - tx, t.z - tz) < radius) {
          const th = getTerrainHeightAt(t.x, t.z);
          if (th > 8.8 || th < getWaterLevelAt(t.z) + 0.3 || getTerrainSlopeAt(t.x, t.z) > 0.6) { worldObjectsGroup.remove(t.mesh); trees.splice(i, 1); }
        }
      }
      rebuildTerrainVertices(); syncWorldObjectsElevation();
    }
    return modified;
  }

  function castMeteorStrike(tx, tz) {
    if (state.faith < 35) { reportActionIssue('พลังศรัทธาไม่พอสำหรับเสกอุกกาบาต (ต้องการ 35 ✨)'); return; }
    state.faith -= 35;
    const ty = getTerrainHeightAt(tx, tz), startX = tx - 28, startY = ty + 68, startZ = tz - 22;
    const meteorGroup = new THREE.Group(); meteorGroup.position.set(startX, startY, startZ);
    meteorGroup.add(new THREE.Mesh(new THREE.DodecahedronGeometry(2.4, 0), new THREE.MeshStandardMaterial({ color: 0x7c2d12, emissive: 0xf97316, emissiveIntensity: 1.2, roughness: 0.5 })));
    meteorGroup.add(new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.45 })));
    scene.add(meteorGroup);
    projectiles.push({ type: 'meteor', mesh: meteorGroup, x: startX, y: startY, z: startZ, tx, ty, tz, speed: 82 });
    addLog('☄️ อุกกาบาตเพลิงกำลังพุ่งลงมาจากฟากฟ้า!', 'warn');
  }

  function detonateMeteor(tx, ty, tz) {
    audio.playMeteorImpact(); camCtrl.triggerShake(2.4, 0.65); triggerScreenFlash();
    godFxPointLight.color.setHex(0xf97316); godFxPointLight.intensity = 4.0; godFxPointLight.position.set(tx, ty + 6, tz);
    spawnShockwaveRing(tx, ty, tz, 0xf97316, 19, 0.85); spawnShockwaveRing(tx, ty + 0.5, tz, 0xfef08a, 13, 0.55);
    spawnBurstParticles(tx, ty + 1, tz, 0xf97316, 36, 18, 0.55, 1.25);
    const posAttr = terrainGeo.attributes.position, craterRadius = 9.5;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i), vz = posAttr.getZ(i), d = Math.hypot(vx - tx, vz - tz);
      if (d < craterRadius && getIslandMask(vx, vz) > 0.15) {
        if (isNearBuildingFoundation(vx, vz, 1.2) || isPointInRiver(vx, vz)) continue;
        userHeightOffsets[i] = Math.max(-5.5, userHeightOffsets[i] - Math.cos((d / craterRadius) * (Math.PI / 2)) * 2.6);
      }
    }
    for (let i = trees.length - 1; i >= 0; i--) if (Math.hypot(trees[i].x - tx, trees[i].z - tz) < 5.5) { worldObjectsGroup.remove(trees[i].mesh); trees.splice(i, 1); }
    rebuildTerrainVertices(); syncWorldObjectsElevation();

    let kills = 0;
    for (const m of monsters) {
      if (!m.alive) continue;
      const d = Math.hypot(m.x - tx, m.z - tz);
      if (d <= 15.5) { m.hp -= 240 * (1 - d / 18); if (m.hp <= 0) { m.alive = false; worldObjectsGroup.remove(m.mesh); kills++; state.faith = Math.min(state.maxFaith, state.faith + 8); } }
    }
    let friendlyHit = 0;
    for (const ag of agents) {
      if (!ag.alive || !ag.mesh.visible) continue;
      const d = Math.hypot(ag.x - tx, ag.z - tz);
      if (d <= 9.5) { ag.hp -= 45 * (1 - d / 10); friendlyHit++; if (ag.hp <= 0) { ag.alive = false; worldObjectsGroup.remove(ag.mesh); } }
    }
    for (let i = buildings.length - 1; i >= 0; i--) {
      const b = buildings[i]; if (b.type === 'temple') continue;
      const d = Math.hypot(b.x - tx, b.z - tz);
      if (d <= 8.5) { b.hp -= 85 * (1 - d / 9.5); friendlyHit++; if (b.hp <= 0) { worldObjectsGroup.remove(b.mesh); const wIdx = windmills.indexOf(b); if (wIdx >= 0) windmills.splice(wIdx, 1); buildings.splice(i, 1); addLog(`🏚️ ${b.name} พังทลายจากแรงระเบิดของอุกกาบาต!`, 'warn'); } }
    }
    addLog(friendlyHit > 0 ? `⚠️ แรงระเบิดอุกกาบาตสร้างความเสียหายลูกหลง! (กำจัดมอนสเตอร์ ${kills} ตัว)` : `💥 อุกกาบาตพุ่งชนพื้นเกาะเกิดคลื่นกระแทก! กวาดล้างมอนสเตอร์ ${kills} ตัว`, friendlyHit > 0 ? 'warn' : 'bless');
  }

  function castLightningStrike(tx, tz) {
    if (state.faith < 20) { reportActionIssue('พลังศรัทธาไม่พอสำหรับเสกสายฟ้าฟาด (ต้องการ 20 ✨)'); return; }
    state.faith -= 20; audio.playLightningThunder(); camCtrl.triggerShake(1.2, 0.3); triggerScreenFlash();
    const ty = getTerrainHeightAt(tx, tz);
    godFxPointLight.color.setHex(0x7dd3fc); godFxPointLight.intensity = 4.5; godFxPointLight.position.set(tx, ty + 8, tz);
    const boltGroup = new THREE.Group(), segments = 12, boltMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
    let prevX = tx + (Math.random() - 0.5) * 6, prevY = ty + 55, prevZ = tz + (Math.random() - 0.5) * 6;
    for (let s = 1; s <= segments; s++) {
      const t = s / segments, nx = s === segments ? tx : THREE.MathUtils.lerp(prevX, tx, t) + (Math.random() - 0.5) * 3.8;
      const ny = THREE.MathUtils.lerp(ty + 55, ty, t), nz = s === segments ? tz : THREE.MathUtils.lerp(prevZ, tz, t) + (Math.random() - 0.5) * 3.8;
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, Math.hypot(nx-prevX, ny-prevY, nz-prevZ), 6), boltMat);
      cyl.position.set((prevX + nx) / 2, (prevY + ny) / 2, (prevZ + nz) / 2);
      cyl.rotation.z = -Math.atan2(nx - prevX, Math.max(0.1, prevY - ny));
      cyl.rotation.x = Math.atan2(nz - prevZ, Math.max(0.1, prevY - ny));
      boltGroup.add(cyl);
      const nodeOrb = new THREE.Mesh(new THREE.OctahedronGeometry(0.75 * (1 - t * 0.35), 0), new THREE.MeshBasicMaterial({ color: s % 2 === 0 ? 0xe0f2fe : 0x38bdf8 }));
      nodeOrb.position.set(nx, ny, nz); boltGroup.add(nodeOrb);
      prevX = nx; prevY = ny; prevZ = nz;
    }
    scene.add(boltGroup); fxParticles.push({ mesh: boltGroup, vx: 0, vy: 0, vz: 0, gravity: 0, life: 0.55, maxLife: 0.55 });
    spawnShockwaveRing(tx, ty, tz, 0x38bdf8, 10, 0.45);
    for (const t of trees) if (Math.hypot(t.x - tx, t.z - tz) < 3.2 && t.growth > 0.35) { t.growth = 0.22; t.hasFruit = false; t.mesh.scale.setScalar(t.growth); }
    let hitCount = 0;
    for (const m of monsters) {
      if (!m.alive) continue;
      if (Math.hypot(m.x - tx, m.z - tz) <= 11.5) {
        m.hp -= 155; hitCount++;
        if (m.hp <= 0) { m.alive = false; worldObjectsGroup.remove(m.mesh); state.faith = Math.min(state.maxFaith, state.faith + 7); }
      }
    }
    for (const ag of agents) if (ag.alive && ag.mesh.visible && Math.hypot(ag.x - tx, ag.z - tz) <= 3.8) ag.hp = Math.max(10, ag.hp - 25);
    addLog(`⚡ สายฟ้าสวรรค์ฟาดลงพื้น! ผ่าร่างมอนสเตอร์ ${hitCount} ตัว`, 'bless');
  }

  function castMiracleBeam(tx, tz) {
    miracleTarget = { x: tx, z: tz };
    const issue = getBuildingPlacementIssue(tx, tz);
    if (issue || state.faith < 25) {
      const message = issue ? `วางหอคอยไม่ได้: ${issue}` : 'ศรัทธาไม่พอ ต้องการ 25';
      addLog(`🚫 ${message}`, 'warn'); updateMiraclePreview(); return;
    }
    state.faith -= 25; audio.playBlessChime();
    const ty = getTerrainHeightAt(tx, tz);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 55, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    beam.position.set(tx, ty + 27.5, tz); scene.add(beam);
    fxParticles.push({ mesh: beam, vx: 0, vy: 0, vz: 0, gravity: 0, life: 0.9, maxLife: 0.9 });
    spawnShockwaveRing(tx, ty, tz, 0xfbbf24, 12, 0.8);
    createWatchtower(tx, tz, 1.0);
    for (const ag of agents) { ag.hp = ag.maxHp; ag.hunger = 0; }
    updateHUD(); updateMiraclePreview();
    addLog('🌟 ลำแสงประทานพรสถิตลงสู่พื้นเกาะ! สร้างป้อมปราการเวทมนตร์และฟื้นฟูชาวบ้านทั้งหมด', 'bless');
  }

  const raycaster = new THREE.Raycaster(), pointerNDC = new THREE.Vector2();
  let isTerraformDragging = false;
  let miracleTarget = null;
  const placementFeedback = document.getElementById('placement-feedback');
  function setReadoutText(id, text) {
    const el = document.getElementById(id);
    if (el.textContent !== text) el.textContent = text;
  }
  function updateMiraclePreview() {
    placementFeedback.hidden = state.activePower !== 'miracle';
    if (placementFeedback.hidden) return;
    const issue = miracleTarget && getBuildingPlacementIssue(miracleTarget.x, miracleTarget.z);
    const blocked = !!issue || state.faith < 25;
    placementFeedback.dataset.state = blocked ? 'blocked' : 'ready';
    const touchHint = navigator.maxTouchPoints > 0 ? 'แตะลากเล็ง ปล่อยเพื่อสร้าง' : 'เล็งพื้นเกาะเพื่อวางหอคอย';
    setReadoutText('placement-feedback', issue ? `⛔ ${issue} · ใช้ 25 ศรัทธา` : state.faith < 25 ? `⛔ ศรัทธาไม่พอ · ต้องการ 25 (มี ${Math.floor(state.faith)})` : miracleTarget ? '✓ วางหอคอยได้ · ใช้ 25 ศรัทธา' : `${touchHint} · ใช้ 25 ศรัทธา`);
    if (miracleTarget) {
      reticleGroup.visible = true;
      reticleGroup.position.set(miracleTarget.x, getTerrainHeightAt(miracleTarget.x, miracleTarget.z) + 0.35, miracleTarget.z);
      reticleGroup.scale.setScalar(4.5);
      reticleRing.material.color.setHex(blocked ? 0xef4444 : 0x34d399);
      reticleFill.material.color.setHex(blocked ? 0xf87171 : 0x6ee7b7);
    }
  }
  function updatePointerRay(e) {
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
  }
  function getTerrainIntersection(e) {
    updatePointerRay(e); if (!terrainMesh) return null;
    const hits = raycaster.intersectObject(terrainMesh, false);
    return hits.length > 0 ? hits[0].point : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return; // Touch gestures have their own handlers below.
    audio.init(); camCtrl.lastX = e.clientX; camCtrl.lastY = e.clientY;
    if (e.button === 2 || e.button === 1) {
      if (state.activePower === 'terraform' && e.button === 2) { isTerraformDragging = true; const pt = getTerrainIntersection(e); if (pt) applyTerraforming(pt.x, pt.z, -1, 0.08); return; }
      camCtrl.isDragging = true; camCtrl.isPanning = e.button === 1; return;
    }
    if (state.activePower === 'observe') {
      if (economy?.handlePoint(e)) return;
      updatePointerRay(e);
      const hits = raycaster.intersectObjects(worldObjectsGroup.children, true);
      if (hits.length > 0) {
        let obj = hits[0].object; while (obj && !obj.userData.entity && obj.parent) obj = obj.parent;
        if (obj && obj.userData.entity) { state.selectedEntity = obj.userData.entity; updateInspectorUI(); document.getElementById('inspector-card').classList.add('visible'); }
      }
      camCtrl.isDragging = true; camCtrl.isPanning = e.shiftKey; return;
    }
    const pt = getTerrainIntersection(e); if (!pt) { camCtrl.isDragging = true; return; }
    if (state.activePower === 'rain') castRainPower(pt.x, pt.z);
    else if (state.activePower === 'terraform') { isTerraformDragging = true; applyTerraforming(pt.x, pt.z, (e.shiftKey || state.terraMode === 'lower') ? -1 : 1, 0.08); }
    else if (state.activePower === 'meteor') castMeteorStrike(pt.x, pt.z);
    else if (state.activePower === 'lightning') castLightningStrike(pt.x, pt.z);
    else if (state.activePower === 'miracle') castMiracleBeam(pt.x, pt.z);
  });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (camCtrl.isDragging) {
      const dx = e.clientX - camCtrl.lastX, dy = e.clientY - camCtrl.lastY;
      camCtrl.lastX = e.clientX; camCtrl.lastY = e.clientY;
      if (camCtrl.isPanning) {
        const panScale = 0.09, rX = Math.cos(camCtrl.theta), rZ = -Math.sin(camCtrl.theta), fX = -Math.sin(camCtrl.theta), fZ = -Math.cos(camCtrl.theta);
        camCtrl.target.x -= (dx * rX - dy * fX) * panScale; camCtrl.target.z -= (dx * rZ - dy * fZ) * panScale; camCtrl.followEntity = null;
      } else {
        camCtrl.targetTheta -= dx * 0.0065; camCtrl.targetPhi = THREE.MathUtils.clamp(camCtrl.targetPhi - dy * 0.0055, 0.25, 1.42);
      }
      return;
    }
    if (state.activePower !== 'observe') {
      const pt = e.target === canvas ? getTerrainIntersection(e) : null;
      miracleTarget = state.activePower === 'miracle' && pt ? { x: pt.x, z: pt.z } : null;
      if (pt) {
        reticleGroup.visible = true; reticleGroup.position.set(pt.x, pt.y + 0.35, pt.z);
        reticleGroup.scale.setScalar(state.activePower === 'terraform' ? state.terraRadius : (state.activePower === 'meteor' ? 10 : (state.activePower === 'rain' ? 11 : 4.5)));
        const isBlocked = state.activePower === 'terraform' ? (isNearBuildingFoundation(pt.x, pt.z, 1.5) || isPointInRiver(pt.x, pt.z)) : (state.activePower === 'miracle' ? !canPlaceBuildingAt(pt.x, pt.z) : false);
        reticleRing.material.color.setHex(isBlocked ? 0xef4444 : 0xfbbf24); reticleFill.material.color.setHex(isBlocked ? 0xf87171 : 0xfde047);
        if (isTerraformDragging && state.activePower === 'terraform') applyTerraforming(pt.x, pt.z, (e.shiftKey || e.buttons === 2 || state.terraMode === 'lower') ? -1 : 1, 0.04);
      } else reticleGroup.visible = false;
      updateMiraclePreview();
    } else reticleGroup.visible = false;
  });
  canvas.addEventListener('pointermove', e => { if (economy?.active) economy.preview(getTerrainIntersection(e)); });
  canvas.addEventListener('pointerleave', () => { miracleTarget = null; reticleGroup.visible = false; updateMiraclePreview(); });

  window.addEventListener('pointerup', () => { camCtrl.isDragging = camCtrl.isPanning = isTerraformDragging = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); camCtrl.targetRadius = THREE.MathUtils.clamp(camCtrl.targetRadius + e.deltaY * 0.085, 18, 280); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    camCtrl.keys[e.code] = true;
    const keyMap = { Digit1: 'observe', Digit2: 'rain', Digit3: 'terraform', Digit4: 'meteor', Digit5: 'lightning', Digit6: 'miracle' };
    if (keyMap[e.code]) setGodPower(keyMap[e.code]);
  });
  window.addEventListener('keyup', (e) => { camCtrl.keys[e.code] = false; });
  window.addEventListener('blur', () => { camCtrl.keys = {}; camCtrl.isDragging = camCtrl.isPanning = isTerraformDragging = false; });
  window.addEventListener('aetheria:drawer-open', () => { camCtrl.keys = {}; camCtrl.isDragging = camCtrl.isPanning = isTerraformDragging = false; });
  canvas.addEventListener('pointercancel', () => { camCtrl.isDragging = camCtrl.isPanning = isTerraformDragging = false; });
  window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

  function moveTowards(entity, tx, tz, speed, dt) {
    const finalDist = Math.hypot(tx - entity.x, tz - entity.z);
    let goalX = tx, goalZ = tz;
    const bridgeZ = (currentCivEra >= 3 && Math.abs(entity.z + 16.0) < Math.abs(entity.z - 14.0)) ? -16.0 : 14.0;
    const bridgeX = getRiverCenterX(bridgeZ);
    const halfSpan = getRiverWidth(bridgeZ) * 1.45 + 3.4;
    const myOffset = entity.x - getRiverCenterX(entity.z), targetOffset = tx - getRiverCenterX(tz);
    const inBridgeLane = Math.abs(entity.z - bridgeZ) <= 2.4 && Math.abs(entity.x - bridgeX) <= halfSpan + 1.8;

    // Once on the destination bank, allow the direct route away from the bridge.
    // Routing every nearby person back to its exit creates a permanent oscillation.
    if ((myOffset * targetOffset < 0) || isPointInRiver(entity.x, entity.z)) {
      const destSide = targetOffset >= 0 ? 1 : -1;
      const exitX = bridgeX + destSide * (halfSpan + 1.4);
      if (inBridgeLane || Math.abs(entity.z - bridgeZ) <= 2.2) {
        // Already aligned with the bridge lane: walk straight across the bridge deck to exitX!
        if ((destSide > 0 && entity.x < exitX - 0.5) || (destSide < 0 && entity.x > exitX + 0.5)) {
          goalX = exitX; goalZ = bridgeZ;
        }
      } else {
        // Walk to the entrance ramp on our current side first
        const startSide = myOffset >= 0 ? 1 : -1;
        goalX = bridgeX + startSide * (halfSpan + 1.0); goalZ = bridgeZ;
      }
    }
    const dx = goalX - entity.x, dz = goalZ - entity.z, dist = Math.hypot(dx, dz);
    if (dist > 0.05) {
      let dirX = dx / dist, dirZ = dz / dist;
      if (!inBridgeLane) for (const b of buildings) {
        if (Math.hypot(b.x - tx, b.z - tz) < 2.8) continue;
        const bx = entity.x - b.x, bz = entity.z - b.z, bd = Math.hypot(bx, bz), avoidR = b.type === 'temple' ? 4.8 : 2.6;
        if (bd < avoidR && bd > 0.01) { const push = (avoidR - bd) / avoidR; dirX += (bx / bd) * push * 1.8; dirZ += (bz / bd) * push * 1.8; }
      }
      const peers = entity.type === 'monster' ? monsters : agents;
      if (!inBridgeLane) for (const other of peers) {
        if (other === entity || !other.alive || !other.mesh.visible) continue;
        const ox = entity.x - other.x, oz = entity.z - other.z, od = Math.hypot(ox, oz);
        if (od < 1.15 && od > 0.001) { const push = (1.15 - od) / 1.15; dirX += (ox / od) * push * 1.1; dirZ += (oz / od) * push * 1.1; }
      }
      const dirLen = Math.hypot(dirX, dirZ) || 1; dirX /= dirLen; dirZ /= dirLen;
      const step = Math.min(dist, speed * dt), nextX = entity.x + dirX * step, nextZ = entity.z + dirZ * step, nextH = getTerrainHeightAt(nextX, nextZ);
      const onBridge = Math.abs(nextZ - bridgeZ) <= 2.2 && Math.abs(nextX - bridgeX) <= halfSpan + 1.0;
      if (nextH < 9.5 && (onBridge || !isPointInRiver(nextX, nextZ))) {
        entity.x = nextX; entity.z = nextZ;
      } else {
        // Try sliding along Z toward nearest bridge, or detouring perpendicular without entering river
        const altZ = entity.z + (bridgeZ > entity.z ? 1 : -1) * step * 0.85;
        const altX = entity.x - dirZ * step * 0.65;
        if (!isPointInRiver(entity.x, altZ) && getTerrainHeightAt(entity.x, altZ) < 9.5) {
          entity.z = altZ;
        } else if (!isPointInRiver(altX, entity.z) && getTerrainHeightAt(altX, entity.z) < 9.5) {
          entity.x = altX;
        }
      }
      const r = Math.hypot(entity.x, entity.z);
      if (r > ISLAND_RADIUS - 4) { entity.x *= (ISLAND_RADIUS - 4) / r; entity.z *= (ISLAND_RADIUS - 4) / r; }
      let y = getTerrainHeightAt(entity.x, entity.z);
      if (Math.abs(entity.z - bridgeZ) <= 2.4 && Math.abs(entity.x - bridgeX) <= halfSpan + 1.4) y = Math.max(y, 4.22);
      entity.mesh.position.set(entity.x, y, entity.z);
      entity.mesh.rotation.y = Math.atan2(dirX, dirZ);
      const stride = Math.sin((entity.walkCycle || (performance.now() * 0.012)));
      if (entity.leftLeg) entity.leftLeg.rotation.x = stride * 0.55;
      if (entity.rightLeg) entity.rightLeg.rotation.x = -stride * 0.55;
      if (entity.leftArm && !state.isNight) entity.leftArm.rotation.x = -stride * 0.42;
      if (entity.type === 'monster' && entity.rightArm) entity.rightArm.rotation.x = stride * 0.65;
    } else {
      if (entity.leftLeg) entity.leftLeg.rotation.x = 0;
      if (entity.rightLeg) entity.rightLeg.rotation.x = 0;
    }
    return finalDist;
  }

  function giveCargo(agent, resource, amount) {
    agent.carryType = resource; agent.carryAmount = amount;
    agent.carryBundle.material.color.setHex(RESOURCE_INFO[resource].color);
    agent.carryBundle.visible = amount > 0;
  }

  function updateAutonomousAgents(dt, elapsedTime) {
    let cForage = 0, cGather = 0, cBuild = 0, cShelter = 0, cPatrol = 0;
    state.autoBuildCooldown -= dt;
    const curHouses = buildings.filter(b => b.type === 'house').length, curTowers = buildings.filter(b => b.type === 'tower').length;
    const maxEraHouses = 3 + state.civEra * 3, maxEraTowers = 1 + state.civEra * 2;
    if (state.autoBuild && !state.isNight && state.autoBuildCooldown <= 0 && state.wood >= 25 && state.ore >= 18 && (curHouses < maxEraHouses || curTowers < maxEraTowers)) {
      state.autoBuildCooldown = 8.5;
      const buildTower = (curTowers < maxEraTowers) && (curTowers < Math.floor(curHouses * 0.6) || monsters.length > 0);
      for (let attempt = 0; attempt < 30; attempt++) {
        const ang = buildTower ? (Math.atan2(-58, 68) + (Math.random() - 0.5) * 0.6) : Math.random() * Math.PI * 2;
        const dist = buildTower ? (32 + Math.random() * 18) : (9 + Math.random() * 22);
        const bx = Math.cos(ang) * dist, bz = Math.sin(ang) * dist;
        if (!canPlaceBuildingAt(bx, bz)) continue;
        state.wood -= 25; state.ore -= 18;
        if (buildTower) { createWatchtower(bx, bz, 0.25, state.civEra); addLog('🏗️ สร้างป้อมอัตโนมัติ · จ่ายไม้ 25 + แร่ 18'); }
        else { createHouse(bx, bz, 0.25, state.civEra); addLog('🏗️ สร้างบ้านอัตโนมัติ · จ่ายไม้ 25 + แร่ 18'); }
        break;
      }
    }

    const soldiers = agents.filter(a => a.alive && a.role === 'soldier');
    let soldierIdx = 0;
    for (const ag of agents) {
      if (!ag.alive) continue;
      ag.hunger = Math.min(100, ag.hunger + dt * 1.45); ag.walkCycle += dt * 9.5;
      ag.torchGroup.visible = state.isNight;
      if (state.isNight) ag.flameOrb.scale.setScalar(0.85 + Math.sin(elapsedTime * 16 + ag.id) * 0.22);
      const incompleteBuilding = buildings.find(b => b.progress !== undefined && b.progress < 1.0);

      if (ag.role === 'soldier') {
        soldierIdx++; ag.mesh.visible = true;
        let nearestMonster = null, minMDist = 999;
        for (const m of monsters) { if (!m.alive) continue; const d = Math.hypot(m.x - ag.x, m.z - ag.z); if (d < minMDist) { minMDist = d; nearestMonster = m; } }
        if (ag.hunger > 78 && !nearestMonster) {
          ag.state = 'FORAGE'; ag.stateLabel = 'หิว ➔ กินเสบียง'; ag.stateGem.material.color.setHex(0xfb7185); cForage++;
          if (moveTowards(ag, 0, 0, 5.8, dt) < 3.5) { ag.hunger = 0; ag.hp = ag.maxHp; if (state.food > 0) state.food--; }
        } else if (nearestMonster && (minMDist < 32 || state.isNight)) {
          ag.state = 'COMBAT'; ag.stateLabel = '⚔️ ปะทะมอนสเตอร์'; ag.stateGem.material.color.setHex(0xef4444); cPatrol++;
          const d = moveTowards(ag, nearestMonster.x, nearestMonster.z, 6.6, dt);
          ag.rightArm.rotation.x = Math.sin(elapsedTime * 18) * 1.1;
          if (d < 2.4) {
            ag.workTimer += dt;
            if (ag.workTimer >= 0.45) {
              ag.workTimer = 0; nearestMonster.hp -= 24; audio.playWorkTick(true);
              if (nearestMonster.hp <= 0) { nearestMonster.alive = false; worldObjectsGroup.remove(nearestMonster.mesh); state.faith = Math.min(state.maxFaith, state.faith + 6); }
            }
          }
        } else if (state.isNight) {
          ag.state = 'NIGHT_DEFENSE'; ag.stateLabel = '🔥 ถือคบเพลิงตั้งแถวป้องกัน'; ag.stateGem.material.color.setHex(0x38bdf8); cPatrol++;
          const spread = (soldierIdx - (soldiers.length + 1) / 2) * 3.2;
          if (moveTowards(ag, 38.0 + spread * 0.85, -30.0 + spread * 0.85, 6.2, dt) < 0.9 && portalObj) ag.mesh.lookAt(portalObj.x, ag.mesh.position.y, portalObj.z);
        } else {
          ag.state = 'PATROL'; ag.stateLabel = '🛡️ ลาดตระเวนรอบเกาะ'; ag.stateGem.material.color.setHex(0x38bdf8); cPatrol++;
          const patrolAng = elapsedTime * 0.22 + soldierIdx * 1.5;
          moveTowards(ag, Math.cos(patrolAng) * 14, Math.sin(patrolAng) * 14, 4.2, dt);
          ag.rightArm.rotation.x = Math.sin(ag.walkCycle) * 0.4;
        }
        continue;
      }

      if (ag.hunger >= 99.5) {
        ag.hp -= dt * 3.5;
        if (ag.hp <= 0) { ag.alive = false; worldObjectsGroup.remove(ag.mesh); addLog(`⚠️ ${ag.name} สิ้นใจจากความอดอยาก!`, 'warn'); continue; }
      }
      if (!state.isNight) ag.mesh.visible = true;
      ag.carryBundle.visible = (ag.carryAmount > 0);

      // Survival interrupts a job without discarding its order or cargo.
      if (ag.hunger >= 65) {
        ag.state = 'FORAGE'; ag.stateLabel = '🍎 หิว ➔ เก็บผลไม้/กินเสบียง'; ag.stateGem.material.color.setHex(0xfb7185); ag.mesh.visible = true; cForage++;
        if (ag.carryType === 'food' && ag.carryAmount >= 2) {
          ag.carryAmount -= 2; if (!ag.carryAmount) ag.carryType = null;
          ag.hunger = 0; ag.hp = Math.min(ag.maxHp, ag.hp + 15);
        } else {
          const ripeTree = chooseFoodTree(ag, state.food, trees);
          if (moveTowards(ag, ripeTree ? ripeTree.x : 0, ripeTree ? ripeTree.z : 0, 5.2, dt) < 2.3) {
            if (ripeTree) {
              ripeTree.hasFruit = false; ripeTree.fruitMeshes.forEach(fm => { fm.visible = false; }); ag.hunger = 0; ag.hp = Math.min(ag.maxHp, ag.hp + 20);
              // The original surplus fruit now travels to the store instead of teleporting there.
              if (!ag.carryAmount) giveCargo(ag, 'food', 2);
            } else if (state.food >= 2) { state.food -= 2; ag.hunger = 0; ag.hp = Math.min(ag.maxHp, ag.hp + 15); }
          }
        }
        continue;
      }
      if (state.isNight) {
        ag.state = 'SHELTER'; ag.stateLabel = '🏮 พักงาน ➔ กลับเข้าบ้าน'; ag.stateGem.material.color.setHex(0xfde047); cShelter++;
        const myHouses = buildings.filter(b => b.type === 'house' && b.progress >= 1.0 && (!isPointInRiver(b.x, b.z) || isOnBridgeDeck(b.x, b.z))), targetHouse = myHouses.length > 0 ? myHouses[ag.id % myHouses.length] : templeObj;
        if (moveTowards(ag, targetHouse ? targetHouse.x : 0, targetHouse ? targetHouse.z : 0, 4.8, dt) < 2.2) {
          if (targetHouse && targetHouse.type === 'house') ag.mesh.visible = false;
          state.faith = Math.min(state.maxFaith, state.faith + dt * 0.45);
        } else ag.mesh.visible = true;
        continue;
      }
      // Finish deliveries before taking another production or construction task.
      if (ag.carryAmount > 0) {
        ag.state = 'HAUL'; ag.stateLabel = `📦 ขน${RESOURCE_INFO[ag.carryType].name} ${ag.carryAmount} กลับคลัง`; ag.stateGem.material.color.setHex(0x38bdf8); cGather++;
        if (moveTowards(ag, 0, 0, 4.4, dt) < 3.4) {
          const delivered = depositCargo(ag, state);
          ag.carryBundle.visible = false; state.faith = Math.min(state.maxFaith, state.faith + 1.2);
          economy?.delivery(ag, delivered);
        }
        continue;
      }
      if (ag.buildTarget && (!buildings.includes(ag.buildTarget) || ag.buildTarget.progress >= 1)) ag.buildTarget = null;
      if (ag.role === 'child') {
        ag.state = 'PLAY'; ag.stateLabel = '👧 วิ่งเล่นกับเพื่อน'; ag.stateGem.material.color.setHex(0x34d399);
        const playAng = elapsedTime * 1.35 + ag.id * 1.4;
        moveTowards(ag, 6 + Math.cos(playAng) * 9.5, 11 + Math.sin(playAng * 1.5) * 6.5, 6.2, dt);
        ag.rightArm.rotation.x = Math.sin(elapsedTime * 14 + ag.id) * 0.8;
        continue;
      }
      if (!ag.buildTarget && !ag.workOrder && ag.role === 'farmer' && cropFields.length > 0) {
        ag.state = 'FARM'; ag.stateLabel = '🌾 เก็บเกี่ยวอาหาร → ส่งคลัง'; ag.stateGem.material.color.setHex(0xeab308); cForage++;
        const cf = cropFields[ag.id % cropFields.length];
        const wx = cf.x + Math.sin(elapsedTime * 0.4 + ag.id) * 2.5, wz = cf.z + Math.cos(elapsedTime * 0.3 + ag.id) * 2.5;
        if (moveTowards(ag, wx, wz, 3.8, dt) < 1.8) {
          ag.rightArm.rotation.x = Math.sin(elapsedTime * 12 + ag.id) * 0.85;
          ag.workTimer += dt;
          if (ag.workTimer >= 2.2) { ag.workTimer = 0; giveCargo(ag, 'food', 3); }
        }
        continue;
      }
      if (!ag.buildTarget && !ag.workOrder && ag.role === 'merchant') {
        ag.state = 'MARKET'; ag.stateLabel = '🎪 ค้าขาย → เพิ่มศรัทธา'; ag.stateGem.material.color.setHex(0xfbbf24); cForage++;
        const stalls = buildings.filter(b => b.type === 'market'), st = stalls.length > 0 ? stalls[ag.id % stalls.length] : null;
        if (st && moveTowards(ag, st.x, st.z + 1.1, 4.0, dt) < 1.5) {
          ag.rightArm.rotation.x = Math.sin(elapsedTime * 6 + ag.id) * 0.45;
          state.faith = Math.min(state.maxFaith, state.faith + dt * 0.35);
        }
        continue;
      }
      if (!ag.buildTarget && !ag.workOrder && ag.role === 'fisherman') {
        ag.state = 'FISH'; ag.stateLabel = '🎣 ตกปลา → ส่งคลัง'; ag.stateGem.material.color.setHex(0x38bdf8); cForage++;
        const fz = 2.0 + (ag.id % 2) * 1.2, fx = getRiverCenterX(fz) + getRiverWidth(fz) * 1.25 + 0.6;
        if (moveTowards(ag, fx, fz, 4.0, dt) < 1.2) {
          ag.mesh.rotation.y = -Math.PI / 2; ag.rightArm.rotation.x = -0.6 + Math.sin(elapsedTime * 3 + ag.id) * 0.15;
          ag.workTimer += dt;
          if (ag.workTimer >= 3.0) { ag.workTimer = 0; giveCargo(ag, 'food', 2); }
        }
        continue;
      }
      const damagedBuilding = buildings.find(b => b.hp < b.maxHp && (b.progress === undefined || b.progress >= 1.0));
      const targetB = ag.buildTarget || (!ag.workOrder && (incompleteBuilding || (state.wood >= 5 && damagedBuilding)));
      if (targetB) {
        const incomplete = targetB.progress !== undefined && targetB.progress < 1;
        ag.state = 'BUILD'; ag.stateLabel = incomplete ? '🔨 ก่อสร้างบ้าน/ป้อม' : '🔧 ซ่อมแซมอาคาร'; ag.stateGem.material.color.setHex(0x34d399); cBuild++;
        if (moveTowards(ag, targetB.x, targetB.z, 5.4, dt) < 2.8) {
          ag.rightArm.rotation.x = Math.sin(elapsedTime * 16) * 0.95;
          if (incomplete) {
            targetB.progress = Math.min(1, targetB.progress + dt * 0.24); targetB.mesh.scale.setScalar(0.3 + 0.7 * targetB.progress);
            if (targetB.progress >= 1) { audio.playVillageBell(false); addLog(`✨ ก่อสร้าง ${targetB.name} เสร็จสมบูรณ์!`, 'bless'); updateHUD(); }
          } else targetB.hp = Math.min(targetB.maxHp, targetB.hp + dt * 28);
        }
      } else {
        const resource = ag.workOrder?.resource || (((ag.id % 2 === 0) || ores.length === 0) ? 'wood' : 'ore');
        const pool = (resource === 'ore' ? ores : trees).filter(n => availableNode(n, resource));
        if (!pool.includes(ag.targetObj)) {
          ag.targetObj = ag.workOrder ? nearestResourceNode(ag, resource, pool) : pool[ag.id % Math.max(1,pool.length)] || null;
          ag.workTimer = 0;
        }
        if (!ag.targetObj) {
          ag.state = 'WAIT'; ag.stateLabel = `รอแหล่ง${RESOURCE_INFO[resource].name} · AI จะเก็บต่อเมื่อพร้อม`; ag.stateGem.material.color.setHex(0x94a3b8);
          continue;
        }
        ag.state = 'GATHER'; ag.stateLabel = resource === 'wood' ? '🪓 ตัดไม้ → แบกกลับคลัง' : resource === 'ore' ? '⛏️ ขุดแร่ → แบกกลับคลัง' : '🍎 เก็บผลไม้ → แบกกลับคลัง'; ag.stateGem.material.color.setHex(0xfbbf24); cGather++;
        if (moveTowards(ag, ag.targetObj.x, ag.targetObj.z, 4.6, dt) < 2.2) {
          ag.rightArm.rotation.x = Math.sin(elapsedTime * 14 + ag.id) * 0.95; ag.workTimer += dt;
          if (ag.workTimer >= 1.5) {
            ag.workTimer = 0;
            const target = ag.targetObj;
            if (resource === 'wood') {
              const amount = Math.min(5, target.woodAmount); target.woodAmount -= amount; giveCargo(ag, 'wood', amount);
              if (target.woodAmount <= 0) { target.growth = 0.20; target.hasFruit = false; target.fruitMeshes?.forEach(fm => { fm.visible = false; }); target.mesh.scale.setScalar(0.20); target.woodAmount = 25; }
            } else if (resource === 'ore') {
              const amount = Math.min(4, target.oreAmount); target.oreAmount -= amount; giveCargo(ag, 'ore', amount);
              if (!target.oreAmount) target.mesh.scale.setScalar(0.65);
            } else {
              target.hasFruit = false; target.fruitMeshes.forEach(fm => { fm.visible = false; }); giveCargo(ag, 'food', 2);
            }
          }
        } else ag.rightArm.rotation.x = Math.sin(ag.walkCycle) * 0.45;
      }
    }
    document.getElementById('st-forage').textContent = cForage; document.getElementById('st-gather').textContent = cGather;
    document.getElementById('st-build').textContent = cBuild; document.getElementById('st-shelter').textContent = cShelter;
    document.getElementById('st-patrol').textContent = cPatrol; document.getElementById('st-monsters').textContent = monsters.filter(m => m.alive).length;
    document.getElementById('ai-active-count').textContent = `${agents.filter(a => a.alive).length} ยูนิต`;
  }

  function updateMonstersAndTowers(dt, elapsedTime) {
    for (const b of buildings) {
      if (b.type !== 'tower' || b.progress < 1.0) continue;
      b.crystal.rotation.y += dt * 2.5; b.fireCooldown = Math.max(0, b.fireCooldown - dt);
      if (b.fireCooldown <= 0) {
        const targetM = monsters.find(m => m.alive && Math.hypot(m.x - b.x, m.z - b.z) <= 21);
        if (targetM) {
          b.fireCooldown = 1.55;
          const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
          const sy = b.mesh.position.y + 8.2; bolt.position.set(b.x, sy, b.z); scene.add(bolt);
          projectiles.push({ type: 'arcane_bolt', mesh: bolt, x: b.x, y: sy, z: b.z, target: targetM, speed: 34 });
        }
      }
    }
    for (let i = monsters.length - 1; i >= 0; i--) {
      const m = monsters[i]; if (!m.alive) { monsters.splice(i, 1); continue; }
      let target = null, minDist = 999;
      for (const ag of agents) if (ag.alive && ag.mesh.visible) { const d = Math.hypot(ag.x - m.x, ag.z - m.z); if (d < minDist) { minDist = d; target = ag; } }
      for (const b of buildings) { const d = Math.hypot(b.x - m.x, b.z - m.z); if (d < minDist) { minDist = d; target = b; } }
      if (target) {
        const d = moveTowards(m, target.x, target.z, m.speed, dt);
        m.mesh.position.y += Math.abs(Math.sin(elapsedTime * 9 + i)) * 0.35;
        if (d < 2.3) {
          m.attackTimer += dt;
          if (m.attackTimer >= 0.85) {
            m.attackTimer = 0; target.hp -= m.dmg;
            if (target.hp <= 0) {
              if (target.type === 'agent') {
                target.alive = false; worldObjectsGroup.remove(target.mesh);
                if (state.selectedEntity === target) { state.selectedEntity = null; document.getElementById('inspector-card').classList.remove('visible'); }
                addLog(`⚠️ ${target.name} พ่ายแพ้ในการปกป้องหมู่บ้าน!`, 'warn');
              } else if (target.type === 'temple') {
                target.hp = Math.round(target.maxHp * 0.65);
                spawnShockwaveRing(0, getTerrainHeightAt(0, 0), 0, 0xfbbf24, 18, 0.8);
                m.hp -= 85;
                if (m.hp <= 0) { m.alive = false; worldObjectsGroup.remove(m.mesh); }
                addLog(`🛡️ เกราะศักดิ์สิทธิ์แห่งมหาวิหารทำงาน! สะท้อนพลังโจมตีใส่อสูรและฟื้นฟูวิหาร`, 'bless');
              } else {
                worldObjectsGroup.remove(target.mesh);
                const bIdx = buildings.indexOf(target); if (bIdx >= 0) buildings.splice(bIdx, 1);
                const wIdx = windmills.indexOf(target); if (wIdx >= 0) windmills.splice(wIdx, 1);
                if (state.selectedEntity === target) { state.selectedEntity = null; document.getElementById('inspector-card').classList.remove('visible'); }
                addLog(`🏚️ ${target.name} ถูกฝูงมอนสเตอร์ทำลายพังทลายลง!`, 'warn');
              }
            }
          }
        }
      }
    }
  }

  const cDawnSky = new THREE.Color(0xfda4af), cDaySky = new THREE.Color(0x60a5fa), cSunsetSky = new THREE.Color(0xf97316), cNightSky = new THREE.Color(0x090d1a);
  const cDawnSun = new THREE.Color(0xfde047), cDaySun = new THREE.Color(0xfffbeb), cSunsetSun = new THREE.Color(0xfb7185), cNightSun = new THREE.Color(0x38bdf8);

  function updateDayNightCycle(dt) {
    const prevTime = state.timeOfDay;
    state.timeOfDay += dt * 0.11;
    if (state.timeOfDay >= 24.0) { state.timeOfDay -= 24.0; state.day++; state.siegeTriggeredTonight = false; state.secondWaveTonight = false; }
    const t = state.timeOfDay, wasNight = state.isNight;
    state.isNight = (t >= 20.0 || t < 5.5);
    if (state.day === 1 && prevTime < 18 && t >= 18 && t < 20) {
      addLog('🌇 อีก 2 ชั่วโมงในเกม อสูรจะบุกเวลา 20:00 เตรียมทหารและเก็บศรัทธาสำหรับสายฟ้า (20) หรือหอคอย (25)', 'warn');
    }

    if (prevTime < 6.0 && t >= 6.0) {
      audio.playVillageBell(false);
      state.faith = Math.min(state.maxFaith, state.faith + 25);
      document.getElementById('siege-banner').classList.remove('visible');
      addLog(`☀️ รุ่งอรุณวันที่ ${state.day} มาเยือน! แสงอาทิตย์ช่วยแผดเผาอสูรที่หลงเหลือ (+25 ศรัทธา)`, 'bless');
    }
    if (!state.isNight && monsters.length > 0) {
      // Daylight weakens surviving monsters gradually instead of deleting them instantly
      for (const m of monsters) {
        if (!m.alive) continue;
        m.hp -= dt * (m.isBoss ? 7 : 14);
        if (m.hp <= 0) { m.alive = false; worldObjectsGroup.remove(m.mesh); }
      }
    }
    if (!wasNight && state.isNight && !state.siegeTriggeredTonight) {
      state.siegeTriggeredTonight = true; state.secondWaveTonight = false; audio.playVillageBell(true);
      const sb = document.getElementById('siege-banner'); sb.classList.add('visible'); setTimeout(() => sb.classList.remove('visible'), 6500);
      const waveCount = 5 + Math.min(10, state.day * 2 + (state.civEra - 1) * 2);
      for (let w = 0; w < waveCount; w++) spawnMonster(state.day + (state.civEra - 1));
      addLog(`🌙 รัตติกาลมาเยือน! กองทัพอสูรระลอกแรก ${waveCount} ตัวบุกจากประตูมิติ!`, 'warn');
    }
    if (state.isNight && !state.secondWaveTonight && t >= 0.5 && t < 4.5) {
      state.secondWaveTonight = true; audio.playVillageBell(true);
      const wave2Count = 3 + Math.min(7, state.day + state.civEra);
      for (let w = 0; w < wave2Count; w++) spawnMonster(state.day + state.civEra);
      addLog(`🔥 ศึกหนักยามเที่ยงคืน! ประตูมิติอเวจีส่งทัพหนุนและจอมอสูรบุกซ้ำอีก ${wave2Count} ตัว!`, 'warn');
    }

  }

  function renderDayNightCycle() {
    const t = state.timeOfDay;
    const sunAngle = ((t - 6.0) / 24.0) * Math.PI * 2, orbitR = 165;
    const sx = Math.cos(sunAngle) * orbitR, sy = Math.sin(sunAngle) * orbitR, sz = 38 * Math.sin(sunAngle * 0.5);
    sunOrb.position.set(sx, sy, sz); sunLight.position.set(sx * 0.55, Math.max(18, Math.abs(sy) * 0.55), sz * 0.55);
    moonOrb.position.set(-sx, -sy, -sz); moonLight.position.set(-sx * 0.55, Math.max(18, -sy * 0.55), -sz * 0.55);

    const skyCol = new THREE.Color(), sunCol = new THREE.Color();
    let sunInt = 1.25, starOpacity = 0.0, phaseText = '☀️ กลางวัน (Day)';
    if (t >= 5.0 && t < 7.5) {
      const f = (t - 5.0) / 2.5;
      skyCol.copy(cNightSky).lerp(cDawnSky, Math.min(1, f * 1.4)); if (f > 0.5) skyCol.lerp(cDaySky, (f - 0.5) * 2);
      sunCol.copy(cDawnSun).lerp(cDaySun, f); sunInt = THREE.MathUtils.lerp(0.35, 1.3, f); starOpacity = 1.0 - f; phaseText = '🌅 รุ่งอรุณ (Dawn)';
    } else if (t >= 7.5 && t < 16.5) {
      skyCol.copy(cDaySky); sunCol.copy(cDaySun); sunInt = 1.35;
    } else if (t >= 16.5 && t < 19.8) {
      const f = (t - 16.5) / 3.3;
      skyCol.copy(f < 0.55 ? cDaySky : cSunsetSky).lerp(f < 0.55 ? cSunsetSky : cNightSky, f < 0.55 ? f / 0.55 : (f - 0.55) / 0.45);
      sunCol.copy(cDaySun).lerp(cSunsetSun, Math.min(1, f * 1.3)); sunInt = THREE.MathUtils.lerp(1.35, 0.35, f); starOpacity = Math.max(0, (f - 0.3) / 0.7); phaseText = '🌇 พระอาทิตย์ตก (Sunset)';
    } else {
      skyCol.copy(cNightSky); sunCol.copy(cNightSun); sunInt = 0.38; starOpacity = 0.92; phaseText = '🌙 กลางคืน (Night Siege)';
    }

    scene.background.copy(skyCol); scene.fog.color.copy(skyCol);
    sunLight.color.copy(sunCol); sunLight.intensity = sunInt; starMat.opacity = starOpacity;
    windowLightMat.emissiveIntensity = state.isNight ? 1.2 : 0.05;
    defensePointLight.intensity = state.isNight ? 1.85 : 0.0;
    portalPointLight.intensity = state.isNight ? 3.2 : 1.1;
    cloudMat.color.copy(sunCol).lerp(new THREE.Color(0xffffff), state.isNight ? 0.25 : 0.65);

    document.getElementById('day-counter').textContent = `วันที่ ${state.day}`;
    document.getElementById('clock-display').textContent = `${String(Math.floor(t)).padStart(2,'0')}:${String(Math.floor((t%1)*60)).padStart(2,'0')}`;
    document.getElementById('phase-badge').textContent = phaseText;
    const statusBadge = document.getElementById('kingdom-Status-badge');
    const enemyCount = monsters.filter(m => m.alive).length;
    statusBadge.textContent = enemyCount > 0 ? `⚔️ กำลังรบ (${enemyCount} ตัว)` : (state.isNight ? '🌙 เฝ้าระวังยามวิกาล' : '🌿 สงบสุข');
    statusBadge.style.color = enemyCount > 0 ? '#fb7185' : '#34d399';
  }

  const chartCanvas = document.getElementById('analytics-canvas'), chartCtx = chartCanvas.getContext('2d');
  function drawAnalyticsChart() {
    if (!chartCtx) return;
    const w = chartCanvas.width, h = chartCanvas.height; chartCtx.clearRect(0, 0, w, h);
    chartCtx.strokeStyle = 'rgba(148, 163, 184, 0.12)'; chartCtx.lineWidth = 1;
    for (let g = 1; g <= 3; g++) { const gy = (h / 4) * g; chartCtx.beginPath(); chartCtx.moveTo(0, gy); chartCtx.lineTo(w, gy); chartCtx.stroke(); }
    const drawSeries = (arr, color, maxScale) => {
      if (arr.length < 2) return;
      chartCtx.strokeStyle = color; chartCtx.lineWidth = 2.2; chartCtx.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const px = (i / (arr.length - 1)) * (w - 16) + 8, py = h - 10 - Math.min(1, Math.max(0, arr[i] / maxScale)) * (h - 22);
        if (i === 0) chartCtx.moveTo(px, py); else chartCtx.lineTo(px, py);
      }
      chartCtx.stroke();
    };
    drawSeries(state.historyRes, '#38bdf8', 350); drawSeries(state.historyFaith, '#fbbf24', 200); drawSeries(state.historyPop, '#34d399', 28);
  }

  function updateKingdomReadout() {
    const people = agents.filter(a => a.alive), enemies = monsters.filter(m => m.alive).length;
    setReadoutText('quick-faith', `${Math.floor(state.faith)}`);
    setReadoutText('quick-food', `${Math.floor(state.food)}`);
    setReadoutText('quick-wood', `${Math.floor(state.wood)}`);
    setReadoutText('quick-ore', `${Math.floor(state.ore)}`);
    setReadoutText('quick-pop', `${people.length}`);
    setReadoutText('quick-capacity', `${6 + buildings.filter(b => b.type === 'house').length * 4}`);
    setReadoutText('quick-soldiers', `${people.filter(a => a.role === 'soldier').length}`);
    setReadoutText('quick-enemies', `${enemies}`);
    const night = state.timeOfDay >= 20 || state.timeOfDay < 5.5;
    const remaining = Math.max(0, Math.ceil((20 - state.timeOfDay) * 60 - 1e-8));
    const clock = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    const firstWarning = state.day === 1 && state.timeOfDay >= 18 && state.timeOfDay < 20;
    document.getElementById('kingdom-readout').dataset.threat = enemies ? 'combat' : firstWarning ? 'warning' : 'calm';
    setReadoutText('night-countdown', night ? 'กลางคืน' : `บุก 20:00 · อีก ${clock} ชม.ในเกม`);
    const recovery = people.length === 0 ? (night ? 'เมืองฟื้นได้: รอรุ่งเช้า แล้วกดชาวบ้าน +1' : enemies ? 'เมืองฟื้นได้: จัดการอสูร แล้วกดชาวบ้าน +1' : 'ฟื้นเมือง: กดชาวบ้าน +1 (เพิ่มชาวบ้าน · 20 ศรัทธา)') : null;
    setReadoutText('night-guidance', recovery || (firstWarning ? 'ก่อนคืนแรก: เตรียมทหารและศรัทธา' : enemies ? 'ยังมีอสูรมีชีวิตบนเกาะ' : night ? (state.secondWaveTonight ? 'แสงอาทิตย์เริ่มเผาอสูร 05:30' : 'เฝ้าระวังทัพหนุน 00:30') : 'แตะทรัพยากรเพื่อสั่งคนงาน'));
  }

  function syncHudDockHeight() {
    const height = `${Math.ceil(document.getElementById('god-dock-wrapper').getBoundingClientRect().height)}px`;
    if (document.documentElement.style.getPropertyValue('--power-dock-height') !== height) document.documentElement.style.setProperty('--power-dock-height', height);
  }

  function updateWorkerCommands() {
    const worker = state.selectedEntity;
    const visible = worker?.alive && worker.role === 'villager';
    const bar = document.getElementById('worker-task-bar');
    const changed = bar.hidden !== !visible;
    bar.hidden = !visible;
    if (!visible) { if (changed) syncHudDockHeight(); return; }
    const signature = `${worker.id}|${worker.name}|${worker.workOrder?.resource || 'auto'}`;
    if (!changed && bar.dataset.worker === signature) return;
    bar.dataset.worker = signature;
    setReadoutText('worker-task-name', worker.name);
    setReadoutText('worker-task-order', worker.workOrder ? `เก็บ${RESOURCE_INFO[worker.workOrder.resource].name} · AI หาแหล่งให้` : 'เลือกงาน · AI เดินไปเก็บเอง');
    document.querySelectorAll('#worker-task-bar [data-worker-resource]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workerResource === (worker.workOrder?.resource || 'auto'))));
    syncHudDockHeight();
  }

  function updateCommandHUD() {
    for (const kind of ['soldier', 'villager']) {
      const button = document.getElementById(kind === 'soldier' ? 'btn-train-soldier' : 'btn-spawn-villager');
      const issue = recruitmentIssue(kind, state, agents, buildings);
      button.setAttribute('aria-disabled', String(!!issue));
      button.title = issue || (kind === 'soldier' ? 'แต่งตั้งคนงานที่ส่งของแล้วเป็นทหาร · 25 ศรัทธา' : 'เพิ่มชาวบ้าน · 20 ศรัทธา');
      button.setAttribute('aria-description', button.title);
      const cost = kind === 'soldier' ? 25 : 20;
      setReadoutText(kind === 'soldier' ? 'soldier-cost' : 'villager-cost', issue?.includes('บ้านพักเต็ม') ? `บ้านเต็ม · ${cost} ศรัทธา` : issue?.includes('ขนของ') ? `รอส่งของ · ${cost} ศรัทธา` : state.faith < cost ? `ศรัทธา ${Math.floor(state.faith)}/${cost}` : `${cost} ศรัทธา`);
    }
    document.querySelectorAll('[data-build]').forEach(button => {
      const issue = constructionRequirement(button.dataset.build, state, agents, buildings);
      button.dataset.unavailable = String(!!issue);
      button.title = issue || 'เลือกพื้นเกาะแล้วกดยืนยัน · ไม้ 25 + แร่ 18';
      button.setAttribute('aria-description', button.title);
    });
    const advance = document.getElementById('btn-advance-era');
    const ready = state.civEra < 4 && state.civProgress >= 100;
    advance.setAttribute('aria-disabled', String(!ready));
    advance.classList.toggle('ready', ready);
    advance.title = state.civEra >= 4 ? 'อารยธรรมอยู่ในยุคสูงสุดแล้ว' : ready ? `พัฒนาสู่ยุคที่ ${state.civEra + 1}` : 'ความก้าวหน้าต้องครบ 100% ก่อนพัฒนายุค';
    setReadoutText('command-era-progress', state.civEra >= 4 ? 'ยุคสูงสุดแล้ว' : ready ? `พร้อมขึ้นยุค ${state.civEra + 1}` : `ก้าวหน้า ${Math.floor(state.civProgress)}%`);
    updateWorkerCommands();
    syncHudDockHeight();
  }

  function updateHUD() {
    updateKingdomReadout();
    updateCommandHUD();
    refreshDilemmaChoices();
    const aliveAgents = agents.filter(a => a.alive), soldiers = aliveAgents.filter(a => a.role === 'soldier');
    const houses = buildings.filter(b => b.type === 'house'), towers = buildings.filter(b => b.type === 'tower'), maxPop = 6 + houses.length * 4;
    document.getElementById('stat-pop').textContent = `${aliveAgents.length} / ${maxPop}`;
    document.getElementById('stat-soldiers').textContent = `${soldiers.length}`;
    document.getElementById('stat-food').textContent = `${Math.floor(state.food)}`;
    document.getElementById('stat-wood').textContent = `${Math.floor(state.wood)}`;
    document.getElementById('stat-ore').textContent = `${Math.floor(state.ore)}`;
    document.getElementById('stat-buildings').textContent = `${houses.length} / ${towers.length}`;
    document.getElementById('stat-faith').textContent = `${Math.floor(state.faith)} / ${state.maxFaith}`;
    document.getElementById('faith-bar-fill').style.width = `${(state.faith / state.maxFaith) * 100}%`;
    const civProgEl = document.getElementById('stat-civ-prog');
    const civFillEl = document.getElementById('civ-bar-fill');
    if (civProgEl && civFillEl) {
      civProgEl.textContent = `${Math.min(100, Math.floor(state.civProgress))}%`;
      civFillEl.style.width = `${Math.min(100, state.civProgress)}%`;
    }
    if (state.selectedEntity) updateInspectorUI();
    economy?.updatePanel();
  }


  // -------------------- FLOATING THOUGHT & SPEECH BUBBLES SYSTEM --------------------
  let bubblesEnabled = false;
  const bubblesLayer = document.getElementById('thought-bubbles-layer');
  const btnToggleBubbles = document.getElementById('btn-toggle-bubbles');
  if (btnToggleBubbles) {
    btnToggleBubbles.addEventListener('click', () => {
      bubblesEnabled = !bubblesEnabled;
      document.body.classList.toggle('bubbles-hidden', !bubblesEnabled);
      btnToggleBubbles.classList.toggle('active', bubblesEnabled);
    });
  }
  const btnJumpBattle = document.getElementById('btn-jump-battle');
  if (btnJumpBattle) {
    btnJumpBattle.addEventListener('click', () => {
      const m = monsters.find(x => x.alive);
      if (m) {
        camCtrl.followEntity = null;
        camCtrl.target.set(m.x, getTerrainHeightAt(m.x, m.z), m.z);
        camCtrl.targetRadius = 46;
      } else {
        camCtrl.target.set(36, 4, -28);
        camCtrl.targetRadius = 48;
      }
    });
  }

  function describeAgentMind(ag) {
    if (customReactionTimer > 0 && customReactionText) {
      return {
        thought: customReactionText,
        plan: '📍 ตอบสนองต่อโองการองค์เทพ • ⏭️ ต่อไป: ปฏิบัติหน้าที่เพื่ออาณาจักร'
      };
    }
    if (ag.role === 'soldier') {
      if (ag.state === 'COMBAT') {
        return {
          thought: '💭 "พวกอสูรเงาทมิฬบุกมาแล้ว! ข้าจะปกป้องหมู่บ้านเอง!"',
          plan: '📍 เดินไป: จุดปะทะมอนสเตอร์ • ⏭️ ต่อไป: กวาดล้างอสูรให้สิ้นซาก'
        };
      }
      if (ag.state === 'NIGHT_DEFENSE') {
        return {
          thought: '💭 "คืนนี้มืดมิดนัก ต้องจุดคบเพลิงเฝ้าด่านหน้าไว้!"',
          plan: '📍 เดินไป: แนวป้อมชายแดน • ⏭️ ต่อไป: ตั้งแถวสกัดกั้นประตูมิติ'
        };
      }
      if (ag.state === 'FORAGE') {
        return {
          thought: '💭 "ออกเวรมาทั้งวัน ท้องหิวแล้ว ขอแวะเติมเสบียงก่อน"',
          plan: '📍 เดินไป: โรงเสบียงกลางเมือง • ⏭️ ต่อไป: กลับไปลาดตระเวน'
        };
      }
      return {
        thought: '💭 "เหตุการณ์ในเมืองสงบเรียบร้อยดี ชาวบ้านปลอดภัย"',
        plan: '📍 เดินไป: รอบเขตป้อมและหมู่บ้าน • ⏭️ ต่อไป: ตรวจตราความสงบ'
      };
    }
    if (ag.state === 'FORAGE') {
      return {
        thought: '💭 "ท้องร้องจ๊อกๆ แล้ว หิวจังเลย ไปหาผลไม้กินดีกว่า!"',
        plan: '📍 เดินไป: ต้นผลไม้ทิพย์ / คลังอาหาร • ⏭️ ต่อไป: กินให้อิ่มแล้วกลับไปทำงาน'
      };
    }
    if (ag.state === 'SHELTER') {
      return {
        thought: '💭 "พระอาทิตย์ตกดินแล้ว รีบจุดโคมไฟกลับเข้าบ้านดีกว่า"',
        plan: '📍 เดินไป: บ้านพักของครอบครัว • ⏭️ ต่อไป: สวดภาวนาและพักผ่อนรอเช้าวันใหม่'
      };
    }
    if (ag.state === 'WAIT') return { thought: '💭 \"ยังไม่มีแหล่งพร้อมให้เก็บ\"', plan: 'AI ค้นหาแหล่งให้อัตโนมัติ → พร้อมเมื่อไรจะกลับไปเก็บเอง' };
    if (ag.workOrder && ag.state === 'GATHER') return { thought: `💭 \"กำลังเก็บ${RESOURCE_INFO[ag.workOrder.resource].name}ตามคำสั่ง\"`, plan: 'เก็บ → แบกกลับวิหารกลางเมือง → ของเข้าคลัง' };
    if (ag.role === 'child') {
      return {
        thought: (ag.id % 2 === 0) ? '💭 "เย้! วิ่งไล่จับกันเร็ว ตามมาให้ทันนะ!"' : '💭 "วันนี้ที่ลานน้ำพุกับตลาดนัดคึกคักจังเลย!"',
        plan: '📍 เดินไป: ลานน้ำพุและตลาดนัด • ⏭️ ต่อไป: วิ่งเล่นกับเพื่อนๆ ในหมู่บ้าน'
      };
    }
    if (ag.role === 'farmer') {
      return {
        thought: '💭 "ปีนี้ดินอุดมสมบูรณ์ ข้าวสาลีและผักโตไวจริงๆ!"',
        plan: '📍 เดินไป: แปลงนาข้าวสาลีฝั่งตะวันตก • ⏭️ ต่อไป: เก็บเกี่ยวผลผลิตส่งยุ้งฉาง'
      };
    }
    if (ag.role === 'merchant') {
      return {
        thought: '💭 "เร่เข้ามาจ้า! ผลไม้สดๆ ขนมปังอบใหม่ๆ จากไร่!"',
        plan: '📍 เดินไป: แผงลอยตลาดนัดกลางเมือง • ⏭️ ต่อไป: ค้าขายแลกเปลี่ยนสินค้า'
      };
    }
    if (ag.role === 'fisherman') {
      return {
        thought: '💭 "น้ำใสไหลเย็นแบบนี้ วันนี้ปลากินเบ็ดดีแน่นอน!"',
        plan: '📍 เดินไป: ท่าเทียบเรือริมแม่น้ำ • ⏭️ ต่อไป: ตกปลาส่งเข้าคลังเสบียง'
      };
    }
    if (ag.state === 'BUILD') {
      return {
        thought: '💭 "ช่วยกันตอกเสาและมุงหลังคาเร็ว เมืองของเราจะได้เติบโต!"',
        plan: '📍 เดินไป: เขตก่อสร้างอาคารใหม่ • ⏭️ ต่อไป: สร้างบ้านและซ่อมบำรุงป้อม'
      };
    }
    if (ag.state === 'HAUL') {
      const itemTxt = RESOURCE_INFO[ag.carryType]?.name || 'ทรัพยากร';
      return {
        thought: `💭 "ได้${itemTxt}มาเต็มหลังเลย รีบขนกลับไปเก็บที่คลังกลางดีกว่า"`,
        plan: `📍 เดินไป: คลังศูนย์กลางหมู่บ้าน • ⏭️ ต่อไป: นำ${itemTxt}ไปขยายอารยธรรม`
      };
    }
    const isWood = (ag.id % 2 === 0);
    return {
      thought: isWood ? '💭 "ไปตัดไม้ในป่ามาเตรียมสร้างบ้านและเกวียนเพิ่มดีกว่า"' : '💭 "ไปสกัดแร่ศิลาที่โขดหินมาเสริมความแข็งแกร่งให้เมือง"',
      plan: isWood ? '📍 เดินไป: ป่าต้นโอ๊กและสน • ⏭️ ต่อไป: ตัดไม้ซุงแล้วแบกกลับเข้าคลัง' : '📍 เดินไป: สายแร่ศิลา • ⏭️ ต่อไป: ขุดแร่แล้วแบกกลับเข้าคลัง'
    };
  }

  function projectWorldToScreen(wx, wy, wz) {
    const w = window.innerWidth, h = window.innerHeight;
    const eye = camera.position, tgt = camera._lookTarget || camCtrl.target;
    let z0 = eye.x - tgt.x, z1 = eye.y - tgt.y, z2 = eye.z - tgt.z, len = Math.hypot(z0, z1, z2) || 1;
    z0 /= len; z1 /= len; z2 /= len;
    let x0 = z2, x1 = 0, x2 = -z0; len = Math.hypot(x0, x2) || 1;
    x0 /= len; x2 /= len;
    const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;

    const dx = wx - eye.x, dy = wy - eye.y, dz = wz - eye.z;
    const vx = x0 * dx + x1 * dy + x2 * dz;
    const vy = y0 * dx + y1 * dy + y2 * dz;
    const vz = z0 * dx + z1 * dy + z2 * dz;
    if (vz >= -1.0) return null; // Behind camera

    const f = 1.0 / Math.tan((camera.fov * 0.5 * Math.PI) / 180);
    const aspect = w / Math.max(1, h);
    const ndcX = (vx * (f / aspect)) / (-vz);
    const ndcY = (vy * f) / (-vz);
    if (ndcX < -0.92 || ndcX > 0.92 || ndcY < -0.88 || ndcY > 0.85) return null;
    return {
      x: (ndcX * 0.5 + 0.5) * w,
      y: (-ndcY * 0.5 + 0.5) * h,
      dist: -vz
    };
  }

  const bubblePool = [];
  for (let i = 0; i < 6; i++) {
    const el = document.createElement('div');
    el.className = 'thought-bubble';
    el.style.display = 'none';
    if (bubblesLayer) bubblesLayer.appendChild(el);
    bubblePool.push(el);
  }

  function updateThoughtBubbles(elapsedTime) {
    if (!bubblesLayer || !bubblesEnabled || allHudHidden) {
      for (const el of bubblePool) el.style.display = 'none';
      return;
    }
    const candidates = [];
    const rotSlot = Math.floor(elapsedTime * 0.28);
    for (const ag of agents) {
      if (!ag.alive || !ag.mesh.visible) continue;
      const mind = describeAgentMind(ag);
      ag.thoughtText = mind.thought;
      ag.planText = mind.plan;
      const isSelected = (state.selectedEntity === ag);
      const scr = projectWorldToScreen(ag.x, ag.mesh.position.y + 2.55, ag.z);
      if (!scr || scr.dist > 135) continue;
      // Avoid overlapping Left & Right HUD panels unless panels are hidden
      const sideMargin = window.innerWidth <= 960 ? 75 : 440;
      if (!isSelected && (scr.x < sideMargin || scr.x > window.innerWidth - sideMargin || scr.y < 135 || scr.y > window.innerHeight - 120)) continue;
      const priority = isSelected ? 1000 : (((ag.id + rotSlot) % 5 === 0) ? 50 : 10) - scr.dist * 0.1;
      candidates.push({ ag, scr, isSelected, priority });
    }
    candidates.sort((a, b) => b.priority - a.priority);

    const chosen = [];
    for (const c of candidates) {
      const maxBubbles = window.innerWidth <= 960 ? 2 : 5;
      if (chosen.length >= maxBubbles) break;
      // Ensure minimum 2D screen separation (175px X, 68px Y) so thought bubbles NEVER overlap each other!
      if (!c.isSelected && chosen.some(o => Math.abs(o.scr.x - c.scr.x) < 185 && Math.abs(o.scr.y - c.scr.y) < 72)) continue;
      chosen.push(c);
    }

    for (let i = 0; i < bubblePool.length; i++) {
      const el = bubblePool[i];
      if (i < chosen.length) {
        const { ag, scr, isSelected } = chosen[i];
        el.style.display = 'block';
        el.style.left = `${Math.round(scr.x)}px`;
        el.style.top = `${Math.round(scr.y)}px`;
        el.classList.toggle('selected', isSelected);
        el.innerHTML = `<div class="tb-header"><span>${ag.name}</span><span style="color:#34d399;font-size:9.5px;">[${ag.stateLabel}]</span></div><div class="tb-thought">${ag.thoughtText}</div><div class="tb-plan">${ag.planText}</div>`;
      } else {
        el.style.display = 'none';
      }
    }
  }


  // -------------------- INTERACTIVE LIVE MINI-MAP RADAR & SAVE SYSTEM --------------------
  const minimapWrap = document.getElementById('minimap-wrap');
  const minimapCanvas = document.getElementById('minimap-canvas');
  const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;


  function jumpCameraFromMinimap(clientX, clientY) {
    if (!minimapCanvas) return;
    const rect = minimapCanvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const nz = ((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
    camCtrl.followEntity = null;
    camCtrl.target.x = THREE.MathUtils.clamp(nx * ISLAND_RADIUS, -100, 100);
    camCtrl.target.z = THREE.MathUtils.clamp(nz * ISLAND_RADIUS, -100, 100);
    camCtrl.target.y = Math.max(2, getTerrainHeightAt(camCtrl.target.x, camCtrl.target.z));
  }

  if (minimapCanvas) {
    let mmDragging = false;
    minimapCanvas.addEventListener('pointerdown', (e) => { mmDragging = true; jumpCameraFromMinimap(e.clientX, e.clientY); });
    minimapCanvas.addEventListener('pointermove', (e) => { if (mmDragging) jumpCameraFromMinimap(e.clientX, e.clientY); });
    window.addEventListener('pointerup', () => { mmDragging = false; });
    minimapCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); if (e.touches[0]) jumpCameraFromMinimap(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    minimapCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); if (e.touches[0]) jumpCameraFromMinimap(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  }

  function renderMinimap() {
    if (!minimapCtx || !minimapWrap || minimapWrap.classList.contains('collapsed') || allHudHidden) return;
    const W = minimapCanvas.width, H = minimapCanvas.height, cx = W * 0.5, cy = H * 0.5;
    const scale = (W * 0.46) / ISLAND_RADIUS;
    minimapCtx.clearRect(0, 0, W, H);

    // Sky/Void background
    minimapCtx.fillStyle = state.isNight ? '#050814' : '#0c192c';
    minimapCtx.fillRect(0, 0, W, H);

    // Island landmass circle
    minimapCtx.beginPath();
    minimapCtx.arc(cx, cy, ISLAND_RADIUS * scale * 0.92, 0, Math.PI * 2);
    minimapCtx.fillStyle = state.isNight ? '#132a23' : '#1e4d38';
    minimapCtx.fill();
    minimapCtx.lineWidth = 1.5;
    minimapCtx.strokeStyle = '#38bdf8';
    minimapCtx.stroke();

    // River path
    minimapCtx.beginPath();
    for (let z = -60; z <= 96; z += 6) {
      const rx = getRiverCenterX(z);
      const px = cx + rx * scale, py = cy + z * scale;
      if (z === -60) minimapCtx.moveTo(px, py); else minimapCtx.lineTo(px, py);
    }
    minimapCtx.lineWidth = 3.2;
    minimapCtx.strokeStyle = '#0ea5e9';
    minimapCtx.stroke();

    // Bridges on minimap
    for (const bz of (state.civEra >= 3 ? [14.0, -16.0] : [14.0])) {
      const bx = cx + getRiverCenterX(bz) * scale, by = cy + bz * scale;
      minimapCtx.fillStyle = '#d97706';
      minimapCtx.fillRect(bx - 4, by - 1.5, 8, 3);
    }

    // Crop fields
    minimapCtx.fillStyle = '#eab308';
    for (const cf of cropFields) {
      minimapCtx.fillRect(cx + cf.x * scale - 2.5, cy + cf.z * scale - 2.5, 5, 5);
    }

    // Buildings (Temple, Houses, Market, Towers)
    for (const b of buildings) {
      const bx = cx + b.x * scale, by = cy + b.z * scale;
      if (b.type === 'temple') {
        minimapCtx.fillStyle = '#fde047';
        minimapCtx.beginPath(); minimapCtx.arc(bx, by, 4.2, 0, Math.PI * 2); minimapCtx.fill();
      } else if (b.type === 'tower') {
        minimapCtx.fillStyle = '#38bdf8';
        minimapCtx.fillRect(bx - 2, by - 2, 4, 4);
      } else {
        minimapCtx.fillStyle = '#f97316';
        minimapCtx.fillRect(bx - 1.5, by - 1.5, 3, 3);
      }
    }

    // Void Portal (68, -58)
    if (portalObj) {
      minimapCtx.fillStyle = '#c084fc';
      minimapCtx.beginPath();
      minimapCtx.arc(cx + portalObj.x * scale, cy + portalObj.z * scale, 4.0, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    // Wagons
    minimapCtx.fillStyle = '#facc15';
    for (const wg of wagons) {
      minimapCtx.fillRect(cx + wg.x * scale - 2, cy + wg.z * scale - 2, 4, 4);
    }

    // Villagers & Soldiers
    for (const a of agents) {
      if (!a.alive) continue;
      minimapCtx.fillStyle = a.role === 'soldier' ? '#60a5fa' : '#34d399';
      minimapCtx.beginPath();
      minimapCtx.arc(cx + a.x * scale, cy + a.z * scale, 1.8, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    // Monsters
    minimapCtx.fillStyle = '#f43f5e';
    for (const m of monsters) {
      if (!m.alive) continue;
      minimapCtx.beginPath();
      minimapCtx.arc(cx + m.x * scale, cy + m.z * scale, 2.5, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    // Camera target crosshair box
    const tx = cx + camCtrl.target.x * scale, ty = cy + camCtrl.target.z * scale;
    minimapCtx.strokeStyle = '#ffffff';
    minimapCtx.lineWidth = 1.2;
    minimapCtx.strokeRect(tx - 6, ty - 5, 12, 10);
  }

  // Save / Load Game State via localStorage
  function saveGameState(silent = false) {
    const saveData = {
      day: state.day, timeOfDay: state.timeOfDay, food: state.food, wood: state.wood,
      ore: state.ore, faith: state.faith, civEra: state.civEra, civProgress: state.civProgress
    };
    const jsonStr = JSON.stringify(saveData);
    try { localStorage.setItem(PROGRESS_KEY, jsonStr); } catch (e) {
      if (!silent) { addLog('⚠️ บันทึกไม่ได้: พื้นที่เก็บข้อมูลไม่พร้อมใช้งาน', 'warn'); showDilemmaToast('⚠️ บันทึกไม่สำเร็จ กรุณาตรวจสอบพื้นที่เก็บข้อมูลของเบราว์เซอร์'); }
      return false;
    }
    if (!silent) {
      addLog('💾 บันทึกความก้าวหน้าอารยธรรมและทรัพยากรลงเครื่องเรียบร้อยแล้ว!', 'bless');
      showDilemmaToast('💾 บันทึกทรัพยากรและยุคแล้ว (ยังไม่รวมภูมิประเทศ อาคาร และยูนิต)');
      audio.playBlessChime();
    }
    return true;
  }

  function loadSavedGameState() {
    try {
      let raw = null;
      try { raw = localStorage.getItem('AETHERIA_CIV_SAVE_V1'); } catch (e) {}
      if (!raw) return false;
      const data = parseProgress(raw);
      if (!data) { addLog('⚠️ ไม่โหลดเซฟความก้าวหน้า: รูปแบบหรือค่าข้อมูลไม่ถูกต้อง', 'warn'); return false; }
      if (data.civEra >= 1 && data.civEra <= 4 && data.civEra !== state.civEra) {
        evolveToEra(data.civEra);
      }
      state.day = data.day || 1;
      state.timeOfDay = typeof data.timeOfDay === 'number' ? data.timeOfDay : 8.2;
      state.food = typeof data.food === 'number' ? data.food : 35;
      state.wood = typeof data.wood === 'number' ? data.wood : 20;
      state.ore = typeof data.ore === 'number' ? data.ore : 15;
      state.faith = typeof data.faith === 'number' ? data.faith : 60;
      state.civProgress = typeof data.civProgress === 'number' ? data.civProgress : 0;
      updateHUD();
      addLog(`📂 โหลดข้อมูลเซฟล่าสุดสำเร็จ (วันที่ ${state.day} • ยุคที่ ${state.civEra})`, 'bless');
      return true;
    } catch (err) {
      return false;
    }
  }

  const btnSaveGame = document.getElementById('btn-save-game');
  if (btnSaveGame) {
    btnSaveGame.addEventListener('click', () => {
      audio.init();
      saveGameState(false);
    });
  }


  // -------------------- INTERACTIVE DIVINE DILEMMA & KINGDOM EVENT SYSTEM --------------------
  let dilemmaActive = false;
  let preDilemmaSpeed = 1.0;
  let dilemmaTimer = 18.0; // First interactive event pops up after 18s of play, then every ~42s!
  let lastDilemmaIdx = -1;
  let customReactionText = '';
  let customReactionTimer = 0;

  const dilemmaOverlay = document.getElementById('dilemma-overlay');
  const dilemmaToast = document.getElementById('dilemma-toast');
  const btnTriggerDilemma = document.getElementById('btn-trigger-dilemma');
  decisionUI = createDecisionControls(window, {
    details: () => { if (pendingDilemmaIdx !== null) { pauseForDilemma(); presentDilemma(false); } },
    continue: () => closeInteractiveDilemma('เล่นต่อได้ · คำถามยังตอบได้บนหน้าจอ')
  });

  let dilemmaToastTimeout;
  function showDilemmaToast(msg) {
    if (!dilemmaToast) return;
    clearTimeout(dilemmaToastTimeout);
    dilemmaToast.textContent = msg;
    dilemmaToast.classList.add('visible');
    dilemmaToastTimeout = setTimeout(() => dilemmaToast.classList.remove('visible'), 5200);
  }

  function setVillagerReaction(thoughtMsg, duration = 18.0) {
    customReactionText = thoughtMsg;
    customReactionTimer = duration;
  }

  const DILEMMA_EVENTS = [
    {
      category: '🍎 คำร้องทุกข์จากชาวบ้าน (Villager Petition)',
      title: 'วิกฤตเสบียงและเสียงบ่นจากผู้ทำงานหนัก',
      avatar: '🌾',
      speaker: 'ชาวนา คีริน & ตัวแทนช่างเมือง',
      quote: '"พวกเราตัดไม้และพรวนดินมาตั้งแต่เช้า ท้องร้องจ๊อกๆ จนหมดแรงแล้ว ขอองค์เทพทรงเมตตาประทานอาหารหรือฝนทิพย์ด้วยเถิด!"',
      desc: 'ชาวบ้านเริ่มหิวและเหนื่อยล้าจากการขยายเมือง หากปล่อยไว้ประสิทธิภาพการทำงานจะลดลง คุณจะทรงตัดสินพระทัยอย่างไร?',
      choices: [
        {
          label: '🌧️ ประทานฝนทิพย์และจัดงานเลี้ยงฉลอง',
          cost: 'ใช้ 15 ✨ ศรัทธา',
          effect: '➔ เสกฝนทิพย์กลางเมืองทันที, +35 🍎 อาหาร, ชาวบ้านอิ่ม 100% และ +15% ความก้าวหน้ายุค',
          action: () => {
            state.faith = Math.max(0, state.faith - 15);
            state.food += 35;
            state.civProgress = Math.min(100, state.civProgress + 15);
            for (const a of agents) { if (a.alive) { a.hunger = 0; a.hp = a.maxHp; } }
            spawnShockwaveRing(0, getTerrainHeightAt(0, 0), 0, 0x38bdf8, 22, 1.0);
            spawnBurstParticles(0, getTerrainHeightAt(0, 0) + 5, 0, 0x34d399, 22, 10, 0.25, 0.9);
            audio.playBlessChime();
            setVillagerReaction('💭 "ไชโย! องค์เทพประทานฝนทิพย์และอาหารให้พวกเราอิ่มท้องแล้ว!"');
            return '🌧️ ประทานฝนทิพย์และเสบียง! ชาวบ้านอิ่มท้อง (+35 อาหาร, +15% ความก้าวหน้า)';
          }
        },
        {
          label: '📦 เปิดคลังสำรองแจกจ่ายตามปันส่วน',
          cost: 'ใช้ 10 🪵 ไม้ซุง',
          effect: '➔ เปลี่ยนไม้ฟืนเป็นอาหาร +22 🍎 และลดความหิวชาวบ้านทุกคนลงครึ่งหนึ่ง',
          action: () => {
            state.wood = Math.max(0, state.wood - 10);
            state.food += 22;
            for (const a of agents) { if (a.alive) a.hunger = Math.max(0, a.hunger * 0.45); }
            audio.playVillageBell(false);
            setVillagerReaction('💭 "ได้รับปันส่วนเสบียงจากคลังหลวงแล้ว มีแรงกลับไปทำงานต่อ!"');
            return '📦 เปิดคลังสำรองแจกจ่ายอาหาร (+22 อาหาร, ลดความหิวชาวบ้าน)';
          }
        },
        {
          label: '⚡ สั่งให้อดทนและเร่งขุดแร่ตัดไม้เป็นสองเท่า!',
          cost: 'ไม่เสียทรัพยากร',
          effect: '➔ ได้รับ +25 🪵 ไม้ซุง และ +20 ⛏️ แร่ศิลา ทันที (แต่ชาวบ้านเหนื่อยล้า -12 HP)',
          action: () => {
            state.wood += 25;
            state.ore += 20;
            for (const a of agents) { if (a.alive && a.role !== 'soldier') a.hp = Math.max(15, a.hp - 12); }
            audio.playLightningThunder();
            setVillagerReaction('💭 "โอ๊ย... องค์เทพสั่งเร่งงานหนักเลย ต้องอดทนกัดฟันสู้!"');
            return '⚡ เร่งแรงงานขั้นสุด! ได้รับ +25 ไม้ซุง และ +20 แร่ศิลา';
          }
        }
      ]
    },
    {
      category: '⚖️ ข้อพิพาทในสภาหมู่บ้าน (Council Dispute)',
      title: 'ศึกแย่งชิงงบประมาณ: ขยายบ้านเรือน หรือ เสริมป้อมปราการ?',
      avatar: '⚔️',
      speaker: 'ช่างเมือง อัคคี vs. แม่ทัพองครักษ์ เมฆา',
      quote: '"ฝ่ายช่างต้องการไม้และหินไปสร้างบ้านรับคนเพิ่ม แต่ฝ่ายทหารยืนยันว่าต้องสร้างป้อมปราการรับมืออสูรยามค่ำคืนก่อน!"',
      desc: 'ทั้งสองฝ่ายต่างพากันมาคุกเข่าหน้าแท่นบูชาเพื่อรอฟังโองการจากคุณว่าจะให้ความสำคัญกับสิ่งใดเป็นอันดับแรก',
      choices: [
        {
          label: '🏠 สนับสนุนฝ่ายช่าง: สร้างบ้านใหม่และเพิ่มประชากร',
          cost: 'ใช้ 15 🪵 ไม้ซุง',
          effect: '➔ สร้างบ้านพักใหม่ 1 หลังทันที + เสกชาวบ้านใหม่ 2 คนเข้าร่วมเมือง',
          action: () => {
            let plot = null;
            for (let i = 0; i < 25; i++) {
              const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 16;
              const hx = Math.cos(a) * r, hz = Math.sin(a) * r;
              if (canPlaceBuildingAt(hx, hz)) { plot = { x: hx, z: hz }; break; }
            }
            if (!plot) return { resolved: false, message: '🚫 ไม่พบพื้นที่เหมาะสมสำหรับบ้าน ยังไม่ใช้ไม้ซุง กรุณาเลือกทางอื่นหรือปิดหน้าต่าง' };
            state.wood -= 15;
            createHouse(plot.x, plot.z, 1.0, state.civEra);
            createAgent(-3, 5, 'villager');
            createAgent(4, 6, 'farmer');
            audio.playBlessChime();
            setVillagerReaction('💭 "ได้บ้านหลังใหม่และสมาชิกใหม่เพิ่มแล้ว เมืองของเราอบอุ่นจัง!"');
            return '🏠 สร้างบ้านใหม่ 1 หลัง พร้อมต้อนรับชาวบ้านใหม่ 2 คน!';
          }
        },
        {
          label: '🗼 สนับสนุนฝ่ายทหาร: สร้างป้อมปราการและแต่งตั้งอัศวิน',
          cost: 'ใช้ 15 ⛏️ แร่ศิลา',
          effect: '➔ สร้างป้อมปราการแนวหน้า 1 ป้อมทันที + เสกอัศวินองครักษ์ 2 นาย',
          action: () => {
            let plot = null;
            for (let i = 0; i < 25; i++) {
              const bx = 26 + (Math.random() - 0.5) * 18, bz = -18 + (Math.random() - 0.5) * 18;
              if (canPlaceBuildingAt(bx, bz)) { plot = { x: bx, z: bz }; break; }
            }
            if (!plot) return { resolved: false, message: '🚫 ไม่พบพื้นที่เหมาะสมสำหรับป้อม ยังไม่ใช้แร่ศิลา กรุณาเลือกทางอื่นหรือปิดหน้าต่าง' };
            state.ore -= 15;
            createWatchtower(plot.x, plot.z, 1.0, state.civEra);
            createAgent(28, -20, 'soldier');
            createAgent(32, -24, 'soldier');
            audio.playVillageBell(true);
            setVillagerReaction('💭 "มีป้อมปราการและอัศวินเพิ่มขึ้น แบบนี้ตอนกลางคืนอุ่นใจขึ้นเยอะเลย!"');
            return '🗼 เสริมป้อมปราการแนวหน้า 1 ป้อม และอัศวินองครักษ์ 2 นาย!';
          }
        },
        {
          label: '✨ ประทานพรสวรรค์เนรมิตให้ทั้งสองฝ่าย!',
          cost: 'ใช้ 25 ✨ ศรัทธา',
          effect: '➔ ได้ทั้งชาวบ้านใหม่ 1 คน, อัศวิน 1 นาย, และ +20% ความก้าวหน้าอารยธรรม',
          action: () => {
            state.faith = Math.max(0, state.faith - 25);
            createAgent(2, 6, 'villager');
            createAgent(26, -18, 'soldier');
            state.civProgress = Math.min(100, state.civProgress + 20);
            spawnShockwaveRing(0, getTerrainHeightAt(0, 0), 0, 0xfbbf24, 24, 1.1);
            audio.playBlessChime();
            setVillagerReaction('💭 "องค์เทพทรงยุติธรรมและเปี่ยมด้วยบารมีจริงๆ สรรเสริญองค์เทพ!"');
            return '✨ ประทานพรสมานฉันท์! ได้ทั้งชาวบ้าน อัศวิน และ +20% ความก้าวหน้ายุค';
          }
        }
      ]
    },
    {
      category: '🎪 เหตุการณ์การค้าและผู้มาเยือน (Sky Caravan Event)',
      title: 'กองเรือเหาะพ่อค้าเร่แห่งนภาแวะเทียบท่าเกาะลอยฟ้า!',
      avatar: '🎪',
      speaker: 'หัวหน้ากองคาราวาน วารี',
      quote: '"คาราวานของพวกเราเดินทางข้ามหมู่เมฆมาไกล เรามีทั้งเสบียงชั้นเลิศ เกวียนเทียมม้า และนักรบรับจ้าง ท่านต้องการแลกเปลี่ยนสิ่งใด?"',
      desc: 'โอกาสทองในการแลกเปลี่ยนทรัพยากรหรือเสริมความมั่งคั่งให้กับอาณาจักรของคุณ',
      choices: [
        {
          label: '🐎 สั่งซื้อเกวียนเทียมม้าและเมล็ดพันธุ์เกษตร',
          cost: 'ใช้ 15 ✨ ศรัทธา',
          effect: '➔ เพิ่มเกวียนเทียมม้าวิ่งขนส่ง 1 ขบวนทันที + รับ +30 🍎 อาหาร',
          action: () => {
            state.faith = Math.max(0, state.faith - 15);
            state.food += 30;
            const bSouthX = getRiverCenterX(14.0);
            createHorseWagon([[-30, 14], [bSouthX, 14], [4, 14], [18, 14], [4, 14], [bSouthX, 14]], 0xd97706);
            audio.playBlessChime();
            setVillagerReaction('💭 "ว้าว! มีเกวียนเทียมม้าขบวนใหม่มาช่วยขนเสบียงเข้าเมืองแล้ว!"');
            return '🐎 ได้รับเกวียนเทียมม้าขบวนใหม่ 1 คัน และ +30 อาหาร!';
          }
        },
        {
          label: '💎 นำไม้ซุงแลกเปลี่ยนเป็นแร่ศิลาและเครื่องสักการะ',
          cost: 'ใช้ 15 🪵 ไม้ซุง',
          effect: '➔ รับ +35 ⛏️ แร่ศิลา และ +35 ✨ พลังศรัทธา ทันที',
          action: () => {
            state.wood = Math.max(0, state.wood - 15);
            state.ore += 35;
            state.faith = Math.min(state.maxFaith, state.faith + 35);
            audio.playBlessChime();
            setVillagerReaction('💭 "การค้าขายกับกองเรือเหาะได้กำไรดีจริงๆ คลังแร่ของเรามั่งคั่งขึ้นมาก!"');
            return '💎 แลกเปลี่ยนสำเร็จ! ได้รับ +35 แร่ศิลา และ +35 พลังศรัทธา';
          }
        },
        {
          label: '🛡️ ว่าจ้างอัศวินรับจ้างจากคาราวานให้อยู่ช่วยปกป้องเกาะ',
          cost: 'ใช้ 20 🍎 อาหาร',
          effect: '➔ ได้รับอัศวินองครักษ์เกราะเหล็ก 2 นายเข้าร่วมกองทัพทันที',
          action: () => {
            state.food = Math.max(0, state.food - 20);
            createAgent(24, -16, 'soldier');
            createAgent(28, -20, 'soldier');
            audio.playVillageBell(false);
            setVillagerReaction('💭 "ได้ยอดฝีมือจากกองคาราวานมาช่วยเฝ้าเมืองเพิ่มอีก 2 นาย!"');
            return '🛡️ ว่าจ้างอัศวินองครักษ์ 2 นายเข้าร่วมกองทัพเรียบร้อย!';
          }
        }
      ]
    },
    {
      category: '🔮 ปริศนาโบราณวัตถุ (Ancient Relic Discovery)',
      title: 'เด็กน้อยวิ่งเล่นไปพบแท่นศิลาเรืองแสงในป่าลึก!',
      avatar: '👧',
      speaker: 'เด็กน้อย ลลนา & ปราชญ์ประจำเผ่า',
      quote: '"หนูวิ่งไล่จับกับเพื่อนไปเจอแท่นหินสีม่วงทองส่องแสงอยู่ใต้ต้นโอ๊กใหญ่! เราควรทำยังไงกับมันดีคะ?"',
      desc: 'ชาวบ้านมุงดูแท่นศิลาโบราณด้วยความตื่นเต้น บางคนเชื่อว่าเป็นพรจากสวรรค์ แต่บางคนเกรงว่าอาจมีอสูรเฝ้าอยู่',
      choices: [
        {
          label: '✨ ประกอบพิธีปลุกพลังศรัทธาแห่งทวยเทพ',
          cost: 'ปลอดภัย 100%',
          effect: '➔ รับ +55 ✨ พลังศรัทธา และ +18% ความก้าวหน้าอารยธรรมทันที',
          action: () => {
            state.faith = Math.min(state.maxFaith, state.faith + 55);
            state.civProgress = Math.min(100, state.civProgress + 18);
            spawnShockwaveRing(0, getTerrainHeightAt(0, 0), 0, 0xfde047, 20, 1.0);
            audio.playBlessChime();
            setVillagerReaction('💭 "แสงสีทองจากแท่นศิลาอบอุ่นหัวใจจัง พลังศรัทธาเปี่ยมล้นไปทั่วเกาะ!"');
            return '✨ ปลุกพลังศิลาเทพสำเร็จ! (+55 ศรัทธา, +18% ความก้าวหน้ายุค)';
          }
        },
        {
          label: '⛏️ สกัดแท่นศิลาโบราณนำแร่ทองคำและไม้ศักดิ์สิทธิ์มาใช้',
          cost: 'ปลอดภัย 100%',
          effect: '➔ รับ +35 ⛏️ แร่ศิลา, +30 🪵 ไม้ซุง, และ +20 🍎 อาหาร',
          action: () => {
            state.ore += 35;
            state.wood += 30;
            state.food += 20;
            audio.playWorkTick(true);
            setVillagerReaction('💭 "ได้แร่ศักดิ์สิทธิ์และทรัพยากรมาเพียบเลย นำไปสร้างเมืองต่อได้สบาย!"');
            return '⛏️ สกัดศิลาโบราณสำเร็จ! (+35 แร่ศิลา, +30 ไม้ซุง, +20 อาหาร)';
          }
        },
        {
          label: '🔥 ทลายผนึกต้องห้ามเพื่อชิงขุมทรัพย์มหาศาล (ท้าทาย!)',
          cost: '⚠️ ปลุกอสูรผู้พิทักษ์ 2 ตัว',
          effect: '➔ รับ +80 ✨ ศรัทธา และ +30% ความก้าวหน้ายุคทันที แต่มีอสูรบุกออกมา 2 ตัว!',
          action: () => {
            state.faith = Math.min(state.maxFaith, state.faith + 80);
            state.civProgress = Math.min(100, state.civProgress + 30);
            spawnMonster(state.day + 1);
            spawnMonster(state.day + 1);
            audio.playLightningThunder();
            setVillagerReaction('💭 "ผนึกแตกออกแล้ว! ได้พลังมหาศาลแต่ระวังอสูรผู้พิทักษ์ด้วย!"');
            return '🔥 ทลายผนึก! ได้รับ +80 ศรัทธา & +30% ความก้าวหน้า แต่ปลุกอสูร 2 ตัว!';
          }
        }
      ]
    },
    {
      category: '🌙 ยุทธศาสตร์ป้องกันอาณาจักร (Military Command)',
      title: 'สัญญาณเตือนภัยจากแนวหน้า: พลังงานมืดปะทุที่ประตูมิติ!',
      avatar: '🛡️',
      speaker: 'แม่ทัพองครักษ์ ธาม',
      quote: '"องค์เทพพ่ะย่ะค่ะ! ทหารลาดตระเวนรายงานว่าประตูมิติอเวจีกำลังรวบรวมพลัังงานมืด ท่านจะทรงวางแผนรับมืออย่างไร?"',
      desc: 'การตัดสินใจทางทหารของคุณจะส่งผลโดยตรงต่อความอยู่รอดของแนวป้อมปราการชายแดน',
      choices: [
        {
          label: '⚡ ฟาดสายฟ้าสวรรค์ทำลายล้างศัตรูในสนามรบเดี๋ยวนี้!',
          cost: 'ใช้ 15 ✨ ศรัทธา',
          effect: '➔ ผ่าร่างมอนสเตอร์ทุกตัวในแผนที่ (-160 HP) และฟื้นฟูเลือดทหารทุกนายเต็ม 100%',
          action: () => {
            state.faith = Math.max(0, state.faith - 15);
            let hit = 0;
            for (const m of monsters) {
              if (!m.alive) continue;
              m.hp -= 160; hit++;
              spawnShockwaveRing(m.x, getTerrainHeightAt(m.x, m.z), m.z, 0x38bdf8, 8, 0.5);
              if (m.hp <= 0) { m.alive = false; worldObjectsGroup.remove(m.mesh); }
            }
            for (const a of agents) { if (a.alive && a.role === 'soldier') a.hp = a.maxHp; }
            triggerScreenFlash();
            audio.playLightningThunder();
            setVillagerReaction('💭 "สายฟ้าขององค์เทพฟาดลงกลางฝูงอสูรเลย น่าเกรงขามที่สุด!"');
            return `⚡ สายฟ้าสวรรค์พิโรธ! ผ่าศัตรู ${hit} ตัว และฮีลกองทัพอัศวินเต็ม 100%`;
          }
        },
        {
          label: '🔧 เสริมเกราะศิลาให้ป้อมปราการและบ้านเรือนทุกหลัง',
          cost: 'ใช้ 12 ⛏️ แร่ศิลา',
          effect: '➔ ซ่อมแซมอาคารทุกหลังเต็ม 100% + เพิ่มความทนทานสูงสุด (Max HP) ให้อาคารทุกหลัง +50',
          action: () => {
            state.ore = Math.max(0, state.ore - 12);
            for (const b of buildings) {
              b.maxHp += 50;
              b.hp = b.maxHp;
              if (b.progress !== undefined && b.progress < 1.0) {
                b.progress = 1.0;
                b.mesh.scale.setScalar(1.0);
              }
            }
            audio.playBlessChime();
            setVillagerReaction('💭 "กำแพงเมืองและป้อมปราการแข็งแกร่งขึ้นมาก พวกอสูรพังเข้ามาไม่ได้แน่!"');
            return '🔧 เสริมความแข็งแกร่งอาคารทุกหลัง (+50 Max HP & ซ่อมแซมเต็ม 100%)!';
          }
        },
        {
          label: '🙏 จัดพิธีสวดภาวนาครั้งใหญ่หน้ามหาวิหาร',
          cost: 'ไม่เสียทรัพยากร',
          effect: '➔ ชาวบ้านร่วมสวดภาวนา มอบ +45 ✨ พลังศรัทธา ให้คุณไว้ใช้ร่ายเวทอุกกาบาต/สายฟ้า',
          action: () => {
            state.faith = Math.min(state.maxFaith, state.faith + 45);
            audio.playVillageBell(false);
            setVillagerReaction('💭 "ขอพลังแห่งคำอธิษฐานจงแปรเปลี่ยนเป็นศรัทธาถวายแด่องค์เทพ!"');
            return '🙏 พิธีสวดภาวนาสำเร็จ! ได้รับ +45 ✨ พลังศรัทธา';
          }
        }
      ]
    }
  ];

  function pauseForDilemma() {
    if (!dilemmaActive) preDilemmaSpeed = state.timeScale;
    dilemmaActive = true; state.timeScale = 0;
    camCtrl.keys = {}; camCtrl.isDragging = camCtrl.isPanning = isTerraformDragging = false;
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === 0));
  }

  const DECISION_TITLES = ['ชาวบ้านขอเสบียง', 'สภาขอขยายเมือง', 'พ่อค้าเรือเหาะมาเยือน', 'พบศิลาโบราณ', 'แม่ทัพขอแผนป้องกัน'];
  const DECISION_CHOICES = [
    [['ประทานฝนทิพย์', 'อาหาร +35 · ฟื้นเลือด/ความอิ่มทุกคน · ก้าวหน้า +15%'], ['แจกเสบียงสำรอง', 'อาหาร +22 · ความหิวทุกคนเหลือ 45%'], ['เร่งแรงงาน', 'ไม้ +25 · แร่ +20 · พลเรือนเสียเลือด 12']],
    [['สร้างบ้าน', 'บ้าน +1 · ชาวบ้าน +2'], ['เสริมแนวป้อม', 'ป้อม +1 · ทหาร +2'], ['ประทานพรทั้งสองฝ่าย', 'ชาวบ้าน +1 · ทหาร +1 · ก้าวหน้า +20%']],
    [['ซื้อเกวียนและเมล็ดพันธุ์', 'เกวียน +1 · อาหาร +30'], ['แลกไม้เป็นแร่และศรัทธา', 'แร่ +35 · ศรัทธา +35'], ['รับทหารอาสา', 'ทหาร +2']],
    [['ปลุกพลังศรัทธา', 'ศรัทธา +55 · ก้าวหน้า +18%'], ['สกัดศิลา', 'แร่ +35 · ไม้ +30 · อาหาร +20'], ['ทลายผนึกต้องห้าม', 'ศรัทธา +80 · ก้าวหน้า +30% · อสูรบุก 2 ตัว']],
    [['ผ่าสายฟ้าใส่กองทัพอสูร', 'อสูรทุกตัวเสียเลือด 160 · ฟื้นเลือดทหารเต็ม'], ['เสริมเกราะอาคาร', 'ซ่อม/สร้างอาคารเสร็จ · ความทนทานสูงสุด +50'], ['จัดพิธีภาวนา', 'ศรัทธา +45']]
  ];

  function presentDilemma(compact) {
    if (pendingDilemmaIdx === null) return;
    window.dispatchEvent(new Event('aetheria:close-drawer'));
    document.body.classList.add('decision-pending');
    decisionUI.show({ compact, title: DECISION_TITLES[pendingDilemmaIdx], speaker: DILEMMA_SCENE_META[pendingDilemmaIdx].npcName.split(' (')[0], paused: dilemmaActive, resumeSpeed: preDilemmaSpeed });
    refreshDilemmaChoices();
  }

  function closeInteractiveDilemma(resumeMsg = null, resolved = false) {
    if (pendingDilemmaIdx === null) return;
    if (dilemmaActive) state.timeScale = preDilemmaSpeed;
    dilemmaActive = false;
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.speed) === state.timeScale));
    if (resolved) {
      pendingDilemmaIdx = null; decisionUI.hide(); document.body.classList.remove('decision-pending');
      dilemmaTimer = 42.0;
    } else presentDilemma(true);
    if (resumeMsg) showDilemmaToast(resumeMsg);
    updateHUD();
  }

  const btnCloseDilemma = document.getElementById('btn-close-dilemma');
  if (btnCloseDilemma) {
    btnCloseDilemma.addEventListener('click', () => closeInteractiveDilemma('เล่นต่อได้ · คำถามยังตอบได้บนหน้าจอ'));
  }

  function checkChoiceAffordability(costStr) {
    if (!costStr || costStr.includes('ไม่เสีย') || costStr.includes('ปลอดภัย') || costStr.includes('⚠️')) return { ok: true };
    const m = costStr.match(/(\d+)/);
    if (!m) return { ok: true };
    const amt = parseInt(m[1], 10);
    if (costStr.includes('ศรัทธา') && state.faith < amt) return { ok: false, reason: `ศรัทธาไม่พอ (มี ${Math.floor(state.faith)}/${amt})` };
    if (costStr.includes('ไม้ซุง') && state.wood < amt) return { ok: false, reason: `ไม้ซุงไม่พอ (มี ${Math.floor(state.wood)}/${amt})` };
    if (costStr.includes('แร่ศิลา') && state.ore < amt) return { ok: false, reason: `แร่ศิลาไม่พอ (มี ${Math.floor(state.ore)}/${amt})` };
    if (costStr.includes('อาหาร') && state.food < amt) return { ok: false, reason: `อาหารไม่พอ (มี ${Math.floor(state.food)}/${amt})` };
    return { ok: true };
  }

  function refreshDilemmaChoices() {
    if (pendingDilemmaIdx === null) return;
    DILEMMA_EVENTS[pendingDilemmaIdx].choices.forEach((choice, index) => {
      const button = document.getElementById(`dl-choice-${index}`);
      if (!button) return;
      const afford = checkChoiceAffordability(choice.cost);
      button.setAttribute('aria-disabled', String(!afford.ok));
      button.classList.toggle('disabled', !afford.ok);
      let label = afford.ok ? choice.cost : afford.reason;
      if (!document.getElementById('decision-card').hidden) {
        const amount = Number(choice.cost.match(/\d+/)?.[0]);
        const currency = ['faith', 'wood', 'ore', 'food'].find(key => choice.cost.includes(key === 'wood' ? 'ไม้ซุง' : RESOURCE_INFO[key].name));
        if (currency) label = afford.ok ? `${amount} ${RESOURCE_INFO[currency].name}` : `${RESOURCE_INFO[currency].name} ${Math.floor(state[currency])}/${amount}`;
        else label = choice.cost.includes('⚠️') ? `เสี่ยง: อสูร +${amount}` : 'ฟรี';
      }
      if (button.querySelector('.dl-choice-cost').textContent !== label) button.querySelector('.dl-choice-cost').textContent = label;
      button.title = afford.ok ? choice.effect : afford.reason;
    });
    decisionUI?.status(dilemmaActive, preDilemmaSpeed);
  }


  // -------------------- LIVE ANIMATED NPC PORTRAIT & EVENT SCENE RENDERER --------------------
  const dlSceneCanvas = document.getElementById('dl-scene-canvas');
  const dlSceneCtx = dlSceneCanvas ? dlSceneCanvas.getContext('2d') : null;
  let activeDilemmaSceneType = 'famine';

  const DILEMMA_SCENE_META = [
    { type: 'famine', npcName: '🌾 ชาวนา คีริน (Farmer Kirin)', mood: '🥺 หิวโหย & วิงวอน', loc: '📍 ทุ่งนาข้าวสาลีและกังหันลม', camX: -28, camZ: 18 },
    { type: 'council', npcName: '⚒️ อัคคี vs. ⚔️ แม่ทัพ เมฆา', mood: '🔥 ถกเถียงดุเดือด', loc: '📍 ลานสภาหน้ามหาวิหารกลางเกาะ', camX: 0, camZ: 4 },
    { type: 'caravan', npcName: '🎪 หัวหน้าคาราวาน วารี', mood: '✨ ข้อเสนอการค้า', loc: '📍 ท่าเทียบเรือเหาะและสะพานใหญ่', camX: -8, camZ: 14 },
    { type: 'relic', npcName: '👧 เด็กน้อย ลลนา (Little Lalana)', mood: '🌟 ตื่นเต้นสงสัย', loc: '📍 ป่าโบราณและแท่นศิลาเรืองแสง', camX: -22, camZ: -20 },
    { type: 'military', npcName: '🛡️ แม่ทัพองครักษ์ ธาม', mood: '⚔️ เตรียมพร้อมรบ!', loc: '📍 แนวป้อมปราการหน้าประตูมิติอเวจี', camX: 42, camZ: -34 }
  ];

  // Store user-imported custom realistic images (keyed by scene type: 'famine', 'council', 'caravan', 'relic', 'military')
  const BUILT_IN_AI_SCENE_URLS = {"famine": "data:image/webp;base64,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", "council": "data:image/webp;base64,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", "caravan": "data:image/webp;base64,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", "relic": "data:image/webp;base64,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", "military": "data:image/webp;base64,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"};
  const builtInAiImages = {};
  let useAiArtMode = true;
  for (const [k, url] of Object.entries(BUILT_IN_AI_SCENE_URLS)) {
    const im = new Image();
    im.src = url;
    builtInAiImages[k] = im;
  }
  const customSceneImages = {};


  function drawNpcPortraitHead(ctx, cx, cy, scale, skinCol, hatType, hairCol, eyePhase, isTalking) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // 1. Ambient Halo / Rim Backlight behind character head
    const haloGrad = ctx.createRadialGradient(0, -4, 8, 0, -4, 44);
    haloGrad.addColorStop(0, 'rgba(254, 240, 138, 0.38)');
    haloGrad.addColorStop(1, 'rgba(254, 240, 138, 0.0)');
    ctx.fillStyle = haloGrad;
    ctx.beginPath(); ctx.arc(0, -4, 44, 0, Math.PI * 2); ctx.fill();

    // 2. Sculpted Neck & Clavicle Shading
    const neckGrad = ctx.createLinearGradient(-10, 16, 12, 34);
    neckGrad.addColorStop(0, '#d97706');
    neckGrad.addColorStop(0.5, skinCol);
    neckGrad.addColorStop(1, '#92400e');
    ctx.fillStyle = neckGrad;
    ctx.beginPath(); ctx.roundRect(-10, 16, 20, 19, 6); ctx.fill();

    // 3. Ears with inner concha shadow
    for (const side of [-1, 1]) {
      ctx.fillStyle = skinCol;
      ctx.beginPath(); ctx.ellipse(side * 24, 2, 4.5, 8.5, side * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(146, 64, 14, 0.45)';
      ctx.beginPath(); ctx.ellipse(side * 24, 2, 2.2, 5.0, side * 0.15, 0, Math.PI * 2); ctx.fill();
    }

    // 4. 3D Subsurface-Shaded Face Contour (Chin, Jawline & Cheekbones)
    const faceGrad = ctx.createRadialGradient(-6, -8, 4, 2, 4, 29);
    faceGrad.addColorStop(0, '#fef3c7');
    faceGrad.addColorStop(0.55, skinCol);
    faceGrad.addColorStop(1, '#b45309');
    ctx.fillStyle = faceGrad;
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.bezierCurveTo(22, -24, 25, -4, 22, 10);
    ctx.bezierCurveTo(18, 21, 7, 26, 0, 26);
    ctx.bezierCurveTo(-7, 26, -18, 21, -22, 10);
    ctx.bezierCurveTo(-25, -4, -22, -24, 0, -24);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(69, 26, 3, 0.65)';
    ctx.stroke();

    // Warm subsurface blush on cheeks
    for (const sx of [-13, 13]) {
      const blushG = ctx.createRadialGradient(sx, 6, 1, sx, 6, 8);
      blushG.addColorStop(0, 'rgba(244, 63, 94, 0.38)');
      blushG.addColorStop(1, 'rgba(244, 63, 94, 0.0)');
      ctx.fillStyle = blushG;
      ctx.beginPath(); ctx.arc(sx, 6, 8, 0, Math.PI * 2); ctx.fill();
    }

    // 5. Realistic Multi-Layered Eyes (Sclera, Iris Gradient, Pupil, Dual Specular Catchlights, Eyelashes)
    const blink = Math.sin(eyePhase * 3.1) > 0.96 ? 0.12 : 1.0;
    const irisColor = hatType === 'helmet' ? '#0284c7' : (hatType === 'child' ? '#10b981' : (hatType === 'merchant' ? '#9333ea' : '#b45309'));
    for (const side of [-1, 1]) {
      const ex = side * 9.5, ey = -2.0;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.scale(1, blink);
      // Sclera white
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.ellipse(0, 0, 5.4, 4.4, 0, 0, Math.PI * 2); ctx.fill();
      // Iris gradient
      const irisG = ctx.createRadialGradient(0, 0.5, 0.8, 0, 0, 3.8);
      irisG.addColorStop(0, '#0f172a');
      irisG.addColorStop(0.55, irisColor);
      irisG.addColorStop(1, '#1e293b');
      ctx.fillStyle = irisG;
      ctx.beginPath(); ctx.arc(0, 0, 3.6, 0, Math.PI * 2); ctx.fill();
      // Pupil
      ctx.fillStyle = '#020617';
      ctx.beginPath(); ctx.arc(0, 0, 1.65, 0, Math.PI * 2); ctx.fill();
      // Primary & secondary specular catchlights
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(-1.4, -1.4, 1.25, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(1.2, 1.2, 0.65, 0, Math.PI * 2); ctx.fill();
      // Upper lash line
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.0;
      ctx.beginPath(); ctx.arc(0, 0.4, 5.4, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.restore();
    }

    // 6. Sculpted 3D Nose Bridge & Nostril Shadow
    ctx.strokeStyle = 'rgba(120, 53, 15, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-1, -3); ctx.lineTo(-2.2, 4.5); ctx.lineTo(1.5, 5.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0.8, -2.5); ctx.lineTo(0.8, 3.8); ctx.stroke();

    // 7. Expressive Eyebrows
    ctx.strokeStyle = hairCol;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-15, -9.5); ctx.quadraticCurveTo(-9.5, -13.0, -4, -9.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -9.5); ctx.quadraticCurveTo(9.5, -13.0, 15, -9.5); ctx.stroke();

    // 8. Shaded Lips, Teeth & Animated Speech
    const mouthOpen = isTalking ? (2.2 + Math.abs(Math.sin(eyePhase * 8.5)) * 4.2) : 1.6;
    ctx.fillStyle = '#7f1d1d';
    ctx.beginPath(); ctx.ellipse(0, 12.5, 5.8, mouthOpen, 0, 0, Math.PI * 2); ctx.fill();
    if (mouthOpen > 2.5) {
      // Upper teeth & tongue highlight
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-4, 12.5 - mouthOpen + 0.6, 8, 1.8);
      ctx.fillStyle = '#fb7185';
      ctx.beginPath(); ctx.ellipse(0, 12.5 + mouthOpen * 0.35, 3.6, mouthOpen * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(153, 27, 27, 0.7)';
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(-6.2, 12.2); ctx.quadraticCurveTo(0, 10.5, 6.2, 12.2); ctx.stroke();

    // 9. Detailed Headgear, Helmets & Hair Shading
    if (hatType === 'straw') {
      // Woven Golden Straw Hat with 3D brim gradient & weave cross-hatching
      const brimG = ctx.createLinearGradient(-40, -18, 40, -12);
      brimG.addColorStop(0, '#a16207'); brimG.addColorStop(0.5, '#facc15'); brimG.addColorStop(1, '#854d0e');
      ctx.fillStyle = brimG;
      ctx.beginPath(); ctx.ellipse(0, -16, 40, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#713f12'; ctx.lineWidth = 1.6; ctx.stroke();
      const domeG = ctx.createRadialGradient(-6, -28, 3, 0, -20, 24);
      domeG.addColorStop(0, '#fef08a'); domeG.addColorStop(0.6, '#eab308'); domeG.addColorStop(1, '#a16207');
      ctx.fillStyle = domeG;
      ctx.beginPath(); ctx.arc(0, -17, 22, Math.PI, 0); ctx.fill();
      ctx.stroke();
      // Crimson cloth sash around hat crown
      ctx.fillStyle = '#dc2626';
      ctx.beginPath(); ctx.roundRect(-21, -20, 42, 4.5, 2); ctx.fill();
    } else if (hatType === 'helmet') {
      // Gleaming Metallic Knight Helm with Specular Reflections & Royal Crimson Plume
      const plumeG = ctx.createLinearGradient(0, -52, 18, -20);
      plumeG.addColorStop(0, '#f43f5e'); plumeG.addColorStop(0.5, '#dc2626'); plumeG.addColorStop(1, '#7f1d1d');
      ctx.fillStyle = plumeG;
      ctx.beginPath();
      ctx.moveTo(-2, -50);
      ctx.quadraticCurveTo(26, -48, 18, -20);
      ctx.quadraticCurveTo(2, -28, -14, -20);
      ctx.closePath();
      ctx.fill();

      const steelG = ctx.createLinearGradient(-26, -32, 26, -6);
      steelG.addColorStop(0, '#475569'); steelG.addColorStop(0.35, '#f8fafc'); steelG.addColorStop(0.65, '#94a3b8'); steelG.addColorStop(1, '#1e293b');
      ctx.fillStyle = steelG;
      ctx.beginPath(); ctx.arc(0, -9, 27, Math.PI * 1.06, -Math.PI * 0.06); ctx.fill();
      ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2; ctx.stroke();

      // Golden Crown Brow & Nasal Guard
      const goldG = ctx.createLinearGradient(-24, -14, 24, -10);
      goldG.addColorStop(0, '#b45309'); goldG.addColorStop(0.5, '#fef08a'); goldG.addColorStop(1, '#d97706');
      ctx.fillStyle = goldG;
      ctx.beginPath(); ctx.roundRect(-25, -14, 50, 5.5, 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(4.5, -7); ctx.lineTo(-4.5, -7); ctx.closePath(); ctx.fill();
    } else if (hatType === 'builder') {
      // Master Craftsman Bandana, Hair & Sculpted Beard
      ctx.fillStyle = hairCol;
      ctx.beginPath(); ctx.arc(0, -7, 26, Math.PI, 0); ctx.fill();
      const bandG = ctx.createLinearGradient(-25, -17, 25, -10);
      bandG.addColorStop(0, '#9a3412'); bandG.addColorStop(0.5, '#f97316'); bandG.addColorStop(1, '#7c2d12');
      ctx.fillStyle = bandG;
      ctx.beginPath(); ctx.roundRect(-25, -17, 50, 8.5, 3); ctx.fill();
      // Full Craftsman Beard with mustache
      ctx.fillStyle = hairCol;
      ctx.beginPath(); ctx.arc(0, 14, 17, 0.12 * Math.PI, 0.88 * Math.PI); ctx.fill();
    } else if (hatType === 'merchant') {
      // Ornate Silk Merchant Turban with Gold Brooch, Emerald & Plume Feather
      const turbG = ctx.createRadialGradient(-8, -26, 4, 0, -18, 32);
      turbG.addColorStop(0, '#c084fc'); turbG.addColorStop(0.55, '#7e22ce'); turbG.addColorStop(1, '#3b0764');
      ctx.fillStyle = turbG;
      ctx.beginPath(); ctx.ellipse(0, -19, 29, 17, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5; ctx.stroke();
      // Silk folds
      ctx.beginPath(); ctx.arc(0, -16, 22, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      // Feather & Emerald Gem
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.moveTo(4, -24); ctx.quadraticCurveTo(22, -46, 9, -48); ctx.quadraticCurveTo(-2, -36, 4, -24); ctx.fill();
      ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(0, -18, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#10b981'; ctx.beginPath(); ctx.arc(0, -18, 4.2, 0, Math.PI * 2); ctx.fill();
    } else if (hatType === 'child') {
      // Lush Braided Hair, Bangs & Glowing Forest Flower Crown
      const hairG = ctx.createRadialGradient(-6, -18, 4, 0, -6, 28);
      hairG.addColorStop(0, '#b45309'); hairG.addColorStop(0.6, hairCol); hairG.addColorStop(1, '#271206');
      ctx.fillStyle = hairG;
      ctx.beginPath(); ctx.arc(0, -6, 26, Math.PI * 0.88, Math.PI * 0.12); ctx.fill();
      ctx.beginPath(); ctx.arc(-23, 9, 8.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(23, 9, 8.5, 0, Math.PI * 2); ctx.fill();
      for (const fx of [-15, -5, 5, 15]) {
        ctx.fillStyle = fx % 2 === 0 ? '#f43f5e' : '#fde047';
        ctx.beginPath(); ctx.arc(fx, -18, 5.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(fx, -18, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function renderDilemmaSceneCanvas(elapsedTime) {
    if (!dlSceneCtx || !dilemmaActive) return;
    const ctx = dlSceneCtx;
    const W = dlSceneCanvas.width, H = dlSceneCanvas.height;
    ctx.clearRect(0, 0, W, H);
    const t = elapsedTime;

    // Render Custom Uploaded Image OR Built-in AI Realistic Illustration (when useAiArtMode is active) with living Ken Burns motion + atmospheric particles!
    const activeImg = customSceneImages[activeDilemmaSceneType] || (useAiArtMode ? builtInAiImages[activeDilemmaSceneType] : null);
    if (activeImg && activeImg.complete && activeImg.naturalWidth > 0) {
      ctx.save();
      const zoom = 1.04 + Math.sin(t * 0.85) * 0.028;
      const panX = Math.cos(t * 0.55) * 4.0;
      const panY = Math.sin(t * 0.65) * 3.0;
      ctx.translate(W * 0.5 + panX, H * 0.5 + panY);
      ctx.scale(zoom, zoom);
      const iw = activeImg.naturalWidth, ih = activeImg.naturalHeight;
      const scale = Math.max(W / iw, H / ih);
      ctx.drawImage(activeImg, -(iw * scale) * 0.5, -(ih * scale) * 0.5, iw * scale, ih * scale);
      ctx.restore();

      // Scene-specific live animated particle overlay on top of the realistic AI artwork
      const pCol = activeDilemmaSceneType === "military" ? "rgba(244, 63, 94, 0.78)" :
                   (activeDilemmaSceneType === "relic" ? "rgba(232, 121, 249, 0.82)" : "rgba(254, 240, 138, 0.72)");
      for (let i = 0; i < 14; i++) {
        const px = (i * 37 + Math.sin(t * 1.5 + i) * 26 + W) % W;
        const py = (i * 29 + Math.cos(t * 1.2 + i) * 22 + H) % H;
        ctx.fillStyle = (i % 2 === 0) ? "rgba(254, 240, 138, 0.75)" : pCol;
        ctx.beginPath(); ctx.arc(px, py, 1.8 + (i % 3) * 0.7, 0, Math.PI * 2); ctx.fill();
      }
      // Subtle golden inner border glow
      ctx.strokeStyle = "rgba(251, 191, 36, 0.35)";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, W - 2, H - 2);
      return;
    }

    if (activeDilemmaSceneType === 'famine') {
      // 1. Golden Sunset Sky + Volumetric God-Rays + Mountain Silhouette
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, '#0f172a');
      skyGrad.addColorStop(0.28, '#1e3a8a');
      skyGrad.addColorStop(0.62, '#ea580c');
      skyGrad.addColorStop(1, '#fef08a');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // Volumetric God-Rays radiating from setting sun (245, 78)
      ctx.save();
      ctx.translate(245, 78);
      for (let r = 0; r < 8; r++) {
        const ang = (r / 8) * Math.PI * 2 + t * 0.12;
        const rayG = ctx.createLinearGradient(0, 0, Math.cos(ang) * 220, Math.sin(ang) * 220);
        rayG.addColorStop(0, 'rgba(254, 240, 138, 0.28)');
        rayG.addColorStop(1, 'rgba(254, 240, 138, 0.0)');
        ctx.fillStyle = rayG;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 240, ang - 0.14, ang + 0.14);
        ctx.closePath();
        ctx.fill();
      }
      const sunHalo = ctx.createRadialGradient(0, 0, 8, 0, 0, 56);
      sunHalo.addColorStop(0, '#ffffff');
      sunHalo.addColorStop(0.35, '#fde047');
      sunHalo.addColorStop(1, 'rgba(251, 146, 60, 0)');
      ctx.fillStyle = sunHalo;
      ctx.beginPath(); ctx.arc(0, 0, 56, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Distant Mountain Range Silhouette
      ctx.fillStyle = 'rgba(49, 46, 129, 0.55)';
      ctx.beginPath();
      ctx.moveTo(0, 175); ctx.lineTo(48, 122); ctx.lineTo(105, 158); ctx.lineTo(165, 115); ctx.lineTo(235, 162); ctx.lineTo(W, 138); ctx.lineTo(W, 195); ctx.lineTo(0, 195);
      ctx.fill();

      // Rolling Farmland Hills & Golden Furrows
      const hillG = ctx.createLinearGradient(0, 160, 0, H);
      hillG.addColorStop(0, '#4d7c0f');
      hillG.addColorStop(0.5, '#365314');
      hillG.addColorStop(1, '#1a2e05');
      ctx.fillStyle = hillG;
      ctx.beginPath(); ctx.moveTo(0, 182); ctx.quadraticCurveTo(95, 152, 210, 178); ctx.lineTo(W, 168); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.55)'; ctx.lineWidth = 2.2;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath(); ctx.moveTo(10 + i * 42, 180); ctx.quadraticCurveTo(i * 44, 230, -30 + i * 54, H); ctx.stroke();
      }

      // Detailed Timber & Stone Windmill in Background Left
      ctx.save();
      ctx.translate(64, 140);
      const wmG = ctx.createLinearGradient(-15, -20, 15, 42);
      wmG.addColorStop(0, '#fef3c7'); wmG.addColorStop(1, '#78350f');
      ctx.fillStyle = wmG;
      ctx.beginPath(); ctx.moveTo(-15, 42); ctx.lineTo(-9, -18); ctx.lineTo(9, -18); ctx.lineTo(15, 42); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#451a03';
      ctx.beginPath(); ctx.arc(0, -18, 11.5, Math.PI, 0); ctx.fill();
      ctx.rotate(-t * 1.4);
      ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 2.5;
      for (let b = 0; b < 4; b++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -36); ctx.stroke();
        ctx.fillStyle = 'rgba(254, 243, 199, 0.82)';
        ctx.fillRect(0, -34, 10, 24);
      }
      ctx.restore();

      // Foreground NPC: Farmer Kirin with Shaded Tunic, Leather Suspenders & Glowing Wheat Sheaf
      const bob = Math.sin(t * 3.2) * 3.0;
      ctx.save();
      ctx.translate(182, 226 + bob);
      const tunicG = ctx.createLinearGradient(-48, -18, 48, 75);
      tunicG.addColorStop(0, '#22c55e'); tunicG.addColorStop(0.6, '#15803d'); tunicG.addColorStop(1, '#052e16');
      ctx.fillStyle = tunicG;
      ctx.beginPath(); ctx.roundRect(-50, -18, 100, 96, 24); ctx.fill();
      ctx.strokeStyle = '#052e16'; ctx.lineWidth = 2; ctx.stroke();
      const vestG = ctx.createLinearGradient(-28, -16, 28, 70);
      vestG.addColorStop(0, '#b45309'); vestG.addColorStop(1, '#451a03');
      ctx.fillStyle = vestG;
      ctx.beginPath(); ctx.roundRect(-28, -16, 56, 85, 8); ctx.fill();
      // Golden Wheat Sheaf with grain heads
      ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2.8;
      for (let w = -5; w <= 5; w++) {
        ctx.beginPath(); ctx.moveTo(-18 + w * 2, 36); ctx.quadraticCurveTo(-28 + w * 4, 0, -38 + w * 6, -30); ctx.stroke();
        ctx.fillStyle = '#facc15';
        ctx.beginPath(); ctx.ellipse(-38 + w * 6, -32, 2.5, 5.5, -0.3, 0, Math.PI * 2); ctx.fill();
      }
      drawNpcPortraitHead(ctx, 0, -45, 1.26, '#fcd34d', 'straw', '#451a03', t, true);
      ctx.restore();

    } else if (activeDilemmaSceneType === 'council') {
      // Dramatic Split-Screen Clash: Forge Fire Orange vs. Royal Knight Cobalt Blue
      const gradL = ctx.createLinearGradient(0, 0, W, H);
      gradL.addColorStop(0, '#9a3412');
      gradL.addColorStop(0.48, '#0f172a');
      gradL.addColorStop(0.52, '#0f172a');
      gradL.addColorStop(1, '#1e3a8a');
      ctx.fillStyle = gradL;
      ctx.fillRect(0, 0, W, H);

      // Fluted Marble Pantheon Columns with 3D cylindrical shading
      for (const cx of [38, 115, 205, 282]) {
        const colG = ctx.createLinearGradient(cx - 12, 0, cx + 12, 0);
        colG.addColorStop(0, 'rgba(148, 163, 184, 0.12)');
        colG.addColorStop(0.45, 'rgba(248, 250, 252, 0.32)');
        colG.addColorStop(1, 'rgba(71, 85, 105, 0.10)');
        ctx.fillStyle = colG;
        ctx.fillRect(cx - 11, 28, 22, 195);
        ctx.fillRect(cx - 16, 20, 32, 8);
      }

      // Glowing Energy Clash Lightning Down the Center
      ctx.save();
      ctx.shadowColor = '#fde047';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(W * 0.5, 10);
      ctx.lineTo(W * 0.5 - 9, 82);
      ctx.lineTo(W * 0.5 + 9, 145);
      ctx.lineTo(W * 0.5 - 4, 210);
      ctx.lineTo(W * 0.5, 275);
      ctx.stroke();
      ctx.restore();

      // Left NPC: Master Builder Akkhi
      const bob1 = Math.sin(t * 3.5) * 2.5;
      ctx.save();
      ctx.translate(84, 228 + bob1);
      const akG = ctx.createLinearGradient(-42, -14, 42, 75);
      akG.addColorStop(0, '#ea580c'); akG.addColorStop(1, '#7c2d12');
      ctx.fillStyle = akG;
      ctx.beginPath(); ctx.roundRect(-44, -14, 88, 92, 20); ctx.fill();
      drawNpcPortraitHead(ctx, 0, -42, 1.14, '#fbbf24', 'builder', '#451a03', t, true);
      ctx.restore();

      // Right NPC: Royal Knight General Mekha
      const bob2 = Math.cos(t * 3.5) * 2.5;
      ctx.save();
      ctx.translate(236, 228 + bob2);
      ctx.fillStyle = '#1d4ed8';
      ctx.beginPath(); ctx.roundRect(-44, -14, 88, 92, 20); ctx.fill();
      const armorG = ctx.createLinearGradient(-34, -10, 34, 60);
      armorG.addColorStop(0, '#f8fafc'); armorG.addColorStop(0.5, '#cbd5e1'); armorG.addColorStop(1, '#475569');
      ctx.fillStyle = armorG;
      ctx.beginPath(); ctx.roundRect(-34, -10, 68, 72, 12); ctx.fill();
      drawNpcPortraitHead(ctx, 0, -42, 1.14, '#fcd34d', 'helmet', '#1e293b', t + 1.2, true);
      ctx.restore();

    } else if (activeDilemmaSceneType === 'caravan') {
      // Sky Caravan Airship & Golden Sunset Clouds
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, '#0c4a6e');
      skyGrad.addColorStop(0.45, '#0284c7');
      skyGrad.addColorStop(0.82, '#38bdf8');
      skyGrad.addColorStop(1, '#fef08a');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // Fluffy Illuminated Sky Clouds
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      for (const [cx, cy, cr] of [[45, 165, 32], [85, 172, 26], [135, 178, 22], [275, 145, 34]]) {
        ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
      }

      // Detailed 3D-Shaded Sky Caravan Airship in Upper Left
      const shipY = 82 + Math.sin(t * 2.2) * 7;
      ctx.save();
      ctx.translate(94, shipY);
      const balG = ctx.createRadialGradient(-14, -34, 6, 0, -24, 52);
      balG.addColorStop(0, '#f87171'); balG.addColorStop(0.55, '#dc2626'); balG.addColorStop(1, '#7f1d1d');
      ctx.fillStyle = balG;
      ctx.beginPath(); ctx.ellipse(0, -24, 52, 30, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.ellipse(0, -24, 52, 9, 0, 0, Math.PI * 2); ctx.fill();
      // Vertical gold ribs on balloon
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)'; ctx.lineWidth = 2;
      for (const rx of [-26, 0, 26]) {
        ctx.beginPath(); ctx.ellipse(0, -24, Math.max(4, Math.abs(rx)), 29, 0, 0, Math.PI * 2); ctx.stroke();
      }
      // Suspension rigging & Wooden Sky-Galleon Hull
      ctx.strokeStyle = '#451a03'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-24, 4); ctx.lineTo(-18, 22); ctx.moveTo(24, 4); ctx.lineTo(18, 22); ctx.stroke();
      const hullG = ctx.createLinearGradient(-32, 18, 32, 36);
      hullG.addColorStop(0, '#b45309'); hullG.addColorStop(1, '#451a03');
      ctx.fillStyle = hullG;
      ctx.beginPath(); ctx.roundRect(-30, 18, 60, 17, 7); ctx.fill();
      ctx.restore();

      // Foreground NPC: Caravan Master Waree in Royal Silk Robes
      const bob = Math.sin(t * 3.0) * 3.0;
      ctx.save();
      ctx.translate(206, 228 + bob);
      const robeG = ctx.createLinearGradient(-48, -16, 48, 75);
      robeG.addColorStop(0, '#9333ea'); robeG.addColorStop(0.6, '#6b21a8'); robeG.addColorStop(1, '#3b0764');
      ctx.fillStyle = robeG;
      ctx.beginPath(); ctx.roundRect(-50, -16, 100, 94, 22); ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-13, -16, 26, 92);
      drawNpcPortraitHead(ctx, 0, -44, 1.24, '#fcd34d', 'merchant', '#1e1b4b', t, true);
      ctx.restore();

    } else if (activeDilemmaSceneType === 'relic') {
      // Mystical Bioluminescent Forest & Levitating Runic Monolith
      const bgGrad = ctx.createRadialGradient(96, 124, 8, 120, 140, 240);
      bgGrad.addColorStop(0, '#a855f7');
      bgGrad.addColorStop(0.45, '#065f46');
      bgGrad.addColorStop(1, '#022c22');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Levitating Ancient Runic Monolith with Rotating Arcane Rings
      const stoneY = 126 + Math.sin(t * 2.6) * 6;
      ctx.save();
      ctx.translate(92, stoneY);
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 46 + Math.sin(t * 4) * 4, 0, Math.PI * 2); ctx.stroke();
      const monoG = ctx.createLinearGradient(-26, -52, 26, 48);
      monoG.addColorStop(0, '#581c87'); monoG.addColorStop(0.5, '#1e1b4b'); monoG.addColorStop(1, '#311042');
      ctx.fillStyle = monoG;
      ctx.beginPath(); ctx.moveTo(0, -54); ctx.lineTo(27, -15); ctx.lineTo(21, 50); ctx.lineTo(-21, 50); ctx.lineTo(-27, -15); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#e879f9'; ctx.lineWidth = 2.2; ctx.stroke();
      // Glowing rune sigil
      ctx.strokeStyle = '#fde047'; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(13, 0); ctx.lineTo(0, 28); ctx.lineTo(-13, 0); ctx.closePath(); ctx.stroke();
      ctx.restore();

      // Glowing Fireflies with soft halos
      for (let f = 0; f < 14; f++) {
        const fx = (f * 37 + Math.sin(t * 1.8 + f) * 20) % W;
        const fy = (f * 29 + Math.cos(t * 2.1 + f) * 18) % (H - 35);
        ctx.fillStyle = f % 2 === 0 ? '#fde047' : '#f0abfc';
        ctx.beginPath(); ctx.arc(fx, fy, 2.8, 0, Math.PI * 2); ctx.fill();
      }

      // Foreground NPC: Little Lalana
      const bob = Math.sin(t * 4.2) * 3.5;
      ctx.save();
      ctx.translate(215, 236 + bob);
      const dressG = ctx.createLinearGradient(-40, -14, 40, 68);
      dressG.addColorStop(0, '#10b981'); dressG.addColorStop(1, '#064e3b');
      ctx.fillStyle = dressG;
      ctx.beginPath(); ctx.roundRect(-42, -14, 84, 84, 20); ctx.fill();
      drawNpcPortraitHead(ctx, 0, -38, 1.16, '#fde68a', 'child', '#78350f', t, true);
      ctx.restore();

    } else {
      // 'military': Void Rift Portal, Red Lightning & Commander Tham in Gleaming Plate Armor
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#090d1a');
      bgGrad.addColorStop(0.5, '#4c1d95');
      bgGrad.addColorStop(1, '#7f1d1d');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Swirling Void Rift Vortex in Upper Left
      ctx.save();
      ctx.translate(82, 108);
      ctx.rotate(t * 1.8);
      for (let r = 46; r > 8; r -= 8) {
        ctx.strokeStyle = r % 16 === 0 ? '#e879f9' : '#f43f5e';
        ctx.lineWidth = 3.2;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 1.45); ctx.stroke();
      }
      ctx.restore();

      // Silhouetted Horned Demon Eyes in the Mist
      ctx.fillStyle = '#ff0055';
      for (const [dx, dy] of [[42, 165], [52, 165], [112, 175], [122, 175]]) {
        ctx.beginPath(); ctx.arc(dx, dy, 3.4, 0, Math.PI * 2); ctx.fill();
      }

      // Foreground NPC: Commander Tham in Gleaming Plate Armor with Blazing Runic Broadsword
      const bob = Math.sin(t * 3.4) * 2.5;
      ctx.save();
      ctx.translate(206, 226 + bob);
      ctx.fillStyle = '#991b1b';
      ctx.beginPath(); ctx.roundRect(-54, -14, 108, 95, 22); ctx.fill();
      const plateG = ctx.createLinearGradient(-42, -12, 42, 75);
      plateG.addColorStop(0, '#ffffff'); plateG.addColorStop(0.45, '#cbd5e1'); plateG.addColorStop(1, '#334155');
      ctx.fillStyle = plateG;
      ctx.beginPath(); ctx.roundRect(-42, -12, 84, 88, 14); ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-6, -12, 12, 85);

      // Raised Glowing Runic Broadsword on Left
      ctx.save();
      ctx.translate(-52, 10);
      ctx.rotate(-0.25 + Math.sin(t * 4) * 0.06);
      const bladeG = ctx.createLinearGradient(-6, -85, 6, 0);
      bladeG.addColorStop(0, '#e0f2fe'); bladeG.addColorStop(0.5, '#38bdf8'); bladeG.addColorStop(1, '#0284c7');
      ctx.fillStyle = bladeG;
      ctx.beginPath(); ctx.moveTo(0, -92); ctx.lineTo(6, -78); ctx.lineTo(5, -10); ctx.lineTo(-5, -10); ctx.lineTo(-6, -78); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-16, -12, 32, 6);
      ctx.restore();

      drawNpcPortraitHead(ctx, 0, -44, 1.24, '#fcd34d', 'helmet', '#0f172a', t, true);
      ctx.restore();
    }
  }

  function openInteractiveDilemma(forceIdx = null, switching = false, compact = false) {
    if (!dilemmaOverlay) return;
    if (pendingDilemmaIdx !== null && !switching) {
      if (!compact) pauseForDilemma();
      presentDilemma(compact); return;
    }
    pauseForDilemma();

    let idx = forceIdx !== null ? forceIdx : Math.floor(Math.random() * DILEMMA_EVENTS.length);
    if (forceIdx === null && idx === lastDilemmaIdx) idx = (idx + 1) % DILEMMA_EVENTS.length;
    if (forceIdx === null) {
      if (monsters.some(m => m.alive) && lastDilemmaIdx !== 4) idx = 4;
      else if (state.food < 25 && lastDilemmaIdx !== 0) idx = 0;
    }
    lastDilemmaIdx = idx;
    pendingDilemmaIdx = idx;
    const ev = DILEMMA_EVENTS[idx];
    const meta = DILEMMA_SCENE_META[idx] || DILEMMA_SCENE_META[0];
    activeDilemmaSceneType = meta.type;
    const pNameEl = document.getElementById('dl-portrait-name'); if (pNameEl) pNameEl.textContent = meta.npcName;
    const pMoodEl = document.getElementById('dl-portrait-mood'); if (pMoodEl) pMoodEl.textContent = meta.mood;
    const pLocEl = document.getElementById('dl-scene-loc'); if (pLocEl) pLocEl.textContent = meta.loc;
    // Smoothly focus 3D island camera on the event's real location!
    camCtrl.followEntity = null;
    camCtrl.target.set(meta.camX, getTerrainHeightAt(meta.camX, meta.camZ), meta.camZ);
    renderDilemmaSceneCanvas(performance.now() * 0.001);

    document.getElementById('dl-category').textContent = ev.category;
    document.getElementById('dl-title').textContent = ev.title;
    document.getElementById('dl-avatar').textContent = ev.avatar;
    document.getElementById('dl-speaker').textContent = ev.speaker;
    document.getElementById('dl-quote').textContent = ev.quote;
    document.getElementById('dl-desc').textContent = ev.desc;

    const choicesBox = document.getElementById('dl-choices');
    choicesBox.innerHTML = '';
    ev.choices.forEach((ch, cIdx) => {
      const afford = checkChoiceAffordability(ch.cost);
      const btn = document.createElement('button');
      btn.className = 'dl-choice-btn' + (afford.ok ? '' : ' disabled');
      btn.id = `dl-choice-${cIdx}`;
      btn.setAttribute('aria-disabled', String(!afford.ok));
      const badgeText = afford.ok ? ch.cost : `❌ ${afford.reason}`;
      const summary = DECISION_CHOICES[idx][cIdx];
      btn.innerHTML = `
        <div class="dl-choice-title">
          <span class="dl-choice-full">${ch.label}</span><span class="dl-choice-compact">${summary[0]}</span>
          <span class="dl-choice-cost">${badgeText}</span>
        </div>
        <div class="dl-choice-effect dl-choice-full">${ch.effect}</div><div class="dl-choice-effect dl-choice-compact">${summary[1]}</div>
      `;
      btn.addEventListener('click', () => {
        if (pendingDilemmaIdx !== idx) return;
        audio.init();
        const nowAfford = checkChoiceAffordability(ch.cost);
        if (!nowAfford.ok) {
          showDilemmaToast(`⚠️ ไม่สามารถเลือกได้: ${nowAfford.reason}`);
          return;
        }
        const result = ch.action();
        if (typeof result === 'object' && result.resolved === false) {
          showDilemmaToast(result.message);
          addLog(result.message, 'warn');
          return;
        }
        const resultMsg = typeof result === 'string' ? result : result.message;
        closeInteractiveDilemma(resultMsg, true);
        addLog(`⚖️ [ผลการตัดสินใจ] ${resultMsg}`, 'bless');
      });
      choicesBox.appendChild(btn);
    });

    dilemmaOverlay.classList.remove('peek-3d');
    if (btnPeek3D) { btnPeek3D.classList.remove('active'); btnPeek3D.textContent = '🎥 ส่องฉาก 3D จริง'; }
    document.querySelectorAll('.dl-tab').forEach(tb => tb.classList.toggle('active', parseInt(tb.dataset.dlIdx, 10) === idx));
    presentDilemma(compact);
    audio.playVillageBell(false);
  }


  // Bind Scene Switcher Tabs (1..5) & 3D Scene Peek Button inside #dilemma-modal
  document.querySelectorAll('.dl-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.init();
      const targetIdx = parseInt(tabBtn.dataset.dlIdx, 10);
      openInteractiveDilemma(targetIdx, true);
    });
  });


  const btnToggleArtMode = document.getElementById('btn-toggle-art-mode');
  if (btnToggleArtMode) {
    btnToggleArtMode.addEventListener('click', (e) => {
      e.stopPropagation();
      useAiArtMode = !useAiArtMode;
      btnToggleArtMode.classList.toggle('active', useAiArtMode);
      btnToggleArtMode.textContent = useAiArtMode ? '✨ ภาพ: AI เหมือนจริง' : '🎨 ภาพ: 2D วาดสด';
      renderDilemmaSceneCanvas(performance.now() * 0.001);
      if (state.selectedEntity) updateInspectorUI();
    });
  }

  const btnUploadSceneImg = document.getElementById('btn-upload-scene-img');
  const customAssetInput = document.getElementById('custom-asset-input');
  if (btnUploadSceneImg && customAssetInput) {
    btnUploadSceneImg.addEventListener('click', (e) => {
      e.stopPropagation();
      customAssetInput.click();
    });
    customAssetInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          customSceneImages[activeDilemmaSceneType] = img;
          renderDilemmaSceneCanvas(performance.now() * 0.001);
          showDilemmaToast('🖼️ นำเข้าภาพ Asset จริงเข้าสู่ฉากเหตุการณ์เรียบร้อยแล้ว!');
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const btnPeek3D = document.getElementById('btn-peek-3d-scene');
  if (btnPeek3D && dilemmaOverlay) {
    btnPeek3D.addEventListener('click', (e) => {
      e.stopPropagation();
      const peeking = dilemmaOverlay.classList.toggle('peek-3d');
      btnPeek3D.classList.toggle('active', peeking);
      btnPeek3D.textContent = peeking ? '🖼️ กลับมาดูหน้าต่างคำถาม' : '🎥 ส่องฉาก 3D จริง';
    });
  }

  if (btnTriggerDilemma) {
    btnTriggerDilemma.addEventListener('click', () => {
      audio.init();
      openInteractiveDilemma(null, false, true);
    });
  }

  function updateInspectorUI() {
    const ent = state.selectedEntity; if (!ent || ent.alive === false) { state.selectedEntity = null; camCtrl.followEntity = null; document.getElementById('inspector-card').classList.remove('visible'); return; }
    const body = document.getElementById('insp-body');
    if (ent.type === 'agent') {
      const mind = describeAgentMind(ent);
      const markup = `
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:6px;">
          <canvas id="insp-portrait-canvas" width="76" height="76" style="width:48px; height:48px; border-radius:12px; border:1.5px solid #fbbf24; background:#091326; flex-shrink:0;"></canvas>
          <div style="min-width:0;">
            <div style="font-weight:800; color:#fde047; font-size:12.5px;">${ent.name}</div>
            <div data-agent-label style="font-size:11px; color:#38bdf8; font-weight:700;">${ent.stateLabel}</div>
            <div data-agent-health style="font-size:10.5px; color:#cbd5e1; margin-top:2px;">❤️ ${Math.ceil(ent.hp)}/${ent.maxHp} • 🍎 หิว ${Math.round(ent.hunger)}%</div>
          </div>
        </div>
        <details class="agent-notes"><summary>ความคิดและแผนของยูนิต</summary><div class="agent-notes-body">
          <div data-agent-thought style="color:#fef08a;font-style:italic;font-size:11px;">${mind.thought}</div>
          <div data-agent-plan style="color:#7dd3fc;font-size:10px;margin-top:2px;">${mind.plan}</div>
        </div></details>
        <div style="margin-top:6px;"><button class="btn-mini" id="btn-follow-agent" style="width:100%;">🎥 กล้องติดตามยูนิตนี้</button></div>`;
      const key = `agent-${ent.id}-${ent.role}`;
      if (body.dataset.entityKey !== key) { body.innerHTML = markup; body.dataset.entityKey = key; }
      body.querySelector('[data-agent-label]').textContent = ent.stateLabel;
      body.querySelector('[data-agent-health]').textContent = `❤️ ${Math.ceil(ent.hp)}/${ent.maxHp} • 🍎 หิว ${Math.round(ent.hunger)}%${ent.carryAmount ? ` • แบก${RESOURCE_INFO[ent.carryType].name} ${ent.carryAmount}` : ''}`;
      body.querySelector('[data-agent-thought]').textContent = mind.thought;
      body.querySelector('[data-agent-plan]').textContent = mind.plan;
      updateWorkerCommands();
      const btn = document.getElementById('btn-follow-agent'); if (btn) btn.onclick = () => { camCtrl.followEntity = ent; };
      const pCan = document.getElementById('insp-portrait-canvas');
      if (pCan) {
        const pCtx = pCan.getContext('2d');
        const roleSceneMap = {
          soldier: { key: 'military', sx: 110, sy: 35, sw: 170, sh: 170 },
          farmer: { key: 'famine', sx: 115, sy: 35, sw: 175, sh: 175 },
          fisherman: { key: 'famine', sx: 115, sy: 35, sw: 175, sh: 175 },
          merchant: { key: 'caravan', sx: 75, sy: 15, sw: 195, sh: 195 },
          child: { key: 'relic', sx: 65, sy: 190, sw: 160, sh: 160 },
          villager: { key: 'council', sx: 75, sy: 85, sw: 145, sh: 145 }
        };
        const mapInfo = roleSceneMap[ent.role] || roleSceneMap.farmer;
        const aiImg = useAiArtMode ? builtInAiImages[mapInfo.key] : null;
        if (aiImg && aiImg.complete && aiImg.naturalWidth > 0) {
          pCtx.drawImage(aiImg, mapInfo.sx, mapInfo.sy, mapInfo.sw, mapInfo.sh, 0, 0, 76, 76);
        } else {
          const bgG = pCtx.createLinearGradient(0, 0, 0, 76);
          bgG.addColorStop(0, ent.role === 'soldier' ? '#1e3a8a' : '#065f46');
          bgG.addColorStop(1, '#090d1a');
          pCtx.fillStyle = bgG; pCtx.fillRect(0, 0, 76, 76);
          const hatMap = { soldier: 'helmet', farmer: 'straw', merchant: 'merchant', child: 'child', villager: 'builder', fisherman: 'straw' };
          drawNpcPortraitHead(pCtx, 38, 46, 0.92, '#fcd34d', hatMap[ent.role] || 'straw', '#451a03', performance.now() * 0.001, true);
        }
      }
    } else {
      body.dataset.entityKey = '';
      body.innerHTML = `
        <div style="font-weight:800; color:#fde047; font-size:12.5px; margin-bottom:4px;">${ent.name}</div>
        ${ent.progress !== undefined ? `<div class="worker-order">${ent.progress < 1 ? `🔨 กำลังก่อสร้าง ${Math.floor(ent.progress * 100)}% · รอคนงานสร้างให้เสร็จ` : '✓ ก่อสร้างเสร็จแล้ว'}</div>` : ''}
        ${ent.hp ? `<div style="font-size:11px; color:#cbd5e1;">🛡️ <strong>ความทนทาน:</strong> ${Math.ceil(ent.hp)} / ${ent.maxHp}</div>` : ''}
        ${ent.species ? `<div style="font-size:11px; color:#34d399;">🌿 <strong>การเติบโต:</strong> ${Math.round(ent.growth * 100)}% ${ent.hasFruit ? '• 🍎 มีผลไม้สุกพร้อมเก็บ' : ''}</div>` : ''}
        ${ent.woodAmount ? `<div style="font-size:11px; color:#fbbf24;">🪵 <strong>ปริมาณไม้ซุง:</strong> ${ent.woodAmount} หน่วย</div>` : ''}
        ${ent.oreAmount !== undefined ? `<div style="font-size:11px; color:#38bdf8;">⛏️ <strong>ปริมาณแร่ศิลา:</strong> ${ent.oreAmount} หน่วย${ent.oreAmount === 0 ? ' · หมดแล้ว' : ''}</div>` : ''}
        <div style="margin-top:6px;"><button class="btn-mini" id="btn-focus-asset" style="width:100%;">🎥 ซูมดูรายละเอียด 3D ใกล้ๆ</button></div>`;
      const fBtn = document.getElementById('btn-focus-asset');
      if (fBtn) fBtn.onclick = () => {
        camCtrl.followEntity = ent;
        camCtrl.target.copy(ent.mesh.position);
        camCtrl.targetRadius = Math.min(camCtrl.targetRadius, 28);
      };
    }
  }

  function setGodPower(powerName) {
    economy?.reset();
    state.activePower = powerName;
    miracleTarget = null; reticleGroup.visible = false; updateMiraclePreview();
    document.querySelectorAll('.power-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.power === powerName));
    canvas.classList.toggle('power-active', powerName !== 'observe');
    document.getElementById('sub-power-bar').classList.toggle('visible', powerName === 'terraform');
    syncHudDockHeight();
  }
  document.querySelectorAll('.power-btn').forEach(btn => btn.addEventListener('click', () => { audio.init(); setGodPower(btn.dataset.power); }));
  document.getElementById('btn-terra-raise').addEventListener('click', () => { state.terraMode = 'raise'; document.getElementById('btn-terra-raise').classList.add('active'); document.getElementById('btn-terra-lower').classList.remove('active'); });
  document.getElementById('btn-terra-lower').addEventListener('click', () => { state.terraMode = 'lower'; document.getElementById('btn-terra-lower').classList.add('active'); document.getElementById('btn-terra-raise').classList.remove('active'); });
  document.getElementById('terra-radius').addEventListener('input', (e) => { state.terraRadius = parseFloat(e.target.value); });
  document.querySelectorAll('[data-speed]').forEach(btn => btn.addEventListener('click', () => {
    if (dilemmaActive && !document.getElementById('decision-card').hidden) dilemmaActive = false;
    state.timeScale = parseFloat(btn.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === (dilemmaActive ? 0 : state.timeScale)));
    decisionUI?.status(dilemmaActive, preDilemmaSpeed);
  }));
  document.getElementById('btn-jump-day').addEventListener('click', () => { state.timeOfDay = 9.0; document.getElementById('siege-banner').classList.remove('visible'); });
  document.getElementById('btn-jump-night').addEventListener('click', () => { state.timeOfDay = 20.25; state.isNight = false; state.siegeTriggeredTonight = false; });
  const btnRegen = document.getElementById('btn-regen-island'); if (btnRegen) btnRegen.addEventListener('click', () => { closeInteractiveDilemma(null, true); simplex.reseed(Math.floor(Math.random() * 999999)); userHeightOffsets.fill(0); buildFloatingIslandMeshes(); state.civEra = 1; state.civProgress = 12; populateWorld(1, true); evolveToEra(1); try { window.name = ''; localStorage.removeItem('AETHERIA_CIV_SAVE_V1'); } catch(e) {} addLog('🎲 สุ่มสร้างเกาะลอยฟ้าใบใหม่และเริ่มต้นยุคชนเผ่าเรียบร้อย!', 'bless'); });
  document.querySelectorAll('[data-era]').forEach(btn => btn.addEventListener('click', () => {
    audio.init();
    evolveToEra(parseInt(btn.dataset.era, 10));
  }));
  const btnAdvEra = document.getElementById('btn-advance-era');
  if (btnAdvEra) btnAdvEra.addEventListener('click', () => {
    audio.init();
    if (state.civEra < 4 && state.civProgress >= 100) evolveToEra(state.civEra + 1);
    else reportActionIssue(state.civEra >= 4 ? 'อารยธรรมอยู่ในยุคสูงสุดแล้ว' : `พัฒนายุคเมื่อความก้าวหน้าครบ 100% · ตอนนี้ ${Math.floor(state.civProgress)}%`);
  });

  document.getElementById('btn-spawn-villager').addEventListener('click', () => {
    audio.init();
    const issue = recruitmentIssue('villager', state, agents, buildings);
    if (issue) { reportActionIssue(issue); return; }
    state.faith -= 20; audio.playBlessChime();
    const a = Math.random() * Math.PI * 2, ag = createAgent(Math.cos(a) * 4, Math.sin(a) * 4, 'villager');
    addLog(`✨ ประทานพรกำเนิด ${ag.name} เข้าร่วมหมู่บ้าน!`, 'bless');
    showDilemmaToast(`เพิ่ม ${ag.name} แล้ว · ใช้ 20 ศรัทธา`); updateHUD();
  });
  document.getElementById('btn-train-soldier').addEventListener('click', () => {
    audio.init();
    const issue = recruitmentIssue('soldier', state, agents, buildings);
    if (issue) { reportActionIssue(issue); return; }
    state.faith -= 25; audio.playBlessChime();
    const civilian = agents.find(a => a.alive && a.role === 'villager' && !(a.carryAmount > 0));
    if (civilian) { const cx = civilian.x, cz = civilian.z; civilian.alive = false; worldObjectsGroup.remove(civilian.mesh); const sol = createAgent(cx, cz, 'soldier'); addLog(`🛡️ แต่งตั้งชาวบ้านขึ้นเป็น ${sol.name}!`, 'bless'); }
    else { const sol = createAgent(26, -18, 'soldier'); addLog(`🛡️ เสก ${sol.name} ลงมาพิทักษ์แนวหน้า!`, 'bless'); }
    showDilemmaToast('แต่งตั้งทหาร +1 แล้ว · ใช้ 25 ศรัทธา'); updateHUD();
  });
  document.getElementById('btn-toggle-audio').addEventListener('click', () => audio.toggle());
  document.getElementById('vol-wind').addEventListener('input', (e) => { audio.volWind = parseFloat(e.target.value) / 100; audio.updateVolumes(); });
  document.getElementById('vol-water').addEventListener('input', (e) => { audio.volWater = parseFloat(e.target.value) / 100; audio.updateVolumes(); });
  document.getElementById('vol-sfx').addEventListener('input', (e) => { audio.volSfx = parseFloat(e.target.value) / 100; });
  document.getElementById('btn-ring-bell').addEventListener('click', () => { audio.init(); audio.playVillageBell(false); addLog('🔔 เสียงระฆังมหาวิหารดังกังวานไปทั่วเกาะลอยฟ้า'); });
  document.getElementById('btn-cam-reset').addEventListener('click', () => camCtrl.reset());
  document.getElementById('btn-close-insp').addEventListener('click', () => { state.selectedEntity = null; camCtrl.followEntity = null; document.getElementById('inspector-card').classList.remove('visible'); });

  const clock = new THREE.Clock();
  const simulationClock = createFixedStepper();
  let elapsedTime = 0;

  function updateSimulation(dt, simulationTime) {
    updateDayNightCycle(dt);
    state.faith = Math.min(state.maxFaith, state.faith + dt * 0.45);
    if (state.civEra < 4 && dt > 0) {
      const eraSpeedDiv = state.civEra === 1 ? 1.0 : (state.civEra === 2 ? 1.45 : 1.95);
      state.civProgress = Math.min(100, state.civProgress + (dt * 0.35) / eraSpeedDiv);
      if (state.civProgress >= 100 && state.timeScale >= 5.0) evolveToEra(state.civEra + 1);
    }
    for (const t of trees) {
      if (t.growth < 1.0) {
        t.growth = Math.min(1.0, t.growth + dt * 0.012); t.mesh.scale.setScalar(t.growth);
        if (t.species === 'fruit' && t.growth >= 0.78 && !t.hasFruit) { t.hasFruit = true; t.fruitMeshes.forEach(fm => { fm.visible = true; }); }
      }
    }
    if (dt > 0) {
      for (const wg of wagons) {
        const target = wg.waypoints[wg.wpIndex];
        const dx = target[0] - wg.x, dz = target[1] - wg.z, dist = Math.hypot(dx, dz);
        if (dist < 1.2) {
          wg.wpIndex = (wg.wpIndex + 1) % wg.waypoints.length;
        } else {
          const step = Math.min(dist, wg.speed * dt);
          wg.x += (dx / dist) * step; wg.z += (dz / dist) * step;
          let wy = getTerrainHeightAt(wg.x, wg.z);
          for (const bz of [14.0, -16.0]) {
            if (Math.abs(wg.z - bz) <= 2.2 && Math.abs(wg.x - getRiverCenterX(bz)) <= getRiverWidth(bz) * 1.4 + 2.0) {
              wy = Math.max(wy, getWaterLevelAt(bz) + 1.05);
            }
          }
          wg.mesh.position.set(wg.x, wy, wg.z);
          wg.mesh.rotation.y = Math.atan2(dx, dz);
          wg.walkCycle += dt * 11.0;
          const s = Math.sin(wg.walkCycle) * 0.55;
          if (wg.horseLegs.length >= 4) {
            wg.horseLegs[0].rotation.x = s; wg.horseLegs[1].rotation.x = -s;
            wg.horseLegs[2].rotation.x = -s; wg.horseLegs[3].rotation.x = s;
          }
          for (const wh of wg.wheels) wh.rotation.x += step * 1.8;
        }
      }
      for (const an of livestock) {
        an.timer -= dt;
        if (an.timer <= 0) {
          an.timer = 2.5 + Math.random() * 4.0;
          const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 4.8;
          an.tx = an.homeX + Math.cos(a) * r; an.tz = an.homeZ + Math.sin(a) * r;
        }
        let dx = an.tx - an.x, dz = an.tz - an.z;
        for (const other of livestock) {
          if (other === an) continue;
          const ox = an.x - other.x, oz = an.z - other.z, od = Math.hypot(ox, oz);
          if (od < 1.85 && od > 0.01) { dx += (ox / od) * 2.5; dz += (oz / od) * 2.5; }
        }
        const dist = Math.hypot(dx, dz);
        if (dist > 0.25) {
          const step = Math.min(dist, an.speed * dt);
          an.x += (dx / dist) * step; an.z += (dz / dist) * step;
          const relX = an.x - an.homeX, relZ = an.z - an.homeZ, relD = Math.hypot(relX, relZ);
          if (relD > 6.4) { an.x = an.homeX + (relX / relD) * 6.4; an.z = an.homeZ + (relZ / relD) * 6.4; }
          an.mesh.position.set(an.x, getTerrainHeightAt(an.x, an.z), an.z);
          an.mesh.rotation.y = Math.atan2(dx, dz);
          an.walkCycle += dt * 9.0;
          const s = Math.sin(an.walkCycle) * 0.45;
          if (an.legs && an.legs.length >= 4) {
            an.legs[0].rotation.x = s; an.legs[1].rotation.x = -s;
            an.legs[2].rotation.x = -s; an.legs[3].rotation.x = s;
          }
        } else if (an.legs) {
          for (const lg of an.legs) lg.rotation.x = 0;
        }
      }
    }

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      if (p.type === 'meteor') {
        const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z, dist = Math.hypot(dx, dy, dz), step = p.speed * dt;
        p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 5;
        if (dist <= step + 1.2) { scene.remove(p.mesh); projectiles.splice(i, 1); detonateMeteor(p.tx, p.ty, p.tz); }
        else { p.x += (dx / dist) * step; p.y += (dy / dist) * step; p.z += (dz / dist) * step; p.mesh.position.set(p.x, p.y, p.z); }
      } else if (p.type === 'arcane_bolt') {
        if (!p.target || !p.target.alive) { scene.remove(p.mesh); projectiles.splice(i, 1); continue; }
        const ty = getTerrainHeightAt(p.target.x, p.target.z) + 1.0, dx = p.target.x - p.x, dy = ty - p.y, dz = p.target.z - p.z, dist = Math.hypot(dx, dy, dz), step = p.speed * dt;
        if (dist <= step + 0.6) {
          p.target.hp -= 28;
          if (p.target.hp <= 0) { p.target.alive = false; worldObjectsGroup.remove(p.target.mesh); state.faith = Math.min(state.maxFaith, state.faith + 5); }
          scene.remove(p.mesh); projectiles.splice(i, 1);
        } else { p.x += (dx / dist) * step; p.y += (dy / dist) * step; p.z += (dz / dist) * step; p.mesh.position.set(p.x, p.y, p.z); }
      }
    }

    updateAutonomousAgents(dt, simulationTime);
    updateMonstersAndTowers(dt, simulationTime);
  }

  function animate() {
    const rawDt = Math.min(clock.getDelta(), 0.05);
    const effectiveScale = dilemmaActive ? 0 : state.timeScale;
    elapsedTime += rawDt;

    camCtrl.update(rawDt);
    simulationClock.advance(rawDt, effectiveScale, (dt, simulationTime) => {
      updateSimulation(dt, simulationTime);
      return !dilemmaActive && state.timeScale > 0;
    });
    renderDayNightCycle();
    updateKingdomReadout(); updateMiraclePreview();
    audio.modulateAmbience(elapsedTime, camera.position.y);

    if (godFxPointLight.intensity > 0) godFxPointLight.intensity = Math.max(0, godFxPointLight.intensity - rawDt * 4.5);

    if (templeObj && templeObj.flameMesh) { templeObj.flameMesh.rotation.y += rawDt * 3.2; templeObj.flameMesh.scale.setScalar(0.9 + Math.sin(elapsedTime * 8) * 0.15); }
    if (portalRingMesh) portalRingMesh.rotation.z += rawDt * (state.isNight ? 3.5 : 0.8);

    // Animate Rotating Windmills, Bobbing Rowboats, Horse-Drawn Wagons & Grazing Livestock
    for (const wm of windmills) if (wm.rotor) wm.rotor.rotation.z -= rawDt * 1.35;
    for (const b of boats) b.mesh.position.y = b.baseY + Math.sin(elapsedTime * 2.4) * 0.12;
    for (const sa of skyAirships) {
      const spd = sa.orbitSpeed || 0.14;
      const cx = sa.centerX !== undefined ? sa.centerX : -8;
      const cz = sa.centerZ !== undefined ? sa.centerZ : 14;
      const rx = sa.radX || 18, rz = sa.radZ || 12;
      sa.orbitAngle += rawDt * spd;
      sa.x = cx + Math.cos(sa.orbitAngle) * rx;
      sa.z = cz + Math.sin(sa.orbitAngle) * rz;
      sa.mesh.position.set(sa.x, sa.baseY + Math.sin(elapsedTime * 1.8 + sa.orbitAngle) * 0.85, sa.z);
      const dirSign = spd >= 0 ? 1 : -1;
      sa.mesh.rotation.y = Math.atan2(-Math.sin(sa.orbitAngle) * rx * dirSign, Math.cos(sa.orbitAngle) * rz * dirSign);
      if (sa.propeller) sa.propeller.rotation.z += rawDt * 18.0;
      if (sa.burnerFlame) sa.burnerFlame.scale.setScalar(0.88 + Math.sin(elapsedTime * 14.0 + sa.orbitAngle) * 0.18);
    }
    if (ancientRelicObj) {
      ancientRelicObj.crystal.position.y = 3.2 + Math.sin(elapsedTime * 2.5) * 0.32;
      ancientRelicObj.crystal.rotation.y += rawDt * 0.9;
      ancientRelicObj.ring.rotation.z -= rawDt * 1.6;
      ancientRelicObj.gem.rotation.y -= rawDt * 2.4;
    }
    for (const sr of floatingRocks) {
      sr.ang += rawDt * sr.speed; sr.mesh.position.x = Math.cos(sr.ang) * sr.dist; sr.mesh.position.z = Math.sin(sr.ang) * sr.dist;
      sr.mesh.position.y = sr.yBase + Math.sin(elapsedTime * 1.4 + sr.phase) * 1.6; sr.mesh.rotation.y += rawDt * 0.25;
    }
    for (const cl of clouds) {
      cl.mesh.position.x += cl.speed * rawDt; if (cl.mesh.position.x > 135) cl.mesh.position.x = -135;
      cl.mesh.position.y += Math.sin(elapsedTime * 0.8 + cl.bobPhase) * 0.015;
    }

    const wfAttr = wfGeo.attributes.position;
    for (let i = 0; i < wfParticleCount; i++) {
      let x = wfAttr.getX(i) + wfVelocities[i].vx * rawDt, y = wfAttr.getY(i) + wfVelocities[i].vy * rawDt, z = wfAttr.getZ(i) + wfVelocities[i].vz * rawDt;
      wfVelocities[i].vy -= 14 * rawDt;
      if (y < wfLipY - 52) { x = wfLipX + (Math.random() - 0.5) * 6.2; y = wfLipY; z = wfLipZ + Math.random() * 1.5; wfVelocities[i].vy = -(10 + Math.random() * 10); }
      wfAttr.setXYZ(i, x, y, z);
    }
    wfAttr.needsUpdate = true;

    for (let i = fxParticles.length - 1; i >= 0; i--) {
      const fx = fxParticles[i]; fx.life -= rawDt;
      if (fx.life <= 0) { scene.remove(fx.mesh); fxParticles.splice(i, 1); continue; }
      const ratio = fx.life / fx.maxLife;
      if (fx.isShockwave) { fx.mesh.scale.setScalar(1 + (1 - ratio) * fx.maxRadius); if (fx.mesh.material) fx.mesh.material.opacity = ratio * 0.9; }
      else { fx.vy -= (fx.gravity || 0) * rawDt; fx.mesh.position.x += fx.vx * rawDt; fx.mesh.position.y += fx.vy * rawDt; fx.mesh.position.z += fx.vz * rawDt; if (fx.mesh.material && fx.mesh.material.transparent) fx.mesh.material.opacity = ratio; }
    }

    if (customReactionTimer > 0) customReactionTimer = Math.max(0, customReactionTimer - rawDt);
    if (pendingDilemmaIdx === null && state.timeScale > 0) {
      dilemmaTimer -= rawDt;
      if (dilemmaTimer <= 0) {
        dilemmaTimer = 42.0;
        openInteractiveDilemma(null, false, true);
      }
    }
    if (dilemmaActive && dilemmaOverlay.classList.contains('visible')) renderDilemmaSceneCanvas(elapsedTime);
    updateThoughtBubbles(elapsedTime);
    economy?.render();
    updateWorkerSelection();
    renderMinimap();

    state.sampleTimer += rawDt;
    if (state.sampleTimer >= 0.8) {
      state.sampleTimer = 0;
      state.historyPop.push(agents.filter(a => a.alive).length);
      state.historyRes.push(state.food + state.wood + state.ore);
      state.historyFaith.push(state.faith);
      if (state.historyPop.length > 40) { state.historyPop.shift(); state.historyRes.shift(); state.historyFaith.shift(); }
      drawAnalyticsChart(); updateHUD();
    }

    if (!dilemmaActive || !dilemmaOverlay.classList.contains('visible') || dilemmaOverlay.classList.contains("peek-3d") || ((Math.floor(elapsedTime * 60) % 6) === 0)) {
      renderer.render(scene, camera);
    }
    setTimeout(() => requestAnimationFrame(animate), 42);
  }


  // -------------------- COLLAPSIBLE & HIDEABLE HUD CONTROLLER --------------------
  let allHudHidden = false;
  const btnAllHud = document.getElementById('btn-toggle-all-hud');
  const btnTopHud = document.getElementById('btn-toggle-top-hud');
  const btnLeftHud = document.getElementById('btn-toggle-left-hud');
  const btnRightHud = document.getElementById('btn-toggle-right-hud');
  const btnBottomHud = document.getElementById('btn-toggle-bottom-hud');

  function setAllHudHidden(hidden) {
    allHudHidden = hidden;
    document.body.classList.toggle('hud-hidden', allHudHidden);
    if (btnAllHud) {
      btnAllHud.textContent = allHudHidden ? '👁️ แสดง HUD [H]' : '👁️ ซ่อน HUD ทั้งหมด [H]';
      btnAllHud.classList.toggle('active', allHudHidden);
    }
  }

  if (btnAllHud) btnAllHud.addEventListener('click', () => setAllHudHidden(!allHudHidden));
  if (btnTopHud) btnTopHud.addEventListener('click', () => {
    const hidden = document.getElementById('top-bar').classList.toggle('hud-panel-hidden-top');
    btnTopHud.classList.toggle('active', !hidden);
  });
  if (btnLeftHud) btnLeftHud.addEventListener('click', () => {
    const lp = document.getElementById('left-panel'), rp = document.getElementById('right-panel');
    const hidden = lp.classList.toggle('hud-panel-hidden-left');
    btnLeftHud.classList.toggle('active', !hidden);
    if (!hidden && window.innerWidth <= 960 && rp) { rp.classList.add('hud-panel-hidden-right'); if (btnRightHud) btnRightHud.classList.remove('active'); }
  });
  if (btnRightHud) btnRightHud.addEventListener('click', () => {
    const lp = document.getElementById('left-panel'), rp = document.getElementById('right-panel');
    const hidden = rp.classList.toggle('hud-panel-hidden-right');
    btnRightHud.classList.toggle('active', !hidden);
    if (!hidden && window.innerWidth <= 960 && lp) { lp.classList.add('hud-panel-hidden-left'); if (btnLeftHud) btnLeftHud.classList.remove('active'); }
  });
  if (btnBottomHud) btnBottomHud.addEventListener('click', () => {
    const hidden = document.getElementById('god-dock-wrapper').classList.toggle('hud-panel-hidden-bottom');
    btnBottomHud.classList.toggle('active', !hidden);
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') setAllHudHidden(!allHudHidden);
    if (e.code === 'Escape') { economy?.reset(); if (dilemmaActive) closeInteractiveDilemma('คำถามยังตอบได้บนหน้าจอ'); else { state.selectedEntity = null; camCtrl.followEntity = null; document.getElementById('inspector-card').classList.remove('visible'); } }
  });


  // -------------------- MOBILE MULTI-TOUCH & RESPONSIVE CONTROLLER --------------------


  // Quick Zoom & Camera Reset buttons for mobile thumb play
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnMobReset = document.getElementById('btn-mob-reset-cam');
  // Keep touch camera buttons above the variable-height resource/power dock.
  if (typeof ResizeObserver !== 'undefined') {
    const dock = document.getElementById('god-dock-wrapper');
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--power-dock-height', `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    }).observe(dock);
  }
  if (btnZoomIn) btnZoomIn.addEventListener('click', () => { camCtrl.targetRadius = Math.max(18, camCtrl.targetRadius - 16); });
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => { camCtrl.targetRadius = Math.min(280, camCtrl.targetRadius + 16); });
  if (btnMobReset) btnMobReset.addEventListener('click', () => {
    camCtrl.followEntity = null;
    camCtrl.target.set(0, 3, 4);
    camCtrl.targetRadius = 62;
    camCtrl.targetTheta = 0.52;
    camCtrl.targetPhi = 0.96;
  });

  // Full Multi-Touch Support on WebGL Canvas (1-Finger Orbit/Cast/Tap, 2-Finger Pinch-Zoom & 2-Finger Pan)
  let touchMode = null; // 'single' | 'pinch'
  let lastTouchX = 0, lastTouchY = 0;
  let touchMovedDist = 0, lastPinchDist = 0, lastMidX = 0, lastMidY = 0;

  canvas.addEventListener('touchstart', (e) => {
    audio.init();
    e.preventDefault();
    camCtrl.isDragging = false;
    if (e.touches.length === 1) {
      touchMode = 'single';
      const t = e.touches[0];
      lastTouchX = t.clientX;
      lastTouchY = t.clientY;
      touchMovedDist = 0;
      const pt = getTerrainIntersection(t);
      if (state.activePower !== 'observe' && pt) {
        reticleGroup.visible = true;
        reticleGroup.position.set(pt.x, pt.y + 0.35, pt.z);
        if (state.activePower === 'rain') castRainPower(pt.x, pt.z);
        else if (state.activePower === 'terraform') applyTerraforming(pt.x, pt.z, state.terraMode === 'lower' ? -1 : 1, 0.12);
        else if (state.activePower === 'meteor') castMeteorStrike(pt.x, pt.z);
        else if (state.activePower === 'lightning') castLightningStrike(pt.x, pt.z);
        else if (state.activePower === 'miracle') { miracleTarget = { x: pt.x, z: pt.z }; updateMiraclePreview(); }
      }
    } else if (e.touches.length >= 2) {
      touchMode = 'pinch';
      miracleTarget = null; reticleGroup.visible = false; updateMiraclePreview();
      const t0 = e.touches[0], t1 = e.touches[1];
      lastPinchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      lastMidX = (t0.clientX + t1.clientX) * 0.5;
      lastMidY = (t0.clientY + t1.clientY) * 0.5;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (touchMode === 'single' && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - lastTouchX, dy = t.clientY - lastTouchY;
      touchMovedDist += Math.hypot(dx, dy);
      lastTouchX = t.clientX; lastTouchY = t.clientY;

      if (state.activePower === 'observe') {
        camCtrl.targetTheta -= dx * 0.0075;
        camCtrl.targetPhi = THREE.MathUtils.clamp(camCtrl.targetPhi - dy * 0.0065, 0.28, 1.40);
      } else if (state.activePower === 'miracle') {
        const pt = document.elementFromPoint(t.clientX, t.clientY) === canvas ? getTerrainIntersection(t) : null;
        miracleTarget = pt ? { x: pt.x, z: pt.z } : null;
        if (!pt) reticleGroup.visible = false;
        updateMiraclePreview();
      } else if (state.activePower === 'terraform') {
        const pt = getTerrainIntersection(t);
        if (pt) {
          reticleGroup.visible = true;
          reticleGroup.position.set(pt.x, pt.y + 0.35, pt.z);
          applyTerraforming(pt.x, pt.z, state.terraMode === 'lower' ? -1 : 1, 0.08);
        }
      }
    } else if (e.touches.length >= 2) {
      touchMode = 'pinch';
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const midX = (t0.clientX + t1.clientX) * 0.5, midY = (t0.clientY + t1.clientY) * 0.5;

      const pinchDelta = lastPinchDist - dist;
      camCtrl.targetRadius = THREE.MathUtils.clamp(camCtrl.targetRadius + pinchDelta * 0.22, 18, 280);
      lastPinchDist = dist;

      const panDx = midX - lastMidX, panDz = midY - lastMidY;
      lastMidX = midX; lastMidY = midY;
      camCtrl.followEntity = null;
      const forwardX = -Math.sin(camCtrl.theta), forwardZ = -Math.cos(camCtrl.theta);
      const rightX = Math.cos(camCtrl.theta), rightZ = -Math.sin(camCtrl.theta);
      const panSpeed = camCtrl.radius * 0.0016;
      camCtrl.target.x = THREE.MathUtils.clamp(camCtrl.target.x - (rightX * panDx - forwardX * panDz) * panSpeed, -105, 105);
      camCtrl.target.z = THREE.MathUtils.clamp(camCtrl.target.z - (rightZ * panDx - forwardZ * panDz) * panSpeed, -105, 105);
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    // Aim while touching; release once to build. Pinch gestures cancel placement.
    if (touchMode === 'single' && e.touches.length === 0 && state.activePower === 'miracle') {
      const touch = e.changedTouches[0];
      const pt = touch && document.elementFromPoint(touch.clientX, touch.clientY) === canvas ? getTerrainIntersection(touch) : null;
      if (pt) castMiracleBeam(pt.x, pt.z);
    }
    if (touchMode === 'single' && touchMovedDist < 14 && state.activePower === 'observe') {
      if (economy?.handlePoint({ clientX: lastTouchX, clientY: lastTouchY })) { touchMode = null; return; }
      updatePointerRay({ clientX: lastTouchX, clientY: lastTouchY });
      const hits = raycaster.intersectObjects(worldObjectsGroup.children, true);
      let found = null;
      for (const h of hits) {
        let obj = h.object;
        while (obj && obj !== worldObjectsGroup) {
          if (obj.userData && obj.userData.entity) { found = obj.userData.entity; break; }
          obj = obj.parent;
        }
        if (found) break;
      }
      state.selectedEntity = found;
      if (found) {
        updateInspectorUI();
        document.getElementById('inspector-card').classList.add('visible');
      } else {
        document.getElementById('inspector-card').classList.remove('visible');
      }
    }
    if (e.touches.length === 0) {
      touchMode = null;
    }
  });
  canvas.addEventListener('touchcancel', () => { touchMode = null; miracleTarget = null; reticleGroup.visible = false; updateMiraclePreview(); });

  const workerSelection = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.42, 32), new THREE.MeshBasicMaterial({ color: 0x7dd3fc, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  workerSelection.rotation.x = -Math.PI / 2; workerSelection.visible = false; scene.add(workerSelection);
  function updateWorkerSelection() {
    const agent = state.selectedEntity;
    workerSelection.visible = !allHudHidden && state.activePower === 'observe' && agent?.type === 'agent' && agent.alive && agent.mesh.visible;
    if (workerSelection.visible) workerSelection.position.set(agent.x, getTerrainHeightAt(agent.x,agent.z)+0.18, agent.z);
  }
  economy = createEconomyControls({ window, state, agents, trees, ores, buildings, camCtrl,
    updateInspector: updateInspectorUI, updateWorkerCommands, updateLayout: syncHudDockHeight, updateHUD, issue: reportActionIssue, log: addLog, notify: showDilemmaToast,
    setObserve: () => setGodPower('observe'), placementIssue: getBuildingPlacementIssue,
    createBuilding: (type,x,z) => type === 'house' ? createHouse(x,z,0.05,state.civEra) : createWatchtower(x,z,0.05,state.civEra),
    terrainPoint: getTerrainIntersection,
    hideReticle: () => { reticleGroup.visible = false; },
    showReticle: (p,blocked) => { reticleGroup.visible = true; reticleGroup.position.set(p.x,getTerrainHeightAt(p.x,p.z)+0.35,p.z); reticleGroup.scale.setScalar(4.5); reticleRing.material.color.setHex(blocked ? 0xef4444 : 0x34d399); reticleFill.material.color.setHex(blocked ? 0xf87171 : 0x6ee7b7); },
    time: () => simulationClock.time, project: projectWorldToScreen, height: getTerrainHeightAt
  });

  window.AETHERIA_API = {
    get simulationTime() { return simulationClock.time; },
    // Copied camera pose for read-only diagnostics, including between render frames.
    get cameraView() { return { position: { ...camera.position }, target: { ...camera._lookTarget }, fov: camera.fov }; },
    economy, setAllHudHidden, evolveToEra, openInteractiveDilemma,
    isNearBuildingFoundation, getBuildingPlacementIssue, canPlaceBuildingAt, state, camCtrl, agents, monsters, projectiles, buildings, trees, ores, wagons, livestock, windmills, cropFields,
    setGodPower, castRainPower, applyTerraforming, castMeteorStrike, detonateMeteor, castLightningStrike, castMiracleBeam,
    spawnMonster, updateInspectorUI, drawAnalyticsChart, updateHUD, saveGameState, loadSavedGameState
  };

  loadSavedGameState(); drawAnalyticsChart(); updateHUD(); animate();
})();
