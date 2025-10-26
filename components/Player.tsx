import React from 'react';
import type { Track } from '../types';

interface PlayerProps {
  tracks: Track[];
  currentTrack: Track;
  isPlaying: boolean;
  onSelectTrack: (id: string, playOnSelect?: boolean) => void;
  onPlay: () => void;
  onPause: () => void;
}

const PlayerButton: React.FC<{ children: React.ReactNode; onClick: () => void; }> = ({ children, onClick }) => (
  <button 
    onClick={onClick}
    className="appearance-none border border-zinc-800 bg-[#121212] text-gray-200 rounded-full px-4 py-2.5 font-semibold cursor-pointer shadow-transparent transition-all duration-200 ease-in-out hover:shadow-[0_0_0_6px_rgba(108,204,255,0.08)] active:translate-y-px"
  >
    {children}
  </button>
);

const Player: React.FC<PlayerProps> = ({ tracks, currentTrack, isPlaying, onSelectTrack, onPlay, onPause }) => {
  return (
    <footer className="flex items-center gap-3 p-3.5 border-t border-zinc-900 bg-gradient-to-t from-[#0f0f0f] to-transparent z-10">
      <PlayerButton onClick={isPlaying ? onPause : onPlay}>
        {isPlaying ? 'Pause' : 'Play'}
      </PlayerButton>
      <div className="flex gap-2 flex-wrap">
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
    </footer>
  );
};

export default Player;