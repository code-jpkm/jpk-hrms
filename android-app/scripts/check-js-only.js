// Fails if any TypeScript file sneaks into the app (JS / JSX only).
const fs = require('fs');
const path = require('path');

const bad = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', '.git', '.expo', 'dist', 'android', 'ios'].includes(name)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(name)) bad.push(full);
  }
}(path.join(__dirname, '..')));

if (bad.length) {
  console.error('TypeScript files are not allowed:\n' + bad.join('\n'));
  process.exit(1);
}
console.log('OK: JavaScript / JSX only');
