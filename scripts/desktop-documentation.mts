import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Marked } from 'marked';
import type { Plugin } from 'vite';

const guides = [
  ['workspace', 'Workspace'], ['keyboard-shortcuts', 'Keyboard Shortcuts'], ['lyric-synchronization', 'Lyric Synchronization'],
  ['audio-separation', 'Audio Separation'], ['models', 'Model Library'], ['voice-recording', 'Voice Recording'],
  ['cdg', 'CD+G'], ['json-lyric-import', 'JSON Lyric Import'], ['project-recovery', 'Project Recovery'],
  ['cli', 'Command Line'], ['releases', 'Install and Update'],
] as const;
const guideIds: ReadonlySet<string> = new Set(guides.map(([id]) => id));
const moduleId = 'virtual:studio-documentation';
const resolvedId = `\0${moduleId}`;

export function renderGuide(id: string, markdown: string): string {
  if (!guideIds.has(id)) throw new Error('Unknown Studio guide.');
  const used = new Set<string>();
  const parser = new Marked({ gfm: true, async: false });
  parser.use({ renderer: {
    // Shipped pages have no HTML, image, or link capable of loading another site or a local file.
    html: () => '',
    image: () => '',
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const [file, fragment = ''] = href.split('#', 2);
      const target = file ? /^(?:\.\/)?([a-z0-9-]+)\.md$/.exec(file)?.[1] : id;
      if (!target || !guideIds.has(target) || fragment && !/^[\p{L}\p{N}-]+$/u.test(fragment)) return label;
      return `<a href="#${target}${fragment ? `/${fragment}` : ''}">${label}</a>`;
    },
    heading({ tokens, depth }) {
      const title = this.parser.parseInline(tokens, this.parser.textRenderer);
      const base = title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
      let anchor = base;
      for (let suffix = 1; used.has(anchor); suffix += 1) anchor = `${base}-${suffix}`;
      used.add(anchor);
      return `<h${depth} id="${id}/${anchor}" tabindex="-1">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  } });
  return parser.parse(markdown, { async: false });
}

export function desktopDocumentation(root: string): Plugin {
  return {
    name: 'studio-documentation',
    resolveId: id => id === moduleId ? resolvedId : null,
    load(id) {
      if (id !== resolvedId) return null;
      const bundle = guides.map(([id, title]) => {
        const path = resolve(root, 'docs', `${id}.md`);
        this.addWatchFile(path);
        return { id, title, html: renderGuide(id, readFileSync(path, 'utf8')) };
      });
      return `export default ${JSON.stringify(bundle)};`;
    },
  };
}
