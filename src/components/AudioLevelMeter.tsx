'use client';

import { useMemo } from 'react';

interface AudioLevelMeterProps {
  level: number; // 0-100
  label: string; // "IN" or "OUT"
  isInActiveCall: boolean;
  isMuted?: boolean; // Only for input meter
  type: 'input' | 'output';
}

export default function AudioLevelMeter({ 
  level, 
  label, 
  isInActiveCall, 
  isMuted = false,
  type 
}: AudioLevelMeterProps) {
  
  const getBackgroundColor = useMemo(() => {
    if (!isInActiveCall) return 'bg-gray-200';
    if (type === 'input' && isMuted) return 'bg-pink-200';
    return 'bg-base-300';
  }, [isInActiveCall, isMuted, type]);

  const getDisplayText = useMemo(() => {
    if (!isInActiveCall) return 'IDLE';
    if (type === 'input' && isMuted) return 'MUTED';
    return `${Math.round(level)}%`;
  }, [isInActiveCall, isMuted, type, level]);

  const shouldShowBars = useMemo(() => {
    if (!isInActiveCall) return false;
    if (type === 'input' && isMuted) return false;
    return true;
  }, [isInActiveCall, isMuted, type]);

  return (
    <div className="flex items-center gap-1">
      <div className="text-xs text-base-content/60">{label}</div>
      <div className={`w-16 h-12 rounded-sm overflow-hidden flex items-end ${getBackgroundColor}`}>
        {/* Segmented level meter */}
        <div className="w-full h-full flex flex-col-reverse gap-px">
          {[...Array(16)].map((_, i) => (
            <div 
              key={i}
              className={`w-full flex-1 transition-all duration-100 ${
                shouldShowBars && level > i * 6.25 
                  ? 'bg-gray-400' 
                  : 'bg-transparent'
              }`}
            ></div>
          ))}
        </div>
      </div>
      <div className="text-xs font-mono w-8 text-right">
        {getDisplayText}
      </div>
    </div>
  );
}