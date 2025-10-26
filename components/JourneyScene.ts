import * as THREE from 'three';
import type { Track } from '../types';

const avg = (arr: Uint8Array, s: number, e: number): number => {
  let sum = 0, n = 0;
  for (let i = s; i <= e && i < arr.length; i++) { sum += arr[i]; n++; }
  return n ? sum / n : 0;
};

// --- GLSL SHADER CODE ---

const vertexShader = `
  varying vec2 v_uv;
  void main() {
    v_uv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 v_uv;
  uniform float u_time;
  uniform float u_bass;
  uniform vec3 u_color_a;
  uniform vec3 u_color_b;
  uniform vec3 u_color_c;

  // Function to generate a random float from a 2D vector
  float rand(vec2 n) { 
    return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
  }

  void main() {
    vec2 p = v_uv;
    
    // Create moving "light blob" positions
    vec2 p1 = p + 0.3 * vec2(sin(u_time * 0.3), cos(u_time * 0.2));
    vec2 p2 = p + 0.4 * vec2(cos(u_time * 0.5), sin(u_time * 0.4));
    vec2 p3 = p + 0.5 * vec2(sin(u_time * 0.7), cos(u_time * 0.6));

    // Calculate distance to blobs, influenced by bass
    float d1 = length(p1 - vec2(0.2, 0.8));
    float d2 = length(p2 - vec2(0.8, 0.7));
    float d3 = length(p3 - vec2(0.5, 0.2));

    // Calculate color contributions from each blob
    float c1 = 1.0 / (d1 * 20.0 * (1.0 - u_bass * 0.5));
    float c2 = 1.0 / (d2 * 18.0 * (1.0 - u_bass * 0.4));
    float c3 = 1.0 / (d3 * 22.0 * (1.0 - u_bass * 0.6));

    // Mix the colors based on contributions
    vec3 color = (c1 * u_color_a + c2 * u_color_b + c3 * u_color_c) / (c1 + c2 + c3);

    // Add grain
    float grain = (rand(v_uv * u_time) - 0.5) * 0.1;
    color += grain;

    gl_FragColor = vec4(color, 1.0);
  }
`;


export class JourneyScene {
  private canvas: HTMLCanvasElement;
  private analyser: AnalyserNode;
  private track: Track;
  private dataArray: Uint8Array;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  
  private mesh!: THREE.Mesh;
  private uniforms!: { [uniform: string]: THREE.IUniform };

  private animationFrameId = 0;

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode, track: Track) {
    this.canvas = canvas;
    this.analyser = analyser;
    this.track = track;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  public init() {
    this.setupScene();
    this.setupMesh();
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    this.animate();
  }

  private setupScene() {
    this.scene = new THREE.Scene();
    // Use orthographic camera for a 2D plane
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
  }

  private setupMesh() {
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.uniforms = {
      u_time: { value: 0.0 },
      u_bass: { value: 0.0 },
      u_color_a: { value: new THREE.Color(this.track.palette[0] ?? '#9be15d') }, // Green
      u_color_b: { value: new THREE.Color(this.track.palette[1] ?? '#f9f871') }, // Yellow
      u_color_c: { value: new THREE.Color(this.track.palette[2] ?? '#6cd4ff') }, // Blue
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);
  }
  
  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.analyser.getByteFrequencyData(this.dataArray);
    this.update();
    this.renderer.render(this.scene, this.camera);
  };

  private update() {
    const time = performance.now() * 0.0005;
    const bass = avg(this.dataArray, 0, 16) / 255;

    this.uniforms.u_time.value = time;
    this.uniforms.u_bass.value = bass;
  }

  private handleResize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { clientWidth, clientHeight } = this.canvas.parentElement || this.canvas;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(clientWidth, clientHeight, false);
  };

  public destroy() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.handleResize);
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material)?.dispose();
    this.renderer?.dispose();
  }
}
