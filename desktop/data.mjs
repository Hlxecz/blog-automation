import fs from 'node:fs';
import path from 'node:path';

export function initializeData(root, bundle) {
  fs.mkdirSync(root, { recursive: true });
  for (const relative of ['tistory.config.json', 'style/profile.md', 'style/samples/source-notes.md', 'docs/WRITING.md', 'AGENTS.md']) {
    const destination = path.join(root, relative);
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(bundle, relative), destination);
    }
  }
  for (const dir of ['inbox', 'drafts']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  return root;
}
