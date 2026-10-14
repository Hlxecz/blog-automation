const { build, version } = require('../package.json');

module.exports = {
  ...build,
  directories: { ...build.directories, output: `dist/${version}/macos` },
  mac: {
    target: ['dmg', 'zip'],
    icon: 'desktop/assets/icon-mac.png',
    category: 'public.app-category.productivity',
    artifactName: 'HDev-Studio-${version}-mac-${arch}.${ext}'
  }
};
