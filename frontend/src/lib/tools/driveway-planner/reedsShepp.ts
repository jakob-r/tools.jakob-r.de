// Reeds-Shepp curves: shortest paths for a car that can drive forward and backward with a minimum
// turning radius. Follows the formulas of Reeds & Shepp (1990) as implemented in OMPL's
// ReedsSheppStateSpace. Lengths are in units of the turning radius; the sign is the gear.

import type { Pose } from './geometry';

export type Turn = 'L' | 'R' | 'S';
export type RsPath = { types: Turn[]; lengths: number[]; total: number };

const PI = Math.PI;
const HALF = PI / 2;
const ZERO = 10 * Number.EPSILON;

function mod2pi(x: number) {
	let v = x % (2 * PI);
	if (v < -PI) v += 2 * PI;
	else if (v > PI) v -= 2 * PI;
	return v;
}

const polar = (x: number, y: number): [number, number] => [Math.hypot(x, y), Math.atan2(y, x)];

function tauOmega(u: number, v: number, xi: number, eta: number, phi: number): [number, number] {
	const delta = mod2pi(u - v);
	const A = Math.sin(u) - Math.sin(delta);
	const B = Math.cos(u) - Math.cos(delta) - 1;
	const t1 = Math.atan2(eta * A - xi * B, xi * A + eta * B);
	const t2 = 2 * (Math.cos(delta) - Math.cos(v) - Math.cos(phi)) + 3;
	const tau = t2 < 0 ? mod2pi(t1 + PI) : mod2pi(t1);
	return [tau, mod2pi(tau - u + v - phi)];
}

type Formula = (x: number, y: number, phi: number) => number[] | null;

// 8.1
const LpSpLp: Formula = (x, y, phi) => {
	const [u, t] = polar(x - Math.sin(phi), y - 1 + Math.cos(phi));
	if (t < -ZERO) return null;
	const v = mod2pi(phi - t);
	return v >= -ZERO ? [t, u, v] : null;
};
// 8.2
const LpSpRp: Formula = (x, y, phi) => {
	const [r, t1] = polar(x + Math.sin(phi), y - 1 - Math.cos(phi));
	const u1 = r * r;
	if (u1 < 4) return null;
	const u = Math.sqrt(u1 - 4);
	const t = mod2pi(t1 + Math.atan2(2, u));
	const v = mod2pi(t - phi);
	return t >= -ZERO && v >= -ZERO ? [t, u, v] : null;
};
// 8.3
const LpRmL: Formula = (x, y, phi) => {
	const [u1, theta] = polar(x - Math.sin(phi), y - 1 + Math.cos(phi));
	if (u1 > 4) return null;
	const u = -2 * Math.asin(0.25 * u1);
	const t = mod2pi(theta + 0.5 * u + PI);
	const v = mod2pi(phi - t + u);
	return t >= -ZERO && u <= ZERO ? [t, u, v] : null;
};
// 8.7
const LpRupLumRm: Formula = (x, y, phi) => {
	const xi = x + Math.sin(phi);
	const eta = y - 1 - Math.cos(phi);
	const rho = 0.25 * (2 + Math.hypot(xi, eta));
	if (rho > 1) return null;
	const u = Math.acos(rho);
	const [t, v] = tauOmega(u, -u, xi, eta, phi);
	return t >= -ZERO && v <= ZERO ? [t, u, v] : null;
};
// 8.8
const LpRumLumRp: Formula = (x, y, phi) => {
	const xi = x + Math.sin(phi);
	const eta = y - 1 - Math.cos(phi);
	const rho = (20 - xi * xi - eta * eta) / 16;
	if (rho < 0 || rho > 1) return null;
	const u = -Math.acos(rho);
	if (u < -HALF) return null;
	const [t, v] = tauOmega(u, u, xi, eta, phi);
	return t >= -ZERO && v >= -ZERO ? [t, u, v] : null;
};
// 8.9
const LpRmSmLm: Formula = (x, y, phi) => {
	const [rho, theta] = polar(x - Math.sin(phi), y - 1 + Math.cos(phi));
	if (rho < 2) return null;
	const r = Math.sqrt(rho * rho - 4);
	const u = 2 - r;
	const t = mod2pi(theta + Math.atan2(r, -2));
	const v = mod2pi(phi - HALF - t);
	return t >= -ZERO && u <= ZERO && v <= ZERO ? [t, u, v] : null;
};
// 8.10
const LpRmSmRm: Formula = (x, y, phi) => {
	const xi = x + Math.sin(phi);
	const eta = y - 1 - Math.cos(phi);
	const [rho, theta] = polar(-eta, xi);
	if (rho < 2) return null;
	const t = theta;
	const u = 2 - rho;
	const v = mod2pi(t + HALF - phi);
	return t >= -ZERO && u <= ZERO && v <= ZERO ? [t, u, v] : null;
};
// 8.11
const LpRmSLmRp: Formula = (x, y, phi) => {
	const xi = x + Math.sin(phi);
	const eta = y - 1 - Math.cos(phi);
	const [rho] = polar(xi, eta);
	if (rho < 2) return null;
	const u = 4 - Math.sqrt(rho * rho - 4);
	if (u > ZERO) return null;
	const t = mod2pi(Math.atan2((4 - u) * xi - 2 * eta, -2 * xi + (u - 4) * eta));
	const v = mod2pi(t - phi);
	return t >= -ZERO && v >= -ZERO ? [t, u, v] : null;
};

