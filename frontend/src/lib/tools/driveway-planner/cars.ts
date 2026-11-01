import type { Pose, Vec } from './geometry';

/** All lengths in meters. */
export type Car = {
	name: string;
	length: number;
	/** Including mirrors. */
	width: number;
	wheelbase: number;
	track: number;
	frontOverhang: number;
	maxSteerDeg: number;
};

/** Steering angle of the bicycle model that reproduces a kerb-to-kerb turning circle. */
export function steerFromTurningCircle(diameter: number, wheelbase: number, track: number) {
	const frontRadius = diameter / 2 - track / 2;
	return (Math.asin(Math.min(1, wheelbase / frontRadius)) * 180) / Math.PI;
}

// [name, length, width incl. mirrors, wheelbase, track, front overhang, turning circle], in mm / m.
// Approximate manufacturer figures.
const raw: [string, number, number, number, number, number, number][] = [
	['Tesla Model Y', 4797, 2129, 2890, 1636, 935, 12.1],
	['Tesla Model 3', 4720, 2089, 2875, 1584, 870, 11.7],
	['VW ID.3', 4261, 2070, 2770, 1536, 790, 10.2],
	['VW ID.4', 4584, 2108, 2766, 1587, 870, 10.2],
	['VW Golf 8', 4284, 2073, 2636, 1549, 900, 10.9],
	['VW Transporter T6.1', 4904, 2297, 3000, 1630, 900, 11.9],
	['Skoda Octavia Combi', 4698, 2030, 2686, 1543, 960, 11.1],
	['Skoda Enyaq', 4653, 2148, 2765, 1587, 880, 9.3],
	['Audi Q4 e-tron', 4588, 2108, 2764, 1580, 880, 10.2],
	['BMW 3 Series Touring', 4713, 2068, 2851, 1590, 780, 11.4],
	['BMW X5', 4935, 2218, 2975, 1680, 910, 12.6],
	['Mercedes E-Class', 4949, 2069, 2961, 1600, 840, 11.6],
	['Hyundai Ioniq 5', 4635, 2140, 3000, 1630, 845, 12.0],
	['Fiat 500', 3571, 1890, 2300, 1407, 730, 9.3]
];

export const presets: Car[] = raw.map(([name, l, w, wb, tr, fo, tc]) => ({
	name,
	length: l / 1000,
	width: w / 1000,
	wheelbase: wb / 1000,
	track: tr / 1000,
	frontOverhang: fo / 1000,
	maxSteerDeg: Math.round(steerFromTurningCircle(tc, wb / 1000, tr / 1000) * 10) / 10
}));

export const minRadius = (car: Car) => car.wheelbase / Math.tan((car.maxSteerDeg * Math.PI) / 180);

/** Car outline grown by `buffer`, for a rear-axle pose. Corner order: front-left, front-right, rear-right, rear-left. */
export function footprint(car: Car, buffer: number, p: Pose): Vec[] {
	const front = car.wheelbase + car.frontOverhang + buffer;
	const rear = -(car.length - car.wheelbase - car.frontOverhang) - buffer;
	const half = car.width / 2 + buffer;
	const c = Math.cos(p.th);
	const s = Math.sin(p.th);
	return [
		[front, -half],
		[front, half],
		[rear, half],
		[rear, -half]
	].map(([u, v]) => ({ x: p.x + u * c - v * s, y: p.y + u * s + v * c }));
}

export const frontAxle = (car: Car, p: Pose): Vec => ({
	x: p.x + car.wheelbase * Math.cos(p.th),
	y: p.y + car.wheelbase * Math.sin(p.th)
});

export const rearFromFront = (car: Car, f: Pose): Pose => ({
	x: f.x - car.wheelbase * Math.cos(f.th),
	y: f.y - car.wheelbase * Math.sin(f.th),
	th: f.th
});
