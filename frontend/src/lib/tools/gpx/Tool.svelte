<script lang="ts">
	import InfoHint from '#lib/core/InfoHint.svelte';
	import { projector } from './geo';
	import { exportGpx, parseGpx, type ParsedGpx } from './gpx';
	import {
		analyze,
		clean,
		detectProfile,
		profiles,
		stats,
		type ProfileId,
		type Stages,
		type Stats
	} from './pipeline';
	import { sampleGpx } from './sample';
	import Timeline from './Timeline.svelte';
	import TrackMap, { type View } from './TrackMap.svelte';

	let src = $state.raw<ParsedGpx | null>(null);
	let fileName = $state('');
	let error = $state('');
	let dragOver = $state(false);

	let stages = $state<Stages>({ crop: true, spikes: true, pauses: true, simplify: true });
	let crop = $state(0);
	let profileOverride = $state<ProfileId | null>(null);
	let view = $state<View | null>(null);
	let hover = $state<number | null>(null);
	let maps = $state<TrackMap[]>([]);

	const points = $derived(src?.points ?? []);
	const analysis = $derived(analyze(points));
	const detection = $derived(detectProfile(points, analysis, stages.crop ? crop : points.length));
	const profileId = $derived(profileOverride ?? detection.profile);
	const result = $derived(src && clean(points, analysis.hasTime, profiles[profileId], stages, crop));
	const before = $derived(src && stats(points));
	const after = $derived(result && stats(result.out));

	const project = $derived(projector(points[0]?.lat ?? 0));
	const xy = $derived(points.map(project));
	const xs = $derived(
		analysis.hasTime ? points.map((p) => (p.time! - points[0].time!) / 1000) : analysis.cum
	);

	function load(text: string, name: string) {
		try {
			const parsed = parseGpx(text);
			error = '';
			src = parsed;
			fileName = name;
			crop = analyze(parsed.points).autoCrop;
			profileOverride = null;
			view = null;
			hover = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function open(file: File | undefined) {
		if (file) load(await file.text(), file.name);
	}

	function download() {
		if (!src || !result) return;
		const blob = new Blob([exportGpx(src, result.out)], { type: 'application/gpx+xml' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = fileName.replace(/\.gpx$/i, '') + '-clean.gpx';
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	function duration(s: number | undefined) {
		if (s === undefined) return '–';
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return `${h}:${String(m).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
	}

	const stageList: { key: keyof Stages; label: string; hint: string }[] = [
		{
			key: 'crop',
			label: 'Auto-crop end',
			hint: 'Cuts off a sustained jump to much higher speed near the end (driving home with the recorder still on). Drag the red marker in the chart to adjust.'
		},
		{
			key: 'spikes',
			label: 'Remove spikes',
			hint: 'Drops points that form a sharp V (< 30°) and would need an acceleration beyond what the activity allows.'
		},
		{
			key: 'pauses',
			label: 'Clean pauses',
			hint: 'Collapses GPS drift while standing still into one spot. Entry and exit times are kept, so elapsed time stays correct while phantom distance disappears.'
		},
		{
			key: 'simplify',
			label: 'Simplify',
			hint: 'Ramer-Douglas-Peucker: drops points that lie within a few meters of a straight line. Tolerance depends on the profile.'
		}
	];

	const metrics: { label: string; fmt: (s: Stats) => string }[] = [
		{ label: 'Distance', fmt: (s) => `${(s.distance / 1000).toFixed(2)} km` },
		{ label: 'Elapsed', fmt: (s) => duration(s.elapsed) },
		{ label: 'Moving', fmt: (s) => duration(s.moving) },
		{ label: 'Ascent', fmt: (s) => (s.ascent === undefined ? '–' : `${Math.round(s.ascent)} m`) },
		{ label: 'Points', fmt: (s) => s.points.toLocaleString('en') }
	];
</script>

<svelte:window
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

<div class="relative flex h-full flex-col">
	<div class="flex shrink-0 items-center gap-3 border-b border-line bg-white px-4 py-2 text-sm">
		<h1 class="font-semibold whitespace-nowrap">GPX Cleaner</h1>
		<InfoHint
			text="Removes GPS spikes, pause drift and the drive home from a GPX track, then simplifies it. Drop a .gpx file anywhere. Maps are drawn locally without map tiles, so your location is never sent anywhere."
		/>
		<label
			class="ml-2 cursor-pointer rounded-md border whitespace-nowrap border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
		>
			Open GPX…
			<input type="file" accept=".gpx,application/gpx+xml" class="hidden" onchange={(e) => open(e.currentTarget.files?.[0])} />
		</label>
		{#if fileName}<span class="max-w-48 truncate text-xs text-mute" title={fileName}>{fileName}</span>{/if}

		{#if before && after}
			<dl class="ml-auto flex gap-4 text-xs">
				{#each metrics as m}
					<div>
						<dt class="text-mute">{m.label}</dt>
						<dd class="font-medium whitespace-nowrap tabular-nums">
							<span class="text-orange-600">{m.fmt(before)}</span>
							<span class="text-mute">→</span>
							<span class="text-teal-700">{m.fmt(after)}</span>
						</dd>
					</div>
				{/each}
			</dl>
		{/if}
		<button
			type="button"
			onclick={download}
			disabled={!result}
			class="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium whitespace-nowrap text-white hover:bg-indigo-600 disabled:opacity-40 {before
				? ''
				: 'ml-auto'}">Export GPX</button
		>
	</div>

	{#if error}
		<div class="border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700">{error}</div>
	{/if}

	{#if src && result}
		<div class="grid min-h-0 flex-1 grid-cols-2 gap-3 p-3 pb-0">
			{#each ['original', 'cleaned'] as const as variant, i}
				<section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white">
					<div class="flex shrink-0 items-center gap-3 border-b border-line bg-slate-50 px-3 py-1.5 text-xs">
						{#if variant === 'original'}
							<span class="font-medium"><span class="text-orange-500">●</span> Original</span>
							<span class="text-mute"><span class="text-red-600">●</span> spike</span>
							<span class="text-mute"><span class="text-purple-500">●</span> pause drift</span>
							<span class="text-mute"><span class="text-slate-400">┄</span> cropped</span>
						{:else}
							<span class="font-medium"><span class="text-teal-600">●</span> Cleaned</span>
							<span class="text-mute"><span class="text-purple-500">○</span> pause</span>
							<span class="text-mute"><span class="text-green-600">●</span> start</span>
							<span class="text-mute"><span class="text-slate-800">●</span> end</span>
						{/if}
						<button
							type="button"
							onclick={() => maps[i]?.fit()}
							class="ml-auto rounded-md border border-line bg-white px-2 py-0.5 hover:border-accent hover:text-accent"
							title="Zoom to the whole track (or double-click the map)">Fit</button
						>
					</div>
					<TrackMap
						bind:this={maps[i]}
						{variant}
						points={xy}
						{project}
						removed={result.removed}
						out={result.out}
						pauses={result.pauses}
						crop={stages.crop ? crop : points.length}
						bind:view
						bind:hover
					/>
				</section>
			{/each}
		</div>

		<div class="m-3 flex h-48 shrink-0 overflow-hidden rounded-xl border border-line bg-white">
			<div class="flex w-60 shrink-0 flex-col gap-2 border-r border-line bg-slate-50 p-3 text-xs">
				<label class="flex flex-col gap-1">
					<span class="flex items-center gap-1.5 text-mute">
						Activity profile
						<InfoHint text="Auto-detected: {detection.reason} Changing it re-runs the cleaning with that profile's limits." />
					</span>
					<select
						value={profileOverride ?? 'auto'}
						onchange={(e) => {
							const v = e.currentTarget.value;
							profileOverride = v === 'auto' ? null : (v as ProfileId);
						}}
						class="rounded-md border border-line bg-white px-1.5 py-1"
					>
						<option value="auto">Auto: {profiles[detection.profile].label}</option>
						{#each Object.entries(profiles) as [id, p]}<option value={id}>{p.label}</option>{/each}
					</select>
				</label>
				{#each stageList as s}
					{@const unavailable = !analysis.hasTime && (s.key === 'crop' || s.key === 'pauses')}
					<label class="flex items-center gap-2 {unavailable ? 'opacity-40' : ''}">
						<input
							type="checkbox"
							bind:checked={stages[s.key]}
							disabled={unavailable}
							class="peer sr-only"
						/>
						<span
							class="relative h-4 w-7 rounded-full bg-slate-300 transition peer-checked:bg-accent after:absolute after:top-0.5 after:left-0.5 after:size-3 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-3 peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40"
						></span>
						{s.label}
						<span class="ml-auto"><InfoHint text={unavailable ? 'Needs timestamps in the file.' : s.hint} /></span>
					</label>
				{/each}
			</div>
			<div class="flex min-w-0 flex-1 flex-col">
				<div class="flex shrink-0 items-center gap-3 px-3 pt-1.5 text-xs text-mute">
					<span><span class="text-slate-300">■</span> elevation</span>
					{#if analysis.hasTime}<span><span class="text-accent">—</span> speed</span>{/if}
					{#if stages.crop && analysis.hasTime}
						<span><span class="text-red-600">▼</span> end of activity</span>
						{#if crop !== analysis.autoCrop}
							<button type="button" class="underline hover:text-accent" onclick={() => (crop = analysis.autoCrop)}
								>reset</button
							>
						{/if}
						<span class="ml-auto"><InfoHint text="Drag the red marker to set where the activity ended." /></span>
					{/if}
				</div>
				<Timeline
					{points}
					{xs}
					speed={analysis.speed}
					hasTime={analysis.hasTime}
					pauses={stages.pauses ? result.pauses : []}
					cropEnabled={stages.crop && analysis.hasTime}
					bind:crop
					bind:hover
				/>
			</div>
		</div>
	{:else}
		<div class="grid flex-1 place-items-center p-6">
			<label
				class="flex w-full max-w-lg cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-8 py-14 text-center hover:border-accent"
			>
				<span class="text-4xl">🧭</span>
				<span class="font-medium">Drop a .gpx file here or click to open one</span>
				<span class="text-sm text-mute">The file is processed in your browser and never uploaded.</span>
				<input type="file" accept=".gpx,application/gpx+xml" class="hidden" onchange={(e) => open(e.currentTarget.files?.[0])} />
			</label>
			<button
				type="button"
				onclick={() => load(sampleGpx(), 'sample-hike.gpx')}
				class="-mt-24 text-sm text-accent underline">or try a sample track</button
			>
		</div>
	{/if}

	{#if dragOver}
		<div
			class="pointer-events-none absolute inset-2 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/80 text-lg font-medium text-accent"
		>
			Drop to clean
		</div>
	{/if}
</div>
