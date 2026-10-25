<script lang="ts">
	import { highlightHtml, highlightMarkdown, type Issue } from './highlight';

	let {
		value = $bindable(),
		language,
		issues = $bindable([]),
		oninput
	}: {
		value: string;
		language: 'markdown' | 'html';
		issues?: Issue[];
		oninput?: () => void;
	} = $props();

	let pre: HTMLPreElement;
	const result = $derived(language === 'html' ? highlightHtml(value) : highlightMarkdown(value));
	$effect(() => {
		issues = result.issues;
	});
</script>

<div class="relative min-h-0 flex-1 font-mono text-[13px] leading-5">
	<pre
		bind:this={pre}
		aria-hidden="true"
		class="code absolute inset-0 m-0 overflow-auto p-3 break-words whitespace-pre-wrap">{@html result.html}</pre>
	<textarea
		bind:value
		oninput={() => oninput?.()}
		onscroll={(e) => {
			pre.scrollTop = e.currentTarget.scrollTop;
			pre.scrollLeft = e.currentTarget.scrollLeft;
		}}
		spellcheck="false"
		autocapitalize="off"
		aria-label="{language} editor"
		class="absolute inset-0 size-full resize-none overflow-auto bg-transparent p-3 break-words whitespace-pre-wrap text-transparent caret-ink outline-none selection:bg-accent/20"
	></textarea>
</div>

<style>
	.code :global(.tk-heading) { color: #4338ca; font-weight: 600; }
	.code :global(.tk-strong) { color: #0f172a; font-weight: 700; }
	.code :global(.tk-em) { color: #0f172a; font-style: italic; }
	.code :global(.tk-code), .code :global(.tk-fence) { color: #0e7490; }
	.code :global(.tk-link) { color: #2563eb; }
	.code :global(.tk-marker), .code :global(.tk-tag) { color: #9333ea; }
	.code :global(.tk-attr) { color: #b45309; }
	.code :global(.tk-string) { color: #15803d; }
	.code :global(.tk-comment) { color: #94a3b8; }
	.code :global(.tk-error) { color: #dc2626; text-decoration: underline wavy #dc2626; }
</style>
