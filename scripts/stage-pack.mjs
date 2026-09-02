#!/usr/bin/env node
// Relocatable engine + tui tree at staging/pack (agent sbt dist is engine-only).
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'staging', 'pack');
const engineSrc = path.join(root, 'modules', 'engine', 'current');
const engineCli = path.join(engineSrc, 'bin', 'fast-cli');
if (!existsSync(engineCli)) {
	console.error('missing modules/engine/current/bin/fast-cli — run pnpm fetch-engine');
	process.exit(1);
}

const protocolSrc = path.join(root, 'packages', 'core', 'bridge', 'protocol');
const clientSrc = path.join(root, 'packages', 'core', 'bridge', 'client');
const sessionSrc = path.join(root, 'packages', 'core', 'session-view');
const tuiSrc = path.join(root, 'apps', 'tui');

for (const [label, file] of [
	['protocol', path.join(protocolSrc, 'dist', 'index.js')],
	['client', path.join(clientSrc, 'dist', 'index.js')],
	['session-view', path.join(sessionSrc, 'dist', 'index.js')],
	['tui', path.join(tuiSrc, 'dist', 'main.js')]
]) {
	if (!existsSync(file)) {
		console.error(`missing ${label} build: ${file}`);
		process.exit(1);
	}
}

rmSync(dest, {recursive: true, force: true});
mkdirSync(dest, {recursive: true});
const engineDest = path.join(dest, 'engine');
cpSync(engineSrc, engineDest, {recursive: true});

function stampEngineId(engineDir) {
	const pom = readFileSync(path.join(root, 'extensions', 'pom.xml'), 'utf8');
	const ver = pom.match(/<agent\.version>([^<]+)<\/agent\.version>/)?.[1]?.trim() || 'unknown';
	const jreFile = path.join(engineDir, '.fast-jre');
	const jre = existsSync(jreFile) ? readFileSync(jreFile, 'utf8').trim() : 'no-jre';
	const packedAt = new Date().toISOString();
	const id = `${ver} ${jre} ${packedAt}`;
	writeFileSync(path.join(engineDir, '.fast-engine-id'), `${id}\n`);
	console.log(`engine id ${id}`);
}

stampEngineId(engineDest);

function writePkg(dir, json) {
	mkdirSync(dir, {recursive: true});
	writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(json, null, 2)}\n`);
}

const protocolDir = path.join(dest, 'packages', 'bridge-protocol');
cpSync(path.join(protocolSrc, 'dist'), path.join(protocolDir, 'dist'), {recursive: true});
writePkg(protocolDir, {
	name: '@fastllm/bridge-protocol',
	version: '0.1.0',
	type: 'module',
	main: './dist/index.js',
	types: './dist/index.d.ts',
	exports: {'.': {types: './dist/index.d.ts', import: './dist/index.js'}},
	dependencies: {zod: '^4.4.3'},
	license: 'ISC'
});

const clientDir = path.join(dest, 'packages', 'bridge-client');
cpSync(path.join(clientSrc, 'dist'), path.join(clientDir, 'dist'), {recursive: true});
writePkg(clientDir, {
	name: '@fastllm/bridge-client',
	version: '0.1.0',
	type: 'module',
	main: './dist/index.js',
	types: './dist/index.d.ts',
	exports: {'.': {types: './dist/index.d.ts', import: './dist/index.js'}},
	dependencies: {
		'@fastllm/bridge-protocol': 'file:../bridge-protocol',
		ws: '^8.18.3'
	},
	license: 'ISC'
});

const sessionDir = path.join(dest, 'packages', 'session-view');
cpSync(path.join(sessionSrc, 'dist'), path.join(sessionDir, 'dist'), {recursive: true});
writePkg(sessionDir, {
	name: '@fast-ide/session-view',
	version: '0.0.1',
	type: 'module',
	main: './dist/index.js',
	types: './dist/index.d.ts',
	exports: {'.': {types: './dist/index.d.ts', import: './dist/index.js'}},
	dependencies: {'@fastllm/bridge-protocol': 'file:../bridge-protocol'},
	license: 'ISC'
});

const tuiPkg = JSON.parse(readFileSync(path.join(tuiSrc, 'package.json'), 'utf8'));
const tuiDir = path.join(dest, 'tui');
mkdirSync(tuiDir, {recursive: true});
cpSync(path.join(tuiSrc, 'dist'), path.join(tuiDir, 'dist'), {recursive: true});
writePkg(tuiDir, {
	name: 'fast-ink',
	version: tuiPkg.version ?? '1.0.0',
	type: 'module',
	bin: {'fast-ink': './dist/main.js'},
	main: 'dist/main.js',
	dependencies: {
		'@fast-ide/session-view': 'file:../packages/session-view',
		'@fastllm/bridge-client': 'file:../packages/bridge-client',
		'@fastllm/bridge-protocol': 'file:../packages/bridge-protocol',
		chalk: tuiPkg.dependencies.chalk,
		execa: tuiPkg.dependencies.execa,
		ink: tuiPkg.dependencies.ink,
		react: tuiPkg.dependencies.react,
		'string-width': tuiPkg.dependencies['string-width']
	}
});

function npmInstall(dir) {
	execFileSync('npm', ['install', '--omit=dev'], {cwd: dir, stdio: 'inherit'});
}

npmInstall(protocolDir);
npmInstall(clientDir);
npmInstall(sessionDir);
npmInstall(tuiDir);

function assertInside(label, file) {
	if (!existsSync(file)) {
		throw new Error(`${label} missing after staging npm install: ${file}`);
	}
	const real = path.resolve(file);
	if (!real.startsWith(path.resolve(dest))) {
		throw new Error(`${label} escapes pack root (${real})`);
	}
}

assertInside('tui ink', path.join(tuiDir, 'node_modules', 'ink', 'package.json'));
assertInside(
	'session-view dist',
	path.join(tuiDir, 'node_modules', '@fast-ide', 'session-view', 'dist', 'index.js')
);
assertInside(
	'bridge-client',
	path.join(tuiDir, 'node_modules', '@fastllm', 'bridge-client', 'dist', 'index.js')
);

execFileSync('bash', [path.join(root, 'scripts', 'write-shims.sh'), dest], {stdio: 'inherit'});
console.log(`staged ${dest}`);
