<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<div class="flex h-dvh flex-col">
	<header class="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-white px-4">
		<a href="/" class="flex shrink-0 items-center gap-2 font-semibold tracking-tight whitespace-nowrap">
			<span class="grid size-6 place-items-center rounded-md bg-accent text-xs text-white">t</span>
			tools.jakob-r.de
		</a>
		<span class="ml-auto text-right text-xs text-mute">🔒 Runs in your browser. Nothing is uploaded.</span>
	</header>
	<main class="min-h-0 flex-1 overflow-auto">{@render children()}</main>
</div>
