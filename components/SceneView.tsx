import React, { useRef, useEffect, useCallback } from 'react';
import type { Track, Particle } from '../types';
import { renderEmotionScene, ensureParticles } from './EmotionRenderer';

interface SceneViewProps {
  analyser: AnalyserNode | null;
  currentTrack: Track;
  onBack: () => void;
}

const avg = (arr: Uint8Array, s: number, e: number): number => {
    let sum = 0, n = 0;
    for (let i = s; i <= e && i < arr.length; i++) {
        sum += arr[i];
        n++;
    }
    return n ? sum / n : 0;
};

const SceneView: React.FC<SceneViewProps> = ({ analyser, currentTrack, onBack }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>(0);
  const dataArray = useRef<Uint8Array | null>(null);
  const particles = useRef<Particle[]>([]);

  const renderScene = useCallback(() => {
    animationFrameId.current = requestAnimationFrame(renderScene);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas || !analyser || !dataArray.current) return;

    analyser.getByteFrequencyData(dataArray.current);
    const { clientWidth: w, clientHeight: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    
    const mid = avg(dataArray.current, 64, 256) / 255;
    const count = Math.floor(140 + mid * 260);
    particles.current = ensureParticles(particles.current, count, w, h);
    
    renderEmotionScene(ctx, currentTrack, dataArray.current, particles.current, w, h);

  }, [analyser, currentTrack]);

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
    };

    resize();
    window.addEventListener('resize', resize);
    animationFrameId.current = requestAnimationFrame(renderScene);

    return () => {
      cancelAnimationFrame(animationFrameId.current);
      window.removeEventListener('resize', resize);
    };
  }, [analyser, renderScene]);

  return (
    <div className="fixed inset-0 bg-[#050505] z-20">
      <div className="absolute inset-x-4 top-4 flex items-center justify-between z-10">
        <div className="text-xs text-zinc-300 border border-zinc-800 rounded-full px-3 py-1.5 bg-[rgba(10,10,10,0.7)] backdrop-blur-md">
            {currentTrack.title} • {currentTrack.mood}
        </div>
        <button
          onClick={onBack}
          className="text-xs text-zinc-300 border border-zinc-800 rounded-full px-3 py-1.5 bg-[rgba(10,10,10,0.7)] backdrop-blur-md cursor-pointer hover:border-zinc-600 hover:text-white transition-colors"
        >
          ← Back to data
        </button>
      </div>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
};

export default SceneView;