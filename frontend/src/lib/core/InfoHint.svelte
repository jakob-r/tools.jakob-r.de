<script lang="ts">
	let { text }: { text: string } = $props();

	let icon: HTMLButtonElement;
	let pos = $state<{ left: number; top: number; above: boolean } | null>(null);

	// The native `title` tooltip only appears after a delay, so the hint draws its own.
	// It is `position: fixed` so scrolling panes with `overflow: hidden` cannot clip it.
	function show() {
		const r = icon.getBoundingClientRect();
		const half = Math.min(140, (innerWidth - 16) / 2);
		const left = Math.min(Math.max(r.left + r.width / 2, half + 8), innerWidth - half - 8);
		const above = r.bottom + 120 > innerHeight;
		pos = { left, top: above ? r.top - 6 : r.bottom + 6, above };
	}
</script>

<svelte:window
	onpointerdown={(e) => pos && e.target !== icon && (pos = null)}
	onscroll={() => (pos = null)}
/>

<button
	type="button"
	bind:this={icon}
	class="inline-grid size-4 cursor-help place-items-center rounded-full border border-slate-300 text-[10px] leading-none font-semibold text-mute outline-none select-none hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent"
	aria-label={text}
	onpointerenter={show}
	onpointerleave={(e) => e.pointerType !== 'touch' && (pos = null)}
	onclick={(e) => {
		// Inside a <label> a click would also toggle the control; on touch a tap opens the hint.
		e.preventDefault();
		e.stopPropagation();
		show();
	}}
	onfocus={show}
	onblur={() => (pos = null)}
	>i</button
>
{#if pos}
	<span
		role="tooltip"
		aria-hidden="true"
		class="pointer-events-none fixed z-50 w-max max-w-[min(280px,calc(100vw-16px))] -translate-x-1/2 rounded-md bg-ink px-2.5 py-1.5 text-xs leading-snug font-normal whitespace-normal text-white shadow-lg"
		class:-translate-y-full={pos.above}
		style="left: {pos.left}px; top: {pos.top}px">{text}</span
	>
{/if}
