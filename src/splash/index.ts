import dayMark from '../../assets/branding/splash-day.svg';
import { readAppearance } from '../renderer/studio-appearance';

const { theme } = readAppearance();
document.documentElement.dataset.theme = theme;
if (theme === 'day') {
  const mark = document.querySelector<HTMLImageElement>('.mark');
  if (mark) mark.src = dayMark;
}

const license = document.querySelector<HTMLElement>('.license');
const trigger = license?.querySelector<HTMLButtonElement>('button');
const tip = document.querySelector<HTMLElement>('#license-tip');
let pinned = false;
let dismissed = false;
function reportLicenseInteraction() {
  const reading = !dismissed && (pinned || license?.matches(':hover') || license?.contains(document.activeElement));
  if (tip) tip.hidden = !reading;
  document.title = reading ? 'Studio splash license active' : 'Studio splash license inactive';
}
license?.addEventListener('mouseenter', () => { dismissed = false; reportLicenseInteraction(); });
license?.addEventListener('mouseleave', reportLicenseInteraction);
license?.addEventListener('focusin', () => { dismissed = false; reportLicenseInteraction(); });
license?.addEventListener('focusout', () => setTimeout(reportLicenseInteraction, 0));
trigger?.addEventListener('click', () => { pinned = !pinned; dismissed = !pinned; reportLicenseInteraction(); });
trigger?.addEventListener('keydown', event => {
  if (!tip || tip.hidden) return;
  const delta = event.key === 'ArrowDown' ? 30 : event.key === 'ArrowUp' ? -30
    : event.key === 'PageDown' ? tip.clientHeight : event.key === 'PageUp' ? -tip.clientHeight : 0;
  if (delta) tip.scrollBy(0, delta);
  else if (event.key === 'Home') tip.scrollTop = 0;
  else if (event.key === 'End') tip.scrollTop = tip.scrollHeight;
  else return;
  event.preventDefault();
});
document.addEventListener('pointerdown', event => {
  if (license && !license.contains(event.target as Node)) {
    pinned = false;
    dismissed = true;
    reportLicenseInteraction();
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && tip && !tip.hidden) {
    pinned = false;
    dismissed = true;
    reportLicenseInteraction();
    event.preventDefault();
  }
});
