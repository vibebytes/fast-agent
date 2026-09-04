// Minimal QR encoder: byte mode, ECC level L, versions 1-9 (ISO/IEC 18004).
const DATA_CODEWORDS = [0, 19, 34, 55, 80, 108, 136, 156, 194, 232];
const ECC_PER_BLOCK = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30];
const BLOCKS = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2];
const ALIGNMENT: number[][] = [
	[],
	[],
	[6, 18],
	[6, 22],
	[6, 26],
	[6, 30],
	[6, 34],
	[6, 22, 38],
	[6, 24, 42],
	[6, 26, 46]
];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
	EXP[i] = x;
	LOG[x] = i;
	x <<= 1;
	if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

function gfMul(a: number, b: number): number {
	return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

function rsDivisor(degree: number): number[] {
	const result = new Array<number>(degree).fill(0);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < degree; j++) {
			result[j] = gfMul(result[j], root);
			if (j + 1 < degree) result[j] ^= result[j + 1];
		}
		root = gfMul(root, 2);
	}
	return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
	const result = new Array<number>(divisor.length).fill(0);
	for (const b of data) {
		const factor = b ^ result.shift()!;
		result.push(0);
		for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
	}
	return result;
}

function pickVersion(byteLen: number): number {
	for (let v = 1; v <= 9; v++) {
		if (byteLen * 8 + 16 <= DATA_CODEWORDS[v] * 8) return v;
	}
	throw new Error('pairing payload too long for QR');
}

function buildCodewords(bytes: Uint8Array, version: number): number[] {
	const capacityBits = DATA_CODEWORDS[version] * 8;
	const bits: number[] = [];
	const pushBits = (val: number, len: number) => {
		for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
	};
	pushBits(0b0100, 4);
	pushBits(bytes.length, 8);
	for (const b of bytes) pushBits(b, 8);
	pushBits(0, Math.min(4, capacityBits - bits.length));
	while (bits.length % 8 !== 0) bits.push(0);
	const data: number[] = [];
	for (let i = 0; i < bits.length; i += 8) {
		let byte = 0;
		for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
		data.push(byte);
	}
	for (let pad = 0xec; data.length < DATA_CODEWORDS[version]; pad ^= 0xec ^ 0x11) data.push(pad);
	const blocks = BLOCKS[version];
	const eccLen = ECC_PER_BLOCK[version];
	const dataLen = DATA_CODEWORDS[version] / blocks;
	const divisor = rsDivisor(eccLen);
	const eccs: number[][] = [];
	for (let b = 0; b < blocks; b++) {
		eccs.push(rsRemainder(data.slice(b * dataLen, (b + 1) * dataLen), divisor));
	}
	const out: number[] = [];
	for (let i = 0; i < dataLen; i++) {
		for (let b = 0; b < blocks; b++) out.push(data[b * dataLen + i]);
	}
	for (let i = 0; i < eccLen; i++) {
		for (let b = 0; b < blocks; b++) out.push(eccs[b][i]);
	}
	return out;
}

function drawFormat(
	grid: (boolean | null)[][],
	isFunction: boolean[][],
	size: number,
	mask: number
): void {
	const data = (0b01 << 3) | mask;
	let rem = data;
	for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
	const bits = ((data << 10) | rem) ^ 0x5412;
	const bit = (i: number) => ((bits >>> i) & 1) !== 0;
	const set = (x: number, y: number, dark: boolean) => {
		grid[y][x] = dark;
		isFunction[y][x] = true;
	};
	for (let i = 0; i <= 5; i++) set(8, i, bit(i));
	set(8, 7, bit(6));
	set(8, 8, bit(7));
	set(7, 8, bit(8));
	for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
	for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
	for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
	set(8, size - 8, true);
}

function drawVersion(
	grid: (boolean | null)[][],
	isFunction: boolean[][],
	size: number,
	version: number
): void {
	let rem = version;
	for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
	const bits = (version << 12) | rem;
	for (let i = 0; i < 18; i++) {
		const dark = ((bits >>> i) & 1) !== 0;
		const a = size - 11 + (i % 3);
		const b = Math.floor(i / 3);
		grid[b][a] = dark;
		grid[a][b] = dark;
		isFunction[b][a] = true;
		isFunction[a][b] = true;
	}
}

function drawFunctionPatterns(
	grid: (boolean | null)[][],
	isFunction: boolean[][],
	size: number,
	version: number
): void {
	const set = (x: number, y: number, dark: boolean) => {
		grid[y][x] = dark;
		isFunction[y][x] = true;
	};
	for (let i = 0; i < size; i++) {
		set(6, i, i % 2 === 0);
		set(i, 6, i % 2 === 0);
	}
	const finder = (cx: number, cy: number) => {
		for (let dy = -4; dy <= 4; dy++) {
			for (let dx = -4; dx <= 4; dx++) {
				const x = cx + dx;
				const y = cy + dy;
				if (x >= 0 && x < size && y >= 0 && y < size) {
					const dist = Math.max(Math.abs(dx), Math.abs(dy));
					set(x, y, dist !== 2 && dist !== 4);
				}
			}
		}
	};
	finder(3, 3);
	finder(size - 4, 3);
	finder(3, size - 4);
	const align = ALIGNMENT[version];
	for (let i = 0; i < align.length; i++) {
		for (let j = 0; j < align.length; j++) {
			// Skip the three finder corners. Still draw alignments that sit on the
			// timing pattern — those overwrite timing, same as ISO/IEC 18004.
			if (i === 0 && j === 0) continue;
			if (i === 0 && j === align.length - 1) continue;
			if (i === align.length - 1 && j === 0) continue;
			const cx = align[i];
			const cy = align[j];
			for (let dy = -2; dy <= 2; dy++) {
				for (let dx = -2; dx <= 2; dx++) {
					set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
				}
			}
		}
	}
	drawFormat(grid, isFunction, size, 0);
	if (version >= 7) drawVersion(grid, isFunction, size, version);
}

