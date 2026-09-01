import {useEffect, useMemo, useRef} from 'react';
import {buildSparkline, computeTokenRate} from '../utils/sparkline.js';

type TokenSample = {timestamp: number; tokens: number};

export function useTokenMetrics(tokensUsed: number, running: boolean): {
	tokenRate: number;
	sparkline: string;
	runningLabel?: string;
} {
	const samplesRef = useRef<TokenSample[]>([]);

	useEffect(() => {
		const now = Date.now();
		const last = samplesRef.current.at(-1);
		if (!last || last.tokens !== tokensUsed) {
			samplesRef.current.push({timestamp: now, tokens: tokensUsed});
		}
		samplesRef.current = samplesRef.current.filter(sample => now - sample.timestamp <= 10_000);
	}, [tokensUsed]);

	return useMemo(() => {
		const now = Date.now();
		const samples = samplesRef.current.filter(sample => now - sample.timestamp <= 10_000);
		const deltas = samples.slice(1).map((sample, index) => {
			const previous = samples[index];
			if (!previous) return 0;
			const elapsed = Math.max(1, sample.timestamp - previous.timestamp);
			return ((sample.tokens - previous.tokens) / elapsed) * 1000;
		});
		const tokenRate = computeTokenRate(samples);
		const sparkline = buildSparkline(deltas, 8);
		const runningLabel = running ? 'task running' : undefined;
		return {tokenRate, sparkline, runningLabel};
	}, [tokensUsed, running]);
}
