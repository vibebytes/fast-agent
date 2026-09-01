const {execFileSync} = require('node:child_process');
const {cpSync, copyFileSync, existsSync} = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
	const product = context.packager.appInfo.productFilename;
	const resources =
		context.electronPlatformName === 'darwin'
			? path.join(context.appOutDir, `${product}.app`, 'Contents', 'Resources')
			: path.join(context.appOutDir, 'resources');
	const shims = path.resolve(__dirname, '../../../../scripts/write-shims.sh');
	const engineCli = path.join(resources, 'engine', 'bin', 'fast-cli');
	const engineBat = path.join(resources, 'engine', 'bin', 'fast-cli.bat');
	if (!existsSync(engineCli) && !existsSync(engineBat)) {
		throw new Error(`afterPack: missing packaged engine at ${resources}/engine/bin/fast-cli`);
	}
	if (!existsSync(path.join(resources, 'tui', 'dist', 'main.js'))) {
		throw new Error(`afterPack: missing packaged tui at ${resources}/tui/dist/main.js`);
	}
	if (context.electronPlatformName === 'darwin') {
		const car = path.resolve(__dirname, '../../build/Assets.car');
		if (!existsSync(car)) {
			throw new Error('afterPack: missing build/Assets.car (run scripts/pack/make-mac-icon.sh)');
		}
		copyFileSync(car, path.join(resources, 'Assets.car'));
	}
	const vendoredNpm = path.resolve(__dirname, '../../../../staging/pack/npm');
	if (existsSync(path.join(vendoredNpm, 'bin', 'npm-cli.js'))) {
		cpSync(vendoredNpm, path.join(resources, 'npm'), {recursive: true, dereference: true, force: true});
	}
	execFileSync('bash', [shims, resources], {stdio: 'inherit'});
	const names =
		context.electronPlatformName === 'win32'
			? ['fast-cli.bat', 'fast.bat', 'fast-ink.bat']
			: ['fast-cli', 'fast', 'fast-ink'];
	for (const name of names) {
		if (!existsSync(path.join(resources, 'bin', name))) {
			throw new Error(`afterPack: missing PATH shim ${resources}/bin/${name}`);
		}
	}
};
