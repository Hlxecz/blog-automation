import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Only the unchanged public template shipped through 0.7.4 is eligible.
const previousDefaultHash = '090681ccde918ed42f81df37ab2630f00ca00dc16574017bae6b1783e301b4b6';

function upgradeDefaultProfile(root, bundle) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tistory.config.json'), 'utf8'));
  if (config.styleProfile?.replaceAll('\\', '/') !== 'style/profile.md') return;
  const profile = path.join(root, 'style/profile.md');
  const previous = fs.readFileSync(profile, 'utf8');
  const hash = createHash('sha256').update(previous.replace(/\r\n/g, '\n').trim()).digest('hex');
  if (hash !== previousDefaultHash) return;
  const next = fs.readFileSync(path.join(bundle, 'config/style.example.md'), 'utf8');
  if (next === previous) return;
  const history = path.join(root, 'style/history');
  fs.mkdirSync(history, { recursive: true });
  const id = `${Date.now()}-${randomUUID()}`;
  fs.copyFileSync(profile, path.join(history, `before-default-0.8.0-${id}.md`), fs.constants.COPYFILE_EXCL);
  const temporary = `${profile}.${id}.tmp`;
  fs.writeFileSync(temporary, next, { flag: 'wx' });
  fs.renameSync(temporary, profile);
}

export function initializeData(root, bundle) {
  fs.mkdirSync(root, { recursive: true });
  const defaults = {
    'tistory.config.json': 'config/tistory.example.json',
    'style/profile.md': 'config/style.example.md',
    'style/samples/source-notes.md': 'config/source-notes.example.md',
    'docs/WRITING.md': 'docs/WRITING.md', 'AGENTS.md': 'AGENTS.md'
  };
  for (const [relative, source] of Object.entries(defaults)) {
    const destination = path.join(root, relative);
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(bundle, source), destination, fs.constants.COPYFILE_EXCL);
    }
  }
  upgradeDefaultProfile(root, bundle);
  for (const dir of ['inbox', 'drafts']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  return root;
}
