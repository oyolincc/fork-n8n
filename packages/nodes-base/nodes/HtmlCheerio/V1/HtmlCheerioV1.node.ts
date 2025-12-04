import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError, NodeConnectionTypes } from 'n8n-workflow';
import cheerio from 'cheerio';
import get from 'lodash/get';

type ISelectValueType = 'object' | 'text' | 'attr';
type ISelectValueBy<VT extends ISelectValueType> = VT extends 'object'
	? ISelectField[]
	: VT extends 'text'
		? undefined
		: VT extends 'attr'
			? string
			: never;

interface ISelectField<VT extends ISelectValueType = ISelectValueType> {
	varName: string;
	selector: string;
	valueType: VT;
	valueBy: ISelectValueBy<VT>;
	multi?: boolean;
}

type IDefaultFieldResult = string | string[] | IResolveFieldRecord | IResolveFieldRecord[];
type IResolveFieldResult<R extends IDefaultFieldResult = IDefaultFieldResult> = R;
interface IResolveFieldRecord {
	[key: string]: IResolveFieldResult;
}

const formatText = (text: string) => {
	// return text.trim().replace(/(\s*)\n+(\s*)/g, (_input, s1, s2) => (s1 || s2) ? ' ' : '')
	return text.trim().replace(/(\s*)\n+(\s*)/g, ' ');
};

function resolveSelectFields(
	this: IExecuteFunctions,
	fields: ISelectField[],
	$: cheerio.Root,
	$base: cheerio.Cheerio,
) {
	const result: IResolveFieldRecord = {};
	for (const field of fields) {
		const { selector, varName, multi, valueBy, valueType } = field;
		if (!selector) {
			continue;
		}
		const $target = $base.find(selector);
		if (multi) {
			const els = $target.get();
			if (valueType === 'text') {
				const textArr: string[] = [];
				els.forEach((el) => textArr.push(formatText($(el).text())));
				result[varName] = textArr;
			} else if (valueType === 'attr') {
				const attrArr: string[] = [];
				els.forEach((el) => attrArr.push($(el).attr(valueBy as ISelectValueBy<'attr'>) || ''));
				result[varName] = attrArr;
			} else if (valueType === 'object') {
				const subRecords: IResolveFieldRecord[] = [];
				els.forEach((el) =>
					subRecords.push(
						resolveSelectFields.call(this, valueBy as ISelectValueBy<'object'>, $, $(el)),
					),
				);
				result[varName] = subRecords;
			} else {
				throw new NodeOperationError(this.getNode(), `${varName}: 非法的valueType: ${valueType}`);
			}
		} else {
			const el = $target.get(0);
			if (!el) {
				continue;
			}

			if (valueType === 'text') {
				result[varName] = formatText($(el).text());
			} else if (valueType === 'attr') {
				result[varName] = $(el).attr(valueBy as ISelectValueBy<'attr'>) || '';
			} else if (valueType === 'object') {
				result[varName] = resolveSelectFields.call(
					this,
					valueBy as ISelectValueBy<'object'>,
					$,
					$(el),
				);
			} else {
				throw new NodeOperationError(this.getNode(), `${varName}: 非法的valueType: ${valueType}`);
			}
		}
	}
	return result;
}

const mainProperties: INodeProperties[] = [
	{
		displayName: '源数据类型',
		name: 'sourceType',
		type: 'options',
		options: [
			{
				name: 'Binary',
				value: 'binary',
			},
			{
				name: 'JSON',
				value: 'json',
			},
		],
		default: 'json',
		description: '指定html是二进制数据还是JSON数据',
	},
	{
		displayName: '输入二进制字段',
		name: 'dataPropertyName',
		type: 'string',
		requiresDataPath: 'single',
		displayOptions: {
			show: {
				sourceType: ['binary'],
			},
		},
		default: 'data',
		required: true,
		hint: '要被提取的字段',
	},
	{
		displayName: '取自JSON中的字段',
		name: 'dataPropertyName',
		type: 'string',
		requiresDataPath: 'single',
		displayOptions: {
			show: {
				sourceType: ['json'],
			},
		},
		default: 'data',
		required: true,
		description:
			'Name of the JSON property in which the HTML to extract the data from can be found. The property can either contain a string or an array of strings.',
	},
	{
		displayName: '提取规则',
		name: 'rules',
		type: 'json',
		default: '[]',
	},
];

export class HtmlCheerioV1 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			version: 1,
			defaults: {
				name: 'HTML Cheerio',
				// color: '#2200DD',
			},
			inputs: [NodeConnectionTypes.Main],
			outputs: [NodeConnectionTypes.Main],
			properties: mainProperties,
		};
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let idx = 0; idx < items.length; idx++) {
			try {
				const sourceType = this.getNodeParameter('sourceType', idx) as 'json' | 'binary';
				const dataPropertyName = this.getNodeParameter('dataPropertyName', idx);
				const rulesParams = String(this.getNodeParameter('rules', idx));
				let rules: ISelectField[] = [];

				try {
					rules = (JSON.parse(rulesParams) as ISelectField[]) || [];
					if (!Array.isArray(rules)) {
						rules = [rules];
					}
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Rules are invalid. Expected an array or an object, got ${rulesParams}`,
						{ message: (error && error.message) || '' },
					);
				}

				const item = items[idx];

				let htmlArray: string[] | string = [];
				if (sourceType === 'json') {
					const value = get(item.json, dataPropertyName);
					if (value === undefined) {
						throw new NodeOperationError(
							this.getNode(),
							`No property named "${dataPropertyName}" exists!`,
							{ itemIndex: idx },
						);
					}
					htmlArray = value as string;
				} else {
					this.helpers.assertBinaryData(idx, dataPropertyName);
					const binaryDataBuffer = await this.helpers.getBinaryDataBuffer(idx, dataPropertyName);
					htmlArray = binaryDataBuffer.toString('utf-8');
				}

				// Convert it always to array that it works with a string or an array of strings
				if (!Array.isArray(htmlArray)) {
					htmlArray = [htmlArray];
				}

				for (const html of htmlArray as string[]) {
					const $ = cheerio.load(html as string);
					returnData.push({
						json: resolveSelectFields.call(this, rules, $, $.root()),
						pairedItem: {
							item: idx,
						},
					});
				}
			} catch (execError) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: execError.message,
						},
						pairedItem: {
							item: idx,
						},
					});
					continue;
				}

				throw execError;
			}
		}

		return [returnData];
	}
}
