import { useEffect, useState } from 'react';

function clock(value: number) {
  const seconds = Math.max(0, Math.ceil(value));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

export function StemSeparationProgress({ job }: { job: StudioSeparationProgress & { started: number } }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="stem-separation-progress">
    <progress aria-label="Stem separation progress for the current step" max={1} value={job.progress} />
    <strong role="status">{job.message}</strong>
    <span className="muted">
      {job.remainingSeconds === undefined ? clock((now - job.started) / 1000) + ' elapsed' : '~' + clock(job.remainingSeconds) + ' left in this step'}
    </span>
  </div>;
}
