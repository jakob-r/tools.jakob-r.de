import type { MultiPolygon } from 'polygon-clipping';
import { footprint, rearFromFront } from './cars';
import type { Vec } from './geometry';
import { colors, drawScene, sceneBounds, type Scene } from './render';
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
