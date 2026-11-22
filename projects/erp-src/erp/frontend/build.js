const fs = require('fs');
const src = fs.readFileSync('./vendor/babel.min.js', 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', src)(mod, mod.exports);
const Babel = mod.exports;
try {
  const jsx = fs.readFileSync('./src/app.jsx', 'utf8') + '\n' + fs.readFileSync('./src/pages_ops.jsx', 'utf8');
  const out = Babel.transform(jsx, { presets: [['react', { runtime: 'classic' }]], filename: 'app.jsx', sourceType: 'script' });
  fs.writeFileSync('./static/app.js', out.code + '\n//# sourceURL=app.jsx\n');
  console.log('OK built ' + (out.code.length / 1024).toFixed(1) + ' KB');
} catch (e) {
  console.log('BUILD ERROR: ' + (e.message || e).toString().slice(0, 900));
  process.exit(1);
}
