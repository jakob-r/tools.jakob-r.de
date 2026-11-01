import type { MultiPolygon } from 'polygon-clipping';
import { footprint, rearFromFront } from './cars';
import type { Vec } from './geometry';
import { colors, drawCar, drawScene, sceneBounds, type LayerScene, type Scene } from './render';
import { unionOf } from './sweep';

const MARGIN = 1;
/** PNG resolution when there is no plan image to match. */
const DEFAULT_PX_PER_M = 50;

function download(blob: Blob, name: string) {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const n = (v: number) => +v.toFixed(3);
const d = (pts: Vec[], closed = true) =>
	pts.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('') + (closed ? 'Z' : '');
const rings = (mp: MultiPolygon) =>
	mp.flatMap((poly) => poly.map((r) => d(r.map(([x, y]) => ({ x, y }))))).join('');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** SVG in meters (1 user unit = 1 m), with the plan embedded and every layer in its own group. */
export function exportSvg(scene: Scene, name: string) {
	const b = sceneBounds(scene);
	if (!b) return;
	const [x, y, w, h] = [b.x0 - MARGIN, b.y0 - MARGIN, b.x1 - b.x0 + 2 * MARGIN, b.y1 - b.y0 + 2 * MARGIN];
	const out: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" width="${n(w * 100)}" height="${n(h * 100)}">`,
		'<desc>Driveway plan. 1 unit = 1 meter.</desc>'
	];
	if (scene.plan)
		out.push(
			`<image id="plan" href="${scene.plan.dataUrl}" x="0" y="0" width="${n(scene.plan.width * scene.mpp)}" height="${n(scene.plan.height * scene.mpp)}" preserveAspectRatio="none"/>`
		);
	if (scene.areaClosed && scene.area.length >= 3)
		out.push(
			`<path id="area" d="${d(scene.area)}" fill="${colors.area}" fill-opacity="0.08" stroke="${colors.area}" stroke-width="0.04" stroke-dasharray="0.15 0.1"/>`
		);
	if (scene.pathway?.length) {
		out.push(
			`<path id="pathway" d="${rings(scene.pathway)}" fill="#64748b" fill-opacity="0.42" fill-rule="evenodd" stroke="${colors.pathwayLine}" stroke-width="0.04"/>`
		);
	}
	for (const l of scene.layers.filter((l) => l.visible)) {
		if (!l.union && l.pieces.length)
			out.push(`<path d="${rings(unionOf(l.pieces))}" fill="${l.color}" fill-opacity="0.13" fill-rule="evenodd"/>`);
		out.push(`<g id="layer-${esc(l.id)}" data-name="${esc(l.name)}" fill="none" stroke="${l.color}">`);
		if (l.drive) {
			out.push(`<path d="${d(l.drive.poses, false)}" stroke-width="0.04" stroke-dasharray="0.15 0.1"/>`);
			out.push(`<path d="${d(l.drive.front, false)}" stroke-width="0.06"/>`);
		}
		for (const [m, c] of [
			[l.start, colors.start],
			[l.via, colors.via],
			[l.end, colors.end]
		] as const)
			if (m) out.push(`<path d="${d(footprint(l.car, 0, rearFromFront(l.car, m)))}" stroke="${c}" stroke-width="0.04"/>`);
		out.push('</g>');
	}
	out.push('</svg>');
	download(new Blob([out.join('\n')], { type: 'image/svg+xml' }), `${name}.svg`);
}

/** PNG at the plan's own resolution (capped), so nothing gets blurrier than the source. */
export async function exportPng(scene: Scene, name: string) {
	const b = sceneBounds(scene);
	if (!b) return;
	const [x, y, w, h] = [b.x0 - MARGIN, b.y0 - MARGIN, b.x1 - b.x0 + 2 * MARGIN, b.y1 - b.y0 + 2 * MARGIN];
	let ppm = scene.plan ? 1 / scene.mpp : DEFAULT_PX_PER_M;
	ppm = Math.min(ppm, 8000 / Math.max(w, h));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(w * ppm);
	canvas.height = Math.round(h * ppm);
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	// Line widths are scaled as if this were a screen showing the whole drawing about 1500 px wide.
	const px = Math.max(w, h) / 1500;
	ctx.setTransform(ppm, 0, 0, ppm, -x * ppm, -y * ppm);
	drawScene(ctx, scene, px);
	const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
	if (blob) download(blob, `${name}.png`);
}

