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
		slug: 'markshift',
		title: 'Markshift',
		description: 'Convert between Markdown, HTML and rich text. Edit either side and the other follows.',
		tags: ['markdown', 'html', 'rich text', 'converter'],
		thumbnail: '/tools/markshift.svg'
	},
	{
		slug: 'base64-encoder-decoder',
		title: 'Base64 Encoder / Decoder',
		description: 'Encode and decode Base64. Edit either side, share via the URL hash, open decoded links.',
		tags: ['base64', 'encode', 'decode', 'binary'],
		thumbnail: '/tools/base64-encoder-decoder.svg'
	},
	{
		slug: 'gpx-cleaner',
		title: 'GPX Cleaner',
		description: 'One-click cleanup for GPS tracks: removes spikes, pause drift and the drive home. Compare before and after.',
		tags: ['gpx', 'gps', 'track', 'fitness'],
		thumbnail: '/tools/gpx-cleaner.svg'
	}
];
