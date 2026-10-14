import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Finder/Dock launches do not inherit the terminal's PATH. Discover known
// installation directories without executing the user's shell startup files.
export function cliEnvironment({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform !== 'darwin') return { ...env };
  const directories = (env.PATH || '').split(':').filter(Boolean);
  directories.push(path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin',
    path.join(env.VOLTA_HOME || path.join(home, '.volta'), 'bin'),
    path.join(env.ASDF_DATA_DIR || path.join(home, '.asdf'), 'shims'),
    path.join(home, '.local/share/mise/shims'));
  const versions = (base, suffix) => {
    try {
      return fs.readdirSync(base).filter(name => /^v?\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
        .map(name => path.join(base, name, suffix));
    } catch { return []; }
  };
  directories.push(...versions(path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions/node'), 'bin'));
  for (const base of [env.FNM_DIR, path.join(home, 'Library/Application Support/fnm'), path.join(home, '.local/share/fnm')].filter(Boolean)) {
    directories.push(...versions(path.join(base, 'node-versions'), 'installation/bin'));
  }
  directories.push('/usr/bin', '/bin', '/usr/sbin', '/sbin');
  return { ...env, PATH: [...new Set(directories)].join(':') };
}

export function findExecutable(name, env = process.env, platform = process.platform) {
  for (const directory of (env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    const file = path.join(directory.replace(/^"|"$/g, ''), name);
    try {
      if (!fs.statSync(file).isFile()) continue;
      fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      return file;
    } catch { /* Ignore stale symlinks and inaccessible installations. */ }
  }
  return null;
}
