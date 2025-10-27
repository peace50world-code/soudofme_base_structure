import * as THREE from 'three';
import type { Track } from '../types';

const avg = (arr: Uint8Array, s: number, e: number): number => {
  let sum = 0, n = 0;
  for (let i = s; i <= e && i < arr.length; i++) { sum += arr[i]; n++; }
  return n ? sum / n : 0;
};

/* ---------------------------- FBM Noise Functions ---------------------------- */
const fbmFunctions = `
  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.y * u.x;
  }

  float fbm(vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(st);
      st *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }
`;

/* ---------------------------- BACKGROUND SHADERS ---------------------------- */
const bgVS = `
  varying vec2 v_uv;
  void main() {
    v_uv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const bgFS = `
  varying vec2 v_uv;
  uniform float u_time;
  uniform float u_bass;
  uniform float u_intense_beat;
  uniform vec2 u_resolution;

  ${fbmFunctions}

  void main() {
    vec2 st = v_uv;

    // Intense beat pulse from center
    vec2 centered_st = st - 0.5;
    float dist = length(centered_st);
    float spread_factor = u_intense_beat * pow(1.0 - smoothstep(0.0, 0.9, dist), 3.0) * 0.5;
    st -= centered_st * spread_factor;

    float aspect = u_resolution.x / u_resolution.y;
    st = (st - 0.5) * vec2(aspect, 1.0) + 0.5;
    
    float timeFlow = u_time * 0.07;

    // Base flowing pattern
    vec2 st_flow = st * 1.2;
    vec2 q_flow = vec2(fbm(st_flow + timeFlow), fbm(st_flow + vec2(5.2, 1.3)));
    vec2 r_flow = vec2(
      fbm(st_flow + 1.5 * q_flow + vec2(1.7, 9.2) + 0.15 * timeFlow),
      fbm(st_flow + 1.5 * q_flow + vec2(8.3, 2.8) + 0.12 * timeFlow)
    );
    float n = fbm(st_flow + 2.0 * r_flow);

    // Coloring
    vec3 color_bg = vec3(0.02, 0.0, 0.0);
    vec3 color_red = vec3(0.8, 0.05, 0.0);
    vec3 color_orange = vec3(1.0, 0.4, 0.0);
    vec3 color_yellow_core = vec3(1.0, 0.9, 0.4);

    vec3 color = mix(color_bg, color_red, smoothstep(0.35, 0.45, n));
    color = mix(color, color_orange, smoothstep(0.45, 0.55, n));
    color = mix(color, color_yellow_core, smoothstep(0.55, 0.65, n));

    float grain = (random(v_uv * (u_time + 1.0)) - 0.5) * 0.1;
    color += grain;

    float vignette = smoothstep(1.0, 0.4, length(v_uv - 0.5));
    color *= vignette * 0.8 + 0.2;

    color *= 1.0 + u_intense_beat * 0.6;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

function bandFlux(cur: Uint8Array, prev: Float32Array, s: number, e: number): number {
  let flux = 0;
  for (let i = s; i <= e && i < cur.length; i++) {
    const d = cur[i] - prev[i];
    if (d > 0) flux += d;
  }
  return flux / Math.max(1, e - s + 1);
}

export class BelieverScene {
  private canvas: HTMLCanvasElement;
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  
  private bgMesh!: THREE.Mesh;
  private bgUniforms!: { [k: string]: THREE.IUniform };
  
  private animationFrameId = 0;
  private prevSpectrum!: Float32Array;
  private fluxHistory: number[] = [];
  private readonly fluxWindow = 43;
  private lastBeatTime = 0;
  private intenseBeatEnv = 0;

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode, track: Track) {
    this.canvas = canvas;
    this.analyser = analyser;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.prevSpectrum = new Float32Array(this.analyser.frequencyBinCount);
  }

  public init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 1);

    this.setupBackground();

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    this.animate();
  }

  private setupBackground() {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.bgUniforms = {
      u_time: { value: 0 },
      u_bass: { value: 0 },
      u_intense_beat: { value: 0 },
      u_resolution: { value: new THREE.Vector2(1, 1) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.bgUniforms,
      vertexShader: bgVS,
      fragmentShader: bgFS,
    });
    this.bgMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.bgMesh);
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    const now = performance.now() * 0.001;
    this.analyser.getByteFrequencyData(this.dataArray);
    this.update(now);
    this.renderer.render(this.scene, this.camera);
  };

  private update(time: number) {
    const bass = avg(this.dataArray, 0, 32) / 255;
    const flux = bandFlux(this.dataArray, this.prevSpectrum, 2, Math.min(64, this.dataArray.length - 1));
    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > this.fluxWindow) this.fluxHistory.shift();

    const n = this.fluxHistory.length || 1;
    const mean = this.fluxHistory.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(this.fluxHistory.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
    
    const intenseThreshold = mean + 4.5 * std;
    const refractoryMs = 200;
    
    const nowMs = time * 1000;
    if (nowMs - this.lastBeatTime > refractoryMs) {
      if (flux > intenseThreshold && bass > 0.4) {
        this.intenseBeatEnv = 1.0;
        this.lastBeatTime = nowMs;
      }
    }

    this.intenseBeatEnv *= 0.92; // Decay
    
    for (let i = 0; i < this.dataArray.length; i++) this.prevSpectrum[i] = this.dataArray[i];
    
    this.bgUniforms.u_time.value = time;
    this.bgUniforms.u_bass.value = bass;
    this.bgUniforms.u_intense_beat.value = this.intenseBeatEnv;
  }

  private handleResize = () => {
    const { clientWidth, clientHeight } = this.canvas.parentElement || this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.bgUniforms.u_resolution.value.set(clientWidth, clientHeight);
  };

  public destroy() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.handleResize);
    this.bgMesh?.geometry.dispose();
    (this.bgMesh?.material as THREE.Material)?.dispose();
    this.renderer?.dispose();
  }
}