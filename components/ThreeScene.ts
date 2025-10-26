import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Track } from '../types';

const avg = (arr: Uint8Array, s: number, e: number): number => {
  let sum = 0, n = 0;
  for (let i = s; i <= e && i < arr.length; i++) { sum += arr[i]; n++; }
  return n ? sum / n : 0;
};

// --- GLSL SHADER CODE ---

const meshVertexShader = `
  uniform float u_time;
  uniform float u_bass;
  uniform float u_treble;
  
  varying float v_noise;

  // Classic Perlin 3D Noise
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+10.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }
  float pnoise(vec3 P, vec3 rep) {
    vec3 Pi0 = mod(floor(P), rep);
    vec3 Pi1 = mod(Pi0 + vec3(1.0), rep);
    Pi0 = mod289(Pi0);
    Pi1 = mod289(Pi1);
    vec3 Pf0 = fract(P);
    vec3 Pf1 = Pf0 - vec3(1.0);
    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
    vec4 iy = vec4(Pi0.yy, Pi1.yy);
    vec4 iz0 = Pi0.zzzz;
    vec4 iz1 = Pi1.zzzz;
    vec4 ixy = permute(permute(ix) + iy);
    vec4 ixy0 = permute(ixy + iz0);
    vec4 ixy1 = permute(ixy + iz1);
    vec4 gx0 = ixy0 * (1.0 / 7.0);
    vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
    gx0 = fract(gx0);
    vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
    vec4 sz0 = step(gz0, vec4(0.0));
    gx0 -= sz0 * (step(0.0, gx0) - 0.5);
    gy0 -= sz0 * (step(0.0, gy0) - 0.5);
    vec4 gx1 = ixy1 * (1.0 / 7.0);
    vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
    gx1 = fract(gx1);
    vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
    vec4 sz1 = step(gz1, vec4(0.0));
    gx1 -= sz1 * (step(0.0, gx1) - 0.5);
    gy1 -= sz1 * (step(0.0, gy1) - 0.5);
    vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
    vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
    vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
    vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
    vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
    vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
    vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
    vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
    vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
    g000 *= norm0.x;
    g010 *= norm0.y;
    g100 *= norm0.z;
    g110 *= norm0.w;
    vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
    g001 *= norm1.x;
    g011 *= norm1.y;
    g101 *= norm1.z;
    g111 *= norm1.w;
    float n000 = dot(g000, Pf0);
    float n100 = dot(g100, vec3(Pf1.x, Pf0.y, Pf0.z));
    float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
    float n110 = dot(g110, vec3(Pf1.x, Pf1.y, Pf0.z));
    float n001 = dot(g001, vec3(Pf0.x, Pf0.y, Pf1.z));
    float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
    float n011 = dot(g011, vec3(Pf0.x, Pf1.y, Pf1.z));
    float n111 = dot(g111, vec3(Pf1.x, Pf1.y, Pf1.z));
    vec3 fade_xyz = fade(Pf0);
    vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
    vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
    float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
    return 2.2 * n_xyz;
  }

  void main() {
    float bass_scale = 1.0 + u_bass * 0.5; 
    vec3 p1 = position * 1.5 + u_time * 0.1;
    float noise1 = pnoise(p1, vec3(10.0));
    vec3 p2 = position * 4.0 + u_time * 0.3;
    float noise2 = pnoise(p2, vec3(10.0));
    vec3 p3 = position * 8.0 + u_time * 0.5;
    float noise3 = pnoise(p3, vec3(10.0));
    float combined_noise = noise1 * 1.0 + noise2 * 0.5 + noise3 * 0.25;
    v_noise = combined_noise;
    float displacement_multiplier = pow(u_treble, 2.0);
    float displacement = displacement_multiplier * combined_noise * 0.8;
    vec3 scaledPosition = position * bass_scale;
    vec3 displacedPosition = scaledPosition + (normal * displacement);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
  }
`;

const meshFragmentShader = `
  uniform vec3 u_color_a;
  uniform vec3 u_color_b;
  uniform vec3 u_color_c;
  uniform float u_mid;
  uniform float u_treble;
  varying float v_noise;

  void main() {
    vec3 mid_color = mix(u_color_a, u_color_b, u_mid);
    vec3 final_color = mix(mid_color, u_color_c, u_treble * 0.8);
    final_color += v_noise * 0.1;
    gl_FragColor = vec4(final_color, 1.0);
  }
`;

const backgroundVertexShader = `
  uniform float u_time;
  uniform float u_treble;
  attribute float a_random;
  varying float v_random;

  void main() {
    v_random = a_random;
    float tremble_amount = u_treble * 0.15;
    vec3 displacement = vec3(
      sin(u_time * a_random * 1.5 + a_random) * tremble_amount,
      cos(u_time * a_random * 1.2 + a_random) * tremble_amount,
      sin(u_time * a_random * 1.8 + a_random) * tremble_amount
    );
    vec4 modelPosition = modelMatrix * vec4(position + displacement, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;
    gl_Position = projectedPosition;
    gl_PointSize = 5.0 + a_random * 5.0;
  }
`;

