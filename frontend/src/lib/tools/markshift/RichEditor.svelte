<script lang="ts">
	import { sanitizeHtml } from './convert';

	let { value, onchange }: { value: string; onchange: (html: string) => void } = $props();

	let el: HTMLDivElement;
	let lastEmitted: string | undefined;

	$effect(() => {
		if (value !== lastEmitted) {
			el.innerHTML = value;
			lastEmitted = value;
		}
	});

	function onInput() {
		lastEmitted = sanitizeHtml(el.innerHTML);
		onchange(lastEmitted);
	}

	function onPaste(e: ClipboardEvent) {
		const html = e.clipboardData?.getData('text/html');
		if (!html) return;
		e.preventDefault();
		document.execCommand('insertHTML', false, sanitizeHtml(html));
	}
</script>

<div
	bind:this={el}
	contenteditable="true"
	role="textbox"
	tabindex="0"
	aria-multiline="true"
	aria-label="Rich text editor"
	oninput={onInput}
	onpaste={onPaste}
	class="rich min-h-0 flex-1 overflow-auto p-4 text-sm outline-none"
></div>

<style>
	.rich :global(h1) { font-size: 1.75rem; font-weight: 700; margin: 0.6em 0 0.3em; }
	.rich :global(h2) { font-size: 1.4rem; font-weight: 700; margin: 0.6em 0 0.3em; }
	.rich :global(h3) { font-size: 1.15rem; font-weight: 600; margin: 0.6em 0 0.3em; }
	.rich :global(p), .rich :global(ul), .rich :global(ol), .rich :global(pre), .rich :global(blockquote), .rich :global(table) { margin: 0.6em 0; }
	.rich :global(ul) { list-style: disc; padding-left: 1.5rem; }
	.rich :global(ol) { list-style: decimal; padding-left: 1.5rem; }
	.rich :global(a) { color: #2563eb; text-decoration: underline; }
	.rich :global(code) { background: #f1f5f9; border-radius: 4px; padding: 0.1em 0.3em; font-family: var(--font-mono); font-size: 0.9em; }
	.rich :global(pre) { background: #f1f5f9; border-radius: 8px; padding: 0.75rem; overflow: auto; }
	.rich :global(pre code) { background: none; padding: 0; }
	.rich :global(blockquote) { border-left: 3px solid #c7d2fe; padding-left: 0.9rem; color: #475569; }
	.rich :global(img) { max-width: 100%; }
	.rich :global(table) { border-collapse: collapse; }
	.rich :global(th), .rich :global(td) { border: 1px solid #e2e8f0; padding: 0.25rem 0.6rem; }
	.rich :global(hr) { border: 0; border-top: 1px solid #e2e8f0; margin: 1em 0; }
</style>
