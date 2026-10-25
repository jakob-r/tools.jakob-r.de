<script lang="ts">
	import { tools } from '#lib/tools';

	let query = $state('');
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return tools;
		return tools.filter((t) =>
			[t.title, t.description, ...t.tags].some((s) => s.toLowerCase().includes(q))
		);
	});
</script>

<svelte:head><title>tools.jakob-r.de</title></svelte:head>

<div class="mx-auto max-w-5xl px-6 py-10">
	<h1 class="text-3xl font-bold tracking-tight">Small tools that just work.</h1>
	<p class="mt-2 max-w-2xl text-mute">
		A collection of little helpers that run entirely in your browser. Your text, files and clipboard
		never leave this page: no backend, no uploads.
	</p>

	<input
		type="search"
		bind:value={query}
		placeholder="Search tools…"
		aria-label="Search tools"
		class="mt-6 w-full max-w-md rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
	/>

	<div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		{#each shown as tool (tool.slug)}
			<a
				href="/{tool.slug}"
				class="group overflow-hidden rounded-xl border border-line bg-white transition hover:border-accent hover:shadow-md"
			>
				<img src={tool.thumbnail} alt="" class="h-32 w-full bg-accent-soft object-cover" />
				<div class="p-4">
					<h2 class="font-semibold group-hover:text-accent">{tool.title}</h2>
					<p class="mt-1 text-sm text-mute">{tool.description}</p>
					<div class="mt-3 flex flex-wrap gap-1">
						{#each tool.tags as tag}
							<span class="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">{tag}</span>
						{/each}
					</div>
				</div>
			</a>
		{:else}
			<p class="text-mute">No tools match “{query}”.</p>
		{/each}
	</div>
</div>
