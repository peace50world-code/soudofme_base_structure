import * as THREE from 'three';
import type { Track } from '../types';

const avg = (arr: Uint8Array, s: number, e: number): number => {
  let sum = 0, n = 0;
  for (let i = s; i <= e && i < arr.length; i++) { sum += arr[i]; n++; }
  return n ? sum / n : 0;
};

// Smoke particle shader
const smokeVS = `
  attribute float size;
  attribute float opacity;
  attribute vec3 color;
  
  varying float v_opacity;
  varying vec3 v_color;
  
  uniform float u_time;
  uniform float u_bass;
  
  void main() {
    v_opacity = opacity;
    v_color = color;
    
    vec3 pos = position;
    
    // Turbulent motion
    float turbulence = sin(u_time * 0.5 + position.x * 3.0) * 0.3 * u_bass;
    pos.x += turbulence;
    pos.z += cos(u_time * 0.3 + position.y * 2.0) * 0.2 * u_bass;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const smokeFS = `
  varying float v_opacity;
  varying vec3 v_color;
  
  void main() {
    // Soft circular gradient
    vec2 uv = gl_PointCoord - 0.5;
    float dist = length(uv);
    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
    alpha *= v_opacity;
    
    // Add some noise to edges
    float edge = smoothstep(0.3, 0.5, dist);
    alpha *= 1.0 - edge * 0.5;
    
    gl_FragColor = vec4(v_color, alpha);
  }
