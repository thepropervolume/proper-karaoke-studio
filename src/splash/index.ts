import dayMark from '../../assets/branding/splash-day.svg';
import { readAppearance } from '../renderer/studio-appearance';

const { theme } = readAppearance();
document.documentElement.dataset.theme = theme;
if (theme === 'day') {
  const mark = document.querySelector<HTMLImageElement>('.mark');
  if (mark) mark.src = dayMark;
}
