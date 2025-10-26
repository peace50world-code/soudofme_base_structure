
import React, { useRef, useEffect, useCallback } from 'react';
import type { Track, Particle } from '../types';
import { renderEmotionScene, ensureParticles } from './EmotionRenderer';
import { ThreeScene } from './ThreeScene';
import { JourneyScene } from './JourneyScene';
import { BelieverScene } from './BelieverScene';

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
  const visualizerRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;

    // Clean up the previous visualizer before creating a new one
    if (visualizerRef.current) {
      visualizerRef.current.destroy();
      visualizerRef.current = null;
    }

    if (currentTrack.id === 'too-sweet') {
      const threeScene = new ThreeScene(canvas, analyser, currentTrack);
      threeScene.init();
      visualizerRef.current = {
        destroy: () => threeScene.destroy(),
      };
    } else if (currentTrack.id === 'journey') {
      const journeyScene = new JourneyScene(canvas, analyser, currentTrack);
      journeyScene.init();
       visualizerRef.current = {
        destroy: () => journeyScene.destroy(),
      };
    } else if (currentTrack.id === 'believer') {
      const believerScene = new BelieverScene(canvas, analyser, currentTrack);
      believerScene.init();
      visualizerRef.current = {
        destroy: () => believerScene.destroy(),
      };
    } else {
      // Fallback to 2D renderer for other tracks
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const particles: Particle[] = [];
      let animationFrameId: number;

      const resize2D = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const { clientWidth, clientHeight } = canvas;
        canvas.width = Math.round(clientWidth * dpr);
        canvas.height = Math.round(clientHeight * dpr);
        const ctx = canvas.getContext('2d');
        ctx?.scale(dpr, dpr);
      };

      const render2DScene = () => {
        animationFrameId = requestAnimationFrame(render2DScene);
        const ctx = canvas.getContext('2d');
        if (!ctx || !analyser) return;

        analyser.getByteFrequencyData(dataArray);
        const { clientWidth: w, clientHeight: h } = canvas;
        ctx.clearRect(0, 0, w, h);
        
        const mid = avg(dataArray, 64, 256) / 255;
        const count = Math.floor(140 + mid * 260);
        const currentParticles = ensureParticles(particles, count, w, h);
        
        renderEmotionScene(ctx, currentTrack, dataArray, currentParticles, w, h);
      };
      
      resize2D();
      window.addEventListener('resize', resize2D);
      render2DScene();

      visualizerRef.current = {
        destroy: () => {
          cancelAnimationFrame(animationFrameId);
          window.removeEventListener('resize', resize2D);
        },
      };
    }

    // Cleanup when component unmounts
    return () => {
      if (visualizerRef.current) {
        visualizerRef.current.destroy();
        visualizerRef.current = null;
      }
    };
  }, [analyser, currentTrack]);

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
