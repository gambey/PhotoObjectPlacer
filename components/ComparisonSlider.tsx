import React, { useState, useRef, useEffect } from 'react';

interface ComparisonSliderProps {
  beforeImage: string;
  afterImage: string;
}

export const ComparisonSlider: React.FC<ComparisonSliderProps> = ({ beforeImage, afterImage }) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = () => setIsDragging(true);
  const handleMouseUp = () => setIsDragging(false);

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = (x / rect.width) * 100;
    setSliderPosition(percentage);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full select-none overflow-hidden cursor-ew-resize bg-black/50"
    >
      {/* After Image (Background) */}
      <img 
        src={afterImage} 
        alt="After" 
        className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none select-none"
      />

      {/* Before Image (Foreground - Clipped) */}
      <div 
        className="absolute top-0 left-0 h-full w-full overflow-hidden pointer-events-none select-none"
        style={{ width: `${sliderPosition}%` }}
      >
        <div className="relative w-full h-full">
           {/* Use parent width to maintain aspect ratio match */}
           {/* Note: This assumes container aspect ratio matches image or object-contain behavior is consistent.
               For precise alignment, width should be 100vw/100% of parent container width. */}
           <img 
            src={beforeImage} 
            alt="Before" 
            className="absolute top-0 left-0 max-w-none h-full object-contain"
            // We need to match the parent's full width here to keep alignment
            style={{ width: containerRef.current ? `${containerRef.current.clientWidth}px` : '100%' }}
          />
        </div>
      </div>

      {/* Slider Handle */}
      <div 
        className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize z-10 shadow-lg"
        style={{ left: `${sliderPosition}%` }}
        onMouseDown={handleMouseDown}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-800">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18-6-6 6-6"/><path d="m15 6 6 6-6 6"/></svg>
        </div>
      </div>
      
      {/* Labels */}
      <div className="absolute top-4 left-4 bg-black/70 text-white px-2 py-1 rounded text-xs pointer-events-none">原图</div>
      <div className="absolute top-4 right-4 bg-black/70 text-white px-2 py-1 rounded text-xs pointer-events-none">处理后</div>
    </div>
  );
};
