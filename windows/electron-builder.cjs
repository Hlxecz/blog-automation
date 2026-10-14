const { build, version } = require('../package.json');

module.exports = {
  ...build,
  directories: { ...build.directories, output: `dist/${version}/windows` },
  win: {
    target: 'portable',
    icon: 'desktop/assets/icon.ico'
  },
  portable: {
    artifactName: 'HDev-Studio-${version}-win-x64.exe'
  }
};
