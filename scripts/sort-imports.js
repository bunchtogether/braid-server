const fs = require('fs');
const path = require('path');

function findInDir(_dir, filter, fileList = []) {
  const dir = path.resolve(__dirname, _dir);
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const fileStat = fs.lstatSync(filePath);

    if (fileStat.isDirectory()) {
      findInDir(filePath, filter, fileList);
    } else if (filter.test(filePath)) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

const filePaths = [
  ...findInDir('../src', /\.jsx?$/),
  ...findInDir('../tests', /\.jsx?$/),
];

const regexes = [
  /\s'react'/,
  /\s'immutable'/,
  /\s'uuid'/,
  /\s'lodash/,
  /\s'(?!\.|@bunchtogether|lib|containers|components|shared-redux|bunch-redux)/,
  /\s'@bunchtogether/,
  /\s'shared-redux\//,
  /\s'bunch-redux\//,
  /\s'lib\//,
  /\s'containers\//,
  /\s'components\//,
  /\s'\.\./,
  /\s'\.[^.]/,
];

const sortImports = (x, y) => {
  for (const regex of regexes) {
    const xMatch = regex.test(x);
    const yMatch = regex.test(y);
    if (xMatch === yMatch) {
      continue;
    }
    if (xMatch) {
      return -1;
    }
    if (yMatch) {
      return 1;
    }
  }
  const xSource = x.match(/('.*?')/m)[1];
  const ySource = y.match(/('.*?')/m)[1];
  if (xSource === ySource) {
    return x < y ? -1 : 1;
  }
  return xSource < ySource ? -1 : 1;
};

let changedFiles = 0;

for (const filePath of filePaths) {
  let content = fs.readFileSync(filePath, 'utf8');
  const imports = [];
  const placeholders = [];
  const matches = content.matchAll(/^import\s[^;]*?';/gm);
  for (const match of matches) {
    const s = match[0];
    const placeholder = `__REPLACE__${Math.random().toString(36)}`;
    content = content.replace(s, placeholder);
    imports.push(s);
    placeholders.push(placeholder);
  }
  let didMakeChange = true;
  const originalImports = imports.join('\n');
  while (didMakeChange) {
    const oldImports = imports.join('\n');
    imports.sort(sortImports);
    const newImports = imports.join('\n');
    didMakeChange = oldImports !== newImports;
  }
  for (let i = 0; i < imports.length; i += 1) {
    const importContent = imports[i];
    const importMatches = importContent.matchAll(/\{([^\}]+)\}/gm);
    for (const match of importMatches) {
      const s = match[1];
      const sortedImports = s.split(',').map((s) => s.trim()).filter((s) => s !== '').sort();
      if (sortedImports.length > 1) {
        imports[i] = importContent.replace(s, `\n${sortedImports.map((s) => `  ${s}`).join(',\n')},\n`);
      } else {
        imports[i] = importContent.replace(s, ` ${sortedImports[0]} `);
      }
    }
  }
  const updatedImports = imports.join('\n');
  if (originalImports !== updatedImports) {
    changedFiles += 1;
  } else {
    continue;
  }
  for (let i = 0; i < imports.length; i += 1) {
    content = content.replace(placeholders[i], imports[i]);
  }
  fs.writeFileSync(filePath, content, { encoding: 'utf8' });
}

console.log(`Changed ${changedFiles} ${changedFiles === 1 ? 'file' : 'files'}`);

