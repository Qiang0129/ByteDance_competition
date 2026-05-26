const fs = require('fs');
const files = [
  'frontend/src/pages/owner/OwnerTasks.tsx',
  'frontend/src/pages/owner/OwnerDatasets.tsx',
  'frontend/src/pages/reviewer/ReviewerAi.tsx',
];
const bad = 'pageSize: 10, showSizeChanger: true';
const good = 'defaultPageSize: 10, showSizeChanger: true';
files.forEach(f => {
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes(bad)) {
    s = s.replaceAll(bad, good);
    fs.writeFileSync(f, s);
    console.log('fixed', f);
  } else {
    console.log('skip', f);
  }
});
