const {execFileSync} = require('node:child_process');
const {existsSync, renameSync} = require('node:fs');
const path = require('node:path');

// electron-builder ${arch} is not stable (AppImage x64 → x86_64). Force --os tokens.
const SETTLE = [
	[/^Fast-(.+)-linux-x86_64\.AppImage$/i, 'Fast-$1-linux-x64.AppImage'],
	[/^Fast-(.+)-linux-amd64\.AppImage$/i, 'Fast-$1-linux-x64.AppImage'],
	[/^Fast-(.+)-linux-aarch64\.AppImage$/i, 'Fast-$1-linux-arm64.AppImage'],
	[/^Fast Setup (.+)\.exe$/i, 'Fast-$1-win-x64.exe']
];

function settleName(file) {
	const dir = path.dirname(file);
	const base = path.basename(file);
	for (const [re, tmpl] of SETTLE) {
		const m = base.match(re);
		if (!m) continue;
		const dest = path.join(dir, tmpl.replace('$1', m[1]));
		if (dest === file || !existsSync(file)) return dest;
		renameSync(file, dest);
		const block = `${file}.blockmap`;
		if (existsSync(block)) {
			renameSync(block, `${dest}.blockmap`);
		}
		return dest;
	}
	return file;
}

/** Settle installer names to --os tokens, then wrap mac .pkg in a .dmg. */
exports.default = async function afterAllArtifactBuild(result) {
	const wrap = path.resolve(__dirname, '../../../../scripts/wrap-pkg-dmg.sh');
	if (!existsSync(wrap)) {
		throw new Error(`afterAllArtifactBuild: missing ${wrap}`);
	}
	const extra = [];
	const settled = [];
	for (const artifact of result.artifactPaths ?? []) {
		const next = settleName(artifact);
		settled.push(next);
		if (next !== artifact) extra.push(next);
	}
	for (const artifact of settled) {
		if (!artifact.endsWith('.pkg') || !existsSync(artifact)) continue;
		const dmg = artifact.replace(/\.pkg$/i, '.dmg');
		execFileSync('bash', [wrap, artifact, dmg], {stdio: 'inherit'});
		extra.push(dmg);
	}
	return extra;
};
