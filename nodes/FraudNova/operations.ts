import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';

import type { CheckType } from './helpers';
import { chunk, mapBatchItemError, normalizeCountry, shapeCheckOutput } from './helpers';
import { FLAG_OPTIONS } from './properties';
import { fraudNovaRequest } from './transport';

const SINGLE_TIMEOUT_MS = 30000;
const BATCH_TIMEOUT_MS = 300000;
const BATCH_SIZE = 100;

const SINGLE_PATH: Record<CheckType, string> = {
	ip: '/check',
	email: '/check/email',
	phone: '/check/phone',
};

const BATCH_PATH: Record<CheckType, string> = {
	ip: '/check/batch',
	email: '/check/email/batch',
	phone: '/check/phone/batch',
};

const BATCH_KEY: Record<CheckType, string> = { ip: 'ips', email: 'emails', phone: 'phones' };

export type CheckOptions = {
	simplify: boolean;
	riskThreshold: number;
	flagOn: string[];
	strictness?: number;
	mobile?: boolean;
	userAgent?: string;
	userLanguage?: string;
	country?: string;
};

type Pending = { index: number; subject: string };

const nonEmpty = (value: unknown): string | undefined =>
	typeof value === 'string' && value !== '' ? value : undefined;

export function readCheckOptions(
	this: IExecuteFunctions,
	type: CheckType,
	itemIndex: number,
): CheckOptions {
	const raw = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const options: CheckOptions = {
		simplify: typeof raw.simplify === 'boolean' ? raw.simplify : true,
		riskThreshold: typeof raw.riskThreshold === 'number' ? raw.riskThreshold : 75,
		flagOn: Array.isArray(raw.flagOn) ? (raw.flagOn as string[]) : [...FLAG_OPTIONS[type].defaults],
	};
	if (type === 'ip') {
		if (typeof raw.strictness === 'number') options.strictness = raw.strictness;
		if (typeof raw.mobile === 'boolean') options.mobile = raw.mobile;
		const userAgent = nonEmpty(raw.userAgent);
		const userLanguage = nonEmpty(raw.userLanguage);
		if (userAgent) options.userAgent = userAgent;
		if (userLanguage) options.userLanguage = userLanguage;
	}
	if (type === 'phone') {
		const country = normalizeCountry(raw.country);
		if (country) options.country = country;
	}
	return options;
}

function apiOptions(options: CheckOptions, mobileAsFlag: boolean): IDataObject {
	const params: IDataObject = {};
	if (options.strictness !== undefined) params.strictness = options.strictness;
	if (options.mobile !== undefined) {
		params.mobile = mobileAsFlag ? (options.mobile ? '1' : '0') : options.mobile;
	}
	if (options.userAgent !== undefined) params.user_agent = options.userAgent;
	if (options.userLanguage !== undefined) params.user_language = options.userLanguage;
	if (options.country !== undefined) params.country = options.country;
	return params;
}

function readSubject(this: IExecuteFunctions, type: CheckType, itemIndex: number): string {
	const value = this.getNodeParameter(type, itemIndex, '');
	return value === null || value === undefined ? '' : String(value).trim();
}

const emptyMessage = (type: CheckType) => `The ${type} field is empty for this item.`;

function errorItem(
	type: CheckType,
	subject: string,
	message: string,
	itemIndex: number,
	code?: string,
): INodeExecutionData {
	const json: IDataObject = { error: message };
	if (code !== undefined) json.code = code;
	json[type] = subject;
	return { json, pairedItem: { item: itemIndex } };
}

function successItem(
	type: CheckType,
	subject: string,
	data: unknown,
	creditsRemaining: unknown,
	options: CheckOptions,
	itemIndex: number,
): INodeExecutionData {
	const record = typeof data === 'object' && data !== null ? (data as IDataObject) : {};
	const credits = typeof creditsRemaining === 'number' ? creditsRemaining : null;
	return {
		json: shapeCheckOutput(type, subject, record, credits, options) as IDataObject,
		pairedItem: { item: itemIndex },
	};
}

export async function executeCheck(
	this: IExecuteFunctions,
	type: CheckType,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const output: INodeExecutionData[] = [];
	for (let i = 0; i < items.length; i++) {
		const subject = readSubject.call(this, type, i);
		if (subject === '') {
			if (!this.continueOnFail()) {
				throw new NodeOperationError(this.getNode(), emptyMessage(type), { itemIndex: i });
			}
			output.push(errorItem(type, subject, emptyMessage(type), i));
			continue;
		}
		const options = readCheckOptions.call(this, type, i);
		try {
			const { body } = await fraudNovaRequest.call(
				this,
				{
					method: 'GET',
					path: SINGLE_PATH[type],
					qs: { [type]: subject, ...apiOptions(options, true) },
					timeout: SINGLE_TIMEOUT_MS,
				},
				i,
			);
			output.push(successItem(type, subject, body.data, body.credits_remaining, options, i));
		} catch (error) {
			if (this.continueOnFail()) {
				output.push(errorItem(type, subject, error.message, i));
				continue;
			}
			throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
		}
	}
	return output;
}

async function checkChunk(
	this: IExecuteFunctions,
	type: CheckType,
	group: Pending[],
): Promise<INodeExecutionData[]> {
	const first = group[0].index;
	const options = readCheckOptions.call(this, type, first);
	const { body, statusCode } = await fraudNovaRequest.call(
		this,
		{
			method: 'POST',
			path: BATCH_PATH[type],
			body: {
				[BATCH_KEY[type]]: group.map((entry) => entry.subject),
				...apiOptions(options, false),
			},
			timeout: BATCH_TIMEOUT_MS,
		},
		first,
	);
	const results = Array.isArray(body.results) ? (body.results as IDataObject[]) : [];
	if (results.length !== group.length) {
		throw new NodeApiError(this.getNode(), body as JsonObject, {
			message: `FraudNova returned ${results.length} results for ${group.length} items.`,
			httpCode: String(statusCode),
			itemIndex: first,
		});
	}
	return group.map(({ index, subject }, k) => {
		const result = results[k];
		if (result.success === true) {
			return successItem(type, subject, result.data, body.credits_remaining, options, index);
		}
		const code = String(result.error);
		return errorItem(type, subject, mapBatchItemError(type, subject, code), index, code);
	});
}

export async function executeCheckMany(
	this: IExecuteFunctions,
	type: CheckType,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const output: INodeExecutionData[] = new Array(items.length);
	const pending: Pending[] = [];
	for (let i = 0; i < items.length; i++) {
		const subject = readSubject.call(this, type, i);
		if (subject === '') {
			output[i] = errorItem(type, subject, emptyMessage(type), i, 'empty');
		} else {
			pending.push({ index: i, subject });
		}
	}
	for (const group of chunk(pending, BATCH_SIZE)) {
		try {
			const shaped = await checkChunk.call(this, type, group);
			shaped.forEach((item, k) => (output[group[k].index] = item));
		} catch (error) {
			if (!this.continueOnFail()) {
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: group[0].index });
			}
			for (const { index, subject } of group) {
				output[index] = errorItem(type, subject, error.message, index);
			}
		}
	}
	return output;
}

export async function executeGetBalance(this: IExecuteFunctions): Promise<INodeExecutionData[]> {
	const { body } = await fraudNovaRequest.call(
		this,
		{ method: 'GET', path: '/balance', timeout: SINGLE_TIMEOUT_MS },
		0,
	);
	return [
		{ json: { credits_remaining: body.credits_remaining as number }, pairedItem: { item: 0 } },
	];
}
