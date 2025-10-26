import * as THREE from 'three';
import type { Track } from '../types';

const avg = (arr: Uint8Array, s: number, e: number): number => {
  let sum = 0, n = 0;
  for (let i = s; i <= e && i < arr.length; i++) { sum += arr[i]; n++; }
  return n ? sum / n : 0;
};

// ===== Background gradient (kept soft) =====
const bgVS = `
  precision mediump float; precision mediump int;
  varying vec2 v_uv;
  void main(){
    v_uv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }
`;
const bgFS = `
  precision mediump float; precision mediump int;
  varying vec2 v_uv;
  uniform float u_time;
  uniform float u_bass;
  uniform vec3 u_color_a, u_color_b, u_color_c;

  float rand(vec2 n){ return fract(sin(dot(n, vec2(12.9898,4.1414))) * 43758.5453); }

  void main(){
    vec2 p = v_uv;
    vec2 p1 = p + 0.3*vec2(sin(u_time*0.3), cos(u_time*0.2));
    vec2 p2 = p + 0.4*vec2(cos(u_time*0.5), sin(u_time*0.4));
    vec2 p3 = p + 0.5*vec2(sin(u_time*0.7), cos(u_time*0.6));

    float d1 = length(p1 - vec2(0.2,0.8));
    float d2 = length(p2 - vec2(0.8,0.7));
    float d3 = length(p3 - vec2(0.5,0.2));

    float c1 = 1.0/(d1*20.0*(1.0 - u_bass*0.5));
    float c2 = 1.0/(d2*18.0*(1.0 - u_bass*0.4));
    float c3 = 1.0/(d3*22.0*(1.0 - u_bass*0.6));

    vec3 col = (c1*u_color_a + c2*u_color_b + c3*u_color_c)/(c1+c2+c3);
    col += (rand(p + u_time*0.1)-0.5)*0.06;
    gl_FragColor = vec4(col,1.0);
  }
`;

// ===== Ripple circles (one GL_POINT per circle) =====
const rippleVS = `
  precision mediump float; precision mediump int;
  attribute vec2 a_center;
  attribute float a_t0;
  attribute float a_dur;
  attribute float a_rmax;
  attribute vec3 a_colA;
  attribute vec3 a_colB;
  attribute vec3 a_colC;

  uniform float u_time;
  uniform float u_dpr;

  varying float v_life;
  varying vec3  v_colA;
  varying vec3  v_colB;
  varying vec3  v_colC;

  void main(){
    float life = clamp( (u_time - a_t0) / a_dur, 0.0, 1.0 );
    v_life = life;
    v_colA = a_colA; v_colB = a_colB; v_colC = a_colC;

    float radius = a_rmax * life;
    gl_PointSize = radius * 2.0 * u_dpr;

    gl_Position = vec4(a_center, 0.0, 1.0);
  }
`;
const rippleFS = `
  precision mediump float; precision mediump int;
  varying float v_life;
  varying vec3  v_colA;
  varying vec3  v_colB;
  varying vec3  v_colC;

  void main(){
    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv) * 2.0;

    float t = smoothstep(0.0, 1.0, r);
    vec3 col = mix(v_colA, v_colB, smoothstep(0.0, 0.45, t));
    col = mix(col, v_colC, smoothstep(0.45, 1.0, t));

    // Make the edge softer by starting the fade much earlier (from 70% of radius)
    float edge = 1.0 - smoothstep(0.70, 1.0, r);
    float alpha = (1.0 - v_life) * edge;
    gl_FragColor = vec4(col, alpha);

    if(gl_FragColor.a < 0.01) discard;
  }
`;

export class JourneyScene {
  private canvas: HTMLCanvasElement;
  private analyser: AnalyserNode;
  private track: Track;
  private dataArray: Uint8Array;
  private prevData: Uint8Array;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;

  // background
  private bgMesh!: THREE.Mesh;
  private bgUni!: { [k: string]: THREE.IUniform };

