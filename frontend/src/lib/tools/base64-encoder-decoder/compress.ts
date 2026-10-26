/**
 * Optional compression layer between Base64 and text (e.g. pako/zlib deflate of JSON).
 * Detection tries each codec and keeps the result that looks most like real text.
 */
import { deflateSync, gunzipSync, gzipSync, inflateSync, unzlibSync, zlibSync } from 'fflate';

export type Codec = 'none' | 'deflate-raw' | 'zlib' | 'gzip';

export const codecLabels: Record<Codec, string> = {
	none: 'None',
	'deflate-raw': 'Deflate (raw)',
	zlib: 'Zlib',
	gzip: 'Gzip'
};

export type Payload = {
	codec: Codec;
	/** Bytes after decompression (equal to the input for `none`). */
	bytes: Uint8Array;
	/** UTF-8 text when the bytes are valid text; otherwise null (binary). */
	text: string | null;
};

const textDecoder = new TextDecoder('utf-8', { fatal: true });

/** Compressed candidates must look at least this much like text to win. */
const MIN_PLAUSIBILITY = 0.95;

function tryUtf8(bytes: Uint8Array): string | null {
	try {
		return textDecoder.decode(bytes);
	} catch {
		return null;
	}
}

const isGzip = (b: Uint8Array) => b.length >= 18 && b[0] === 0x1f && b[1] === 0x8b && b[2] === 8;
// CMF: method 8 (deflate), window ≤ 32K; FCHECK makes the 16-bit header a multiple of 31.
const isZlib = (b: Uint8Array) =>
	b.length >= 6 && (b[0] & 0x0f) === 8 && b[0] >> 4 <= 7 && ((b[0] << 8) | b[1]) % 31 === 0;

export function decompress(bytes: Uint8Array, codec: Codec): Uint8Array | null {
	try {
		switch (codec) {
			case 'none':
				return bytes;
			case 'deflate-raw':
				return inflateSync(bytes);
			case 'zlib':
				return unzlibSync(bytes);
			case 'gzip':
				return gunzipSync(bytes);
		}
	} catch {
		return null;
	}
}

export function compress(bytes: Uint8Array, codec: Codec): Uint8Array {
	switch (codec) {
		case 'none':
			return bytes;
		case 'deflate-raw':
			return deflateSync(bytes, { level: 9 });
		case 'zlib':
			return zlibSync(bytes, { level: 9 });
		case 'gzip':
			return gzipSync(bytes, { level: 9, mtime: 0 });
	}
}

/**
 * 0…1 share of characters that are ordinary text (not control characters or U+FFFD),
 * plus a bonus of 1 when the whole text parses as a JSON object or array.
 */
export function textPlausibility(text: string): number {
	if (!text) return 0;
	let good = 0;
	let total = 0;
	for (const ch of text) {
		total++;
		const c = ch.codePointAt(0)!;
		const control = (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || (c >= 0x7f && c < 0xa0);
		if (!control && c !== 0xfffd) good++;
	}
	let score = good / total;
	const t = text.trim();
	if (t[0] === '{' || t[0] === '[') {
		try {
			JSON.parse(t);
			score += 1;
		} catch {
			// not JSON
		}
	}
	return score;
}

/** Decode with a fixed codec; null when the bytes are not in that format. */
export function payloadWith(bytes: Uint8Array, codec: Codec): Payload | null {
	const out = decompress(bytes, codec);
	if (!out) return null;
	return { codec, bytes: out, text: tryUtf8(out) };
}

/**
 * Pick the most plausible reading of `bytes`: as-is, or decompressed (gzip, zlib, raw deflate).
 * A compressed reading wins only when it yields text that looks more like text than the raw bytes.
 */
export function detectPayload(bytes: Uint8Array): Payload {
	const plain: Payload = { codec: 'none', bytes, text: tryUtf8(bytes) };
	let best = plain;
	let bestScore = plain.text === null ? -1 : textPlausibility(plain.text);
	if (bytes.length < 2) return plain;

	const codecs: Codec[] = [];
	if (isGzip(bytes)) codecs.push('gzip');
	if (isZlib(bytes)) codecs.push('zlib');
	codecs.push('deflate-raw');

	for (const codec of codecs) {
		const p = payloadWith(bytes, codec);
		if (!p || p.text === null || p.bytes.length === 0) continue;
		const score = textPlausibility(p.text);
		if (score >= MIN_PLAUSIBILITY && score > bestScore) {
			best = p;
			bestScore = score;
		}
	}
	return best;
}
