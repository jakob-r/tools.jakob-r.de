// The whole plan except the background image, packed into the URL hash for sharing:
// compact JSON → raw deflate → Base64url, behind a version prefix. The hash never reaches a server.

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { Car } from './cars';
import type { Pose, Vec } from './geometry';
import type { Spline } from './spline';

export type SharedLayer = {
	name: string;
	color: string;
	visible: boolean;
	union: boolean;
	car: Car;
	start: Pose | null;
	via: Pose | null;
	end: Pose | null;
	spline: Spline | null;
};

export type SharedState = {
	/** The background the drawing belongs to; only its name and pixel size travel. */
	plan: { name: string; width: number; height: number } | null;
	mpp: number;
	dpi: number;
	buffer: number;
	area: Vec[];
	areaClosed: boolean;
	active: number;
	layers: SharedLayer[];
};

const PREFIX = 'v1.';
// Millimeters are plenty, and short numbers compress well.
const r = (v: number) => Math.round(v * 1000) / 1000;
const flat = (pts: Vec[]) => pts.flatMap((p) => [r(p.x), r(p.y)]);
const unflat = (a: number[]): Vec[] => {
	const out: Vec[] = [];
	for (let i = 0; i + 1 < a.length; i += 2) out.push({ x: a[i], y: a[i + 1] });
	return out;
};
const pose = (p: Pose | null) => (p ? [r(p.x), r(p.y), Math.round(p.th * 1e4) / 1e4] : 0);
const unpose = (a: unknown): Pose | null => (Array.isArray(a) && a.length === 3 ? { x: a[0], y: a[1], th: a[2] } : null);

export function encodeState(s: SharedState): string {
	const packed = {
		p: s.plan ? [s.plan.name, s.plan.width, s.plan.height] : 0,
		m: s.mpp,
		d: s.dpi,
		b: s.buffer,
		a: flat(s.area),
		ac: s.areaClosed ? 1 : 0,
		i: s.active,
		l: s.layers.map((l) => ({
			n: l.name,
			c: l.color,
			f: (l.visible ? 1 : 0) | (l.union ? 2 : 0),
			k: [l.car.name, l.car.length, l.car.width, l.car.wheelbase, l.car.track, l.car.frontOverhang, l.car.maxSteerDeg],
			s: pose(l.start),
			v: pose(l.via),
			e: pose(l.end),
			sp: l.spline ? [flat(l.spline.pts), l.spline.cusps, l.spline.gears] : 0
		}))
	};
	const bytes = deflateSync(strToU8(JSON.stringify(packed)), { level: 9 });
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The state in a URL hash, or null when the hash holds none (or something broken). */
export function decodeState(hash: string): SharedState | null {
	const code = hash.replace(/^#/, '');
	if (!code.startsWith(PREFIX)) return null;
	try {
		const bin = atob(code.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'));
		const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
		const p = JSON.parse(strFromU8(inflateSync(bytes)));
		const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
		return {
			plan: Array.isArray(p.p) ? { name: String(p.p[0]), width: num(p.p[1], 0), height: num(p.p[2], 0) } : null,
			mpp: num(p.m, 0.0254),
			dpi: num(p.d, 96),
			buffer: num(p.b, 0.3),
			area: unflat(p.a ?? []),
			areaClosed: !!p.ac,
			active: num(p.i, 0),
			layers: (p.l ?? []).map((l: Record<string, any>) => {
				const [name, length, width, wheelbase, track, frontOverhang, maxSteerDeg] = l.k;
				return {
					name: String(l.n),
					color: String(l.c),
					visible: !!(l.f & 1),
					union: !!(l.f & 2),
					car: { name, length, width, wheelbase, track, frontOverhang, maxSteerDeg },
					start: unpose(l.s),
					via: unpose(l.v),
					end: unpose(l.e),
					spline: Array.isArray(l.sp) ? { pts: unflat(l.sp[0]), cusps: l.sp[1], gears: l.sp[2] } : null
				};
			})
		};
	} catch {
		return null;
	}
}

// --- Project files ---------------------------------------------------------------------------
// Readable JSON with the same state as the link, plus the background as a Base64 data URL.

const FORMAT = 'driveway-planner';

export type ProjectImage = { name: string; dpi: number; dataUrl: string };

export function projectJson(state: SharedState, image: ProjectImage | null) {
	return JSON.stringify({ format: FORMAT, version: 1, state, image }, null, 1);
}

export function parseProject(text: string): { state: SharedState; image: ProjectImage | null } {
	let raw: any;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new Error('This file is not valid JSON.');
	}
	if (raw?.format !== FORMAT || !raw.state) throw new Error('This JSON file is not a saved driveway plan.');
	const s = raw.state;
	const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
	const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
	const vec = (p: any): Vec | null => (p && isNum(p.x) && isNum(p.y) ? { x: p.x, y: p.y } : null);
	const vecs = (a: unknown): Vec[] => (Array.isArray(a) ? a.map(vec).filter((p) => p !== null) : []);
	const pose = (p: any): Pose | null => (vec(p) && isNum(p.th) ? { x: p.x, y: p.y, th: p.th } : null);
	const ints = (a: unknown): number[] => (Array.isArray(a) ? a.filter((v) => Number.isInteger(v)) : []);
	const image = raw.image;
	return {
		state: {
			plan: s.plan && typeof s.plan.name === 'string' ? { name: s.plan.name, width: num(s.plan.width, 0), height: num(s.plan.height, 0) } : null,
			mpp: num(s.mpp, 0.0254),
			dpi: num(s.dpi, 96),
			buffer: num(s.buffer, 0.3),
			area: vecs(s.area),
			areaClosed: !!s.areaClosed,
			active: num(s.active, 0),
			layers: (Array.isArray(s.layers) ? s.layers : []).map((l: any) => {
				const c = l.car ?? {};
				const spline = l.spline && {
					pts: vecs(l.spline.pts),
					cusps: ints(l.spline.cusps),
					gears: ints(l.spline.gears)
				};
				return {
					name: String(l.name ?? 'Route'),
					color: typeof l.color === 'string' ? l.color : '#6366f1',
					visible: l.visible !== false,
					union: l.union !== false,
					car: {
						name: String(c.name ?? 'Custom'),
						length: num(c.length, 4.8),
						width: num(c.width, 2.1),
						wheelbase: num(c.wheelbase, 2.9),
						track: num(c.track, 1.6),
						frontOverhang: num(c.frontOverhang, 0.9),
						maxSteerDeg: num(c.maxSteerDeg, 33)
					},
					start: pose(l.start),
					via: pose(l.via),
					end: pose(l.end),
					spline:
						spline && spline.pts.length >= 2 && spline.gears.length === spline.cusps.length + 1 ? spline : null
				};
			})
		},
		image:
			image && typeof image.dataUrl === 'string' && image.dataUrl.startsWith('data:image/')
				? { name: String(image.name ?? 'plan'), dpi: num(image.dpi, 96), dataUrl: image.dataUrl }
				: null
	};
}
