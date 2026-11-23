import guides from 'virtual:studio-documentation';
import './style.css';

const nav = document.querySelector('nav ul')!;
const article = document.querySelector('article')!;
const links = new Map<string, HTMLAnchorElement>();
for (const guide of guides.slice(1)) {
  const entry = document.createElement('li');
  const link = document.createElement('a');
  link.href = `#${guide.id}`;
  link.textContent = guide.title;
  links.set(guide.id, link);
  entry.append(link);
  nav.append(entry);
}
links.set('workspace', document.querySelector<HTMLAnchorElement>('nav > a')!);

let shown = '';
function showGuide(moveFocus = false) {
  const [id, section] = location.hash.slice(1).split('/', 2);
  const guide = guides.find(item => item.id === id) ?? guides[0];
  if (shown !== guide.id) {
    links.get(shown)?.removeAttribute('aria-current');
    shown = guide.id;
    links.get(shown)?.setAttribute('aria-current', 'page');
    // Available only from the build-time Markdown renderer's fixed guide list.
    article.innerHTML = guide.html;
    document.title = guide.id === 'workspace' ? 'Karaoke Studio Documentation' : `${guide.title} · Karaoke Studio Documentation`;
  }
  let target: HTMLElement | null = null;
  if (section) {
    try { target = document.getElementById(`${guide.id}/${decodeURIComponent(section)}`); } catch { /* An invalid bookmark opens the guide. */ }
  }
  if (target) target.scrollIntoView();
  else window.scrollTo(0, 0);
  if (moveFocus) (target ?? article.querySelector('h1'))?.focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => showGuide(true));
showGuide();