function drawCodewords(
	grid: (boolean | null)[][],
	isFunction: boolean[][],
	codewords: number[],
	size: number
): number {
	let i = 0;
	let upward = true;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vert = 0; vert < size; vert++) {
			for (let j = 0; j < 2; j++) {
				const x = right - j;
				const y = upward ? size - 1 - vert : vert;
				if (!isFunction[y][x] && i < codewords.length * 8) {
					grid[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
					i++;
				}
			}
		}
		upward = !upward;
	}
	return i;
}

function penalty(grid: (boolean | null)[][], size: number): number {
	let result = 0;
	const runColor = (x: number, y: number) => grid[y][x] === true;
	for (let y = 0; y < size; y++) {
		let color = false;
		let runLen = 0;
		let history = [0, 0, 0, 0, 0, 0, 0];
		for (let x = 0; x < size; x++) {
			if (runColor(x, y) === color) {
				runLen++;
				if (runLen === 5) result += 3;
				else if (runLen > 5) result++;
			} else {
				addHistory(runLen, history, size);
				if (!color) result += countPatterns(history) * 40;
				color = runColor(x, y);
				runLen = 1;
			}
		}
		result += terminateAndCount(color, runLen, history, size) * 40;
	}
	for (let x = 0; x < size; x++) {
		let color = false;
		let runLen = 0;
		let history = [0, 0, 0, 0, 0, 0, 0];
		for (let y = 0; y < size; y++) {
			if (runColor(x, y) === color) {
				runLen++;
				if (runLen === 5) result += 3;
				else if (runLen > 5) result++;
			} else {
				addHistory(runLen, history, size);
				if (!color) result += countPatterns(history) * 40;
				color = runColor(x, y);
				runLen = 1;
			}
		}
		result += terminateAndCount(color, runLen, history, size) * 40;
	}
	for (let y = 0; y < size - 1; y++) {
		for (let x = 0; x < size - 1; x++) {
			const color = grid[y][x] === true;
			if (color === (grid[y][x + 1] === true) && color === (grid[y + 1][x] === true) && color === (grid[y + 1][x + 1] === true)) {
				result += 3;
			}
		}
	}
	let dark = 0;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (grid[y][x] === true) dark++;
		}
	}
	const total = size * size;
	const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
	result += k * 10;
	return result;
}

function terminateAndCount(color: boolean, runLen: number, history: number[], size: number): number {
	if (color) {
		addHistory(runLen, history, size);
		runLen = 0;
	}
	runLen += size;
	addHistory(runLen, history, size);
	return countPatterns(history);
}

function addHistory(runLen: number, history: number[], size: number): void {
	if (history[0] === 0) runLen += size;
	history.pop();
	history.unshift(runLen);
}

function countPatterns(history: number[]): number {
	const n = history[1];
	const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
	return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
}

export function encodeQrMatrix(text: string): boolean[][] {
	const bytes = new TextEncoder().encode(text);
	const version = pickVersion(bytes.length);
	const size = version * 4 + 17;
	const modules: (boolean | null)[][] = Array.from({length: size}, () => new Array<boolean | null>(size).fill(null));
	const isFunction = Array.from({length: size}, () => new Array<boolean>(size).fill(false));
	drawFunctionPatterns(modules, isFunction, size, version);
	const codewords = buildCodewords(bytes, version);
	const placed = drawCodewords(modules, isFunction, codewords, size);
	if (placed !== codewords.length * 8) {
		throw new Error(`QR v${version} placed ${placed} of ${codewords.length * 8} bits`);
	}
	let best: {penalty: number; grid: (boolean | null)[][]} | null = null;
	for (let mask = 0; mask < 8; mask++) {
		const candidate = modules.map(row => row.slice());
		applyMask(candidate, isFunction, mask, size);
		drawFormat(candidate, isFunction, size, mask);
		const score = penalty(candidate, size);
		if (!best || score < best.penalty) best = {penalty: score, grid: candidate};
	}
	return best!.grid.map(row => row.map(cell => cell === true));
}

function applyMask(grid: (boolean | null)[][], isFunction: boolean[][], mask: number, size: number): void {
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (isFunction[y][x]) continue;
			let invert: boolean;
			switch (mask) {
				case 0: invert = (x + y) % 2 === 0; break;
				case 1: invert = y % 2 === 0; break;
				case 2: invert = x % 3 === 0; break;
				case 3: invert = (x + y) % 3 === 0; break;
				case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
				case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
				case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
				default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
			}
			if (invert) grid[y][x] = !grid[y][x];
		}
	}
}