`;

// Background distortion shader
const bgVS = `
  varying vec2 v_uv;
  void main() {
    v_uv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const bgFS = `
  varying vec2 v_uv;
  uniform float u_time;
  uniform float u_bass;
  uniform float u_mid;
  uniform vec2 u_resolution;

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
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(st);
      st *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 st = v_uv;
    st.x *= u_resolution.x / u_resolution.y;
    
    // Slower, heavier flow
    float timeFlow = u_time * 0.08;
    
    // Distortion based on audio
    vec2 distortion = vec2(
      fbm(st * 2.0 + timeFlow) * u_bass * 0.3,
      fbm(st * 2.5 + timeFlow + 10.0) * u_mid * 0.2
    );
    
    st += distortion;
    
    // Multi-layer noise
    vec2 q = vec2(fbm(st + timeFlow), fbm(st + vec2(5.2, 1.3)));
    vec2 r = vec2(
      fbm(st + 3.0 * q + vec2(1.7, 9.2) + 0.1 * timeFlow),
      fbm(st + 3.0 * q + vec2(8.3, 2.8) + 0.08 * timeFlow)
    );
    
    float n = fbm(st + 3.0 * r);
    
    // Darker, more intense colors
    vec3 color1 = vec3(0.05, 0.0, 0.0);   // Very dark red
    vec3 color2 = vec3(0.3, 0.05, 0.0);   // Deep ember
    vec3 color3 = vec3(0.9, 0.3, 0.1);    // Hot orange
    vec3 color4 = vec3(1.0, 0.8, 0.4);    // Bright core
    
    vec3 color = mix(color1, color2, smoothstep(0.2, 0.4, n));
    color = mix(color, color3, smoothstep(0.4, 0.65, n));
    color = mix(color, color4, smoothstep(0.65, 0.8, n));
    
    // Pulsing highlights
    float pulse = sin(u_time * 2.0) * 0.5 + 0.5;
    float highlight = smoothstep(0.7, 0.85, n) * u_mid * pulse;
    color += highlight * vec3(1.0, 0.6, 0.2) * 0.6;
    
    // Vignette
    float vignette = smoothstep(0.8, 0.2, length(v_uv - 0.5));
    color *= vignette * 0.6 + 0.4;
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

class SmokeParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  size: number;
  opacity: number;
  life: number;
  maxLife: number;
  color: THREE.Color;

  constructor() {
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.size = 0;
    this.opacity = 0;
    this.life = 0;
    this.maxLife = 1;
    this.color = new THREE.Color();
  }

  reset(bass: number) {
    // Spawn from bottom
    this.position.set(
      (Math.random() - 0.5) * 4,
      -2,
      (Math.random() - 0.5) * 2
    );
    
    // Upward velocity with randomness
    this.velocity.set(
      (Math.random() - 0.5) * 0.3,
      0.4 + Math.random() * 0.6,
      (Math.random() - 0.5) * 0.2
    );
    
    this.size = 0.5 + Math.random() * 1.5 + bass * 2;
    this.opacity = 0;
    this.life = 0;
    this.maxLife = 3 + Math.random() * 4;
    
    // Color variation (ember to bright)
    const heat = Math.random();
    if (heat < 0.3) {
      this.color.setRGB(0.2, 0.02, 0.0); // Dark ember
    } else if (heat < 0.7) {
      this.color.setRGB(0.8, 0.2, 0.05); // Orange
    } else {
      this.color.setRGB(1.0, 0.6, 0.2); // Bright
    }
  }

  update(dt: number, bass: number, mid: number) {
    this.life += dt;
    
    // Fade in/out
    const lifeRatio = this.life / this.maxLife;
    if (lifeRatio < 0.2) {
      this.opacity = lifeRatio / 0.2;
    } else if (lifeRatio > 0.7) {
      this.opacity = 1.0 - (lifeRatio - 0.7) / 0.3;
    } else {
      this.opacity = 1.0;
    }
    
    // Slow down as it rises (viscous feel)
    this.velocity.y *= 0.98;
    this.velocity.x *= 0.99;
    this.velocity.z *= 0.99;
    
    // Audio influence
    this.velocity.x += (Math.random() - 0.5) * bass * 0.01;
    this.velocity.y += mid * 0.005;
    
    this.position.add(this.velocity.clone().multiplyScalar(dt));
    
    // Expand as it rises
    this.size += dt * 0.1;
    
    return lifeRatio < 1.0;
  }
}

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
  
  // Smoke particles
  private particles: SmokeParticle[] = [];
  private particleCount = 200;
  private smokeGeometry!: THREE.BufferGeometry;
  private smokePoints!: THREE.Points;
  private smokeUniforms!: { [k: string]: THREE.IUniform };
  
  private positions!: Float32Array;
  private sizes!: Float32Array;
  private opacities!: Float32Array;
  private colors!: Float32Array;

  private animationFrameId = 0;
  private lastTime = 0;
  
  // Audio smoothing
  private bassSmooth = 0;
  private midSmooth = 0;
  private trebleSmooth = 0;

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode, track: Track) {
    this.canvas = canvas;
    this.analyser = analyser;
    this.track = track;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  public init() {
    this.setupScene();
    this.setupBackground();
    this.setupSmoke();
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
    const geo = new THREE.PlaneGeometry(10, 10);
    this.bgUniforms = {
      u_time: { value: 0 },
      u_bass: { value: 0 },
      u_mid: { value: 0 },
      u_resolution: { value: new THREE.Vector2(1, 1) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.bgUniforms,
      vertexShader: bgVS,
      fragmentShader: bgFS,
      depthWrite: false,
    });
    this.bgMesh = new THREE.Mesh(geo, mat);
    this.bgMesh.position.z = -5;
    this.scene.add(this.bgMesh);
  }

  private setupSmoke() {
    // Initialize particles
    for (let i = 0; i < this.particleCount; i++) {
      const p = new SmokeParticle();
      p.reset(0);
      p.life = Math.random() * p.maxLife; // Stagger
      this.particles.push(p);
    }
    
    // Buffers
    this.positions = new Float32Array(this.particleCount * 3);
    this.sizes = new Float32Array(this.particleCount);
    this.opacities = new Float32Array(this.particleCount);
    this.colors = new Float32Array(this.particleCount * 3);
    
    this.smokeGeometry = new THREE.BufferGeometry();
    this.smokeGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.smokeGeometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.smokeGeometry.setAttribute('opacity', new THREE.BufferAttribute(this.opacities, 1));
    this.smokeGeometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    
    this.smokeUniforms = {
      u_time: { value: 0 },
      u_bass: { value: 0 },
    };
    
    const mat = new THREE.ShaderMaterial({
      uniforms: this.smokeUniforms,
      vertexShader: smokeVS,
      fragmentShader: smokeFS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    
    this.smokePoints = new THREE.Points(this.smokeGeometry, mat);
    this.scene.add(this.smokePoints);
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
    const treble = avg(this.dataArray, 150, 400) / 255;
    
    // Smooth
    const smoothing = 0.1;
    this.bassSmooth += (bass - this.bassSmooth) * smoothing;
    this.midSmooth += (mid - this.midSmooth) * smoothing;
    this.trebleSmooth += (treble - this.trebleSmooth) * smoothing;
    
    // Update background
    this.bgUniforms.u_time.value = time;
    this.bgUniforms.u_bass.value = this.bassSmooth;
    this.bgUniforms.u_mid.value = this.midSmooth;
    
    // Update smoke
    this.smokeUniforms.u_time.value = time;
    this.smokeUniforms.u_bass.value = this.bassSmooth;
    
    // Update particles
    for (let i = 0; i < this.particleCount; i++) {
      const p = this.particles[i];
      const alive = p.update(dt, this.bassSmooth, this.midSmooth);
      
      if (!alive) {
        p.reset(this.bassSmooth);
      }
      
      // Update buffers
      this.positions[i * 3 + 0] = p.position.x;
      this.positions[i * 3 + 1] = p.position.y;
      this.positions[i * 3 + 2] = p.position.z;
      this.sizes[i] = p.size;
      this.opacities[i] = p.opacity * 0.4;
      this.colors[i * 3 + 0] = p.color.r;
      this.colors[i * 3 + 1] = p.color.g;
      this.colors[i * 3 + 2] = p.color.b;
    }
    
    (this.smokeGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.smokeGeometry.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (this.smokeGeometry.attributes.opacity as THREE.BufferAttribute).needsUpdate = true;
    (this.smokeGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
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
    this.smokeGeometry?.dispose();
    (this.smokePoints?.material as THREE.Material)?.dispose();
    this.renderer?.dispose();
  }
}