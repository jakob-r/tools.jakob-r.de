/** Light JSON helpers: detect, pretty/minify, and highlight for the plain pane. */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, s: string) => `<span class="${cls}">${esc(s)}</span>`;

/** Parse if the text looks like a JSON value (object or array). */
export function tryParseJson(text: string): unknown | undefined {
	const t = text.trim();
	if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
	try {
		return JSON.parse(t);
	} catch {
		return undefined;
	}
}

export function minifyJson(value: unknown): string {
	return JSON.stringify(value);
}

export function prettyJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

/**
 * If `text` is JSON, return a pretty display string and the minified form for Base64.
 * Otherwise both sides are the original text.
 */
export function viewForDecodedText(text: string): { display: string; canonical: string; isJson: boolean } {
	const parsed = tryParseJson(text);
	if (parsed === undefined) return { display: text, canonical: text, isJson: false };
	return { display: prettyJson(parsed), canonical: minifyJson(parsed), isJson: true };
}

/** Canonical payload to encode from the plain pane (minified JSON when valid). */
export function canonicalFromPlain(plain: string): { ok: true; text: string; isJson: boolean } | { ok: false; error: string } {
	const t = plain.trim();
	if (t && (t[0] === '{' || t[0] === '[')) {
		try {
			return { ok: true, text: minifyJson(JSON.parse(t)), isJson: true };
		} catch (e) {
			const msg = e instanceof SyntaxError ? e.message : 'Invalid JSON.';
			return { ok: false, error: msg };
		}
	}
	return { ok: true, text: plain, isJson: false };
}

/** Slight syntax highlighting for JSON text (assumes mostly-valid input). */
export function highlightJson(src: string): string {
	const re =
		/("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}\[\],])/g;
	let out = '';
	let last = 0;
	for (const m of src.matchAll(re)) {
		out += esc(src.slice(last, m.index));
		if (m[1] !== undefined) {
			out += span(m[2] !== undefined ? 'tk-key' : 'tk-string', m[1]);
			if (m[2]) out += esc(m[2]);
		} else if (m[3] !== undefined) out += span('tk-number', m[3]);
		else if (m[4] !== undefined) out += span('tk-literal', m[4]);
		else out += span('tk-punct', m[5]);
		last = m.index + m[0].length;
	}
	out += esc(src.slice(last));
	return out + '\n';
}
