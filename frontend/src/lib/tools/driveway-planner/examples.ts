// Sample properties for the start page. Each plan is generated as an SVG in meters, drawn at
// 1:100 for 96 dpi, so it behaves exactly like an uploaded plan.

import type { Pose, Vec } from './geometry';

export type Example = {
	id: string;
	title: string;
	description: string;
	/** Plan size in meters. */
	width: number;
	height: number;
	buffer: number;
	area: Vec[];
	routes: { name: string; start: Pose; via?: Pose; end: Pose }[];
	/** SVG elements in meter coordinates. */
	drawing: string;
};

const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;
const EAST = 0;
const WEST = Math.PI;
/** 1:100 at 96 dpi. */
const PX_PER_M = 96 / 0.0254 / 100;

const building = (x: number, y: number, w: number, h: number, label: string) =>
	`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#cbd5e1" stroke="#334155" stroke-width="0.12"/>` +
	text(x + w / 2, y + h / 2, label);
const garage = (x: number, y: number, w: number, h: number, label = 'Garage') =>
	// Open at the bottom edge.
	`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f1f5f9"/>` +
	`<path d="M${x} ${y + h}V${y}H${x + w}V${y + h}" fill="none" stroke="#334155" stroke-width="0.2"/>` +
	text(x + w / 2, y + 1.2, label, 0.55);
const street = (y: number, w: number, h: number) =>
	`<rect x="0" y="${y}" width="${w}" height="${h}" fill="#e5e7eb"/>` +
	`<path d="M0 ${y + h / 2}H${w}" stroke="#fff" stroke-width="0.12" stroke-dasharray="1.5 1"/>` +
	text(w - 3, y + h / 2 - 0.5, 'Street', 0.6);
const tree = (x: number, y: number, r = 1.2) =>
	`<circle cx="${x}" cy="${y}" r="${r}" fill="#bbf7d0" stroke="#4d7c0f" stroke-width="0.08"/>`;
const text = (x: number, y: number, s: string, size = 0.7) =>
	`<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" fill="#334155" text-anchor="middle" dominant-baseline="middle">${s}</text>`;
const scaleBar = (x: number, y: number) =>
	`<path d="M${x} ${y - 0.3}V${y}H${x + 5}V${y - 0.3}M${x + 2.5} ${y}V${y - 0.2}" fill="none" stroke="#334155" stroke-width="0.08"/>` +
	text(x + 2.5, y - 0.8, '5 m', 0.5);
const lot = (w: number, h: number) =>
	`<rect x="0" y="0" width="${w}" height="${h}" fill="#f7fee7"/>` +
	`<path d="M0.1 ${h}V0.1H${w - 0.1}V${h}" fill="none" stroke="#94a3b8" stroke-width="0.08" stroke-dasharray="0.6 0.3"/>`;

