#!/usr/bin/env node
// Mobile-side pairing E2E simulator against the running desktop engine.
// Phase 1: pin fingerprint (like probe), Phase 2: WS upgrade, Phase 3: Hello auth.
import {createConnection} from 'net';
import {createHash, randomBytes} from 'crypto';
import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
const tlsDir = path.join(HOME, '.fast', 'tls');
const runDir = path.join(HOME, '.fast', 'run');
const expectedFp = fs.readFileSync(path.join(runDir, 'bridge.fingerprint'), 'utf8').trim();
const token = fs.readFileSync(path.join(runDir, 'bridge.token'), 'utf8').trim();

const HOST = process.argv[2] || '127.0.0.1';
const PORT = process.argv[3] || '1979';
const BEARER_HOST = process.argv[4] || `${HOST}:${PORT}`;
const HOST_HEADER = BEARER_HOST.startsWith('[') ? BEARER_HOST : BEARER_HOST;
const URL_PATH = '/bridge';

function fail(stage, msg) {
  console.log(`[${stage}] FAIL: ${msg}`);
  process.exitCode = 1;
}

// ---- Phase 0: read cert, compute fingerprint (TrustManager would verify; we compare it)
const der = fs.readFileSync(path.join(tlsDir, 'cert.pem')).toString();
// strip PEM headers; cert is a single block
const b64 = der.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
const serverDer = Buffer.from(b64, 'base64');
const computed = createHash('sha256').update(serverDer).digest('hex');
if (expectedFp !== `sha256:${computed}`) {
  fail('fp-file', `fingerprint file ${expectedFp} != cert sha256:${computed}`);
} else {
  console.log(`[fp-file] OK sha256:${computed}`);
}

// ---- Phase 1: raw TLS handshake using the same cert (Node trusts explicit CA)
const tls = await import('tls');
const socket = tls.connect({
  host: HOST,
  port: Number(PORT),
  ca: der,
  servername: HOST,
  rejectUnauthorized: true,
  checkServerIdentity: () => undefined
});
const handshake = new Promise(resolve => {
  socket.once('secureConnect', () => resolve('ok'));
  socket.once('error', e => resolve('err:' + e.message));
});
const hs = await handshake;
if (hs !== 'ok') { fail('tls', hs); process.exit(1); }
const peerDer = socket.getPeerCertificate().raw;
const peerFp = createHash('sha256').update(peerDer).digest('hex');
if (peerFp !== computed) {
  fail('tls-pin', `peer fingerprint ${peerFp} != ${computed}`);
  process.exit(1);
}
console.log(`[tls] OK pinned ${peerFp}`);

// ---- Phase 2: WebSocket upgrade
const key = randomBytes(16).toString('base64');
let upgraded = false;
socket.write([
  `GET ${URL_PATH} HTTP/1.1`,
  `Host: ${HOST_HEADER}`,
  'Upgrade: websocket',
  'Connection: Upgrade',
  `Sec-WebSocket-Key: ${key}`,
  'Sec-WebSocket-Version: 13',
  '',
  ''
].join('\r\n'));

let buf = Buffer.alloc(0);
let helloOk = false;
const received = [];
let phase = 'upgrade';
let closed = false;
socket.on('data', chunk => {
  buf = Buffer.concat([buf, chunk]);
  if (phase === 'upgrade') {
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) return;
    const head = buf.subarray(0, idx).toString('utf8');
    buf = buf.subarray(idx + 4);
    const statusLine = head.split('\r\n')[0];
    if (!statusLine.includes('101')) { fail('upgrade', statusLine); socket.destroy(); return; }
    console.log(`[upgrade] OK ${statusLine}`);
    phase = 'hello';
    // ---- Phase 3: masked text frame with Hello JSON
    const hello = JSON.stringify({
      type: 'Hello',
      protocolVersion: 1,
      clientId: 'probe-' + randomBytes(4).toString('hex'),
      clientKind: 'fast-mobile-sim',
      clientVersion: '0.0.0',
      clientName: 'pair-e2e-sim',
      authToken: token
    });
    const payload = Buffer.from(hello, 'utf8');
    const mask = randomBytes(4);
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x81, 0x80 | payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const frame = Buffer.concat([header, mask, payload]);
    for (let i = 0; i < payload.length; i++) frame[header.length + 4 + i] = payload[i] ^ mask[i % 4];
    socket.write(frame);
  }
  while (buf.length >= 2) {
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
    let maskKey = null;
    if (masked) { maskKey = buf.subarray(off, off + 4); off += 4; }
    if (buf.length < off + len) return;
    const raw = buf.subarray(off, off + len);
    let payload = raw;
    if (maskKey) {
      payload = Buffer.alloc(len);
      for (let i = 0; i < len; i++) payload[i] = raw[i] ^ maskKey[i % 4];
    }
    buf = buf.subarray(off + len);
    if (opcode === 0x8) {
      const code = len >= 2 ? payload.readUInt16BE(0) : -1;
      const reason = len > 2 ? payload.subarray(2).toString('utf8') : '';
      console.log(`[ws] close frame code=${code} reason="${reason}"`);
      closed = true;
    }
    else if (opcode === 0x9) { /* ping */ }
    else if (opcode === 0xa) { /* pong */ }
    else if (opcode === 0x1) { received.push(payload.toString('utf8')); }
    if (fin && opcode === 0x1) {
      const line = payload.toString('utf8');
      console.log(`[hello-reply] ${line}`);
      try {
        const msg = JSON.parse(line);
        helloOk = msg.type === 'HelloOk';
        if (msg.type === 'HelloOk') console.log('[hello] OK');
        else if (msg.type === 'HelloReject' || msg.type === 'Error') fail('hello', line);
      } catch {
        fail('hello', 'unparsable reply: ' + line);
      }
    }
  }
});
socket.on('close', () => {
  if (phase === 'upgrade' && !closed) {
    // server closed before 101
  }
});
socket.on('error', e => { fail('sock', e.message); });

setTimeout(() => {
  if (phase === 'upgrade') fail('upgrade-timeout', 'no 101 within 6s');
  else if (!helloOk && !process.exitCode) fail('hello-timeout', `no HelloOk; replies=${JSON.stringify(received)}`);
  socket.destroy();
  process.exit(process.exitCode || 0);
}, 6000);