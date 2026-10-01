import React, { useEffect, useRef } from "react";
import { HEIGHT, Mono, WIDTH, drawMonoToCanvas, withLowBatteryBadge } from "../utils/bitmap";

interface MonoCanvasProps {
  mono: Mono;
  scale?: number;
  lowBattery?: boolean;
  className?: string;
}

// 1-bit frame rendered in e-paper colours, pixel-exact
export const MonoCanvas: React.FC<MonoCanvasProps> = ({ mono, scale = 2, lowBattery = false, className }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawMonoToCanvas(ref.current, lowBattery ? withLowBatteryBadge(mono) : mono);
  }, [mono, lowBattery]);
  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: WIDTH * scale, height: HEIGHT * scale, imageRendering: 'pixelated' }}
    />
  );
};
