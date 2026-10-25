<script lang="ts" module>
	export type View = { cx: number; cy: number; scale: number };
	export type XY = { x: number; y: number };

	/** Shared by both panes so each tile is requested once. */
	const tileCache = new Map<string, HTMLImageElement>();
	let tilesLoaded = $state(0);
</script>

<script lang="ts">
	import type { OutPoint } from './gpx';
	import type { Pause, Reason } from './pipeline';

	let {
		variant,
		points,
		project,
		removed,
		out,
		pauses,
		crop,
		world,
		tiles,
		view = $bindable(),
		hover = $bindable()
	}: {
		variant: 'original' | 'cleaned';
		points: XY[];
		project: (p: { lat: number; lon: number }) => XY;
		removed: Map<number, Reason>;
		out: OutPoint[];
		pauses: Pause[];
		/** First cropped original index (points.length when nothing is cropped). */
		crop: number;
		/** Projected width of the whole Mercator world, to line up map tiles. */
		world: number;
		/** Draw OpenStreetMap tiles underneath. Only true after the user opted in. */
		tiles: boolean;
		view: View | null;
		hover: number | null;
	} = $props();

	const colors = {
		original: '#f97316',
		spike: '#dc2626',
		pause: '#a855f7',
		cropped: '#94a3b8',
		cleaned: '#0d9488',
		grid: '#eef2f6'
	};

	let canvas: HTMLCanvasElement;
	let width = $state(0);
	let height = $state(0);

	const outXY = $derived(out.map(project));

	export function fit() {
		if (!width || !height || !points.length) return;
		let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
		// Frame the activity, not the cropped drive home.
		for (const p of points.slice(0, Math.max(2, crop))) {
			x0 = Math.min(x0, p.x);
			x1 = Math.max(x1, p.x);
			y0 = Math.min(y0, p.y);
			y1 = Math.max(y1, p.y);
		}
		const scale = Math.min((width - 48) / Math.max(1, x1 - x0), (height - 48) / Math.max(1, y1 - y0));
		view = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale };
	}

	$effect(() => {
		if (!view && width && height && points.length) fit();
	});

	const toScreen = (v: View, p: XY) => ({
		x: width / 2 + (p.x - v.cx) * v.scale,
		y: height / 2 - (p.y - v.cy) * v.scale
	});

	$effect(() => draw());

	function draw() {
		const v = view;
		if (!canvas || !v || !width) return;
		const dpr = devicePixelRatio || 1;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		if (tiles) drawTiles(ctx, v);
		const unit = drawGrid(ctx, v, !tiles);
		ctx.lineJoin = ctx.lineCap = 'round';

		if (variant === 'original') {
			polyline(ctx, v, points.slice(0, crop), colors.original, 2);
			ctx.setLineDash([5, 5]);
			polyline(ctx, v, points.slice(Math.max(0, crop - 1)), colors.cropped, 2);
			ctx.setLineDash([]);
			for (const [idx, reason] of removed) {
				if (reason === 'pause') dot(ctx, v, points[idx], 2, colors.pause);
				else if (reason === 'spike') dot(ctx, v, points[idx], 4.5, colors.spike, '#fff');
			}
			if (hover !== null && points[hover]) ring(ctx, toScreen(v, points[hover]));
		} else {
			polyline(ctx, v, outXY, colors.cleaned, 2.5);
			for (const p of pauses) dot(ctx, v, project(p), 6, '#fff', colors.pause, 2.5);
			if (outXY.length) {
				dot(ctx, v, outXY[0], 5, '#16a34a', '#fff');
				dot(ctx, v, outXY[outXY.length - 1], 5, '#1e293b', '#fff');
			}
			const i = hoverOut();
			if (i >= 0) ring(ctx, toScreen(v, outXY[i]));
		}
		scaleBar(ctx, unit);
	}

	/** The cleaned point that stands in for the hovered original point. */
	function hoverOut() {
		if (hover === null || !out.length) return -1;
		let lo = 0;
		let hi = out.length - 1;
		if (out[0].idx > hover) return 0;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (out[mid].idx <= hover) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}

	function polyline(ctx: CanvasRenderingContext2D, v: View, pts: XY[], color: string, w: number) {
		if (pts.length < 2) return;
		ctx.beginPath();
		pts.forEach((p, i) => {
			const s = toScreen(v, p);
			if (i) ctx.lineTo(s.x, s.y);
			else ctx.moveTo(s.x, s.y);
		});
		ctx.strokeStyle = color;
		ctx.lineWidth = w;
		ctx.stroke();
	}

	function dot(ctx: CanvasRenderingContext2D, v: View, p: XY, r: number, fill: string, stroke?: string, sw = 1.5) {
		const s = toScreen(v, p);
		ctx.beginPath();
		ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
		ctx.fillStyle = fill;
		ctx.fill();
		if (stroke) {
			ctx.strokeStyle = stroke;
			ctx.lineWidth = sw;
			ctx.stroke();
		}
	}

	function ring(ctx: CanvasRenderingContext2D, s: XY) {
		ctx.beginPath();
		ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
		ctx.fillStyle = 'rgba(99,102,241,0.25)';
		ctx.fill();
		ctx.strokeStyle = '#6366f1';
		ctx.lineWidth = 2;
		ctx.stroke();
	}

	function tile(z: number, x: number, y: number) {
		const key = `${z}/${x}/${y}`;
		let img = tileCache.get(key);
		if (!img) {
			img = new Image();
			img.src = `https://tile.openstreetmap.org/${key}.png`;
			img.onload = () => tilesLoaded++;
			tileCache.set(key, img);
		}
		return img;
	}

	function drawTiles(ctx: CanvasRenderingContext2D, v: View) {
		void tilesLoaded; // redraw as tiles arrive
		const z = Math.max(0, Math.min(19, Math.round(Math.log2((world * v.scale) / 256))));
		const n = 2 ** z;
		const size = (world / n) * v.scale;
		// Screen position of the world's top-left corner.
		const ox = width / 2 + (-world / 2 - v.cx) * v.scale;
		const oy = height / 2 - (world / 2 - v.cy) * v.scale;
		const x0 = Math.max(0, Math.floor(-ox / size));
		const y0 = Math.max(0, Math.floor(-oy / size));
		const x1 = Math.min(n - 1, Math.floor((width - ox) / size));
		const y1 = Math.min(n - 1, Math.floor((height - oy) / size));
		for (let x = x0; x <= x1; x++)
			for (let y = y0; y <= y1; y++) {
				const img = tile(z, x, y);
				if (img.complete && img.naturalWidth)
					ctx.drawImage(img, ox + x * size, oy + y * size, size + 0.5, size + 0.5);
			}
		// Wash out the map a little so the tracks stay the strongest thing on screen.
		ctx.fillStyle = 'rgba(255,255,255,0.35)';
		ctx.fillRect(0, 0, width, height);
	}

	/** Grid lines at a round distance; returns that distance in meters for the scale bar. */
	function drawGrid(ctx: CanvasRenderingContext2D, v: View, visible: boolean) {
		const target = 90 / v.scale;
		const pow = 10 ** Math.floor(Math.log10(target));
		const unit = [1, 2, 5, 10].map((m) => m * pow).find((u) => u >= target)!;
		if (!visible) return unit;
		ctx.strokeStyle = colors.grid;
		ctx.lineWidth = 1;
		ctx.beginPath();
		const left = v.cx - width / 2 / v.scale;
		const bottom = v.cy - height / 2 / v.scale;
		for (let x = Math.ceil(left / unit) * unit; x < left + width / v.scale; x += unit) {
			const sx = Math.round(toScreen(v, { x, y: 0 }).x) + 0.5;
			ctx.moveTo(sx, 0);
			ctx.lineTo(sx, height);
		}
		for (let y = Math.ceil(bottom / unit) * unit; y < bottom + height / v.scale; y += unit) {
			const sy = Math.round(toScreen(v, { x: 0, y }).y) + 0.5;
			ctx.moveTo(0, sy);
			ctx.lineTo(width, sy);
		}
		ctx.stroke();
		return unit;
	}

	function scaleBar(ctx: CanvasRenderingContext2D, unit: number) {
		const len = unit * view!.scale;
		const x = 12;
		const y = height - 14;
		ctx.strokeStyle = '#475569';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x, y - 4);
		ctx.lineTo(x, y);
		ctx.lineTo(x + len, y);
		ctx.lineTo(x + len, y - 4);
		ctx.stroke();
		ctx.fillStyle = '#475569';
		ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
		ctx.fillText(unit >= 1000 ? `${unit / 1000} km` : `${unit} m`, x + len + 6, y + 3);
	}

	let drag = $state<{ x: number; y: number } | null>(null);

	// Touch is handled by the touch listeners below; a tap only picks the hovered point.
	function pointerdown(e: PointerEvent) {
		if (e.pointerType === 'touch') {
			if (view) hover = nearest(e.offsetX, e.offsetY);
			return;
		}
		canvas.setPointerCapture(e.pointerId);
		drag = { x: e.clientX, y: e.clientY };
	}

	function pointermove(e: PointerEvent) {
		if (!view || e.pointerType === 'touch') return;
		if (drag) {
			view = {
				...view,
				cx: view.cx - (e.clientX - drag.x) / view.scale,
				cy: view.cy + (e.clientY - drag.y) / view.scale
			};
			drag = { x: e.clientX, y: e.clientY };
			return;
		}
		hover = nearest(e.offsetX, e.offsetY);
	}

	function nearest(mx: number, my: number): number | null {
		const v = view!;
		let best = 144; // 12 px
		let found: number | null = null;
		const list = variant === 'original' ? points : outXY;
		for (let i = 0; i < list.length; i++) {
			const s = toScreen(v, list[i]);
			const d = (s.x - mx) ** 2 + (s.y - my) ** 2;
			if (d < best) [best, found] = [d, variant === 'original' ? i : out[i].idx];
		}
		return found;
	}

	/** Zoom so the world point under `from` ends up under `to`, scaled by `factor`. */
	function zoomAround(base: View, from: XY, to: XY, factor: number): View {
		const wx = base.cx + (from.x - width / 2) / base.scale;
		const wy = base.cy - (from.y - height / 2) / base.scale;
		const scale = Math.min(50, Math.max(1e-4, base.scale * factor));
		return { scale, cx: wx - (to.x - width / 2) / scale, cy: wy + (to.y - height / 2) / scale };
	}

	// When the panes are stacked the page scrolls, so one finger scrolls it and two fingers move
	// the map. Side by side nothing scrolls, so one finger pans as well.
	// Matches Tailwind's `md` breakpoint used by the layout in Tool.svelte.
	let windowWidth = $state(0);
	const stacked = $derived(windowWidth < 768);

	type Gesture = { base: View; mid: XY; dist: number };
	let gesture: Gesture | null = null;

	function touchState(e: TouchEvent): { mid: XY; dist: number } {
		const r = canvas.getBoundingClientRect();
		const [a, b = a] = [...e.touches];
		return {
			mid: { x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top },
			dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
		};
	}

	function touchstart(e: TouchEvent) {
		if (!view || (stacked && e.touches.length < 2)) return (gesture = null);
		e.preventDefault();
		gesture = { base: view, ...touchState(e) };
	}

	function touchmove(e: TouchEvent) {
		if (!gesture) return;
		e.preventDefault();
		const now = touchState(e);
		const factor = gesture.dist > 0 && now.dist > 0 ? now.dist / gesture.dist : 1;
		view = zoomAround(gesture.base, gesture.mid, now.mid, factor);
	}

	// Lifting one of two fingers continues as a one-finger pan (side by side) or ends the gesture.
	const touchend = (e: TouchEvent) => (e.touches.length ? touchstart(e) : (gesture = null));

	$effect(() => {
		// Svelte's ontouch* attributes are passive; preventDefault needs real listeners.
		const opts = { passive: false };
		canvas.addEventListener('touchstart', touchstart, opts);
		canvas.addEventListener('touchmove', touchmove, opts);
		canvas.addEventListener('touchend', touchend);
		canvas.addEventListener('touchcancel', touchend);
		return () => {
			canvas.removeEventListener('touchstart', touchstart);
			canvas.removeEventListener('touchmove', touchmove);
			canvas.removeEventListener('touchend', touchend);
			canvas.removeEventListener('touchcancel', touchend);
		};
	});

	function wheel(e: WheelEvent) {
		if (!view) return;
		e.preventDefault();
		const at = { x: e.offsetX, y: e.offsetY };
		view = zoomAround(view, at, at, Math.exp(-e.deltaY * 0.0015));
	}
</script>

<svelte:window bind:innerWidth={windowWidth} />

<div class="relative min-h-0 flex-1" bind:clientWidth={width} bind:clientHeight={height}>
	<canvas
		bind:this={canvas}
		class="absolute inset-0 size-full {drag ? 'cursor-grabbing' : 'cursor-grab'}"
		style="width: {width}px; height: {height}px; touch-action: {stacked ? 'pan-y' : 'none'}"
		onpointerdown={pointerdown}
		onpointermove={pointermove}
		onpointerup={() => (drag = null)}
		onpointerleave={(e) => e.pointerType !== 'touch' && (hover = null)}
		onwheel={wheel}
		ondblclick={fit}
		aria-label="{variant} track map"
	></canvas>
	{#if tiles}
		<a
			href="https://www.openstreetmap.org/copyright"
			target="_blank"
			rel="noreferrer"
			class="absolute right-0 bottom-0 rounded-tl bg-white/80 px-1.5 py-0.5 text-[10px] text-mute hover:text-accent"
			>© OpenStreetMap contributors</a
		>
	{/if}
</div>
