/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { useEffect, useRef, useState } from 'react';

export function BackdropPreview({ url, motion, looping, position, playing, onError }: {
  url: string; motion: boolean; looping: boolean; position: number; playing: boolean; onError(message: string): void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const finished = duration > 0 && !looping && position >= duration;

  useEffect(() => {
    const player = video.current;
    if (!player || !duration) return;
    if (finished) { player.pause(); return; }
    const target = looping ? position % duration : Math.min(position, duration);
    const drift = Math.abs(player.currentTime - target);
    if (drift > (playing ? .2 : .025)) player.currentTime = target;
    if (playing && player.paused) void player.play().catch(() => { /* Wait for a decoded frame. */ });
    else if (!playing && !player.paused) player.pause();
  }, [url, position, playing, looping, duration, finished]);

  return motion ? <video ref={video} src={url} muted playsInline loop={looping} preload="auto" aria-hidden="true" hidden={finished}
    onLoadedMetadata={event => {
      const length = event.currentTarget.duration;
      setDuration(Number.isFinite(length) && length > 0 ? length : 0);
    }} onError={() => onError('Studio could not preview the backdrop. Try an H.264 MP4, GIF, PNG, or JPEG.')} />
    : <img src={url} alt="Selected karaoke background" />;
}
