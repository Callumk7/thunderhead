import { defineTool } from '@flue/runtime';
import Exa from 'exa-js';
import * as v from 'valibot';

const searchInput = v.object({
	query: v.pipe(v.string(), v.minLength(2), v.maxLength(500)),
	numResults: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10))),
	includeDomains: v.optional(
		v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.maxLength(10)),
	),
	startPublishedDate: v.optional(v.pipe(v.string(), v.isoTimestamp())),
});

export const searchWeb = defineTool({
	name: 'search_web',
	description:
		'Search the live web with Exa and return source metadata plus relevant quoted highlights. Use it for current or externally verifiable facts. Run distinct queries to gather independent evidence.',
	input: searchInput,
	async run({ data, log }) {
		const apiKey = process.env.EXA_API_KEY;
		if (!apiKey) throw new Error('EXA_API_KEY is not configured.');

		log.info('Searching Exa', { query: data.query });
		const exa = new Exa(apiKey);
		const response = await exa.search(data.query, {
			type: 'auto',
			numResults: data.numResults ?? 6,
			...(data.includeDomains ? { includeDomains: data.includeDomains } : {}),
			...(data.startPublishedDate ? { startPublishedDate: data.startPublishedDate } : {}),
			contents: {
				highlights: { query: data.query, maxCharacters: 1_500 },
				maxAgeHours: 24,
				filterEmptyResults: true,
			},
		});

		return {
			output: {
				requestId: response.requestId,
				results: response.results.map((result) => ({
					title: result.title ?? 'Untitled',
					url: result.url,
					...(result.author ? { author: result.author } : {}),
					...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
					highlights: result.highlights ?? [],
				})),
			},
		};
	},
});
