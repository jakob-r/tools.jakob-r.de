/** UTF-8 text ↔ Base64, plus helpers for URLs that embed a Base64 segment. */
import { detectPayload } from './compress';

export type DecodeOk = {
	ok: true;
	bytes: Uint8Array;
	/** Decoded as UTF-8 when the bytes are valid text; otherwise null (binary). */
	text: string | null;
};

export type DecodeErr = { ok: false; error: string };

export type DecodeResult = DecodeOk | DecodeErr;

/** How the Base64 alphabet / padding appeared in the source, so we can write it back the same way. */
export type Base64Style = {
	urlSafe: boolean;
	/** Whether the original included `=` padding. */
	pad: boolean;
};

export type EmbeddedBase64 = {
	prefix: string;
	base64: string;
	suffix: string;
	style: Base64Style;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

/** Path/query segments shorter than this are ignored (avoids matching ids like `abcd`). */
const MIN_EMBEDDED_LEN = 16;

function bytesToBinaryString(bytes: Uint8Array): string {
	const chunk = 0x8000;
	let out = '';
	for (let i = 0; i < bytes.length; i += chunk) {
		out += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return out;
}

function binaryStringToBytes(binary: string): Uint8Array {
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Encode raw bytes to standard Base64. */
export function encodeBytes(bytes: Uint8Array): string {
	return btoa(bytesToBinaryString(bytes));
}

/** Encode a UTF-8 string to Base64. */
export function encodeText(text: string): string {
	return encodeBytes(textEncoder.encode(text));
}

export function detectBase64Style(raw: string): Base64Style {
	const compact = raw.replace(/\s+/g, '');
	return {
		urlSafe: /[-_]/.test(compact) && !/[+/]/.test(compact),
		pad: /=/.test(compact)
	};
}

/** Encode bytes using the same alphabet / padding style as the source. */
export function encodeBytesWithStyle(bytes: Uint8Array, style: Base64Style): string {
	let s = encodeBytes(bytes);
	if (!style.pad) s = s.replace(/=+$/, '');
	if (style.urlSafe) s = s.replace(/\+/g, '-').replace(/\//g, '_');
	return s;
}

export function encodeTextWithStyle(text: string, style: Base64Style): string {
	return encodeBytesWithStyle(textEncoder.encode(text), style);
}

/**
 * Normalize common Base64 variants: strip whitespace, URL-safe alphabet, missing padding.
 */
export function normalizeBase64(raw: string): string {
	let s = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
	const pad = s.length % 4;
	if (pad === 1) {
		// Length ≡ 1 (mod 4) is never valid Base64.
		return s;
	}
	if (pad) s += '='.repeat(4 - pad);
	return s;
}

function tryDecodeUtf8(bytes: Uint8Array): string | null {
	try {
		return textDecoder.decode(bytes);
	} catch {
		return null;
	}
}

/** Decode a Base64 string. Accepts standard and URL-safe forms, with or without padding. */
export function decodeBase64(raw: string): DecodeResult {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { ok: true, bytes: new Uint8Array(), text: '' };
	}

	const normalized = normalizeBase64(trimmed);
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
		return { ok: false, error: 'Not valid Base64.' };
	}

	try {
		const bytes = binaryStringToBytes(atob(normalized));
		return { ok: true, bytes, text: tryDecodeUtf8(bytes) };
	} catch {
		return { ok: false, error: 'Not valid Base64.' };
	}
}

/** True when `s` looks like Base64 (after whitespace strip), not e.g. plain prose. */
export function looksLikeBase64(s: string): boolean {
	const compact = s.replace(/\s+/g, '');
	if (compact.length < 4) return false;
	if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return false;
	if (compact.length % 4 === 1) return false;
	return decodeBase64(compact).ok;
}

function isEmbeddedCandidate(s: string): boolean {
	const compact = s.replace(/\s+/g, '');
	if (compact.length < MIN_EMBEDDED_LEN) return false;
	if (!looksLikeBase64(compact)) return false;
	// Prefer payloads that decode (possibly after decompression) to text — path ids that
	// happen to be valid Base64 are rare at this length.
	const decoded = decodeBase64(compact);
	return decoded.ok && detectPayload(decoded.bytes).text !== null;
}

/** The value itself plus its `.`-separated parts, for versioned payloads like `z1.<base64>`. */
function candidateParts(value: string): string[] {
	return value.includes('.') ? [value, ...value.split('.')] : [value];
}

function wrapAt(input: string, base64: string): EmbeddedBase64 | null {
	const i = input.indexOf(base64);
	if (i < 0) return null;
	return {
		prefix: input.slice(0, i),
		base64,
		suffix: input.slice(i + base64.length),
		style: detectBase64Style(base64)
	};
}

/**
 * Find a Base64 payload in pasted text: bare Base64, data URL, hash, or a path/query
 * segment inside a normal http(s) link. Returns prefix/suffix so only the Base64
 * part is rewritten when the decoded data changes.
 */
export function findEmbeddedBase64(input: string): EmbeddedBase64 | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	const dataUrl = /^data:[^;,\s]*;base64,([\s\S]+)$/i.exec(trimmed);
	if (dataUrl) {
		const payload = dataUrl[1].trim();
		if (decodeBase64(payload).ok) return wrapAt(trimmed, dataUrl[1]) ?? wrapAt(trimmed, payload);
	}

	let best: EmbeddedBase64 | null = null;
	const consider = (value: string) => {
		for (const part of candidateParts(value)) {
			if (!isEmbeddedCandidate(part)) continue;
			const found = wrapAt(trimmed, part);
			if (!found) continue;
			if (!best || found.base64.length > best.base64.length) best = found;
		}
	};

	try {
		const url = new URL(trimmed);
		if (url.protocol === 'http:' || url.protocol === 'https:') {
			if (url.hash.length > 1) {
				const rawHash = url.hash.slice(1);
				consider(rawHash);
				try {
					consider(decodeURIComponent(rawHash));
				} catch {
					// ignore malformed escape sequences
				}
			}

			for (const seg of url.pathname.split('/')) {
				if (seg) consider(seg);
			}

			for (const value of url.searchParams.values()) {
				consider(value);
			}
		}
	} catch {
		// Not a URL — fall through to bare Base64.
	}

	if (best) return best;

	if (!/\s/.test(trimmed) && trimmed.includes('.')) consider(trimmed);
	if (best) return best;

	if (looksLikeBase64(trimmed)) {
		return { prefix: '', base64: trimmed, suffix: '', style: detectBase64Style(trimmed) };
	}

	return null;
}

/** http(s) or data: URL suitable for opening in a new tab. */
export function asOpenableUrl(text: string): string | null {
	const t = text.trim();
	if (!t || /\s/.test(t)) return null;
	try {
		const u = new URL(t);
		if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:') {
			return u.href;
		}
	} catch {
		// ignore
	}
	return null;
}
