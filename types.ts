export interface Track {
  id: string;
  title: string;
  file: string;
  palette: string[];
  mood: string;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
}
