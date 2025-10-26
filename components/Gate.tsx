
import React from 'react';

interface GateProps {
  onStart: () => void;
}

const Gate: React.FC<GateProps> = ({ onStart }) => {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <button 
        onClick={onStart}
        className="appearance-none border border-zinc-800 bg-[#121212] text-gray-200 rounded-full px-5 py-3 font-semibold cursor-pointer shadow-transparent transition-all duration-200 ease-in-out hover:shadow-[0_0_0_6px_rgba(108,204,255,0.08)] active:translate-y-px"
      >
        Start audio
      </button>
    </div>
  );
};

export default Gate;