import fs from 'fs';

const stats = JSON.parse(
  fs.readFileSync('./dist/stats.json', 'utf8'),
);

console.log(
  `Bundle Size: ${stats.assets[0].size}`,
);