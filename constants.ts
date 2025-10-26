
import type { Track } from './types';

// Using a CDN to serve files from GitHub with the correct Content-Type header.
export const RAW_BASE = 'https://cdn.jsdelivr.net/gh/peace50world-code/digitalwebsite@main/';

export const TRACKS: Track[] = [
  {
    id: 'journey',
    title: "WOODZ — Journey",
    file: "WOODZ (우즈) 'Journey' Official Audio - JXS_BP Official.mp3",
    palette: ['#9be15d','#f9f871','#6cd4ff','#3ba3ff'],
    mood: 'hopeful • breeze',
  },
  {
    id: 'too-sweet',
    title: 'Hozier — Too Sweet',
    file: 'too_sweet.mp3',
    palette: ['#7a1f2b','#b24a34','#6b3f2c','#e3b07f'],
    mood: 'bold • pulse • burgundy heat',
  },
  {
    id: 'believer',
    title: 'Liam St. John — Believer',
    file: 'Believer - Liam St. John.mp3',
    palette: ['#86a8e7','#91eae4','#c2e9fb','#a1c4fd'],
    mood: 'intensity • fire',
  },
];