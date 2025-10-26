import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Track } from '../types';

const avg = (arr: Uint8Array, s: number, e: number): number => {
  let sum = 0, n = 0;
  for (let i = s; i <= e && i < arr.length; i++) { sum += arr[i]; n++; }
  return n ? sum / n : 0;
};

export class ThreeScene {
  private canvas: HTMLCanvasElement;
  private analyser: AnalyserNode;
  private track: Track;
  private dataArray: Uint8Array;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;

  private points!: THREE.Points;
  private originalPositions!: Float32Array;
  private color!: THREE.Color;

  private animationFrameId = 0;

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode, track: Track) {
    this.canvas = canvas;
    this.analyser = analyser;
    this.track = track;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.color = new THREE.Color(this.track.palette?.[3] ?? '#ffffff');
  }

  public init() {
    this.setupScene();
    this.setupSphere();
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    this.animate();
  }

  private setupScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    this.camera.position.z = 2; // Adjusted for smaller sphere

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setClearColor(0x000000, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.4;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
  }

  private setupSphere() {
    const geometry = new THREE.IcosahedronGeometry(0.75, 64); // Size reduced by half
    this.originalPositions = new Float32Array(geometry.attributes.position.array);

    const material = new THREE.PointsMaterial({
      color: this.color,
      size: 0.015,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, material);
    this.scene.add(this.points);
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.analyser.getByteFrequencyData(this.dataArray);
    this.update();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private update() {
    const bass = avg(this.dataArray, 0, 8) / 255;      // Low-end punch
    const mid = avg(this.dataArray, 40, 100) / 255;   // Color and rotation
    const treble = avg(this.dataArray, 150, 400) / 255; // Surface detail
    const time = performance.now() * 0.0005;

    const positions = this.points.geometry.attributes.position.array as Float32Array;
    const tempVec = new THREE.Vector3();

    for (let i = 0; i < positions.length; i += 3) {
      tempVec.fromArray(this.originalPositions, i);

      const bassMod = 1.0 + bass * 0.4;
      const trebleMod = treble * 0.15;

      const noise =
        Math.sin(tempVec.y * 5 + time) *
        Math.cos(tempVec.x * 5 + time) *
        Math.sin(tempVec.z * 5 + time) *
        trebleMod;

      tempVec.multiplyScalar(bassMod + noise).toArray(positions, i);
    }
    
    // Update color
    const targetColor = new THREE.Color(this.track.palette[1]);
    (this.points.material as THREE.PointsMaterial).color.lerpColors(this.color, targetColor, mid);

    this.points.geometry.attributes.position.needsUpdate = true;
    this.controls.autoRotateSpeed = 0.3 + mid * 1.2;
  }

  public setSize(width: number, height: number, dpr = 1) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private handleResize = () => {
    const { clientWidth, clientHeight } = this.canvas;
    this.setSize(clientWidth, clientHeight, window.devicePixelRatio);
  };

  public destroy() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.handleResize);
    this.controls?.dispose();
    this.points?.geometry.dispose();
    (this.points?.material as THREE.Material)?.dispose();
    this.renderer?.dispose();
  }
}
