import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function releaseInfo(root = ROOT, { platform = 'win32', arch = 'x64' } = {}) {
  const pkg = read(path.join(root,'package.json')), lock = read(path.join(root,'package-lock.json'));
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('배포 버전 형식을 확인하세요. 예: 0.3.5 또는 0.4.0-rc.1');
  if (lock.version !== version || lock.packages[''].version !== version) throw new Error('package.json과 package-lock.json의 버전이 다릅니다. npm version 명령을 사용하세요.');
  const headings = fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8').split(/\r?\n/);
  if (!headings.some(line => line.startsWith(`## [${version}] - `))) throw new Error(`CHANGELOG.md에 ${version}의 변경 내역과 날짜를 작성하세요.`);
  const directory = path.join(root, 'dist', version, platform === 'darwin' ? 'macos' : 'windows');
  if (platform === 'win32' && arch === 'x64') return { version, directory, filename: `HDev-Studio-${version}-win-x64.exe` };
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) {
    const filenames = ['dmg', 'zip'].map(ext => `HDev-Studio-${version}-mac-${arch}.${ext}`);
    return { version, directory, filename: filenames[0], filenames };
  }
  throw new Error('지원하는 배포 대상은 Windows x64 또는 macOS arm64/x64입니다.');
}

export function checksums(root = ROOT, { platform = 'win32' } = {}) {
  const info = releaseInfo(root, { platform, arch: platform === 'darwin' ? 'arm64' : 'x64' });
  const allowed = platform === 'darwin'
    ? ['arm64', 'x64'].flatMap(arch => releaseInfo(root, { platform, arch }).filenames) : [info.filename];
  const artifacts = allowed.filter(filename => fs.existsSync(path.join(info.directory, filename))).map(filename => {
    const bytes = fs.readFileSync(path.join(info.directory, filename));
    return { filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  if (!artifacts.length) throw new Error('체크섬을 만들 배포 파일이 없습니다. 먼저 앱을 빌드하세요.');
  fs.writeFileSync(path.join(info.directory, 'SHA256SUMS.txt'), artifacts.map(item => `${item.sha256}  ${item.filename}\n`).join(''));
  const metadata = platform === 'win32' && artifacts.length === 1
    ? { version: info.version, ...artifacts[0] } : { version: info.version, artifacts };
  fs.writeFileSync(path.join(info.directory, 'release.json'), JSON.stringify(metadata, null, 2) + '\n');
  return { ...info, ...metadata };
}

export function buildPlan(command, { platform = process.platform, arch = process.arch, all = false, root = ROOT } = {}) {
  if (command === 'build') {
    if (platform !== 'win32') throw new Error('Windows에서 EXE를 빌드하세요. Mac에서는 npm run build:mac을 사용하세요.');
    const info = releaseInfo(root);
    return { info, filenames: [info.filename], args: ['--config', 'windows/electron-builder.cjs', '--win', 'portable', '--x64', '--publish', 'never'] };
  }
  if (command !== 'build-mac') throw new Error('알 수 없는 빌드 명령입니다.');
  if (platform !== 'darwin') throw new Error('macOS에서 Mac 앱을 빌드하세요.');
  const architectures = all ? ['arm64', 'x64'] : [arch];
  const info = releaseInfo(root, { platform, arch: architectures[0] });
  return { info, filenames: architectures.flatMap(arch => releaseInfo(root, { platform, arch }).filenames),
    args: ['--config', 'macos/electron-builder.cjs', '--mac', 'dmg', 'zip', ...architectures.map(arch => `--${arch}`), '--publish', 'never'] };
}

function run(command) {
  const info = releaseInfo();
  if (command === 'check') { console.log(`버전 일치: ${info.version} · 변경 내역 확인 완료`); return; }
  if (command === 'build' || command === 'build-mac') {
    const plan = buildPlan(command, { all: process.argv.includes('--all') });
    if (plan.filenames.some(filename => fs.existsSync(path.join(plan.info.directory, filename)))) throw new Error(`${info.version} 배포 파일이 이미 있습니다. 기존 배포본을 유지하려면 새 버전으로 올린 뒤 빌드하세요.`);
    for (const file of ['config/tistory.example.json','config/style.example.md','config/source-notes.example.md']) {
      if (!fs.existsSync(path.join(ROOT,file))) throw new Error(`공용 기본 설정이 없습니다: ${file}`);
    }
    const result = spawnSync(process.execPath,[path.join(ROOT,'node_modules/electron-builder/cli.js'), ...plan.args],{cwd:ROOT,stdio:'inherit',windowsHide:true});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`앱 빌드 실패 (${result.status ?? result.signal})`);
    if (plan.filenames.some(filename => !fs.existsSync(path.join(plan.info.directory, filename)))) throw new Error('예상한 배포 파일이 생성되지 않았습니다.');
  } else if (command !== 'checksums') throw new Error('사용법: node scripts/release.mjs check|build|build-mac [--all]|checksums');
  const platforms = command === 'build' ? ['win32'] : command === 'build-mac' ? ['darwin'] : ['win32', 'darwin'];
  let found = false;
  for (const platform of platforms) {
    const info = releaseInfo(ROOT, { platform, arch: platform === 'darwin' ? 'arm64' : 'x64' });
    const names = platform === 'darwin' ? ['arm64', 'x64'].flatMap(arch => releaseInfo(ROOT, { platform, arch }).filenames) : [info.filename];
    if (!names.some(name => fs.existsSync(path.join(info.directory, name)))) continue;
    const result = checksums(ROOT, { platform }); found = true;
    console.log(`배포 폴더: ${result.directory}\n체크섬: ${path.join(result.directory, 'SHA256SUMS.txt')}`);
  }
  if (!found) throw new Error('체크섬을 만들 배포 파일이 없습니다. 먼저 앱을 빌드하세요.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
