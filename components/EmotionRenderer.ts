
import type { Track, Particle } from '../types';

const avg = (arr: Uint8Array, s: number, e: number): number => {
    let sum = 0, n = 0;
    for (let i = s; i <= e && i < arr.length; i++) {
        sum += arr[i];
        n++;
    }
    return n ? sum / n : 0;
};

export const ensureParticles = (particles: Particle[], n: number, w: number, h: number): Particle[] => {
    while (particles.length < n) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        s: Math.random() * 2 + 0.5
      });
    }
    while (particles.length > n) {
      particles.pop();
    }
    return particles;
};

export const renderEmotionScene = (
    ctx: CanvasRenderingContext2D,
    track: Track,
    data: Uint8Array,
    particles: Particle[],
    canvasWidth: number,
    canvasHeight: number
) => {
    const bass = avg(data, 2, 48) / 255;
    const mid = avg(data, 64, 256) / 255;
    const tre = avg(data, 257, 512) / 255;
    const t = performance.now() * 0.0006;
    
    // Background
    const g = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
    track.palette.forEach((color, i) => {
      const shift = (i / track.palette.length + t * 0.05 + bass * 0.1) % 1;
      g.addColorStop(shift, color);
    });
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.globalAlpha = 1;

    // Particles update and draw
    ctx.fillStyle = `rgba(255,255,255,${0.5 + tre * 0.4})`;
    particles.forEach(p => {
      p.vx += (Math.random() - 0.5) * 0.02 * (0.5 + tre);
      p.vy += (Math.random() - 0.5) * 0.02 * (0.5 + tre);
      p.x += p.vx * (0.6 + mid * 1.4);
      p.y += p.vy * (0.6 + mid * 1.4);
      if (p.x < 0) p.x += canvasWidth; if (p.x > canvasWidth) p.x -= canvasWidth;
      if (p.y < 0) p.y += canvasHeight; if (p.y > canvasHeight) p.y -= canvasHeight;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    });

    // Waves
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.08 + 0.06 * i / 5 + bass * 0.1})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = 0; x <= canvasWidth; x += 10) {
        const y = canvasHeight * 0.5 + Math.sin((x * 0.01) + (t * 3) + (i * 0.6)) * (40 + bass * 120) + Math.cos((x * 0.005) + (i * 1.7)) * (10 + tre * 40);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
};