/** Long side of the video in pixels. */
const VIDEO_SIZE = 1920;
/** Seconds the car stands still at the start and the end. */
const VIDEO_HOLD = 0.8;

function videoType() {
	return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) =>
		MediaRecorder.isTypeSupported(t)
	);
}

export const canExportVideo = () =>
	typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype && !!videoType();

/**
 * Records the car driving `layer` as a video, framed on that route. MediaRecorder works in real
 * time, so this takes as long as the video lasts. Resolves false when cancelled.
 */
export async function exportVideo(
	scene: Scene,
	layer: LayerScene,
	name: string,
	speed: number,
	onprogress: (f: number) => boolean
) {
	const drive = layer.drive;
	const type = videoType();
	if (!drive || !type) return false;
	// The recorded route shows even when it is hidden in the editor.
	scene = { ...scene, layers: scene.layers.map((l) => (l.id === layer.id ? { ...l, visible: true } : l)) };
	const b = sceneBounds({ ...scene, plan: null, area: [], layers: [layer] });
	if (!b) return false;
	const m = 2 * MARGIN;
	let [x, y, w, h] = [b.x0 - m, b.y0 - m, b.x1 - b.x0 + 2 * m, b.y1 - b.y0 + 2 * m];
	// 16:9 landscape, centered on the route.
	if (w / h < 16 / 9) [x, w] = [x - (h * (16 / 9) - w) / 2, h * (16 / 9)];
	else [y, h] = [y - (w / (16 / 9) - h) / 2, w / (16 / 9)];
	const canvas = document.createElement('canvas');
	canvas.width = VIDEO_SIZE;
	canvas.height = Math.round((VIDEO_SIZE * 9) / 16 / 2) * 2;
	const ppm = canvas.width / w;
	const px = 1.5 / ppm;
	const ctx = canvas.getContext('2d')!;

	const cumulative = [0];
	for (let i = 1; i < drive.front.length; i++)
		cumulative.push(cumulative[i - 1] + Math.hypot(drive.front[i].x - drive.front[i - 1].x, drive.front[i].y - drive.front[i - 1].y));
	const total = cumulative[cumulative.length - 1];
	const duration = total / speed + 2 * VIDEO_HOLD;

	let i = 0;
	const frame = (pos: number) => {
		while (i < cumulative.length - 1 && cumulative[i] < pos) i++;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = scene.plan ? '#fff' : '#f8fafc';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(ppm, 0, 0, ppm, -x * ppm, -y * ppm);
		if (!scene.plan) {
			ctx.beginPath();
			for (let gx = Math.floor(x); gx <= x + w; gx++) ctx.rect(gx, y, 0, h);
			for (let gy = Math.floor(y); gy <= y + h; gy++) ctx.rect(x, gy, w, 0);
			ctx.strokeStyle = '#e2e8f0';
			ctx.lineWidth = px;
			ctx.stroke();
		}
		drawScene(ctx, scene, px);
		drawCar(ctx, layer.car, drive.poses[i], drive.steer[i], layer.color, px);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		const label = `${layer.name} · ${drive.gears[i] < 0 ? 'Reverse' : 'Forward'} · ${pos.toFixed(1)} / ${total.toFixed(1)} m`;
		ctx.font = '500 28px system-ui, sans-serif';
		const tw = ctx.measureText(label).width;
		ctx.fillStyle = 'rgba(255,255,255,0.85)';
		ctx.beginPath();
		ctx.roundRect(24, canvas.height - 76, tw + 32, 52, 10);
		ctx.fill();
		ctx.fillStyle = '#1e293b';
		ctx.fillText(label, 40, canvas.height - 40);
	};

	frame(0);
	const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 8e6 });
	const chunks: Blob[] = [];
	recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
	const stopped = new Promise((r) => (recorder.onstop = r));
	recorder.start();
	const t0 = performance.now();
	const done = await new Promise<boolean>((resolve) =>
		requestAnimationFrame(function tick(now) {
			const t = (now - t0) / 1000;
			if (!onprogress(Math.min(1, t / duration))) return resolve(false);
			frame(Math.max(0, Math.min(total, (t - VIDEO_HOLD) * speed)));
			if (t >= duration) resolve(true);
			else requestAnimationFrame(tick);
		})
	);
	recorder.stop();
	await stopped;
	if (done) download(new Blob(chunks, { type }), `${name}.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
	return done;
}
