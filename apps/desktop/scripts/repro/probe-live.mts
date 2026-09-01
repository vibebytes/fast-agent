import {mkdtempSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BridgeHost, tryConnectUnix} from '@fastllm/bridge-client';

const SOCKET = join(homedir(), '.fast/run/bridge.sock');
const accepting = await tryConnectUnix(SOCKET, 2_000);
if (!accepting) { console.log('no socket'); process.exit(0); }
const ws = mkdtempSync(join(tmpdir(), 'probe-live-'));
const events: any[] = [];
const host = new BridgeHost();
await host.connect({clientKind: 'fast-ide', clientId: `probe-${randomUUID()}`, cwd: ws, heartbeatMs: 0}, {
  onEvent: e => events.push(e),
  onError: m => console.log('onError:', m),
  onClose: () => console.log('onClose')
});
host.send({type: 'CreateProject', projectType: 'coding', rootPath: ws, displayName: 'probe-e2e'});
await new Promise(r => setTimeout(r, 4000));
const created: any = events.find(e => e.type === 'command_result' && e.name === 'CreateProject');
console.log('CreateProject result:', JSON.stringify(created));
const projectId = String(created?.projectId ?? '');
console.log('projectId:', JSON.stringify(projectId));
host.send({type: 'CreateSession', projectId, title: 'probe-sess', taskId: `task-${randomUUID()}`});
await new Promise(r => setTimeout(r, 10000));
console.log('events since:', events.slice(1).map(e => `${e.type}${'name' in e ? ':'+e.name : ''}${'status' in e ? '/'+e.status : ''}${'sessionId' in e ? '#'+String(e.sessionId).slice(0,8) : ''}${'message' in e ? '|'+String(e.message).slice(0,60) : ''}`).join('\n  '));
const sessResult: any = events.find(e => e.type === 'command_result' && e.name === 'CreateSession');
console.log('CreateSession result:', JSON.stringify(sessResult));
process.exit(0);