const flipLR = (types: Turn[]) => types.map((t) => (t === 'L' ? 'R' : t === 'R' ? 'L' : 'S')) as Turn[];
const T = (s: string) => s.split('') as Turn[];

/** Every Reeds-Shepp candidate for a normalized goal (x, y, phi) relative to the start. */
function candidates(x: number, y: number, phi: number): RsPath[] {
	const out: RsPath[] = [];
	const add = (types: Turn[], lengths: number[]) =>
		out.push({ types, lengths, total: lengths.reduce((s, l) => s + Math.abs(l), 0) });

	// Time-flip (reverse gear) and reflection (swap left/right) variants of a formula.
	function family(f: Formula, types: Turn[], map: (r: number[]) => number[], fx = x, fy = y) {
		let r: number[] | null;
		if ((r = f(fx, fy, phi))) add(types, map(r));
		if ((r = f(-fx, fy, -phi))) add(types, map(r).map((v) => -v));
		if ((r = f(fx, -fy, -phi))) add(flipLR(types), map(r));
		if ((r = f(-fx, -fy, phi))) add(flipLR(types), map(r).map((v) => -v));
	}
	const xb = x * Math.cos(phi) + y * Math.sin(phi);
	const yb = x * Math.sin(phi) - y * Math.cos(phi);

	// CSC
	family(LpSpLp, T('LSL'), ([t, u, v]) => [t, u, v]);
	family(LpSpRp, T('LSR'), ([t, u, v]) => [t, u, v]);
	// CCC
	family(LpRmL, T('LRL'), ([t, u, v]) => [t, u, v]);
	family(LpRmL, T('LRL'), ([t, u, v]) => [v, u, t], xb, yb);
	// CCCC
	family(LpRupLumRm, T('LRLR'), ([t, u, v]) => [t, u, -u, v]);
	family(LpRumLumRp, T('LRLR'), ([t, u, v]) => [t, u, u, v]);
	// CCSC
	family(LpRmSmLm, T('LRSL'), ([t, u, v]) => [t, -HALF, u, v]);
	family(LpRmSmRm, T('LRSR'), ([t, u, v]) => [t, -HALF, u, v]);
	family(LpRmSmLm, T('LSRL'), ([t, u, v]) => [v, u, -HALF, t], xb, yb);
	family(LpRmSmRm, T('RSRL'), ([t, u, v]) => [v, u, -HALF, t], xb, yb);
	// CCSCC
	family(LpRmSLmRp, T('LRSLR'), ([t, u, v]) => [t, -HALF, u, -HALF, v]);
	return out;
}

/** All Reeds-Shepp paths from a to b for turning radius r, shortest first. */
export function rsPaths(a: Pose, b: Pose, r: number): RsPath[] {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const c = Math.cos(a.th);
	const s = Math.sin(a.th);
	const x = (c * dx + s * dy) / r;
	const y = (-s * dx + c * dy) / r;
	const phi = b.th - a.th;
	// A few CCCC solutions of the closed-form formulas miss the goal; drop any that do.
	return candidates(x, y, phi)
		.filter((p) => {
			if (!p.lengths.every(Number.isFinite)) return false;
			let q: Pose = { x: 0, y: 0, th: 0 };
			p.types.forEach((t, i) => (q = arc(q, p.lengths[i], t === 'S' ? 0 : t === 'L' ? 1 : -1)));
			return Math.hypot(q.x - x, q.y - y) < 1e-6 && Math.abs(Math.sin((q.th - phi) / 2)) < 1e-6;
		})
		.sort((p, q) => p.total - q.total);
}

/** Length (meters) of the shortest Reeds-Shepp path. */
export function rsDistance(a: Pose, b: Pose, r: number) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const c = Math.cos(a.th);
	const s = Math.sin(a.th);
	let best = Infinity;
	for (const p of candidates((c * dx + s * dy) / r, (-s * dx + c * dy) / r, b.th - a.th)) best = Math.min(best, p.total);
	return best * r;
}

/** Poses along a path every ~`ds` meters, each with its gear (+1 forward, -1 reverse). */
export function sampleRs(a: Pose, path: RsPath, r: number, ds: number): { pose: Pose; gear: number }[] {
	const out: { pose: Pose; gear: number }[] = [];
	let p = { ...a };
	path.types.forEach((type, i) => {
		const len = path.lengths[i] * r;
		if (Math.abs(len) < 1e-9) return;
		const gear = Math.sign(len);
		const n = Math.max(1, Math.ceil(Math.abs(len) / ds));
		const start = p;
		for (let k = 1; k <= n; k++) {
			p = arc(start, (len * k) / n, type === 'S' ? 0 : type === 'L' ? 1 / r : -1 / r);
			out.push({ pose: p, gear });
		}
	});
	return out;
}

/** Drive `s` meters (negative = reverse) with curvature `k` (positive turns toward +θ). */
export function arc(p: Pose, s: number, k: number): Pose {
	if (Math.abs(k) < 1e-9) return { x: p.x + s * Math.cos(p.th), y: p.y + s * Math.sin(p.th), th: p.th };
	const th = p.th + k * s;
	return {
		x: p.x + (Math.sin(th) - Math.sin(p.th)) / k,
		y: p.y - (Math.cos(th) - Math.cos(p.th)) / k,
		th
	};
}
