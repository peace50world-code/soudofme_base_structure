
import React, { useRef, useEffect, useCallback } from 'react';
import type { Track, Particle } from '../types';
import { renderEmotionScene, ensureParticles } from './EmotionRenderer';

interface DataViewProps {
  analyser: AnalyserNode | null;
  currentTrack: Track;
  onEnterScene: () => void;
}

const avg = (arr: Uint8Array, s: number, e: number): number => {
  let sum = 0, n = 0;
  for (let i = s; i <= e && i < arr.length; i++) {
    sum += arr[i];
    n++;
  }
  return n ? sum / n : 0;
};

const DataView: React.FC<DataViewProps> = ({ analyser, currentTrack, onEnterScene }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>(0);
  const dataArray = useRef<Uint8Array | null>(null);
  const particles = useRef<Particle[]>([]);

  // State for lens physics and position
  const lensState = useRef({
    isHovering: false,
    mouseX: 0,
    mouseY: 0,
    hoverIndex: -1,
    targetX: 0,
    targetY: 0,
    targetR: 0,
    // Spring-animated properties
    posX: 0,
    posY: 0,
    posR: 0,
    velX: 0,
    velY: 0,
    velR: 0,
    // Simple eased property
    alpha: 0,
  });

  const renderCanvas = useCallback(() => {
    animationFrameId.current = requestAnimationFrame(renderCanvas);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas || !analyser || !dataArray.current) return;

    analyser.getByteFrequencyData(dataArray.current);
    const { clientWidth: width, clientHeight: height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const nBars = 96;
    const margin = 36;
    const barGap = 3;
    const barW = (width - margin * 2 - (nBars - 1) * barGap) / nBars;
    const step = Math.floor(analyser.frequencyBinCount / nBars);
    
    // 1. Draw grid
    ctx.strokeStyle = '#101010';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const y = Math.round(margin + ((height - margin * 2) / 8) * i) + 0.5;
      ctx.beginPath(); 
      ctx.moveTo(margin, y); 
      ctx.lineTo(width - margin, y); 
      ctx.stroke();
    }

    // 2. Calculate bar shapes and perform hover detection simultaneously
    let x = margin;
    const barShapes: {x:number, y:number, w:number, h:number}[] = [];
    const state = lensState.current;
    let newHoverIndex = -1;

    for (let i = 0; i < nBars; i++) {
        const v = dataArray.current[i * step] || 0;
        const h = (v / 255) * (height - margin * 2);
        const shape = { x, y: height - margin - h, w: barW, h };
        barShapes.push(shape);
        x += barW + barGap;

        if (state.isHovering &&
            state.mouseX >= shape.x && state.mouseX <= shape.x + shape.w &&
            state.mouseY >= shape.y && state.mouseY <= shape.y + shape.h) {
            newHoverIndex = i;
        }
    }
    state.hoverIndex = newHoverIndex;
    
    // 2b. Now draw all bars in base grayscale
    for (let i = 0; i < nBars; i++) {
        const shape = barShapes[i];
        const v = dataArray.current[i * step] || 0;
        const g = Math.round(180 - v * 0.6);
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
    }

    // 3. Update lens targets based on hover state
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

    // 4. Apply spring physics for "chewy" animation
    const stiffness = 0.06;
    const damping = 0.7;

    let forceX = (state.targetX - state.posX) * stiffness;
    state.velX = (state.velX + forceX) * damping;
    state.posX += state.velX;

    let forceY = (state.targetY - state.posY) * stiffness;
    state.velY = (state.velY + forceY) * damping;
    state.posY += state.velY;

    let forceR = (state.targetR - state.posR) * stiffness;
    state.velR = (state.velR + forceR) * damping;
    state.posR += state.velR;
    
    const targetAlpha = shouldDrawLens ? 1 : 0;
    state.alpha += (targetAlpha - state.alpha) * 0.15;
    
    // 5. Draw the lens if it's visible
    if (state.alpha > 0.01 && state.posR > 1) {
        ctx.save();
        ctx.globalAlpha = state.alpha;

        // First, clip to the shape of the bars.
        ctx.beginPath();
        barShapes.forEach(s => ctx.rect(s.x, s.y, s.w, s.h));
        ctx.clip();
        
        // Render the emotion scene inside the bar shapes.
        const mid = avg(dataArray.current, 64, 256) / 255;
        const count = Math.floor(80 + mid * 150);
        particles.current = ensureParticles(particles.current, count, width, height);
        renderEmotionScene(ctx, currentTrack, dataArray.current, particles.current, width, height);

        // Now, apply a second "spotlight" mask to create the feathered circle.
        ctx.globalCompositeOperation = 'destination-in';
        
        const gradient = ctx.createRadialGradient(
            state.posX, state.posY, state.posR * 0.5,
            state.posX, state.posY, state.posR
        );
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.restore();
    }
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
    
    const handleMouseMove = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const state = lensState.current;
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;

        if (!state.isHovering) {
            // First frame of hovering, set initial positions to avoid jump
            state.posX = localX;
            state.posY = localY;
            state.posR = 0;
            state.velX = 0;
            state.velY = 0;
            state.velR = 0;
        }

        state.isHovering = true;
        state.mouseX = localX;
        state.mouseY = localY;
    };
    const handleMouseLeave = () => {
        const state = lensState.current;
        state.isHovering = false;
        state.hoverIndex = -1;
    };
    const handleClick = () => {
        if (lensState.current.hoverIndex !== -1) {
            onEnterScene();
        }
    };

    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('click', handleClick);
    
    animationFrameId.current = requestAnimationFrame(renderCanvas);

    return () => {
      cancelAnimationFrame(animationFrameId.current);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('click', handleClick);
    };
  }, [analyser, renderCanvas, onEnterScene]);

  return (
    <>
      <canvas ref={canvasRef} className="block w-full h-full" />
      <div className="absolute left-4 bottom-4 bg-[rgba(15,15,15,0.7)] backdrop-blur-md px-3 py-2.5 rounded-xl border border-zinc-800 text-xs text-gray-300">
        Neutral spectrum (grayscale). Your emotions remain hidden… until you hover.
      </div>
    </>
  );
};

export default DataView;
