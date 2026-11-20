import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { link, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { readLegacyCfj, readLegacyCfjx } from '../src/storage/legacyCfj.ts';
import { decodeProjectArchive, encodeProjectArchive } from '../src/storage/projectArchive.ts';
import { writeProject } from '../src/storage/projectCompatibility.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const outputIndex = args.indexOf('--output');
const outputOption = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
const positional = args.filter((arg, index) => arg !== '--dry-run' && arg !== '--output' && (outputIndex < 0 || index !== outputIndex + 1));
if (positional.length !== 1 || (outputIndex >= 0 && (!outputOption || outputOption.startsWith('--'))) || args.some(arg => arg.startsWith('--') && !['--dry-run', '--output'].includes(arg))) {
  console.error('Usage: bun run scripts/convert-cfj.ts <file.cfj|file.cfjx|directory> [--output directory] [--dry-run]');
  process.exit(1);
}

const source = resolve(positional[0]);
const sourceStat = await stat(source);
const files = sourceStat.isDirectory()
  ? (await readdir(source, { withFileTypes: true })).filter(entry => entry.isFile() && ['.cfj', '.cfjx'].includes(extname(entry.name).toLowerCase())).map(entry => join(source, entry.name)).sort()
  : ['.cfj', '.cfjx'].includes(extname(source).toLowerCase()) ? [source] : [];
if (!files.length) throw new Error('No CFJ or CFJX files found.');
const outputDirectory = outputOption ? resolve(outputOption) : undefined;
if (outputDirectory && !dryRun) await mkdir(outputDirectory, { recursive: true });

function normalizedDocument(project: ReturnType<typeof writeProject>) {
  return JSON.parse(JSON.stringify(project, (_key, value: unknown) => {
    if (typeof value !== 'string') return value;
    const match = /^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
    return match ? `data:image/${match[1].toLowerCase()};base64,${Buffer.from(match[2], 'base64').toString('base64')}` : value;
  }));
}

let failures = 0;
for (const file of files) {
  const oldArchive = extname(file).toLowerCase() === '.cfjx';
  const target = join(outputDirectory ?? dirname(file), `${basename(file, extname(file))}${oldArchive ? '.converted' : ''}.cfjx`);
  let temporary: string | undefined;
  try {
    const project = oldArchive ? await readLegacyCfjx(new Uint8Array(await readFile(file))) : readLegacyCfj(await readFile(file, 'utf8'));
    const archive = await encodeProjectArchive(project);
    const restored = await decodeProjectArchive(archive);
    if (!isDeepStrictEqual(normalizedDocument(writeProject(project)), normalizedDocument(writeProject(restored)))) throw new Error('Round-trip verification failed.');
    if (!dryRun) {
      temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
      await writeFile(temporary, archive, { flag: 'wx' });
      const written = await decodeProjectArchive(new Uint8Array(await readFile(temporary)));
      if (!isDeepStrictEqual(normalizedDocument(writeProject(project)), normalizedDocument(writeProject(written)))) throw new Error('Written archive verification failed.');
      await link(temporary, target);
      await unlink(temporary);
      temporary = undefined;
    }
    console.log(`${dryRun ? 'VERIFIED' : 'CONVERTED'} ${basename(file)} -> ${basename(target)} (${archive.length} bytes)`);
  } catch (error) {
    if (oldArchive && error instanceof Error && error.message === 'Not a legacy single-JSON CFJX archive.') {
      console.log(`SKIPPED ${basename(file)} (not a legacy single-JSON CFJX archive)`);
      continue;
    }
    failures++;
    console.error(`FAILED ${basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
  }
}
console.log(`Processed ${files.length} file(s), ${failures} failed.`);
if (failures) process.exitCode = 1;