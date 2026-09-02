import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = ['check-catalog-parity.mjs', 'check-key-refs.mjs'];
let failed = false;
for (const name of scripts) {
  const result = spawnSync(process.execPath, [join(here, name)], {stdio: 'inherit'});
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
