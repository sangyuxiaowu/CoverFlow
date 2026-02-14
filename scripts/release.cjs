const { execSync } = require("child_process");

const run = (command) => execSync(command, { stdio: "inherit" });
const read = (command) => execSync(command, { encoding: "utf8" }).trim();

const branch = read("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  console.error(`Release must run on main. Current branch: ${branch}`);
  process.exit(1);
}

const status = read("git status --porcelain");
if (status) {
  const dirtyFiles = status
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
  const allowed = new Set(["package.json"]);
  const disallowed = dirtyFiles.filter((file) => !allowed.has(file));
  if (disallowed.length > 0) {
    console.error(`Working tree has uncommitted files: ${disallowed.join(", ")}`);
    process.exit(1);
  }
}

run("npm run prebuild:tauri");

const nextStatus = read("git status --porcelain");
if (!nextStatus) {
  console.error("No changes detected after prebuild:tauri. Did you update version?");
  process.exit(1);
}

run("git add -A");

const version = require("../package.json").version;
if (!version) {
  console.error("Missing package.json version.");
  process.exit(1);
}

run(`git commit -m "chore(release): v${version}"`);
run(`git tag v${version}`);
run("git push origin main");
run("git push --tags");
