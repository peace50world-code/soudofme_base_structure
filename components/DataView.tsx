import React, { useRef, useEffect, useCallback } from 'react';
import type { Track, Particle } from '../types';
import { renderEmotionScene, ensureParticles } from './EmotionRenderer';
import { ThreeScene } from './ThreeScene';
import { JourneyScene } from './JourneyScene';

interface DataViewProps {
  analyser: AnalyserNode | null;
  currentTrack: Track;
  onEnterScene: () => void;
  is3DMode: boolean;
}

const avg = (arr: Uint8Array, s: number, e: number): number => {
  let sum = 0, n = 0;
  for (let i = s; i <= e && i < arr.length; i++) { sum += arr[i]; n++; }
  return n ? sum / n : 0;
};

const DataView: React.FC<DataViewProps> = ({ analyser, currentTrack, onEnterScene, is3DMode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const webglCanvasRef = useRef<HTMLCanvasElement>(null);
  const webglSceneRef = useRef<{ destroy: () => void } | null>(null);
  const animationFrameId = useRef<number>(0);
  const dataArray = useRef<Uint8Array | null>(null);
  const particles = useRef<Particle[]>([]);

  const lensState = useRef({
    isHovering: false, mouseX: 0, mouseY: 0, hoverIndex: -1,
    targetX: 0, targetY: 0, targetR: 0,
    posX: 0, posY: 0, posR: 0,
    velX: 0, velY: 0, velR: 0,
    alpha: 0,
  });

  useEffect(() => {
    if (is3DMode && analyser && webglCanvasRef.current) {
      if (webglSceneRef.current) {
        webglSceneRef.current.destroy();
      }
      
      let scene;
      if (currentTrack.id === 'too-sweet') {
        scene = new ThreeScene(webglCanvasRef.current, analyser, currentTrack);
      } else if (currentTrack.id === 'journey') {
        scene = new JourneyScene(webglCanvasRef.current, analyser, currentTrack);
      }
      
      if (scene) {
        scene.init();
        webglSceneRef.current = scene;
      }
    }
    return () => {
      if (webglSceneRef.current) {
        webglSceneRef.current.destroy();
        webglSceneRef.current = null;
      }
    };
  }, [is3DMode, analyser, currentTrack]);

  const renderCanvas = useCallback(() => {
    animationFrameId.current = requestAnimationFrame(renderCanvas);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas || !analyser || !dataArray.current) return;

    analyser.getByteFrequencyData(dataArray.current);
    const { clientWidth: width, clientHeight: height } = canvas;

    ctx.clearRect(0, 0, width, height);

    if (is3DMode) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, width, height);
    }

    const nBars = 96;
    const margin = 36;
    const barGap = 3;
    const barW = (width - margin * 2 - (nBars - 1) * barGap) / nBars;
    const step = Math.floor(analyser.frequencyBinCount / nBars);

    ctx.strokeStyle = '#101010';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const y = Math.round(margin + ((height - margin * 2) / 8) * i) + 0.5;
      ctx.beginPath(); ctx.moveTo(margin, y); ctx.lineTo(width - margin, y); ctx.stroke();
    }

    let x = margin;
    const barShapes: { x: number; y: number; w: number; h: number }[] = [];
    const state = lensState.current;
    let newHover = -1;

    for (let i = 0; i < nBars; i++) {
      const v = dataArray.current[i * step] || 0;
      const h = (v / 255) * (height - margin * 2);
      const s = { x, y: height - margin - h, w: barW, h };
      barShapes.push(s);
      x += barW + barGap;
      if (state.isHovering && state.mouseX >= s.x && state.mouseX <= s.x + s.w && state.mouseY >= s.y && state.mouseY <= s.y + s.h) {
        newHover = i;
      }
    }
    state.hoverIndex = newHover;

    for (let i = 0; i < nBars; i++) {
      const s = barShapes[i];
      const v = dataArray.current[i * step] || 0;
      const g = Math.round(180 - v * 0.6);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(s.x, s.y, s.w, s.h);
    }

    const shouldDrawLens = state.isHovering && state.hoverIndex >= 0;
    if (shouldDrawLens) {
      const rect = barShapes[state.hoverIndex];
      state.targetX = rect.x + rect.w / 2;
      state.targetY = state.mouseY;
      const bassNow = avg(dataArray.current, 2, 48) / 255;
      state.targetR = Math.max(70, Math.min(150, rect.w * 3)) * (0.95 + bassNow * 0.25);
    } else {
      state.targetR = 0;
    }

    const k = 0.06, d = 0.7;
    state.velX = (state.velX + (state.targetX - state.posX) * k) * d; state.posX += state.velX;
    state.velY = (state.velY + (state.targetY - state.posY) * k) * d; state.posY += state.velY;
    state.velR = (state.velR + (state.targetR - state.posR) * k) * d; state.posR += state.velR;
    state.alpha += ((shouldDrawLens ? 1 : 0) - state.alpha) * 0.15;

    if (state.alpha > 0.01 && state.posR > 1) {
      ctx.save();
      if (is3DMode) {
        ctx.globalCompositeOperation = 'destination-out';
        const grad = ctx.createRadialGradient(state.posX, state.posY, state.posR * 0.5, state.posX, state.posY, state.posR);
        grad.addColorStop(0, `rgba(0,0,0,${state.alpha})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.globalAlpha = state.alpha;
        ctx.beginPath(); barShapes.forEach(s => ctx.rect(s.x, s.y, s.w, s.h)); ctx.clip();
        const mid = avg(dataArray.current, 64, 256) / 255;
        const count = Math.floor(80 + mid * 150);
        particles.current = ensureParticles(particles.current, count, width, height);
        renderEmotionScene(ctx, currentTrack, dataArray.current, particles.current, width, height);
        ctx.globalCompositeOperation = 'destination-in';
        const g2 = ctx.createRadialGradient(state.posX, state.posY, state.posR * 0.5, state.posX, state.posY, state.posR);
        g2.addColorStop(0, 'rgba(0,0,0,1)');
        g2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g2; ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }
  }, [analyser, currentTrack, is3DMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    dataArray.current = new Uint8Array(analyser.frequencyBinCount);
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { clientWidth, clientHeight } = canvas;
      canvas.width = Math.round(clientWidth * dpr);
      canvas.height = Math.round(clientHeight * dpr);
      const ctx = canvas.getContext('2d');
      ctx?.scale(dpr, dpr);
      if (webglSceneRef.current && 'setSize' in webglSceneRef.current) {
        (webglSceneRef.current as any).setSize(clientWidth, clientHeight, dpr);
      }
    };
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const s = lensState.current;
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (!s.isHovering) { s.posX = x; s.posY = y; s.posR = 0; s.velX = s.velY = s.velR = 0; }
      s.isHovering = true; s.mouseX = x; s.mouseY = y;
    };
    const onLeave = () => { const s = lensState.current; s.isHovering = false; s.hoverIndex = -1; };
    const onClick = () => { if (lensState.current.hoverIndex !== -1) onEnterScene(); };

    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('click', onClick);

    animationFrameId.current = requestAnimationFrame(renderCanvas);
    return () => {
      cancelAnimationFrame(animationFrameId.current);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('click', onClick);
    };
  }, [analyser, renderCanvas, onEnterScene]);

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={webglCanvasRef}
        className={`absolute inset-0 w-full h-full block pointer-events-none ${is3DMode ? '' : 'hidden'}`}
      />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      <div className="absolute left-4 bottom-4 bg-[rgba(15,15,15,0.7)] backdrop-blur-md px-3 py-2.5 rounded-xl border border-zinc-800 text-xs text-gray-300 pointer-events-none">
        Neutral spectrum (grayscale). Your emotions remain hidden… until you hover.
      </div>
    </div>
  );
};

export default DataView;