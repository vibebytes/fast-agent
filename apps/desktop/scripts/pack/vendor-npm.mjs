import {cpSync, existsSync, readdirSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, '../../../../staging/pack/npm');

function npmRootFromResolve() {
	try {
		const req = createRequire(join(here, 'noop.js'));
		return dirname(req.resolve('npm/package.json'));
	} catch {
		return null;
	}
}

function npmRootFromNodeLayout() {
	const candidate = resolve(dirname(process.execPath), '../lib/node_modules/npm');
	return existsSync(join(candidate, 'package.json')) ? candidate : null;
}

function npmRootFromVolta() {
	const image = join(process.env.HOME ?? '', '.volta/tools/image/npm');
	if (!existsSync(image)) return null;
	const best = readdirSync(image)
		.filter(v => statSync(join(image, v)).isDirectory())
		.sort((a, b) => b.localeCompare(a, undefined, {numeric: true}))[0];
	if (!best) return null;
	const candidate = join(image, best);
	return existsSync(join(candidate, 'package.json')) ? candidate : null;
}

const root = npmRootFromResolve() ?? npmRootFromNodeLayout() ?? npmRootFromVolta();
if (!root) {
	console.error('vendor-npm: no npm package found (devDependency, node layout, or volta image)');
	process.exit(1);
}
if (!existsSync(join(root, 'bin/npm-cli.js'))) {
	console.error(`vendor-npm: ${root} has no bin/npm-cli.js`);
	process.exit(1);
}
cpSync(root, dest, {recursive: true, dereference: true, force: true});
console.log(`vendor-npm: ${root} -> ${dest}`);