export const examples: Example[] = [
	{
		id: 'garage-at-the-back',
		title: 'Garage at the back',
		description: 'Turn in from the street and drive straight into a garage behind the house.',
		width: 24,
		height: 18,
		buffer: 0.3,
		area: [
			{ x: 0, y: 18 },
			{ x: 24, y: 18 },
			{ x: 24, y: 14 },
			{ x: 22, y: 14 },
			{ x: 22, y: 8 },
			{ x: 17.3, y: 8 },
			{ x: 17.3, y: 2.2 },
			{ x: 14.2, y: 2.2 },
			{ x: 14.2, y: 8 },
			{ x: 11, y: 8 },
			{ x: 11, y: 14 },
			{ x: 0, y: 14 }
		],
		routes: [{ name: 'Into the garage', start: { x: 6, y: 16.2, th: EAST }, end: { x: 15.75, y: 3.7, th: UP } }],
		drawing:
			lot(24, 14) +
			street(14, 24, 4) +
			building(2, 3, 8, 8, 'House') +
			garage(14, 2, 3.5, 6) +
			tree(20.5, 3) +
			tree(5, 12.6, 0.9) +
			scaleBar(1, 1.6)
	},
	{
		id: 'in-forwards-out-backwards',
		title: 'In forwards, out backwards',
		description: 'Two routes for a carport beside the house: driving in and reversing out. Both form the driveway.',
		width: 20,
		height: 25,
		buffer: 0.3,
		area: [
			{ x: 0, y: 25 },
			{ x: 20, y: 25 },
			{ x: 20, y: 21 },
			{ x: 18.5, y: 21 },
			{ x: 18.5, y: 5.5 },
			{ x: 12.5, y: 5.5 },
			{ x: 12.5, y: 21 },
			{ x: 0, y: 21 }
		],
		routes: [
			{ name: 'Drive in', start: { x: 6, y: 23.2, th: EAST }, end: { x: 15.5, y: 7.5, th: UP } },
			{ name: 'Back out', start: { x: 15.5, y: 7.5, th: UP }, end: { x: 5, y: 23.2, th: WEST } }
		],
		drawing:
			lot(20, 21) +
			street(21, 20, 4) +
			building(2, 4, 9.5, 10, 'House') +
			garage(13, 5.5, 5, 6.5, 'Carport') +
			tree(4, 18) +
			tree(8, 17.5, 0.9) +
			scaleBar(1, 1.6)
	},
	{
		id: 'turning-in-the-yard',
		title: 'Turning in the yard',
		description: 'In forwards through the gate (a via point just behind it), then a K-turn to park facing the exit.',
		width: 24,
		height: 26,
		buffer: 0.25,
		area: [
			{ x: 0, y: 26 },
			{ x: 24, y: 26 },
			{ x: 24, y: 20 },
			{ x: 14.2, y: 20 },
			{ x: 14.2, y: 16 },
			{ x: 17.5, y: 16 },
			{ x: 17.5, y: 6 },
			{ x: 6, y: 6 },
			{ x: 6, y: 16 },
			{ x: 9.4, y: 16 },
			{ x: 9.4, y: 20 },
			{ x: 0, y: 20 }
		],
		routes: [
			{
				name: 'Park facing out',
				start: { x: 6, y: 23.5, th: EAST },
				via: { x: 11.8, y: 14.5, th: UP },
				end: { x: 14.8, y: 11, th: DOWN }
			}
		],
		drawing:
			lot(24, 20) +
			street(20, 24, 6) +
			building(6, 1, 11.5, 5, 'House') +
			building(1, 2, 5, 14, 'Barn') +
			building(17.5, 6, 5, 7, 'Shed') +
			`<rect x="6" y="16" width="3.4" height="4" fill="#cbd5e1" stroke="#334155" stroke-width="0.12"/>` +
			`<rect x="14.2" y="16" width="3.3" height="4" fill="#cbd5e1" stroke="#334155" stroke-width="0.12"/>` +
			text(11.8, 18, 'Gate', 0.55) +
			text(11.8, 8, 'Yard', 0.7) +
			tree(20.5, 17) +
			scaleBar(18, 1.6)
	}
];

/** The plan as an SVG file: meters inside, 1:100 at 96 dpi outside. */
export function exampleSvg(ex: Example, withRoutes = false) {
	const w = Math.round(ex.width * PX_PER_M);
	const h = Math.round(ex.height * PX_PER_M);
	const marks = withRoutes
		? ex.routes
				.flatMap((r) => [
					[r.start, '#16a34a'],
					...(r.via ? ([[r.via, '#ca8a04']] as const) : []),
					[r.end, '#1e293b']
				] as const)
				.map(
					([p, c]) =>
						`<path d="M${p.x} ${p.y}l${Math.cos(p.th) * 1.6} ${Math.sin(p.th) * 1.6}" stroke="${c}" stroke-width="0.35" stroke-linecap="round"/><circle cx="${p.x}" cy="${p.y}" r="0.5" fill="${c}" stroke="#fff" stroke-width="0.15"/>`
				)
				.join('')
		: '';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${ex.width} ${ex.height}"><rect width="${ex.width}" height="${ex.height}" fill="#fff"/>${ex.drawing}${marks}</svg>`;
}
