import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndown = new TurndownService({
	headingStyle: 'atx',
	codeBlockStyle: 'fenced',
	bulletListMarker: '-',
	emDelimiter: '*'
});
turndown.use(gfm);

const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM']);

/** Removes active content (scripts, event handlers, javascript: URLs) from an HTML string. */
export function sanitizeHtml(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	for (const el of [...doc.body.querySelectorAll('*')]) {
		if (DROP.has(el.tagName)) {
			el.remove();
			continue;
		}
		for (const attr of [...el.attributes]) {
			const name = attr.name.toLowerCase();
			const value = attr.value.trim().toLowerCase();
			const url = ['href', 'src', 'xlink:href', 'action', 'formaction'].includes(name);
			if (name.startsWith('on') || name === 'srcdoc' || (url && /^(javascript|vbscript|data:text\/html)/.test(value)))
				el.removeAttribute(attr.name);
		}
	}
	return doc.body.innerHTML;
}

export function markdownToHtml(md: string): string {
	return sanitizeHtml(marked.parse(md, { async: false, gfm: true }) as string);
}

export function htmlToMarkdown(html: string): string {
	return turndown.turndown(sanitizeHtml(html)).trim();
}
