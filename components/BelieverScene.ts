import * as THREE from 'three';
import type { Track } from '../types';

const avg = (arr: Uint8Array, s: number, e: number): number => {
  let sum = 0, n = 0;
  for (let i = s; i <= e && i < arr.length; i++) { sum += arr[i]; n++; }
  return n ? sum / n : 0;
};

// Background distortion shader
const bgVS = `
  varying vec2 v_uv;
  void main() {
    v_uv = uv;
    // Directly output clip space coordinates for a fullscreen quad.
    // This bypasses camera projection, making it always fill the screen.
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
    for (int i = 0; i < 4; i++) { // Reduced octaves for smoother noise
      value += amplitude * noise(st);
      st *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 st = v_uv;

    // 1. Correct aspect ratio and apply a more subtle vertical stretch
    float aspect = u_resolution.x / u_resolution.y;
    st = (st - 0.5) * vec2(aspect, 1.0) + 0.5;
    st.y = (st.y - 0.5) * 1.8 + 0.5;

    // 2. Music-reactive horizontal movement (sway)
    st.x += sin(u_time * 0.4) * u_mid * 0.2;

    // Beat-driven zoom/push from center
    vec2 dir = st - vec2(0.5);
    float dist = length(dir);
    float push_amount = u_beat * 0.3 * smoothstep(0.6, 0.0, dist);
    st -= normalize(dir) * push_amount;
    float beat_zoom = 1.0 - u_beat * 0.2;
    st = (st - 0.5) * beat_zoom + 0.5;
    
    // 3. Music-reactive flow speed
    float timeFlow = u_flow_time * 0.7;
    
    // --- PATTERN GENERATION ---

    // A. The smooth, flowing base pattern
    vec2 st_flow = st * 1.2;
    vec2 q_flow = vec2(fbm(st_flow + timeFlow), fbm(st_flow + vec2(5.2, 1.3)));
    vec2 r_flow = vec2(
      fbm(st_flow + 1.5 * q_flow + vec2(1.7, 9.2) + 0.15 * timeFlow),
      fbm(st_flow + 1.5 * q_flow + vec2(8.3, 2.8) + 0.12 * timeFlow)
    );
    float n_flow = fbm(st_flow + 2.0 * r_flow);

    // B. The chaotic, explosive beat pattern
    vec2 st_beat = st * 3.5; 
    vec2 q_beat = vec2(fbm(st_beat + u_time * 2.0), fbm(st_beat + vec2(3.1, 4.2)));
    vec2 r_beat = vec2(
      fbm(st_beat + 2.0 * q_beat + vec2(6.7, 2.2) + 0.2 * u_time * 2.0),
      fbm(st_beat + 2.0 * q_beat + vec2(1.3, 7.8) + 0.18 * u_time * 2.0)
    );
    float n_beat = fbm(st_beat + 2.5 * r_beat);

    // C. Mix between the two patterns based on the beat
    float n = mix(n_flow, n_beat, u_beat);
    
    // Multi-layered color palette for depth and clarity
    vec3 color_bg = vec3(0.02, 0.0, 0.0);
    vec3 color_red = vec3(0.8, 0.05, 0.0);
    vec3 color_orange = vec3(1.0, 0.4, 0.0);
    vec3 color_yellow_core = vec3(1.0, 0.9, 0.4);

    // Sharper, more defined color transitions for better shape definition
    vec3 color = mix(color_bg, color_red, smoothstep(0.35, 0.45, n));
    color = mix(color, color_orange, smoothstep(0.45, 0.55, n));
    
    // The 'hot' core expands and brightens with the beat
    float core_mix = smoothstep(0.55, 0.65 + u_beat * 0.15, n);
    color = mix(color, color_yellow_core, core_mix);

    // Add subtle grain for texture
    float grain = (random(v_uv * (u_time + 1.0)) - 0.5) * 0.1;
    color += grain;
    
    // Vignette to focus the center
    float vignette = smoothstep(1.0, 0.4, length(v_uv - 0.5));
    color *= vignette * 0.8 + 0.2;
    
    // Overall brightness pulse on beat
    color *= 1.0 + u_beat * 0.5;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

export class BelieverScene {
  private canvas: HTMLCanvasElement;
  private analyser: AnalyserNode;
  private track: Track;
  private dataArray: Uint8Array;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  
  // Background
  private bgMesh!: THREE.Mesh;
  private bgUniforms!: { [k: string]: THREE.IUniform };
  
  private animationFrameId = 0;
  private lastTime = 0;
  private flowTime = 0;
  
  // Audio smoothing
  private bassSmooth = 0;
  private midSmooth = 0;

  // Beat detection
  private beat = 0;
  private prevBass = 0;

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode, track: Track) {
    this.canvas = canvas;
    this.analyser = analyser;
    this.track = track;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  public init() {
    this.setupScene();
    this.setupBackground();
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    this.lastTime = performance.now();
    this.animate();
  }

  private setupScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    this.camera.position.z = 3;
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: this.canvas, 
      antialias: false,
      alpha: false 
    });
    this.renderer.setClearColor(0x000000, 1);
  }

  private setupBackground() {
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
    // Audio analysis
    const bass = avg(this.dataArray, 0, 32) / 255;
    const mid = avg(this.dataArray, 40, 120) / 255;
    
    // Smooth values for general flow
    const smoothing = 0.1;
    this.bassSmooth += (bass - this.bassSmooth) * smoothing;
    this.midSmooth += (mid - this.midSmooth) * smoothing;
    
    // Music-driven flow time, almost entirely dependent on audio energy.
    this.flowTime += dt * (0.01 + this.bassSmooth * 0.5 + this.midSmooth * 0.25);

    // Beat detection
    const bassOnset = Math.max(0, bass - this.prevBass);
    if (bassOnset > 0.05 && bass > 0.4) {
        this.beat = 1.0;
    }
    this.beat *= 0.92; // decay
    this.prevBass = bass;

    // Update uniforms
    this.bgUniforms.u_time.value = time;
    this.bgUniforms.u_bass.value = this.bassSmooth;
    this.bgUniforms.u_mid.value = this.midSmooth;
    this.bgUniforms.u_beat.value = this.beat;
    this.bgUniforms.u_flow_time.value = this.flowTime;
  }

  private handleResize = () => {
    const { clientWidth, clientHeight } = this.canvas.parentElement || this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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