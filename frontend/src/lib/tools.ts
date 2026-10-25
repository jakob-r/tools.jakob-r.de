export type Tool = {
	slug: string;
	title: string;
	description: string;
	tags: string[];
	thumbnail: string;
};

/** Metadata only. Never import tool implementations here. */
export const tools: Tool[] = [
	{
		slug: 'markdown',
		title: 'Markshift',
		description: 'Convert between Markdown, HTML and rich text. Edit either side and the other follows.',
		tags: ['markdown', 'html', 'rich text', 'converter'],
		thumbnail: '/tools/markdown.svg'
	},
	{
		slug: 'gpx',
		title: 'GPX Cleaner',
		description: 'One-click cleanup for GPS tracks: removes spikes, pause drift and the drive home. Compare before and after.',
		tags: ['gpx', 'gps', 'track', 'fitness'],
		thumbnail: '/tools/gpx.svg'
	}
];
