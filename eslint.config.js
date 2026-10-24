const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  { languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  { files: ['cloud/**'], languageOptions: { globals: { ...globals.node, Parse: 'readonly' } } },
  { ignores: ['node_modules', 'logs'] },
];
