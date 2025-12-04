import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';
import { HtmlCheerioV1 } from './V1/HtmlCheerioV1.node';

export class HtmlCheerio extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'HTML Cheerio',
			name: 'htmlCheerio',
			icon: { light: 'file:htmlCheerio.svg', dark: 'file:htmlCheerio.dark.svg' },
			usableAsTool: true,
			group: ['transform'],
			subtitle: '={{$parameter["sourceData"] + ": " + $parameter["dataPropertyName"]}}',
			description: 'Extract json from html by Cheerio',
			defaultVersion: 1,
			// hidden: true,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new HtmlCheerioV1(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
