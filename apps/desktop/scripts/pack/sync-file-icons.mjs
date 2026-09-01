/**
 * Copy Material Icon Theme SVGs used by file name/extension maps and emit a
 * slim manifest for the renderer. Run via `pnpm sync-file-icons`.
 */
import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateManifest} from 'material-icon-theme';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, '../..');
const pkgJsonPath = require.resolve('material-icon-theme/package.json');
const iconsSrc = join(dirname(pkgJsonPath), 'icons');
const iconsDest = join(desktopRoot, 'src/renderer/public/file-icons');
const manifestDest = join(desktopRoot, 'src/renderer/src/files/fileIconManifest.json');
const metaDest = join(desktopRoot, 'src/renderer/public/file-icons/.sync-meta.json');

const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
const force = process.argv.includes('--force');
try {
	if (!force) {
		const meta = JSON.parse(readFileSync(metaDest, 'utf8'));
		if (meta.version === pkg.version) {
			console.log(`[sync-file-icons] up to date (material-icon-theme@${pkg.version})`);
			process.exit(0);
		}
	}
} catch {
	/* regenerate */
}

const manifest = generateManifest();

const fileNames = manifest.fileNames ?? {};
const fileExtensions = manifest.fileExtensions ?? {};
const lightFileNames = manifest.light?.fileNames ?? {};
const lightFileExtensions = manifest.light?.fileExtensions ?? {};
const defaultFile = manifest.file ?? 'file';
const lightFile = manifest.light?.file ?? defaultFile;

const used = new Set([defaultFile, lightFile]);
for (const id of Object.values(fileNames)) used.add(id);
for (const id of Object.values(fileExtensions)) used.add(id);
for (const id of Object.values(lightFileNames)) used.add(id);
for (const id of Object.values(lightFileExtensions)) used.add(id);

rmSync(iconsDest, {recursive: true, force: true});
mkdirSync(iconsDest, {recursive: true});
mkdirSync(dirname(manifestDest), {recursive: true});

let copied = 0;
for (const id of used) {
	const src = join(iconsSrc, `${id}.svg`);
	try {
		cpSync(src, join(iconsDest, `${id}.svg`));
		copied += 1;
	} catch {
		console.warn(`[sync-file-icons] missing svg: ${id}.svg`);
	}
}

const slim = {
	version: pkg.version,
	file: defaultFile,
	fileNames,
	fileExtensions,
	light: {
		file: lightFile,
		fileNames: lightFileNames,
		fileExtensions: lightFileExtensions
	}
};

writeFileSync(manifestDest, `${JSON.stringify(slim)}\n`, 'utf8');
writeFileSync(
	metaDest,
	`${JSON.stringify({version: pkg.version, icons: copied, generatedAt: new Date().toISOString()}, null, 2)}\n`,
	'utf8'
);

console.log(
	`[sync-file-icons] material-icon-theme@${pkg.version}: ${copied} icons → public/file-icons, manifest written`
);
