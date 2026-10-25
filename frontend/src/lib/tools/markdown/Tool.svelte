<script lang="ts">
	import CopyButton from '#lib/core/CopyButton.svelte';
	import InfoHint from '#lib/core/InfoHint.svelte';
	import SplitPane from '#lib/core/SplitPane.svelte';
	import CodeEditor from './CodeEditor.svelte';
	import RichEditor from './RichEditor.svelte';
	import { htmlToMarkdown, markdownToHtml } from './convert';
	import type { Issue } from './highlight';

	type Format = 'markdown' | 'html' | 'rich';
	const formats: { id: Format; label: string }[] = [
		{ id: 'markdown', label: 'Markdown' },
		{ id: 'html', label: 'HTML' },
		{ id: 'rich', label: 'Rich text' }
	];

	const sample = `# Hello, Markshift

Write **Markdown** on one side, get *HTML* or rich text on the other.

- Edit either pane
- The other one follows
- [Learn more](https://commonmark.org)
`;

	let markdown = $state(sample);
	let html = $state(markdownToHtml(sample));
	let formatA = $state<Format>('markdown');
	let formatB = $state<Format>('rich');
	let orientation = $state<'horizontal' | 'vertical'>('horizontal');
	let issues = $state<Record<'a' | 'b', Issue[]>>({ a: [], b: [] });
	/** Pane whose content could not be converted yet because of syntax errors. */
	let blockedFrom = $state<Format | null>(null);

	const value = (f: Format) => (f === 'markdown' ? markdown : html);
	const hasError = (list: Issue[]) => list.some((i) => i.severity === 'error');

	function edited(source: Format, pane: 'a' | 'b') {
		// Editor issues are recomputed in an effect; check synchronously for the blocking decision.
		queueMicrotask(() => {
			if (source !== 'rich' && hasError(issues[pane])) {
				blockedFrom = source;
				return;
			}
			blockedFrom = null;
			if (source === 'markdown') html = markdownToHtml(markdown);
			else markdown = htmlToMarkdown(html);
		});
	}

	function setRich(h: string, pane: 'a' | 'b') {
		html = h;
		edited('rich', pane);
	}

	function swap() {
		[formatA, formatB] = [formatB, formatA];
		[issues.a, issues.b] = [issues.b, issues.a];
	}

	const outFormat = $derived(formatB);
	const outText = $derived(outFormat === 'rich' ? markdown : value(outFormat));
</script>

<div class="flex h-full flex-col">
	<div class="flex shrink-0 items-center gap-2 border-b border-line bg-white px-4 py-2 text-sm">
		<h1 class="font-semibold">Markshift</h1>
		<InfoHint
			text="Pick a format for each pane. Both panes are editable and stay in sync. Rich text is edited directly; pasting keeps formatting but strips scripts."
		/>
		<button
			type="button"
			onclick={swap}
			class="ml-4 rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
			title="Swap the two panes">⇄ Swap</button
		>
		<div class="ml-auto flex items-center gap-1 text-xs text-mute">
			Layout
			{#each ['horizontal', 'vertical'] as const as o}
				<button
					type="button"
					onclick={() => (orientation = o)}
					aria-pressed={orientation === o}
					class="rounded-md border px-2 py-1 {orientation === o
						? 'border-accent bg-accent-soft text-accent'
						: 'border-line hover:border-accent'}"
				>
					{o === 'horizontal' ? '▥ Side by side' : '▤ Stacked'}
				</button>
			{/each}
		</div>
	</div>

	<div class="min-h-0 flex-1">
		<SplitPane {orientation}>
			{#snippet first()}
				{@render pane('a', formatA, (f) => (formatA = f), 'Input')}
			{/snippet}
			{#snippet second()}
				{@render pane('b', formatB, (f) => (formatB = f), 'Output')}
			{/snippet}
		</SplitPane>
	</div>
</div>

{#snippet pane(id: 'a' | 'b', format: Format, setFormat: (f: Format) => void, title: string)}
	{@const stale = blockedFrom !== null && blockedFrom !== format}
	<div class="flex shrink-0 items-center gap-2 border-b border-line bg-slate-50 px-3 py-1.5 text-xs">
		<span class="font-medium text-mute">{title}</span>
		<select
			value={format}
			onchange={(e) => setFormat(e.currentTarget.value as Format)}
			aria-label="{title} format"
			class="rounded-md border border-line bg-white px-1.5 py-0.5"
		>
			{#each formats as f}<option value={f.id}>{f.label}</option>{/each}
		</select>
		{#if id === 'b'}
			<span class="ml-auto"
				><CopyButton
					text={outText}
					html={outFormat === 'rich' ? html : undefined}
					label={outFormat === 'rich' ? 'Copy rich text' : 'Copy'}
				/></span
			>
		{/if}
	</div>

	{#if stale}
		<div class="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
			Not updated: fix the HTML errors in the other pane first.
		</div>
	{/if}

	{#if format === 'rich'}
		<RichEditor value={html} onchange={(h) => setRich(h, id)} />
	{:else if format === 'markdown'}
		<CodeEditor bind:value={markdown} language="markdown" bind:issues={issues[id]} oninput={() => edited('markdown', id)} />
	{:else}
		<CodeEditor bind:value={html} language="html" bind:issues={issues[id]} oninput={() => edited('html', id)} />
	{/if}

	{#if format !== 'rich' && issues[id].length}
		<ul class="max-h-24 shrink-0 overflow-auto border-t border-line bg-slate-50 px-3 py-1.5 text-xs">
			{#each issues[id] as issue}
				<li class={issue.severity === 'error' ? 'text-red-600' : 'text-amber-600'}>
					{issue.severity === 'error' ? '✕' : '⚠'} {issue.message}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}
