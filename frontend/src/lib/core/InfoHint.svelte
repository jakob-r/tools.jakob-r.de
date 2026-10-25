<script lang="ts">
	let { text }: { text: string } = $props();
</script>

<span
	class="inline-grid size-4 cursor-help place-items-center rounded-full border border-slate-300 text-[10px] leading-none font-semibold text-mute select-none hover:border-accent hover:text-accent"
	title={text}
	role="img"
	aria-label={text}>i</span
>
