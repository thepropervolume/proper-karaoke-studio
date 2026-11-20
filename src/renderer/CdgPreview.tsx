import { useEffect, useRef } from 'react';
import { CdgPlayer, cdgHeight, cdgWidth } from '../domain/cdg';

export function CdgPreview({ player, seconds, playing, livePosition }: {
  player: CdgPlayer; seconds: number; playing: boolean; livePosition: () => number | undefined;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<ImageData | null>(null);
  const previous = useRef<CdgPlayer | null>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    let animation = 0;
    const paint = () => {
      if (player.seek(playing ? livePosition() ?? seconds : seconds) || previous.current !== player) {
        frame.current ??= context.createImageData(cdgWidth, cdgHeight);
        player.writeRgba(frame.current.data);
        context.putImageData(frame.current, 0, 0);
        previous.current = player;
      }
      if (playing) animation = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(animation);
  }, [player, seconds, playing, livePosition]);
  return <div className="cdg-preview">
    <canvas ref={canvas} width={cdgWidth} height={cdgHeight} aria-label="CD+G graphics preview" />
  </div>;
}
