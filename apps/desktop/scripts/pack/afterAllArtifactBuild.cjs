const {execFileSync} = require('node:child_process');
const {existsSync} = require('node:fs');
const path = require('node:path');

/** After .pkg is built, wrap it in a .dmg the user can open. */
exports.default = async function afterAllArtifactBuild(result) {
	const wrap = path.resolve(__dirname, '../../../../scripts/wrap-pkg-dmg.sh');
	if (!existsSync(wrap)) {
		throw new Error(`afterAllArtifactBuild: missing ${wrap}`);
	}
	const extra = [];
	for (const artifact of result.artifactPaths ?? []) {
		if (!artifact.endsWith('.pkg')) continue;
		const dmg = artifact.replace(/\.pkg$/i, '.dmg');
		execFileSync('bash', [wrap, artifact, dmg], {stdio: 'inherit'});
		extra.push(dmg);
	}
	return extra;
};
