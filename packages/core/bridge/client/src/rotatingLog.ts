import {closeSync, existsSync, openSync, renameSync, unlinkSync, writeSync, statSync} from 'node:fs';
import {Writable} from 'node:stream';

export const DAEMON_LOG_MAX_BYTES = 50 * 1024 * 1024;
export const DAEMON_LOG_KEEP = 3;

/**
 * Size-capped, rotating append sink for a child process's stdout/stderr.
 * `file` grows to `maxBytes`, then rotates to `file.1` … `file.<keep>` (oldest dropped).
 * Bounded disk use is the whole point: a supervisor restart storm once wrote 47 GB to an
 * uncapped `bridge-daemon-*.out.log`. Synchronous writes keep ordering trivial; volume is
 * engine log output, not a hot path.
 */
export function createRotatingLogStream(
	file: string,
	opts: {maxBytes?: number; keep?: number} = {}
): Writable {
	const maxBytes = opts.maxBytes ?? DAEMON_LOG_MAX_BYTES;
	const keep = opts.keep ?? DAEMON_LOG_KEEP;
	let fd = openSync(file, 'a');
	let size = existsSync(file) ? statSync(file).size : 0;

	const rotate = (): void => {
		closeSync(fd);
		for (let i = keep; i >= 1; i--) {
			const from = i === 1 ? file : `${file}.${i - 1}`;
			const to = `${file}.${i}`;
			if (!existsSync(from)) continue;
			if (i === keep && existsSync(to)) unlinkSync(to);
			renameSync(from, to);
		}
		fd = openSync(file, 'a');
		size = 0;
	};

	return new Writable({
		write(chunk: Buffer | string, _enc, cb) {
			const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
			if (size + buf.length > maxBytes && size > 0) rotate();
			writeSync(fd, buf);
			size += buf.length;
			cb();
		},
		final(cb) {
			closeSync(fd);
			cb();
		}
	});
}
