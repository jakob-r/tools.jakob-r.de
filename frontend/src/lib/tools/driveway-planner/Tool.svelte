<script lang="ts">
	import CopyButton from '#lib/core/CopyButton.svelte';
	import InfoHint from '#lib/core/InfoHint.svelte';
	import type { MultiPolygon } from 'polygon-clipping';
	import { untrack } from 'svelte';
	import { presets, rearFromFront, type Car } from './cars';
	import { dist, type Pose, type Vec } from './geometry';
	import { canExportVideo, exportPng, exportSvg, exportVideo } from './exportPlan';
	import { importPlan, planFromDataUrl, type PlanImage } from './importPlan';
	import PlanCanvas, { type Mode, type Playback } from './PlanCanvas.svelte';
	import type { PlanInput, PlanResult } from './planner';
	import type { LayerScene, MarkerKind, Scene } from './render';
	import { exampleSvg, examples, type Example } from './examples';
	import { decodeState, encodeState, parseProject, projectJson, type SharedState } from './share';
	import { drive, fitDrivable, joinSplines, VIA_TOLERANCE, type Spline } from './spline';
	import { multiArea, sweepPieces, unionOf } from './sweep';

	type Layer = {
		id: string;
		name: string;
		color: string;
		visible: boolean;
		union: boolean;
		car: Car;
		start: Pose | null;
		via: Pose | null;
		end: Pose | null;
		spline: Spline | null;
		planning: boolean;
		error: string;
	};

	const palette = ['#6366f1', '#f97316', '#0d9488', '#db2777', '#ca8a04', '#0284c7'];
	let nextId = 1;
	function newLayer(car: Car = presets[0]): Layer {
		const n = nextId++;
		return {
			id: String(n),
			name: `Route ${n}`,
			color: palette[(n - 1) % palette.length],
			visible: true,
			union: true,
			car: { ...car },
			start: null,
			via: null,
			end: null,
			spline: null,
			planning: false,
			error: ''
		};
	}

	let plan = $state.raw<PlanImage | null>(null);
	/** Name and pixel size of the plan the drawing belongs to; known even when the image is not. */
	let planInfo = $state.raw<SharedState['plan']>(null);
	let started = $state(false);
	let fileError = $state('');
	let dragOver = $state(false);
	/** Meters per plan pixel. */
	let mpp = $state(0.0254);
	let dpi = $state(96);
	let area = $state.raw<Vec[]>([]);
	let areaClosed = $state(false);
	let buffer = $state(0.3);
	let layers = $state<Layer[]>([newLayer()]);
	let activeId = $state('1');
	let mode = $state<Mode>('select');
	let ruler = $state<[Vec, Vec] | null>(null);
	let rulerLength = $state<number | null>(null);
	let dragging = $state(false);
	let canvas = $state<PlanCanvas>();

	const active = $derived(layers.find((l) => l.id === activeId) ?? null);
	const ratio = $derived(Math.round(((mpp * dpi) / 0.0254) * 10) / 10);

	const drives = $derived(
		layers.map((l) =>
			l.spline && l.start && l.end
				? drive(l.car, buffer, areaClosed ? area : [], l.spline, l.start.th, l.end.th, l.via)
				: null
		)
	);
	const layerScenes = $derived<LayerScene[]>(
		layers.map((l, i) => ({
			id: l.id,
			name: l.name,
			color: l.color,
			visible: l.visible,
			union: l.union,
			car: l.car,
			start: l.start,
			via: l.via,
			end: l.end,
			spline: l.spline,
			drive: drives[i],
			pieces: drives[i] ? sweepPieces(l.car, buffer, drives[i]!.poses) : []
		}))
	);

	// The exact union is slower than drawing the pieces, so it waits until editing pauses.
	let pathway = $state.raw<MultiPolygon | null>(null);
	$effect(() => {
		const pieces = layerScenes.filter((l) => l.union).flatMap((l) => l.pieces);
		pathway = null;
		if (dragging || !pieces.length) return;
		const t = setTimeout(() => (pathway = unionOf(pieces)), 120);
		return () => clearTimeout(t);
	});
	const pathwayArea = $derived(pathway ? multiArea(pathway) : null);

	const scene = $derived<Scene>({ plan, mpp, area, areaClosed, layers: layerScenes, pathway });
	const activeScene = $derived(layerScenes.find((l) => l.id === activeId) ?? null);
	const activeDrive = $derived(activeScene?.drive ?? null);

	// --- Plan file --------------------------------------------------------------------------

	async function open(file: File | undefined) {
		if (!file) return;
		if (file.type === 'application/json' || /\.json$/i.test(file.name)) return openProject(file);
		try {
			const img = await importPlan(file);
			fileError = '';
			plan = img;
			started = true;
			ruler = null;
			// The same plan again (e.g. after opening a shared link): keep the drawing and its scale.
			const same = planInfo && planInfo.width === img.width && planInfo.height === img.height;
			planInfo = { name: img.name, width: img.width, height: img.height };
			if (!same) {
				dpi = Math.round(img.dpi);
				// Assume 1:100 until the user sets the scale.
				mpp = (0.0254 / img.dpi) * 100;
				area = [];
				areaClosed = false;
				for (const l of layers) Object.assign(l, { start: null, via: null, end: null, spline: null, error: '' });
			}
			requestAnimationFrame(() => canvas?.fit());
		} catch (e) {
			fileError = e instanceof Error ? e.message : String(e);
		}
	}

	// --- Sharing via the URL hash -----------------------------------------------------------

	/** Everything worth keeping, as plain data (for the link and for saved files). */
	const sharedState = $derived<SharedState>({
		plan: planInfo,
		mpp,
		dpi,
		buffer,
		area,
		areaClosed,
		active: Math.max(0, layers.findIndex((l) => l.id === activeId)),
		layers: layers.map(({ name, color, visible, union, car, start, via, end, spline }) =>
			$state.snapshot({ name, color, visible, union, car, start, via, end, spline })
		)
	});
	const shareCode = $derived(started ? encodeState(sharedState) : '');
	const shareUrl = $derived(shareCode && `${location.origin}${location.pathname}#${shareCode}`);
	let writtenHash = '';

	// Keep the address bar current, so the link can be copied from there too.
	$effect(() => {
		const code = shareCode;
		if (!code || dragging) return;
		const t = setTimeout(() => {
			writtenHash = `#${code}`;
			history.replaceState(history.state, '', `${location.pathname}${location.search}${writtenHash}`);
		}, 300);
		return () => clearTimeout(t);
	});

	function applyShared(s: SharedState) {
		started = true;
		if (plan && !(s.plan && plan.width === s.plan.width && plan.height === s.plan.height)) plan = null;
		planInfo = s.plan;
		mpp = s.mpp;
		dpi = s.dpi;
		buffer = s.buffer;
		area = s.area;
		areaClosed = s.areaClosed;
		ruler = null;
		mode = 'select';
		nextId = 1;
		layers = s.layers.length ? s.layers.map((l) => ({ ...newLayer(), ...l })) : [newLayer()];
		activeId = (layers[s.active] ?? layers[0]).id;
		requestAnimationFrame(() => canvas?.fit());
		if (!plan && s.plan) restoreExamplePlan(s.plan);
	}

	/** A shared link only carries the plan's name and size; an example plan can be regenerated from those. */
	async function restoreExamplePlan(info: NonNullable<SharedState['plan']>) {
		const ex = examples.find((e) => `${e.id}.svg` === info.name);
		if (!ex) return;
		try {
			const img = await importPlan(new File([exampleSvg(ex)], info.name, { type: 'image/svg+xml' }));
			// Skip if another plan was opened meanwhile or the drawing belongs to a different size.
			if (plan || planInfo?.name !== info.name || img.width !== info.width || img.height !== info.height) return;
			plan = img;
			requestAnimationFrame(() => canvas?.fit());
		} catch {
			// The "open the plan again" prompt stays.
		}
	}

	// --- Saved files: the same state as JSON, with the background embedded as Base64 ----------

	function saveProject() {
		const json = projectJson(
			sharedState,
			plan ? { name: plan.name, dpi: plan.dpi, dataUrl: plan.dataUrl } : null
		);
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
		a.download = `${fileName}.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	async function openProject(file: File) {
		try {
			const { state, image } = parseProject(await file.text());
			const img = image ? await planFromDataUrl(image.dataUrl, image.name, image.dpi) : null;
			fileError = '';
			plan = img;
			applyShared(
				img ? { ...state, plan: { name: img.name, width: img.width, height: img.height } } : state
			);
		} catch (e) {
			fileError = e instanceof Error ? e.message : String(e);
		}
	}

	function onHashChange() {
		if (location.hash === writtenHash) return;
		const s = decodeState(location.hash);
		if (s) applyShared(s);
	}

	const initial = decodeState(location.hash);
	if (initial) applyShared(initial);

	async function loadExample(ex: Example) {
		const svg = exampleSvg(ex);
		const img = await importPlan(new File([svg], `${ex.id}.svg`, { type: 'image/svg+xml' }));
		plan = img;
		applyShared({
			plan: { name: img.name, width: img.width, height: img.height },
			mpp: ex.width / img.width,
			dpi: 96,
			buffer: ex.buffer,
			area: ex.area,
			areaClosed: true,
			active: 0,
			layers: ex.routes.map((r, i) => ({
				name: r.name,
				color: palette[i % palette.length],
				visible: true,
				union: true,
				car: { ...presets[0] },
				start: r.start,
				via: r.via ?? null,
				end: r.end,
				spline: null
			}))
		});
	}

	/** Change the scale and keep everything drawn on the plan in place. */
	function setMpp(next: number) {
		if (!(next > 0) || !Number.isFinite(next)) return;
		const k = next / mpp;
		mpp = next;
		const sv = (p: Vec) => ({ x: p.x * k, y: p.y * k });
		const sp = (p: Pose | null) => (p ? { ...p, x: p.x * k, y: p.y * k } : null);
		area = area.map(sv);
		if (ruler) ruler = [sv(ruler[0]), sv(ruler[1])];
		for (const l of layers) {
			l.start = sp(l.start);
			l.via = sp(l.via);
			l.end = sp(l.end);
			if (l.spline) l.spline = { ...l.spline, pts: l.spline.pts.map(sv) };
		}
		requestAnimationFrame(() => canvas?.fit());
	}

	const rulerMeasured = $derived(ruler ? dist(ruler[0], ruler[1]) : 0);
	function applyRuler() {
		if (!ruler || !rulerLength || rulerMeasured < 1e-6) return;
		setMpp((mpp * rulerLength) / rulerMeasured);
		ruler = null;
		rulerLength = null;
		mode = 'select';
	}

	// --- Editing callbacks -----------------------------------------------------------------

	function setArea(pts: Vec[], closed: boolean) {
		area = pts;
		areaClosed = closed;
		for (const l of layers) l.error = '';
	}

	function setMarker(which: MarkerKind, pose: Pose) {
		const l = active;
		if (!l) return;
		if (Number.isNaN(pose.th)) {
			// Clicked without dragging: a via point faces from start toward end.
			const { start, end } = l;
			pose = { ...pose, th: which === 'via' && start && end ? Math.atan2(end.y - start.y, end.x - start.x) : 0 };
		}
		l[which] = pose;
		l.error = '';
		if (!l.spline) return;
		// The route only passes near its via point, so a moved via point means a new route
		// (found once the drag ends).
		if (which === 'via') {
			l.spline = null;
			return;
		}
		const pts = [...l.spline.pts];
		pts[which === 'start' ? 0 : pts.length - 1] = { x: pose.x, y: pose.y };
		l.spline = { ...l.spline, pts };
	}

	function removeVia(l: Layer) {
		l.via = null;
		l.spline = null;
		l.error = '';
	}

	function setSpline(s: Spline) {
		if (active) active.spline = s;
	}

	function startMode(m: Mode) {
		if (m !== 'ruler') ruler = null;
		mode = m;
	}

	// --- Path finding (in a worker) ---------------------------------------------------------

	let worker: Worker | null = null;
	let seq = 0;
	const pending = new Map<number, (r: PlanResult) => void>();

	function runPlan(input: PlanInput) {
		if (!worker) {
			worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' });
			worker.onmessage = (e: MessageEvent<{ id: number; result: PlanResult }>) => {
				pending.get(e.data.id)?.(e.data.result);
				pending.delete(e.data.id);
			};
		}
		const id = ++seq;
		return new Promise<PlanResult>((resolve) => {
			pending.set(id, resolve);
			worker!.postMessage({ id, ...input });
		});
	}

	async function findPath(l: Layer) {
		if (!l.start || !l.end) return;
		l.planning = true;
		l.error = '';
		const car = $state.snapshot(l.car);
		const stops = [l.start, l.via, l.end].filter((m) => m !== null).map((m) => ({ ...m }));
		const zone = areaClosed ? $state.snapshot(area) : [];
		// With a via point the route is planned in two legs. The first only has to pass the via
		// point; the second carries on from wherever that was, in the same gear if it can.
		const legs: { poses: Pose[]; gears: number[] }[] = [];
		let from = rearFromFront(car, stops[0]);
		let gear = 0;
		let error = '';
		for (let i = 1; i < stops.length; i++) {
			const last = i === stops.length - 1;
			const result = await runPlan({
				car,
				buffer,
				area: zone,
				start: from,
				goal: rearFromFront(car, stops[i]),
				names: [i > 1 ? 'via point' : 'start', last ? 'end' : 'via point'],
				tolerance: last ? undefined : VIA_TOLERANCE,
				startGear: gear
			});
			if ('error' in result) {
				error = (stops.length > 2 ? (last ? 'From the via point: ' : 'To the via point: ') : '') + result.error;
				break;
			}
			legs.push(result);
			from = result.poses[result.poses.length - 1];
			gear = result.gears[result.gears.length - 1];
		}
		l.planning = false;
		// Markers moved while planning: that result is for a different question.
		const now = [l.start, l.via, l.end].filter((m) => m !== null);
		if (now.length !== stops.length || now.some((m, i) => m.x !== stops[i].x || m.y !== stops[i].y)) return;
		if (error) {
			l.error = error;
			return;
		}
		l.spline = legs
			.map((r) => fitDrivable(car, buffer, zone, r.poses, r.gears, r.poses[r.poses.length - 1].th))
			.reduce((a, b) => joinSplines(a, b));
	}

	// Find a path as soon as both ends are placed (for every route, e.g. after loading an example).
	$effect(() => {
		if (dragging || mode !== 'select') return;
		for (const l of layers) if (l.start && l.end && !l.spline && !l.planning && !l.error) findPath(l);
	});

	// --- Layers ----------------------------------------------------------------------------

	function addLayer() {
		const l = newLayer(active?.car);
		layers.push(l);
		activeId = l.id;
		mode = 'start';
	}

	function duplicateLayer() {
		if (!active) return;
		const { name, union, car, start, via, end, spline, error } = $state.snapshot(active);
		const l = { ...newLayer(), name: `${name} copy`, union, car, start, via, end, spline, error };
		layers.splice(layers.indexOf(active) + 1, 0, l);
		activeId = l.id;
	}

	/** Shows just this route, or everything again when it already is the only one shown. */
	function soloLayer(id: string) {
		const solo = layers.every((l) => l.visible === (l.id === id));
		for (const l of layers) l.visible = solo || l.id === id;
	}

	function removeLayer(id: string) {
		layers = layers.filter((l) => l.id !== id);
		if (!layers.length) layers.push(newLayer());
		if (!layers.some((l) => l.id === activeId)) activeId = layers[0].id;
	}

	// --- Car -------------------------------------------------------------------------------

	const carFields: { key: Exclude<keyof Car, 'name'>; label: string; unit: string; step: number }[] = [
		{ key: 'length', label: 'Length', unit: 'm', step: 0.01 },
		{ key: 'width', label: 'Width incl. mirrors', unit: 'm', step: 0.01 },
		{ key: 'wheelbase', label: 'Wheelbase', unit: 'm', step: 0.01 },
		{ key: 'track', label: 'Track width', unit: 'm', step: 0.01 },
		{ key: 'frontOverhang', label: 'Front overhang', unit: 'm', step: 0.01 },
		{ key: 'maxSteerDeg', label: 'Max steering', unit: '°', step: 0.5 }
	];
	const presetName = $derived(
		active && presets.find((p) => carFields.every((f) => Math.abs(p[f.key] - active.car[f.key]) < 1e-6))?.name
	);

	// --- Playback --------------------------------------------------------------------------

	let playing = $state(false);
	let playPos = $state(0);
	const SPEED = 1.5;

	const cumulative = $derived.by(() => {
		const f = activeDrive?.front ?? [];
		const c = [0];
		for (let i = 1; i < f.length; i++) c.push(c[i - 1] + dist(f[i], f[i - 1]));
		return c;
	});
	const total = $derived(cumulative[cumulative.length - 1] ?? 0);

	$effect(() => {
		if (!playing) return;
		let last = performance.now();
		let raf = requestAnimationFrame(function tick(now) {
			playPos = Math.min(total, playPos + ((now - last) / 1000) * SPEED);
			last = now;
			if (playPos >= total) playing = false;
			else raf = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(raf);
	});

	// Another route starts from the beginning.
	$effect(() => {
		void activeId;
		untrack(() => {
			playing = false;
			playPos = 0;
		});
	});

	function togglePlay() {
		if (!playing && playPos >= total) playPos = 0;
		playing = !playing;
	}

	const playback = $derived.by<Playback | null>(() => {
		const d = activeDrive;
		if (!d || !active || (!playing && playPos <= 0)) return null;
		let lo = 0;
		let hi = cumulative.length - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (cumulative[mid] < playPos) lo = mid + 1;
			else hi = mid;
		}
		return { pose: d.poses[lo], steer: d.steer[lo], car: active.car, color: active.color };
	});
	/** Progress of the video being recorded, or null. */
	let recording = $state<number | null>(null);
	async function recordVideo() {
		if (recording !== null) {
			recording = null;
			return;
		}
		if (!activeScene?.drive) return;
		const id = activeId;
		recording = 0;
		await exportVideo(scene, activeScene, `${fileName}-${activeScene.name}`, SPEED, (f) => {
			if (recording === null || activeId !== id) return false;
			recording = f;
			return true;
		});
		recording = null;
	}

	const gearNow =$derived(playback && activeDrive ? activeDrive.gears[activeDrive.poses.indexOf(playback.pose)] : 0);

	const modes: { id: Mode; label: string; hint: string; needsPlan?: boolean }[] = [
		{ id: 'select', label: 'Select', hint: 'Drag empty space to pan, wheel to zoom. Drag markers, their arrow tips and path points.' },
		{ id: 'ruler', label: 'Ruler', hint: 'Drag along a known distance on the plan, then enter its real length.', needsPlan: true },
		{
			id: 'area',
			label: 'Area',
			hint: 'Click the corners of the area the driveway may use; click the first corner or press Enter to close it. Then drag corners to move them, double-click an edge to add one, select one and press Delete to remove it.'
		},
		{ id: 'start', label: 'Start', hint: 'Click where the middle of the front axle starts, drag in the driving direction.' },
		{
			id: 'via',
			label: 'Via',
			hint: 'Optional: click a position the route has to drive through, to guide the planner. Drag to set the direction. The car passes within 40 cm and 20° of it without stopping; moving it finds a new route.'
		},
		{ id: 'end', label: 'End', hint: 'Click where the middle of the front axle ends, drag in the direction the car points.' }
	];

	const fileName = $derived(plan ? plan.name.replace(/\.[^.]+$/, '') + '-driveway' : 'driveway');
	const fmt = (v: number, d = 1) => v.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d });
</script>

<svelte:window
	onhashchange={onHashChange}
	ondragover={(e) => {
		e.preventDefault();
		dragOver = true;
	}}
	ondragleave={(e) => e.relatedTarget === null && (dragOver = false)}
	ondrop={(e) => {
		e.preventDefault();
		dragOver = false;
		open(e.dataTransfer?.files[0]);
	}}
/>

{#snippet card(onclick: () => void, image: string | null, title: string, description: string)}
	<button
		type="button"
		{onclick}
		class="flex flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white text-left hover:border-accent"
	>
		<span class="flex h-36 shrink-0 overflow-hidden border-b border-line bg-slate-50 p-2">
			{#if image}
				<img src={image} alt="" class="min-h-0 w-full object-contain" />
			{:else}
				<span
					class="size-full rounded-md border border-line bg-white"
					style="background-image: linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px); background-size: 12px 12px"
				></span>
			{/if}
		</span>
		<span class="flex flex-col gap-1 p-3">
			<span class="text-sm font-medium">{title}</span>
			<span class="text-xs text-mute">{description}</span>
		</span>
	</button>
{/snippet}

{#snippet openButton(label: string)}
	<label
		class="cursor-pointer rounded-md border border-line px-2.5 py-1 text-xs whitespace-nowrap hover:border-accent hover:text-accent"
	>
		{label}
		<input
			type="file"
			accept="image/*,.svg,.pdf,application/pdf,.json,application/json"
			class="hidden"
			onchange={(e) => open(e.currentTarget.files?.[0])}
		/>
	</label>
{/snippet}

<div class="relative flex h-full flex-col">
	<div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-white px-4 py-2 text-sm">
		<h1 class="font-semibold whitespace-nowrap">Driveway Planner</h1>
		<InfoHint
			text="Plan a driveway on your property plan: set the scale, draw the usable area, place where the car starts and ends, and the planner finds a drivable path (with K-turns if needed). The grey area is what the car and its buffer cover."
		/>
		{@render openButton('Open plan…')}
		{#if plan}<span class="max-w-48 truncate text-xs text-mute" title={plan.name}>{plan.name}</span>{/if}

		{#if started}
			<div class="ml-2 flex overflow-hidden rounded-md border border-line text-xs">
				{#each modes.filter((m) => plan || !m.needsPlan) as m}
					<button
						type="button"
						onclick={() => startMode(m.id)}
						class="border-r border-line px-2.5 py-1 last:border-r-0 {mode === m.id
							? 'bg-accent text-white'
							: 'hover:bg-accent-soft hover:text-accent'}">{m.label}</button
					>
				{/each}
			</div>
			<InfoHint text={modes.find((m) => m.id === mode)!.hint} />
			<button
				type="button"
				onclick={() => canvas?.fit()}
				class="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent">Fit</button
			>
			<div class="ml-auto flex items-center gap-3">
				{#if pathwayArea !== null}
					<span class="text-xs whitespace-nowrap text-mute"
						>Driveway <span class="font-medium text-ink tabular-nums">{fmt(pathwayArea)} m²</span></span
					>
				{/if}
				<span class="flex items-center gap-1.5">
					<button
						type="button"
						onclick={saveProject}
						class="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium whitespace-nowrap hover:border-accent hover:text-accent"
						>Save</button
					>
					<InfoHint
						text="Downloads the whole plan as a .json file, background image included. Open it again with “Open plan…” or by dropping it here."
					/>
					<CopyButton text={shareUrl} label="Copy link" />
					<InfoHint
						text="The link (also in the address bar) holds the whole plan except the background image, which stays in your browser. Send the plan file along; opening it on the shared drawing keeps everything in place."
					/>
				</span>
				<button
					type="button"
					onclick={() => exportSvg(scene, fileName)}
					class="rounded-md border border-line px-2.5 py-1 text-xs whitespace-nowrap hover:border-accent hover:text-accent"
					>Export SVG</button
				>
				<button
					type="button"
					onclick={() => exportPng(scene, fileName)}
					class="rounded-md bg-accent px-3 py-1.5 text-xs font-medium whitespace-nowrap text-white hover:bg-indigo-600"
					>Export PNG</button
				>
			</div>
		{/if}
	</div>

	{#if fileError}
		<div class="border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700">{fileError}</div>
	{/if}

	{#if started && planInfo && !plan}
		<div class="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
			This drawing was made on <span class="font-medium">{planInfo.name}</span>. Open that file to see it underneath; images
			are never part of the link.
			{@render openButton('Open plan…')}
		</div>
	{/if}

	{#if started}
		<div class="flex min-h-0 flex-1">
			<aside class="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-white p-3 text-xs">
				{#if plan}
					<section class="flex flex-col gap-2">
						<h2 class="flex items-center gap-1.5 font-semibold">
							Scale
							<InfoHint
								text="Enter the plan's scale and the resolution it was scanned or exported at, or measure a known distance with the ruler. PDFs are rendered at {Math.round(
									plan.dpi
								)} dpi. Everything you drew stays in place on the plan when the scale changes."
							/>
						</h2>
						<div class="flex items-center gap-1.5">
							1 :
							<input
								type="number"
								min="1"
								step="1"
								value={ratio}
								onchange={(e) => setMpp((0.0254 / dpi) * +e.currentTarget.value)}
								class="w-20 rounded-md border border-line px-1.5 py-1 tabular-nums"
							/>
							at
							<input
								type="number"
								min="1"
								step="1"
								value={dpi}
								onchange={(e) => {
									const n = +e.currentTarget.value;
									if (n > 0) {
										const r = ratio;
										dpi = n;
										setMpp((0.0254 / n) * r);
									}
								}}
								class="w-16 rounded-md border border-line px-1.5 py-1 tabular-nums"
							/>
							dpi
						</div>
						{#if mode === 'ruler' || ruler}
							<div class="flex flex-col gap-1.5 rounded-md bg-pink-50 p-2">
								{#if ruler && rulerMeasured > 0}
									<span class="text-mute">Ruler is {fmt(rulerMeasured, 2)} m at the current scale. Real length:</span>
									<div class="flex items-center gap-1.5">
										<input
											type="number"
											min="0"
											step="0.01"
											bind:value={rulerLength}
											onkeydown={(e) => e.key === 'Enter' && applyRuler()}
											class="w-20 rounded-md border border-line bg-white px-1.5 py-1 tabular-nums"
										/>
										m
										<button
											type="button"
											onclick={applyRuler}
											disabled={!rulerLength}
											class="ml-auto rounded-md bg-accent px-2.5 py-1 text-white disabled:opacity-40">Set scale</button
										>
									</div>
								{:else}
									<span class="text-mute">Drag along a known distance on the plan.</span>
								{/if}
							</div>
						{:else}
							<button
								type="button"
								onclick={() => startMode('ruler')}
								class="self-start rounded-md border border-line px-2.5 py-1 hover:border-accent hover:text-accent"
								>Measure with ruler</button
							>
						{/if}
					</section>
				{/if}

				<section class="flex flex-col gap-2">
					<h2 class="flex items-center gap-1.5 font-semibold">
						Area
						<InfoHint
							text="Where the car may drive. Without an area the planner ignores obstacles. Edit it in Area mode: drag corners, double-click an edge to add one, select one and press Delete to remove it."
						/>
					</h2>
					<div class="flex items-center gap-2">
						<span class="text-mute">{areaClosed ? `${area.length} corners` : 'None drawn'}</span>
						<button
							type="button"
							onclick={() => startMode('area')}
							class="ml-auto rounded-md border border-line px-2.5 py-1 hover:border-accent hover:text-accent"
							>{areaClosed ? 'Edit' : 'Draw'}</button
						>
						{#if areaClosed}
							<button
								type="button"
								onclick={() => setArea([], false)}
								class="rounded-md border border-line px-2.5 py-1 hover:border-red-400 hover:text-red-600">Clear</button
							>
						{/if}
					</div>
					<label class="flex items-center gap-1.5">
						Buffer around the car
						<InfoHint text="Clearance added on every side of the car, for doors, walls and driving imprecision. Included in the driveway area." />
						<input
							type="number"
							min="0"
							step="0.05"
							bind:value={buffer}
							class="ml-auto w-16 rounded-md border border-line px-1.5 py-1 tabular-nums"
						/>
						m
					</label>
				</section>

				{#if active}
					<section class="flex flex-col gap-2">
						<h2 class="flex items-center gap-1.5 font-semibold">
							Car
							<span class="font-normal text-mute">for {active.name}</span>
							<InfoHint
								text="Presets use approximate manufacturer figures; check yours. Max steering is derived from the turning circle. Each route can use a different car."
							/>
						</h2>
						<select
							value={presetName ?? ''}
							onchange={(e) => {
								const p = presets.find((p) => p.name === e.currentTarget.value);
								if (p) active.car = { ...p };
							}}
							class="rounded-md border border-line bg-white px-1.5 py-1"
						>
							{#if !presetName}<option value="">Custom</option>{/if}
							{#each presets as p}<option value={p.name}>{p.name}</option>{/each}
						</select>
						<div class="grid grid-cols-[1fr_auto_auto] items-center gap-x-1.5 gap-y-1">
							{#each carFields as f}
								<span class="text-mute">{f.label}</span>
								<input
									type="number"
									min="0"
									step={f.step}
									bind:value={active.car[f.key]}
									class="w-20 rounded-md border border-line px-1.5 py-0.5 text-right tabular-nums"
								/>
								<span class="w-2 text-mute">{f.unit}</span>
							{/each}
						</div>
					</section>
				{/if}

				<section class="flex flex-col gap-2">
					<h2 class="flex items-center gap-1.5 font-semibold">
						Routes
						<InfoHint
							text="Each route has its own start, end and car, e.g. driving in forwards and backing out, or a second car. Checked routes form the driveway (grey). Click a route to edit it."
						/>
						<button
							type="button"
							onclick={addLayer}
							class="ml-auto rounded-md border border-line px-2 py-0.5 font-normal hover:border-accent hover:text-accent">+ Add</button
						>
						<button
							type="button"
							onclick={duplicateLayer}
							disabled={!active}
							class="grid place-items-center rounded-md border border-line px-1.5 py-1 font-normal hover:border-accent hover:text-accent disabled:opacity-40"
							aria-label="Duplicate selected route"
							title="Duplicate selected route"
						>
							<svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<rect x="9" y="9" width="12" height="12" rx="2" />
								<path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
							</svg>
						</button>
					</h2>
					{#each layers as l, i (l.id)}
						{@const d = drives[i]}
						<div
							role="button"
							tabindex="0"
							onclick={() => (activeId = l.id)}
							onkeydown={(e) => e.key === 'Enter' && (activeId = l.id)}
							class="flex cursor-pointer flex-col gap-1.5 rounded-lg border p-2 {l.id === activeId
								? 'border-accent bg-accent-soft/50'
								: 'border-line hover:border-slate-300'}"
						>
							<div class="flex items-center gap-1.5">
								<span class="size-2.5 shrink-0 rounded-full" style="background: {l.color}"></span>
								<input
									value={l.name}
									onchange={(e) => (l.name = e.currentTarget.value)}
									onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
									class="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-line focus:border-accent focus:bg-white"
								/>
								<label class="flex items-center gap-1 text-mute" title="Part of the driveway">
									<input type="checkbox" bind:checked={l.union} class="accent-accent" onclick={(e) => e.stopPropagation()} />
									driveway
								</label>
								<button
									type="button"
									onclick={(e) => {
										e.stopPropagation();
										l.visible = !l.visible;
									}}
									ondblclick={(e) => {
										e.stopPropagation();
										soloLayer(l.id);
									}}
									class="text-mute hover:text-accent"
									aria-label={l.visible ? 'Hide route' : 'Show route'}
									title="{l.visible ? 'Hide route' : 'Show route'} (double-click: show only this one)"
								>
									<svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
										<circle cx="12" cy="12" r="3" />
										{#if !l.visible}<path d="M3 3l18 18" />{/if}
									</svg>
								</button>
								<button
									type="button"
									onclick={(e) => {
										e.stopPropagation();
										removeLayer(l.id);
									}}
									class="text-mute hover:text-red-600"
									aria-label="Delete route">✕</button
								>
							</div>
							{#if l.id === activeId}
								{#if !l.start || !l.end}
									<span class="text-mute">
										Place the
										<button type="button" class="text-accent underline" onclick={() => startMode('start')}>start</button>
										and
										<button type="button" class="text-accent underline" onclick={() => startMode('end')}>end</button>
										of the car.
									</span>
								{:else if l.planning}
									<span class="text-mute">Finding a path…</span>
								{:else if l.error}
									<span class="text-red-600">{l.error}</span>
								{:else if d}
									{#if d.problems.length}
										<span class="text-red-600">Not drivable: {d.problems.join('; ')}.</span>
									{:else}
										<span class="text-teal-700"
											>Drivable · {fmt(total)} m{l.spline && l.spline.cusps.length
												? ` · ${l.spline.cusps.length} gear change${l.spline.cusps.length > 1 ? 's' : ''}`
												: ''}</span
										>
									{/if}
								{/if}
								{#if l.start && l.end}
									<div class="flex items-center gap-1.5">
										<button
											type="button"
											disabled={l.planning}
											onclick={(e) => {
												e.stopPropagation();
												findPath(l);
											}}
											class="rounded-md border border-line bg-white px-2 py-0.5 hover:border-accent hover:text-accent disabled:opacity-40"
											>{l.spline ? 'Find again' : 'Find path'}</button
										>
										{#if l.spline}
											<InfoHint
												text="The solid line is the middle of the front axle, the dashed one the rear axle. Drag its points to edit; where a point would bend too sharply for the car, its neighbors follow (hold Alt to move just the one point). Double-click it to add a point, select one and press Delete to remove it. Diamonds are gear changes. Red means the car cannot drive it."
											/>
										{/if}
										<button
											type="button"
											onclick={(e) => {
												e.stopPropagation();
												if (l.via) removeVia(l);
												else startMode('via');
											}}
											class="ml-auto rounded-md border border-line bg-white px-2 py-0.5 hover:border-accent hover:text-accent"
											title={l.via ? undefined : 'Add a position the route has to pass'}
											>{l.via ? 'Remove via' : '+ Via point'}</button
										>
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</section>
			</aside>

			<div class="flex min-w-0 flex-1 flex-col">
				<PlanCanvas
					bind:this={canvas}
					{scene}
					active={activeScene}
					bind:mode
					bind:ruler
					bind:dragging
					{playback}
					onarea={setArea}
					onmarker={setMarker}
					onspline={setSpline}
				/>
				<div class="flex shrink-0 items-center gap-3 border-t border-line bg-white px-3 py-1.5 text-xs">
					<button
						type="button"
						onclick={togglePlay}
						disabled={!activeDrive}
						class="grid size-7 place-items-center rounded-full bg-accent text-white hover:bg-indigo-600 disabled:opacity-40"
						aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button
					>
					<input
						type="range"
						min="0"
						max={total || 1}
						step="0.01"
						bind:value={playPos}
						disabled={!activeDrive}
						class="flex-1 accent-accent"
					/>
					<span class="w-48 text-right whitespace-nowrap text-mute tabular-nums">
						{#if playback}
							{gearNow < 0 ? 'Reverse' : 'Forward'} · {fmt(Math.abs((playback.steer * 180) / Math.PI), 0)}° ·
						{/if}
						{fmt(playPos)} / {fmt(total)} m
					</span>
					{#if canExportVideo()}
						<button
							type="button"
							onclick={recordVideo}
							disabled={!activeDrive && recording === null}
							class="w-28 rounded-md border border-line px-2.5 py-1 whitespace-nowrap hover:border-accent hover:text-accent disabled:opacity-40"
							title={recording === null
								? 'Records the car driving this route, framed on it. Takes as long as the video lasts; keep this tab in front.'
								: 'Cancel'}
							>{recording === null ? 'Export video' : `Recording ${Math.round(recording * 100)} %`}</button
						>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
			<label
				class="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-8 py-12 text-center hover:border-accent"
			>
				<span class="text-4xl">🏡</span>
				<span class="font-medium">Drop a property plan here or click to open one</span>
				<span class="text-sm text-mute">PNG, JPG, SVG or PDF, or a saved .json plan. It is processed in your browser and never uploaded.</span>
				<input
					type="file"
					accept="image/*,.svg,.pdf,application/pdf,.json,application/json"
					class="hidden"
					onchange={(e) => open(e.currentTarget.files?.[0])}
				/>
			</label>
			<h2 class="mt-2 text-sm text-mute">Or start from an example</h2>
			<div class="grid grid-cols-4 gap-4">
				{#each examples as ex}
					{@render card(
						() => loadExample(ex),
						`data:image/svg+xml,${encodeURIComponent(exampleSvg(ex, true))}`,
						ex.title,
						ex.description
					)}
				{/each}
				{@render card(
					() => (started = true),
					null,
					'Empty grid',
					'No plan at hand: sketch the area and routes on a 1 m grid.'
				)}
			</div>
		</div>
	{/if}

	{#if dragOver}
		<div
			class="pointer-events-none absolute inset-2 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/80 text-lg font-medium text-accent"
		>
			Drop to open the plan
		</div>
	{/if}
</div>
