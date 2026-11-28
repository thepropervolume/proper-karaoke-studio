import dayMark from '../../assets/branding/splash-day.svg';
import { readAppearance } from '../renderer/studio-appearance';

const { theme } = readAppearance();
document.documentElement.dataset.theme = theme;
if (theme === 'day') {
  const mark = document.querySelector<HTMLImageElement>('.mark');
  if (mark) mark.src = dayMark;
}

const license = document.querySelector<HTMLElement>('.license');
function reportLicenseInteraction() {
  const reading = license?.matches(':hover') || license?.contains(document.activeElement);
  document.title = reading ? 'Studio splash license active' : 'Studio splash license inactive';
}
license?.addEventListener('mouseenter', reportLicenseInteraction);
license?.addEventListener('mouseleave', reportLicenseInteraction);
license?.addEventListener('focusin', reportLicenseInteraction);
license?.addEventListener('focusout', () => setTimeout(reportLicenseInteraction, 0));
