<script lang="ts">
	import { highlightJson } from './json';

	let {
		value = $bindable(),
		json = false,
		readonly = false,
		oninput
	}: {
		value: string;
		json?: boolean;
		readonly?: boolean;
		oninput?: () => void;
	} = $props();

	let pre = $state<HTMLPreElement | undefined>(undefined);
	const html = $derived(json ? highlightJson(value) : '');
</script>

{#if json}
	<div class="relative min-h-0 flex-1 font-mono text-[13px] leading-5">
		<pre
			bind:this={pre}
			aria-hidden="true"
			class="code absolute inset-0 m-0 overflow-auto p-3 break-words whitespace-pre-wrap">{@html html}</pre>
		<textarea
			bind:value
			{readonly}
			oninput={() => oninput?.()}
			onscroll={(e) => {
				if (!pre) return;
				pre.scrollTop = e.currentTarget.scrollTop;
				pre.scrollLeft = e.currentTarget.scrollLeft;
			}}
			spellcheck="false"
			autocapitalize="off"
			aria-label="Decoded JSON"
			class="absolute inset-0 size-full resize-none overflow-auto bg-transparent p-3 break-words whitespace-pre-wrap text-transparent caret-ink outline-none selection:bg-accent/20"
		></textarea>
	</div>
{:else}
	<textarea
		bind:value
		{readonly}
		oninput={() => oninput?.()}
		spellcheck="false"
		aria-label="Decoded text"
		class="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm leading-relaxed outline-none"
	></textarea>
{/if}

<style>
	.code :global(.tk-key) {
		color: #4338ca;
	}
	.code :global(.tk-string) {
		color: #15803d;
	}
	.code :global(.tk-number) {
		color: #b45309;
	}
	.code :global(.tk-literal) {
		color: #9333ea;
	}
	.code :global(.tk-punct) {
		color: #64748b;
	}
</style>
