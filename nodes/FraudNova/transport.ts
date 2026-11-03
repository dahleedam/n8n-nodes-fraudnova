import { NodeApiError, sleep } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, JsonObject } from 'n8n-workflow';
import { mapStatusError, retryDelayMs } from './helpers';

export const BASE_URL = 'https://fraudnova.com/api/v1';

type FullResponse = { body: unknown; statusCode: number };

export async function fraudNovaRequest(
	this: IExecuteFunctions,
	options: {
		method: 'GET' | 'POST';
		path: string;
		qs?: IDataObject;
		body?: IDataObject;
		timeout: number;
	},
	itemIndex: number,
): Promise<{ body: Record<string, unknown>; statusCode: number }> {
	const requestOptions: IHttpRequestOptions = {
		method: options.method,
		url: BASE_URL + options.path,
		qs: options.qs,
		body: options.body,
		json: true,
		timeout: options.timeout,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	for (let attempt = 1; ; attempt++) {
		let response: FullResponse;
		try {
			response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'fraudNovaApi',
				requestOptions,
			)) as FullResponse;
		} catch (error) {
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: `FraudNova request failed: ${(error as Error).message}`,
				itemIndex,
			});
		}

		const { statusCode, body } = response;
		if (statusCode >= 200 && statusCode < 300) {
			return { body: body as Record<string, unknown>, statusCode };
		}

		const message = mapStatusError(statusCode, body);
		if (statusCode === 429) {
			const delay = retryDelayMs(message, attempt);
			if (delay !== null) {
				await sleep(delay);
				continue;
			}
		}

		throw new NodeApiError(
			this.getNode(),
			(typeof body === 'object' && body !== null ? body : { body: String(body) }) as JsonObject,
			{ message, httpCode: String(statusCode), itemIndex },
		);
	}
}
