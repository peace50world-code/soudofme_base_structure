
import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { Track } from './types';
import { TRACKS, RAW_BASE } from './constants';
import Header from './components/Header';
import Player from './components/Player';
import DataView from './components/DataView';
import SceneView from './components/SceneView';
import Gate from './components/Gate';

type View = 'gate' | 'data' | 'scene';

const App: React.FC = () => {
  const [view, setView] = useState<View>('gate');
  const [currentTrack, setCurrentTrack] = useState<Track>(TRACKS[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.75); // Add volume state

  const audioEl = useRef<HTMLAudioElement>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const sourceNode = useRef<MediaElementAudioSourceNode | null>(null);

  // Effect to sync volume state with the audio element
  useEffect(() => {
    if (audioEl.current) {
      audioEl.current.volume = volume;
    }
  }, [volume]);

  const handleStartAudio = useCallback(async () => {
    if (!audioContext.current) {
      const AC = new (window.AudioContext || (window as any).webkitAudioContext)();
      const an = AC.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0.85;

      audioContext.current = AC;
      analyser.current = an;

      if (audioEl.current) {
        // Set initial volume
        audioEl.current.volume = volume;
        const sn = AC.createMediaElementSource(audioEl.current);
        sn.connect(an);
        an.connect(AC.destination);
        sourceNode.current = sn;
      }
    }
    if (audioContext.current.state === 'suspended') {
        await audioContext.current.resume();
    }
    
    setView('data');
    handleSelectTrack(currentTrack.id, true);
  }, [currentTrack.id, volume]); // Add volume to dependency array

  const handleSelectTrack = useCallback((id: string, playOnSelect = false) => {
    const track = TRACKS.find(t => t.id === id) || TRACKS[0];
    setCurrentTrack(track);
    if (audioEl.current) {
      const toRaw = (name: string) => RAW_BASE + encodeURIComponent(name);
      audioEl.current.src = toRaw(track.file);
      if (playOnSelect) {
        audioEl.current.play().catch(e => console.error("Error playing audio:", e));
      }
    }
  }, []);

  const handlePlay = useCallback(() => {
    audioEl.current?.play().catch(e => console.error("Error playing audio:", e));
  }, []);
  
  const handlePause = useCallback(() => {
    audioEl.current?.pause();
  }, []);

  const handleVolumeChange = useCallback((newVolume: number) => {
    setVolume(newVolume);
  }, []);
  
  useEffect(() => {
    const audio = audioEl.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
    };
  }, []);

  const renderView = () => {
    switch(view) {
      case 'gate':
        return <Gate onStart={handleStartAudio} />;
      case 'data':
        return (
          <DataView 
            analyser={analyser.current} 
            currentTrack={currentTrack} 
            onEnterScene={() => setView('scene')}
            is3DMode={currentTrack.id === 'too-sweet' || currentTrack.id === 'journey'}
          />
        );
      case 'scene':
        return (
          <SceneView 
            analyser={analyser.current} 
            currentTrack={currentTrack} 
            onBack={() => setView('data')} 
          />
        );
      default:
        return <Gate onStart={handleStartAudio} />;
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col font-sans overflow-hidden">
      {view !== 'scene' && <Header />}
      <main className="flex-1 relative bg-gradient-to-b from-[#0a0a0a] to-[#080808] via-[#0b0b0b]">
        {renderView()}
      </main>
      {view === 'data' && (
        <Player
          tracks={TRACKS}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          onSelectTrack={handleSelectTrack}
          onPlay={handlePlay}
          onPause={handlePause}
          volume={volume}
          onVolumeChange={handleVolumeChange}
        />
      )}
       <audio ref={audioEl} crossOrigin="anonymous" />
    </div>
  );
};

export default App;
