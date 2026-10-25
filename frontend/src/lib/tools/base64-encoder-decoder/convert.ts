/** UTF-8 text ↔ Base64, plus helpers for URL hashes and pasted data URLs. */

export type DecodeOk = {
	ok: true;
	bytes: Uint8Array;
	/** Decoded as UTF-8 when the bytes are valid text; otherwise null (binary). */
	text: string | null;
};

export type DecodeErr = { ok: false; error: string };

export type DecodeResult = DecodeOk | DecodeErr;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

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

/**
 * Pull a Base64 payload out of a pasted data URL or a link whose hash is Base64
 * (including this tool's share URLs). Returns null when nothing usable is found.
 */
export function extractBase64FromPaste(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	const dataUrl = /^data:[^;,\s]*;base64,([\s\S]+)$/i.exec(trimmed);
	if (dataUrl) {
		const payload = dataUrl[1].trim();
		return decodeBase64(payload).ok ? normalizeBase64(payload) : null;
	}

	try {
		const url = new URL(trimmed);
		if (url.hash.length > 1) {
			const hash = decodeURIComponent(url.hash.slice(1));
			if (looksLikeBase64(hash)) return normalizeBase64(hash);
		}
	} catch {
		// Not a URL — fall through.
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
