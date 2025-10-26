
import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="flex items-center justify-between py-4 px-5 border-b border-zinc-900 bg-gradient-to-b from-[#0e0e0e] to-transparent absolute top-0 left-0 right-0 z-10">
      <div>
        <div className="tracking-wider font-bold text-white">SOUND OF ME</div>
        <div className="text-xs text-[#9aa0a6]">Landing: DATA (spectrum) → Hover: EMOTION lens → Click: Full scene</div>
      </div>
      <div className="text-xs text-[#9aa0a6] hidden sm:block">Hover a band to reveal an emotion lens • Click to dive in</div>
    </header>
  );
};

export default Header;
