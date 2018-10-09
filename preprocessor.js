const babel = require('babel-core');
const jestPreset = require('babel-preset-jest');

module.exports = {
  process: (src, filename) => {
    if (babel.util.canCompile(filename)) {
      return babel.transform({
        filename,
        presets: [jestPreset],
        retainLines: true,
      }).code;
    }
    return src;
  },
};
