<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		orientation = 'horizontal',
		first,
		second
	}: {
		orientation?: 'horizontal' | 'vertical';
		first: Snippet;
		second: Snippet;
	} = $props();
</script>

<div
	class="grid h-full min-h-0 gap-3 p-3 {orientation === 'horizontal'
		? 'grid-cols-2 grid-rows-1'
		: 'grid-cols-1 grid-rows-2'}"
>
	<section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white">
		{@render first()}
	</section>
	<section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white">
		{@render second()}
	</section>
</div>
