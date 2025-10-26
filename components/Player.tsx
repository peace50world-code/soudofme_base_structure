
import React from 'react';
import type { Track } from '../types';

interface PlayerProps {
  tracks: Track[];
  currentTrack: Track;
  isPlaying: boolean;
  onSelectTrack: (id: string, playOnSelect?: boolean) => void;
  onPlay: () => void;
  onPause: () => void;
  volume: number;
  onVolumeChange: (newVolume: number) => void;
}

const PlayerButton: React.FC<{ children: React.ReactNode; onClick: () => void; }> = ({ children, onClick }) => (
  <button 
    onClick={onClick}
    className="appearance-none border border-zinc-800 bg-[#121212] text-gray-200 rounded-full px-4 py-2.5 font-semibold cursor-pointer shadow-transparent transition-all duration-200 ease-in-out hover:shadow-[0_0_0_6px_rgba(108,204,255,0.08)] active:translate-y-px"
  >
    {children}
  </button>
);

const Player: React.FC<PlayerProps> = ({ tracks, currentTrack, isPlaying, onSelectTrack, onPlay, onPause, volume, onVolumeChange }) => {
  return (
    <footer className="flex items-center gap-3 p-3.5 border-t border-zinc-900 bg-gradient-to-t from-[#0f0f0f] to-transparent z-10">
      <PlayerButton onClick={isPlaying ? onPause : onPlay}>
        {isPlaying ? 'Pause' : 'Play'}
      </PlayerButton>
      <div className="flex gap-2 flex-wrap flex-1">
        {tracks.map(track => (
          <button
            key={track.id}
            onClick={() => onSelectTrack(track.id, true)}
            className={`border px-3 py-1.5 rounded-full text-xs cursor-pointer transition-all duration-200
              ${currentTrack.id === track.id
                ? 'border-[#3aa6ff] text-[#eaf6ff] bg-[#121212] shadow-[0_0_0_3px_rgba(58,166,255,0.1)]'
                : 'border-zinc-800 text-zinc-400 bg-[#121212] hover:border-zinc-600 hover:text-zinc-200'
              }`
            }
          >
            {track.title}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 pr-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d={volume > 0.5 ? "M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" : volume > 0 ? "M15.54 8.46a5 5 0 0 1 0 7.07" : ""}></path>
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="w-24 accent-[#6cf]"
        />
      </div>
    </footer>
  );
};

export default Player;
