import { useEffect, useState } from 'react';

export function usePresentationUrl(path: string | null, kind: 'logo' | 'animation') {
  const [asset, setAsset] = useState<{ path: string; url?: string; missing?: boolean }>();
  useEffect(() => {
    if (!path) return;
    let current = true;
    void window.studio.registerPresentationMedia(path, kind).then(
      url => { if (current) setAsset({ path, url }); },
      () => { if (current) setAsset({ path, missing: true }); },
    );
    return () => { current = false; };
  }, [path, kind]);
  return asset?.path === path ? asset : undefined;
}

export function animationDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const finish = (duration?: number) => {
      window.clearTimeout(timeout);
      video.onloadedmetadata = null; video.onerror = null;
      video.removeAttribute('src'); video.load();
      if (!duration || !Number.isFinite(duration) || duration > 300) reject(new Error('Choose a readable MP4 or WebM animation up to five minutes long.'));
      else resolve(duration);
    };
    const timeout = window.setTimeout(() => finish(), 15000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish(video.videoWidth ? video.duration : undefined);
    video.onerror = () => finish();
    video.src = url;
  });
}
