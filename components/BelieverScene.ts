import * as THREE from 'three';
import type { Track } from '../types';

const avg = (arr: Uint8Array, s: number, e: number): number => {
  let sum = 0, n = 0;
  for (let i = s; i <= e && i < arr.length; i++) { sum += arr[i]; n++; }
  return n ? sum / n : 0;
};

/* ---------------------------- SHADERS ---------------------------- */
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
  uniform float u_mid;
  uniform float u_beat;
  uniform vec2 u_resolution;
  uniform float u_flow_time;

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

  void main() {
    vec2 st = v_uv;
    float aspect = u_resolution.x / u_resolution.y;
    st = (st - 0.5) * vec2(aspect, 1.0) + 0.5;
    st.y = (st.y - 0.5) * 1.8 + 0.5;
    st.x += sin(u_time * 0.4) * u_mid * 0.2;

    float timeFlow = u_flow_time * 0.7;

    // --- Base flowing pattern (n_flow) ---
    vec2 st_flow = st * 1.2;
    vec2 q_flow = vec2(fbm(st_flow + timeFlow), fbm(st_flow + vec2(5.2, 1.3)));
    vec2 r_flow = vec2(
      fbm(st_flow + 1.5 * q_flow + vec2(1.7, 9.2) + 0.15 * timeFlow),
      fbm(st_flow + 1.5 * q_flow + vec2(8.3, 2.8) + 0.12 * timeFlow)
    );
    float n_flow = fbm(st_flow + 2.0 * r_flow);

    // --- New pattern on beat (n_beat) ---
    vec2 st_beat = st * 2.5;
    vec2 q_beat = vec2(fbm(st_beat + u_time * 2.0), fbm(st_beat + vec2(6.1, 7.3)));
    vec2 r_beat = vec2(
      fbm(st_beat + 2.0 * q_beat + vec2(3.4, 4.2) + 0.3 * u_time),
      fbm(st_beat + 2.0 * q_beat + vec2(9.5, 6.8) + 0.2 * u_time)
    );
    float n_beat = fbm(st_beat + 3.0 * r_beat);

    // --- Mix patterns based on beat envelope ---
    float beat_mix = smoothstep(0.0, 0.5, u_beat);
    float n = mix(n_flow, n_beat, beat_mix);


    // --- Coloring ---
    vec3 color_bg = vec3(0.02, 0.0, 0.0);
    vec3 color_red = vec3(0.8, 0.05, 0.0);
    vec3 color_orange = vec3(1.0, 0.4, 0.0);
    vec3 color_yellow_core = vec3(1.0, 0.9, 0.4);

    vec3 color = mix(color_bg, color_red, smoothstep(0.35, 0.45, n));
    color = mix(color, color_orange, smoothstep(0.45, 0.55, n));

    float core_mix = smoothstep(0.55, 0.65 + u_beat * 0.15, n);
    color = mix(color, color_yellow_core, core_mix);

    float grain = (random(v_uv * (u_time + 1.0)) - 0.5) * 0.1;
    color += grain;

    float vignette = smoothstep(1.0, 0.4, length(v_uv - 0.5));
    color *= vignette * 0.8 + 0.2;

    color *= 1.0 + u_beat * 0.5;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

function bandFlux(cur: Uint8Array, prev: Float32Array, s: number, e: number): number {
  let flux = 0;
  for (let i = s; i <= e && i < cur.length; i++) {
    const d = cur[i] - prev[i];
    if (d > 0) {
      const w = 1 + (s + (e - i)) / (e - s + 1);
      flux += d * w;
    }
  }
  return flux / Math.max(1, e - s + 1);
}

export class BelieverScene {
  private canvas: HTMLCanvasElement;
  private analyser: AnalyserNode;
  private track: Track;
  private dataArray: Uint8Array;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  private bgMesh!: THREE.Mesh;
  private bgUniforms!: { [k: string]: THREE.IUniform };

  private animationFrameId = 0;
  private lastTime = 0;
  private flowTime = 0;

  private bassSmooth = 0;
  private midSmooth = 0;

  private prevSpectrum!: Float32Array;
  private fluxHistory: number[] = [];
  private fluxWindow = 43;
  private refractoryMs = 120;
  private lastBeatTime = 0;
  private beatEnv = 0;
  private release = 0.88; // Decay factor for envelopes

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode, track: Track) {
    this.canvas = canvas;
    this.analyser = analyser;
    this.track = track;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.prevSpectrum = new Float32Array(this.analyser.frequencyBinCount);
  }

  public init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    this.camera.position.z = 3;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.setClearColor(0x000000, 1);

    const geo = new THREE.PlaneGeometry(2, 2);
    this.bgUniforms = {
      u_time: { value: 0 },
      u_bass: { value: 0 },
      u_mid: { value: 0 },
      u_beat: { value: 0 },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_flow_time: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.bgUniforms,
      vertexShader: bgVS,
      fragmentShader: bgFS,
      depthWrite: false,
      depthTest: false,
    });
    this.bgMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.bgMesh);

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    this.lastTime = performance.now();
    this.animate();
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    this.analyser.getByteFrequencyData(this.dataArray);
    this.update(dt, now * 0.001);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number, time: number) {
    const bass = avg(this.dataArray, 0, 32) / 255;
    const mid = avg(this.dataArray, 40, 120) / 255;

    const s = 0.12;
    this.bassSmooth += (bass - this.bassSmooth) * s;
    this.midSmooth += (mid - this.midSmooth) * s;

    const flux = bandFlux(this.dataArray, this.prevSpectrum, 2, Math.min(64, this.dataArray.length - 1));
    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > this.fluxWindow) this.fluxHistory.shift();

    let mean = 0, sq = 0;
    for (const v of this.fluxHistory) { mean += v; sq += v * v; }
    const n = this.fluxHistory.length || 1;
    mean /= n;
    const variance = Math.max(0, sq / n - mean * mean);
    const std = Math.sqrt(variance);
    const threshold = mean + 1.0 * std;

    let isBeat = false;
    if (flux > threshold) {
      const nowMs = performance.now();
      if (nowMs - this.lastBeatTime > this.refractoryMs) {
        isBeat = true;
        this.lastBeatTime = nowMs;
      }
    }

    // Beat envelope for mixing patterns
    if (isBeat) {
      this.beatEnv = 1.0;
    } else {
      this.beatEnv *= this.release;
    }

    for (let i = 0; i < this.dataArray.length; i++) {
      this.prevSpectrum[i] = this.dataArray[i];
    }

    // The flow speed is now independent of the beat.
    // The beat's visual impact comes from pattern mixing in the shader.
    const baseFlowSpeed = 0.01 + this.bassSmooth * 0.5 + this.midSmooth * 0.25;
    this.flowTime += dt * baseFlowSpeed;

    this.bgUniforms.u_time.value = time;
    this.bgUniforms.u_bass.value = this.bassSmooth;
    this.bgUniforms.u_mid.value = this.midSmooth;
    this.bgUniforms.u_beat.value = this.beatEnv;
    this.bgUniforms.u_flow_time.value = this.flowTime;
  }

  private handleResize = () => {
    const { clientWidth, clientHeight } = this.canvas.parentElement || this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
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