  // ripples
  private maxRipples = 96;
  private rGeometry!: THREE.BufferGeometry;
  private rPoints!: THREE.Points;
  private rUniforms!: { [k: string]: THREE.IUniform };

  // attribute arrays
  private a_center!: Float32Array;
  private a_t0!: Float32Array;
  private a_dur!: Float32Array;
  private a_rmax!: Float32Array;
  private a_colA!: Float32Array;
  private a_colB!: Float32Array;
  private a_colC!: Float32Array;

  private pool: number[] = [];
  private live: number[] = [];

  // Advanced beat detection
  private ema = 0;
  private cooldown = 0;
  private lastNow = performance.now();
  private animationFrameId = 0;

  // Onset detection
  private spectralFlux = 0;
  private fluxHistory: number[] = [];
  private readonly fluxHistorySize = 60;

  // Energy tracking per band
  private bassEma = 0;
  private midEma = 0;
  private highEma = 0;
  private prevBass = 0;
  private prevMid = 0;
  private prevHigh = 0;

  // Tempo estimation
  private beatIntervals: number[] = [];
  private lastBeatTime = 0;
  private bpmEstimate = 120;
  private bpmConfidence = 0;

  // Energy history for adaptive threshold
  private energyHistory: number[] = [];
  private readonly energyHistorySize = 90;

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode, track: Track) {
    this.canvas = canvas;
    this.analyser = analyser;
    this.track = track;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.prevData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  public init() {
    this.setupScene();
    this.setupBackground();
    this.setupRipples();
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    this.animate();
  }

  private setupScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x000000, 1);
  }

  private setupBackground() {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.bgUni = {
      u_time:   { value: 0 },
      u_bass:   { value: 0 },
      u_color_a:{ value: new THREE.Color(this.track.palette?.[0] ?? '#9be15d') },
      u_color_b:{ value: new THREE.Color(this.track.palette?.[1] ?? '#f9f871') },
      u_color_c:{ value: new THREE.Color(this.track.palette?.[2] ?? '#6cd4ff') },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.bgUni, vertexShader: bgVS, fragmentShader: bgFS, transparent: false });
    this.bgMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.bgMesh);
  }

  private setupRipples() {
    this.rGeometry = new THREE.BufferGeometry();

    this.a_center = new Float32Array(this.maxRipples * 2);
    this.a_t0     = new Float32Array(this.maxRipples);
    this.a_dur    = new Float32Array(this.maxRipples);
    this.a_rmax   = new Float32Array(this.maxRipples);
    this.a_colA   = new Float32Array(this.maxRipples * 3);
    this.a_colB   = new Float32Array(this.maxRipples * 3);
    this.a_colC   = new Float32Array(this.maxRipples * 3);

    for (let i = 0; i < this.maxRipples; i++) {
      this.a_center.set([999, 999], i * 2);
      this.a_t0[i]   = 1e9;
      this.a_dur[i]  = 1;
      this.a_rmax[i] = 0;
      this.a_colA.set([1,1,1], i*3);
      this.a_colB.set([1,1,1], i*3);
      this.a_colC.set([1,1,1], i*3);
      this.pool.push(i);
    }

    this.rGeometry.setAttribute('a_center', new THREE.BufferAttribute(this.a_center, 2));
    this.rGeometry.setAttribute('a_t0',     new THREE.BufferAttribute(this.a_t0, 1));
    this.rGeometry.setAttribute('a_dur',    new THREE.BufferAttribute(this.a_dur, 1));
    this.rGeometry.setAttribute('a_rmax',   new THREE.BufferAttribute(this.a_rmax, 1));
    this.rGeometry.setAttribute('a_colA',   new THREE.BufferAttribute(this.a_colA, 3));
    this.rGeometry.setAttribute('a_colB',   new THREE.BufferAttribute(this.a_colB, 3));
    this.rGeometry.setAttribute('a_colC',   new THREE.BufferAttribute(this.a_colC, 3));

    const dummyPos = new Float32Array(this.maxRipples * 3);
    this.rGeometry.setAttribute('position', new THREE.BufferAttribute(dummyPos, 3));
    this.rGeometry.setDrawRange(0, this.maxRipples);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.rUniforms = {
      u_time: { value: 0 },
      u_dpr:  { value: dpr },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.rUniforms,
      vertexShader: rippleVS,
      fragmentShader: rippleFS,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.rPoints = new THREE.Points(this.rGeometry, mat);
    this.rPoints.renderOrder = 1;
    this.rPoints.frustumCulled = false;
    this.scene.add(this.rPoints);
  }

  private spawnRipple(cx: number, cy: number, energy: number) {
    const i = this.pool.pop();
    if (i === undefined) return;
    this.live.push(i);

    const t = performance.now() * 0.001;
    
    // Size (rmax) is now directly and exponentially tied to the beat's energy.
    // A small base size ensures even quiet beats are visible.
    // The exponential part creates a huge difference between soft and loud beats.
    const rmax = 40 + 700 * Math.pow(energy, 4);

    // Duration is also linked to energy, making larger ripples last longer.
    const dur = 0.6 + energy * 1.4;

    const base = this.track.palette ?? ['#6bd3ff','#00c2a8','#c9f658'];
    const ca = new THREE.Color(base[Math.floor(Math.random()*base.length)]);
    const cb = new THREE.Color(base[Math.floor(Math.random()*base.length)]);
    const cc = new THREE.Color(base[Math.floor(Math.random()*base.length)]);

    this.a_center[i*2+0] = cx;
    this.a_center[i*2+1] = cy;
    this.a_t0[i]   = t;
    this.a_dur[i]  = dur;
    this.a_rmax[i] = rmax;

    this.a_colA[i*3+0]=ca.r; this.a_colA[i*3+1]=ca.g; this.a_colA[i*3+2]=ca.b;
    this.a_colB[i*3+0]=cb.r; this.a_colB[i*3+1]=cb.g; this.a_colB[i*3+2]=cb.b;
    this.a_colC[i*3+0]=cc.r; this.a_colC[i*3+1]=cc.g; this.a_colC[i*3+2]=cc.b;

    (this.rGeometry.getAttribute('a_center') as THREE.BufferAttribute).needsUpdate = true;
    (this.rGeometry.getAttribute('a_t0')     as THREE.BufferAttribute).needsUpdate = true;
    (this.rGeometry.getAttribute('a_dur')    as THREE.BufferAttribute).needsUpdate = true;
    (this.rGeometry.getAttribute('a_rmax')   as THREE.BufferAttribute).needsUpdate = true;
    (this.rGeometry.getAttribute('a_colA')   as THREE.BufferAttribute).needsUpdate = true;
    (this.rGeometry.getAttribute('a_colB')   as THREE.BufferAttribute).needsUpdate = true;
    (this.rGeometry.getAttribute('a_colC')   as THREE.BufferAttribute).needsUpdate = true;
  }

  private cullRipples(nowSec: number) {
    for (let k = this.live.length - 1; k >= 0; k--) {
      const i = this.live[k];
      const t0 = this.a_t0[i];
      const dur = this.a_dur[i];
      if (nowSec - t0 > dur) {
        this.a_center[i*2+0] = 999; this.a_center[i*2+1] = 999;
        (this.rGeometry.getAttribute('a_center') as THREE.BufferAttribute).needsUpdate = true;
        this.pool.push(i);
        this.live.splice(k, 1);
      }
    }
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    const now = performance.now();
    const nowSec = now * 0.001;
    const dtMs = now - this.lastNow; 
    this.lastNow = now;

    this.analyser.getByteFrequencyData(this.dataArray);
    const bass = avg(this.dataArray, 0, 32) / 255;
    const mid  = avg(this.dataArray, 32, 96) / 255;
    const high = avg(this.dataArray, 96, 200) / 255;

    this.bgUni.u_time.value = nowSec;
    this.bgUni.u_bass.value = bass;

    this.detectAndSpawnRipples(now, dtMs, bass, mid, high);

    this.rUniforms.u_time.value = nowSec;
    this.cullRipples(nowSec);

    this.prevData.set(this.dataArray);

    this.renderer.render(this.scene, this.camera);
  };

  private detectAndSpawnRipples(now: number, dtMs: number, bass: number, mid: number, high: number) {
    // Update EMAs per band
    const smoothing = 0.18;
    this.bassEma += (bass - this.bassEma) * smoothing;
    this.midEma += (mid - this.midEma) * smoothing;
    this.highEma += (high - this.highEma) * smoothing;

    // Calculate acceleration (급격한 변화)
    const bassAccel = bass - this.bassEma;
    const midAccel = mid - this.midEma;
    const highAccel = high - this.highEma;

    // 쿨다운
    const kickCooldown = (60000 / this.bpmEstimate) / 3.5;
    const otherCooldown = (60000 / this.bpmEstimate) / 4.5;
    if (this.cooldown > 0) this.cooldown -= dtMs;

    // KICK DRUM - 다층 감지 (초반/중반/후반 모두 대응)
    const condition1 = bassAccel > 0.04 && bass > 0.15;  // 상대적 증가
    const condition2 = bass > this.prevBass * 1.15 && bass > 0.18 && bassAccel > 0.015;  // 15% 점프
    const condition3 = bass > 0.3 && bassAccel > 0.01 && bass > this.prevBass;  // 후반 클라이막스
    
    const isStrongKick = condition1 || condition2 || condition3;

    if (isStrongKick && this.cooldown <= 0) {
      const cx = (Math.random() * 1.4 - 0.7);
      const cy = (Math.random() * 1.4 - 0.7);
      this.spawnRipple(cx, cy, bass);
      this.updateTempo(now);
      this.cooldown = kickCooldown;
    }
    // MID (스네어/클랩)
    else if (this.cooldown <= 0) {
      const isMidHit = (midAccel > 0.04 && mid > 0.12) ||
                       (mid > this.prevMid * 1.25 && mid > 0.15 && midAccel > 0.02);
      
      if (isMidHit) {
        const cx = (Math.random() * 1.6 - 0.8);
        const cy = (Math.random() * 1.6 - 0.8);
        this.spawnRipple(cx, cy, mid);
        this.cooldown = otherCooldown;
      }
    }
    // HIGH (하이햇)
    else if (this.cooldown <= 0) {
      const isHighHit = (highAccel > 0.045 && high > 0.12) ||
                        (high > this.prevHigh * 1.3 && high > 0.15 && highAccel > 0.025);
      
      if (isHighHit) {
        const cx = (Math.random() * 1.8 - 0.9);
        const cy = (Math.random() * 1.8 - 0.9);
        this.spawnRipple(cx, cy, high);
        this.cooldown = otherCooldown * 0.7;
      }
    }

    this.prevBass = bass;
    this.prevMid = mid;
    this.prevHigh = high;
  }

  private updateTempo(now: number) {
    if (this.lastBeatTime > 0) {
      const interval = now - this.lastBeatTime;
      
      if (interval > 200 && interval < 2000) {
        this.beatIntervals.push(interval);
        
        if (this.beatIntervals.length > 16) {
          this.beatIntervals.shift();
        }

        if (this.beatIntervals.length >= 4) {
          const sorted = [...this.beatIntervals].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const estimatedBPM = 60000 / median;

          this.bpmEstimate += (estimatedBPM - this.bpmEstimate) * 0.1;
          this.bpmConfidence = Math.min(1, this.beatIntervals.length / 16);
        }
      }
    }
    
    this.lastBeatTime = now;
  }

  private handleResize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { clientWidth, clientHeight } = this.canvas.parentElement || this.canvas;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(clientWidth, clientHeight, false);
    if (this.rUniforms) this.rUniforms.u_dpr.value = dpr;
  };

  public destroy() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.handleResize);
    this.bgMesh?.geometry.dispose();
    (this.bgMesh?.material as THREE.Material)?.dispose();
    this.rGeometry?.dispose();
    (this.rPoints?.material as THREE.Material)?.dispose();
    this.renderer?.dispose();
  }
}