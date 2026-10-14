const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const runGit = (args) => execFileSync('git', args, { cwd: root, stdio: 'inherit' });
const readGit = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const parseVersion = (version) => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  return match ? match.slice(1).map(Number) : null;
};

const version = process.argv[2];
if (!version || process.argv.length > 3) {
  console.error('Usage: npm run release -- <major.minor.patch>');
  process.exit(1);
}

const nextVersion = parseVersion(version);
if (!nextVersion) {
  console.error(`Invalid version: ${version}. Expected major.minor.patch.`);
  process.exit(1);
}

const branch = readGit(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') {
  console.error(`Release must run on main. Current branch: ${branch}`);
  process.exit(1);
}

if (readGit(['status', '--porcelain'])) {
  console.error('Release requires a clean working tree.');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const currentVersion = parseVersion(packageJson.version);
if (!currentVersion) {
  console.error(`Invalid package.json version: ${packageJson.version}`);
  process.exit(1);
}

const firstDifference = nextVersion.findIndex((part, index) => part !== currentVersion[index]);
if (
  firstDifference === -1 ||
  nextVersion[firstDifference] < currentVersion[firstDifference]
) {
  console.error(`Release version must be greater than current version ${packageJson.version}.`);
  process.exit(1);
}

const tag = `v${version}`;
if (readGit(['tag', '--list', tag]) === tag) {
  console.error(`Tag already exists: ${tag}`);
  process.exit(1);
}

packageJson.version = version;
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

execSync('npm run build:tauri', { cwd: root, stdio: 'inherit' });

const filesToStage = [
  'package.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
].filter((file) => fs.existsSync(path.join(root, file)));

runGit(['add', '--', ...filesToStage]);
runGit(['commit', '-m', `release: ${tag}`]);
runGit(['tag', '-a', tag, '-m', `release: ${tag}`]);
runGit(['push', 'origin', 'main', '--tags']);
