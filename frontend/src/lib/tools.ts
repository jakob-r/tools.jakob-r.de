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
	}
];