const backgroundFragmentShader = `
  uniform float u_time;
  uniform float u_treble;
  varying float v_random;

  void main() {
    vec3 color = vec3(1.0, 0.906, 0.302);
    float sparkle = pow(sin(u_time * 3.0 * v_random + v_random * 6.28) * 0.5 + 0.5, 20.0);
    float final_sparkle = sparkle * (0.6 + u_treble * 8.0);
    float distance_to_center = distance(gl_PointCoord, vec2(0.5));
    float glow = pow(1.0 - distance_to_center * 2.0, 2.0);
    gl_FragColor = vec4(color * glow, final_sparkle * glow);
  }
`;

export class ThreeScene {
  private canvas: HTMLCanvasElement;
  private analyser: AnalyserNode;
  private track: Track;
  private dataArray: Uint8Array;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;

  private mesh!: THREE.Mesh;
  private meshUniforms!: { [uniform: string]: THREE.IUniform };
  
  private backgroundParticles!: THREE.Points;
  private backgroundParticleUniforms!: { [uniform: string]: THREE.IUniform };

  private animationFrameId = 0;

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode, track: Track) {
    this.canvas = canvas;
    this.analyser = analyser;
    this.track = track;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  public init() {
    this.setupScene();
    this.setupPostProcessing();
    this.setupMesh();
    this.setupBackgroundParticles();
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    this.animate();
  }

  private setupScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    this.camera.position.z = 1.5;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setClearColor(0x000000, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.autoRotate = false;
    this.controls.enablePan = false;
    this.controls.enableZoom = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 5;
  }

  private setupPostProcessing() {
    const renderPass = new RenderPass(this.scene, this.camera);

    const initialParams = {
        strength: 1.5,
        radius: 0.4,
        threshold: 0.85
    };
    this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(this.canvas.clientWidth, this.canvas.clientHeight),
        initialParams.strength,
        initialParams.radius,
        initialParams.threshold
    );

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);
  }

  private setupMesh() {
    const geometry = new THREE.IcosahedronGeometry(0.75, 64);
    this.meshUniforms = {
      u_time: { value: 0.0 },
      u_bass: { value: 0.0 },
      u_mid: { value: 0.0 },
      u_treble: { value: 0.0 },
      u_color_a: { value: new THREE.Color(this.track.palette[0] ?? '#7a1f2b') },
      u_color_b: { value: new THREE.Color('#d90057') },
      u_color_c: { value: new THREE.Color('#e09419') },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.meshUniforms,
      vertexShader: meshVertexShader,
      fragmentShader: meshFragmentShader,
      wireframe: true,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);
  }
  
  private setupBackgroundParticles() {
    const particleCount = 20000;
    const positions = new Float32Array(particleCount * 3);
    const randoms = new Float32Array(particleCount);
    const radius = 10;
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);
      randoms[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('a_random', new THREE.BufferAttribute(randoms, 1));
    this.backgroundParticleUniforms = {
        u_time: { value: 0.0 },
        u_treble: { value: 0.0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.backgroundParticleUniforms,
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.backgroundParticles = new THREE.Points(geometry, material);
    this.scene.add(this.backgroundParticles);
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.analyser.getByteFrequencyData(this.dataArray);
    this.update();
    this.controls.update();
    this.composer.render();
  };

  private update() {
    const time = performance.now() * 0.0005;
    const bass = avg(this.dataArray, 0, 8) / 255;
    const mid = avg(this.dataArray, 40, 100) / 255;
    const treble = avg(this.dataArray, 150, 400) / 255;

    this.meshUniforms.u_time.value = time;
    this.meshUniforms.u_bass.value = bass;
    this.meshUniforms.u_mid.value = mid;
    this.meshUniforms.u_treble.value = treble;

    if (this.backgroundParticleUniforms) {
      this.backgroundParticleUniforms.u_time.value = time;
      this.backgroundParticleUniforms.u_treble.value = treble;
    }
    
    if (this.bloomPass) {
        this.bloomPass.strength = 0.5 + bass * 2.0;
        this.bloomPass.radius = 0.2 + mid * 0.8;
        this.bloomPass.threshold = 0.9 - treble * 0.5;
    }
  }

  public setSize(width: number, height: number, dpr = 1) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(width, height);
  }

  private handleResize = () => {
    const { clientWidth, clientHeight } = this.canvas.parentElement || this.canvas;
    this.setSize(clientWidth, clientHeight, window.devicePixelRatio);
  };

  public destroy() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.handleResize);
    this.controls?.dispose();
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material)?.dispose();
    if (this.backgroundParticles) {
      this.backgroundParticles.geometry.dispose();
      (this.backgroundParticles.material as THREE.Material).dispose();
    }
    this.renderer?.dispose();
  }
}