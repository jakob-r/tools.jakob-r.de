export type Issue = { message: string; severity: 'error' | 'warning' };
export type Highlighted = { html: string; issues: Issue[] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, s: string) => `<span class="${cls}">${esc(s)}</span>`;

const MD_INLINE =
	/(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|_[^_\n]+_)|(!?\[[^\]\n]*\]\([^)\n]*\))|(!?\[[^\]\n]*\]\([^)\n]*$)|(<\/?[a-zA-Z][^>\n]*>)/g;

export function highlightMarkdown(src: string): Highlighted {
	const issues: Issue[] = [];
	let inFence = false;
	let fenceLine = 0;
	const lines = src.split('\n').map((line, i) => {
		if (/^\s*(```|~~~)/.test(line)) {
			if (!inFence) fenceLine = i + 1;
			inFence = !inFence;
			return span('tk-fence', line);
		}
		if (inFence) return span('tk-code', line);

		let prefix = '';
		let rest = line;
		const block = /^(\s*(?:#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s|---+$|\*\*\*+$))/.exec(line);
		if (block) {
			prefix = span(/^\s*#/.test(line) ? 'tk-heading' : 'tk-marker', block[1]);
			rest = line.slice(block[1].length);
		}
		const heading = /^\s*#/.test(line);

		let out = '';
		let last = 0;
		for (const m of rest.matchAll(MD_INLINE)) {
			out += heading ? span('tk-heading', rest.slice(last, m.index)) : esc(rest.slice(last, m.index));
			const t = m[0];
			if (m[1]) out += span('tk-code', t);
			else if (m[2]) out += span('tk-strong', t);
			else if (m[3]) out += span('tk-em', t);
			else if (m[4]) out += span('tk-link', t);
			else if (m[5]) {
				issues.push({ severity: 'warning', message: `Line ${i + 1}: link is missing a closing “)”` });
				out += span('tk-error', t);
			} else out += span('tk-tag', t);
			last = m.index + t.length;
		}
		out += heading ? span('tk-heading', rest.slice(last)) : esc(rest.slice(last));
		if ((rest.match(/`/g)?.length ?? 0) % 2 === 1)
			issues.push({ severity: 'warning', message: `Line ${i + 1}: unmatched backtick` });
		return prefix + out;
	});
	if (inFence)
		issues.push({ severity: 'warning', message: `Code fence opened on line ${fenceLine} is never closed` });
	return { html: lines.join('\n') + '\n', issues };
}

const VOID = new Set(
	'area base br col embed hr img input link meta param source track wbr'.split(' ')
);
const HTML_TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)(?:"[^"]*"|'[^']*'|[^>"'])*>|<(?=[a-zA-Z/!])[^>]*$|</g;

function highlightTag(tag: string, bad: boolean): string {
	const m = /^(<\/?)([\w:-]+)([\s\S]*?)(\/?>?)$/.exec(tag);
	if (!m) return span('tk-error', tag);
	const attrs = esc(m[3]).replace(
		/([\w:-]+)(=)?("[^"]*"|'[^']*'|[^\s&]+)?/g,
		(_, n, eq, v) =>
			`<span class="tk-attr">${n}</span>${eq ?? ''}${v ? `<span class="tk-string">${v}</span>` : ''}`
	);
	const cls = bad ? 'tk-error' : 'tk-tag';
	return `<span class="${cls}">${esc(m[1])}${esc(m[2])}</span>${attrs}<span class="${cls}">${esc(m[4])}</span>`;
}

export function highlightHtml(src: string): Highlighted {
	const issues: Issue[] = [];
	const stack: { name: string; token: number }[] = [];
	const tokens: { text: string; kind: 'text' | 'comment' | 'tag' | 'bad'; }[] = [];
	let last = 0;

	for (const m of src.matchAll(HTML_TOKEN)) {
		if (m.index > last) tokens.push({ text: src.slice(last, m.index), kind: 'text' });
		last = m.index + m[0].length;
		const t = m[0];
		if (t.startsWith('<!--')) tokens.push({ text: t, kind: 'comment' });
		else if (!m[1]) {
			issues.push({ severity: 'error', message: t === '<' ? 'Stray “<” (use &lt;)' : 'Tag is never closed with “>”' });
			tokens.push({ text: t, kind: 'bad' });
		} else {
			const name = m[1].toLowerCase();
			const idx = tokens.push({ text: t, kind: 'tag' }) - 1;
			if (t.startsWith('</')) {
				const at = stack.map((s) => s.name).lastIndexOf(name);
				if (at === -1) {
					issues.push({ severity: 'error', message: `Closing </${name}> has no matching opening tag` });
					tokens[idx].kind = 'bad';
				} else {
					for (const open of stack.splice(at + 1)) {
						issues.push({ severity: 'error', message: `<${open.name}> is never closed` });
						tokens[open.token].kind = 'bad';
					}
					stack.pop();
				}
			} else if (!VOID.has(name) && !t.endsWith('/>')) stack.push({ name, token: idx });
		}
	}
	if (last < src.length) tokens.push({ text: src.slice(last), kind: 'text' });
	for (const open of stack) {
		issues.push({ severity: 'error', message: `<${open.name}> is never closed` });
		tokens[open.token].kind = 'bad';
	}

	const html = tokens
		.map((t) =>
			t.kind === 'text' ? esc(t.text) : t.kind === 'comment' ? span('tk-comment', t.text) : t.kind === 'bad' && !/^<\/?[a-zA-Z]/.test(t.text) ? span('tk-error', t.text) : highlightTag(t.text, t.kind === 'bad')
		)
		.join('');
	return { html: html + '\n', issues };
}
