<script lang="ts">
	let {
		text,
		html,
		label = 'Copy'
	}: { text: string; html?: string; label?: string } = $props();

	let done = $state(false);

	async function copy() {
		try {
			if (html !== undefined && typeof ClipboardItem !== 'undefined') {
				await navigator.clipboard.write([
					new ClipboardItem({
						'text/html': new Blob([html], { type: 'text/html' }),
						'text/plain': new Blob([text], { type: 'text/plain' })
					})
				]);
			} else {
				await navigator.clipboard.writeText(text);
			}
			done = true;
			setTimeout(() => (done = false), 1200);
		} catch {
			done = false;
		}
	}
</script>

<button
	type="button"
	onclick={copy}
	class="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium hover:border-accent hover:text-accent"
>
	{done ? 'Copied ✓' : label}
</button>
