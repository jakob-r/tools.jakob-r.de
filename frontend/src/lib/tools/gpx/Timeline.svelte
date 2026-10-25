<script lang="ts">
	import type { TrackPoint } from './gpx';
	import type { Pause } from './pipeline';

	let {
		points,
		xs,
		speed,
		hasTime,
		pauses,
		cropEnabled,
		crop = $bindable(),
		hover = $bindable()
	}: {
		points: TrackPoint[];
		/** Position of each original point on the x axis: elapsed seconds, or meters without timestamps. */
		xs: number[];
		/** m/s per original point, empty without timestamps. */
		speed: number[];
		hasTime: boolean;
		pauses: Pause[];
		cropEnabled: boolean;
		crop: number;
		hover: number | null;
	} = $props();

	const pad = { l: 44, r: 44, t: 10, b: 20 };
	let canvas: HTMLCanvasElement;
	let width = $state(0);
	let height = $state(0);
	let dragging = $state(false);

	const eles = $derived(points.map((p) => p.ele).filter((e): e is number => e !== undefined));
	const eleRange = $derived.by(() => {
		if (!eles.length) return null;
		let lo = eles.reduce((a, b) => Math.min(a, b));
		let hi = eles.reduce((a, b) => Math.max(a, b));
		if (hi - lo < 20) [lo, hi] = [lo - 10, hi + 10];
		return { lo, hi };
	});
	const vMax = $derived(speed.reduce((a, v) => Math.max(a, v * 3.6), 1) * 1.05);
	const xMax = $derived(Math.max(1, xs[xs.length - 1] ?? 1));

	const sx = (x: number) => pad.l + (x / xMax) * (width - pad.l - pad.r);
	const plotH = () => height - pad.t - pad.b;

	$effect(() => draw());

	function draw() {
		if (!canvas || !width) return;
		const dpr = devicePixelRatio || 1;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
		const bottom = pad.t + plotH();

		for (const p of pauses) {
			ctx.fillStyle = 'rgba(168,85,247,0.12)';
			ctx.fillRect(sx(xs[p.from]), pad.t, sx(xs[p.to]) - sx(xs[p.from]), plotH());
		}

		const er = eleRange;
		if (er) {
			const sy = (e: number) => bottom - ((e - er.lo) / (er.hi - er.lo)) * plotH();
			ctx.beginPath();
			ctx.moveTo(sx(0), bottom);
			points.forEach((p, i) => p.ele !== undefined && ctx.lineTo(sx(xs[i]), sy(p.ele)));
			ctx.lineTo(sx(xMax), bottom);
			ctx.fillStyle = '#e2e8f0';
			ctx.fill();
			ctx.fillStyle = '#64748b';
			ctx.textAlign = 'right';
			ctx.fillText(`${Math.round(er.hi)} m`, pad.l - 6, pad.t + 8);
			ctx.fillText(`${Math.round(er.lo)} m`, pad.l - 6, bottom);
		}

		if (hasTime) {
			const sy = (v: number) => bottom - ((v * 3.6) / vMax) * plotH();
			ctx.beginPath();
			speed.forEach((v, i) => (i ? ctx.lineTo(sx(xs[i]), sy(v)) : ctx.moveTo(sx(xs[i]), sy(v))));
			ctx.strokeStyle = '#6366f1';
			ctx.lineWidth = 1.25;
			ctx.stroke();
			ctx.fillStyle = '#6366f1';
			ctx.textAlign = 'left';
			ctx.fillText(`${Math.round(vMax)} km/h`, width - pad.r + 6, pad.t + 8);
			ctx.fillText('0', width - pad.r + 6, bottom);
		}

		ctx.fillStyle = '#64748b';
		ctx.textAlign = 'center';
		for (let k = 0; k <= 4; k++) ctx.fillText(axisLabel((xMax * k) / 4), sx((xMax * k) / 4), height - 5);

		if (cropEnabled && crop < points.length) {
			const x = sx(xs[crop]);
			ctx.fillStyle = 'rgba(148,163,184,0.3)';
			ctx.fillRect(x, pad.t, sx(xMax) - x, plotH());
			ctx.fillStyle = '#dc2626';
			ctx.fillRect(x - 1, pad.t, 2, plotH());
			ctx.beginPath();
			ctx.moveTo(x - 6, pad.t);
			ctx.lineTo(x + 6, pad.t);
			ctx.lineTo(x, pad.t + 8);
			ctx.fill();
		}

		if (hover !== null && xs[hover] !== undefined) {
			ctx.fillStyle = '#6366f1';
			ctx.fillRect(sx(xs[hover]) - 0.5, pad.t, 1, plotH());
		}
	}

	function axisLabel(x: number) {
		if (!hasTime) return `${(x / 1000).toFixed(1)} km`;
		const h = Math.floor(x / 3600);
		const m = Math.floor((x % 3600) / 60);
		return `${h}:${String(m).padStart(2, '0')}`;
	}

	/** Original index closest to a canvas x position. */
	function indexAt(mx: number) {
		const x = ((mx - pad.l) / (width - pad.l - pad.r)) * xMax;
		let lo = 0;
		let hi = xs.length - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (xs[mid] < x) lo = mid + 1;
			else hi = mid;
		}
		return lo > 0 && x - xs[lo - 1] < xs[lo] - x ? lo - 1 : lo;
	}

	const nearMarker = (mx: number) => cropEnabled && Math.abs(mx - sx(xs[Math.min(crop, xs.length - 1)])) < 8;

	function pointerdown(e: PointerEvent) {
		if (!nearMarker(e.offsetX)) return;
		dragging = true;
		canvas.setPointerCapture(e.pointerId);
	}

	function pointermove(e: PointerEvent) {
		const i = indexAt(e.offsetX);
		hover = i;
		if (dragging) crop = Math.max(2, e.offsetX >= sx(xMax) ? points.length : i);
	}
</script>

<div class="relative min-h-0 flex-1" bind:clientWidth={width} bind:clientHeight={height}>
	<canvas
		bind:this={canvas}
		class="absolute inset-0 touch-none"
		style="width: {width}px; height: {height}px"
		onpointerdown={pointerdown}
		onpointermove={(e) => {
			pointermove(e);
			canvas.style.cursor = dragging || nearMarker(e.offsetX) ? 'ew-resize' : 'crosshair';
		}}
		onpointerup={() => (dragging = false)}
		onpointerleave={() => (hover = null)}
		aria-label="Elevation and speed timeline"
	></canvas>
</div>
