import type { IExecuteFunctions, JsonObject } from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL, fraudNovaRequest } from '../nodes/FraudNova/transport';

vi.mock('n8n-workflow', async (importOriginal) => ({
	...(await importOriginal<typeof import('n8n-workflow')>()),
	sleep: vi.fn().mockResolvedValue(undefined),
}));

const httpRequestWithAuthentication = vi.fn();

const context = {
	getNode: () => ({
		name: 'FraudNova',
		type: 'n8n-nodes-fraudnova.fraudNova',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
		id: 'node-1',
	}),
	helpers: { httpRequestWithAuthentication },
} as unknown as IExecuteFunctions;

const call = (itemIndex = 0) =>
	fraudNovaRequest.call(
		context,
		{ method: 'GET', path: '/check', qs: { ip: '1.1.1.1' }, timeout: 30000 },
		itemIndex,
	);

const response = (statusCode: number, body: unknown) => ({
	body,
	headers: {},
	statusCode,
	statusMessage: '',
});

const CONCURRENCY = { success: false, message: 'Too many concurrent requests.' };
const RATE_LIMIT = { success: false, message: 'Rate limit exceeded. Try again shortly.' };

const caught = async (promise: Promise<unknown>): Promise<NodeApiError> => {
	try {
		await promise;
	} catch (error) {
		return error as NodeApiError;
	}
	throw new Error('expected the request to throw');
};

beforeEach(() => {
	httpRequestWithAuthentication.mockReset();
	vi.mocked(sleep).mockClear();
});

describe('fraudNovaRequest', () => {
	it('returns the body and status of a 200 and sends the expected request', async () => {
		httpRequestWithAuthentication.mockResolvedValueOnce(response(200, { success: true }));

		const result = await call();

		expect(result).toEqual({ body: { success: true }, statusCode: 200 });
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [credential, options] = httpRequestWithAuthentication.mock.calls[0];
		expect(credential).toBe('fraudNovaApi');
		expect(options).toMatchObject({
			method: 'GET',
			url: 'https://fraudnova.com/api/v1/check',
			qs: { ip: '1.1.1.1' },
			json: true,
			timeout: 30000,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		});
		expect(BASE_URL).toBe('https://fraudnova.com/api/v1');
		expect(sleep).not.toHaveBeenCalled();
	});

	it('retries a concurrency 429 with 1s then 2s backoff', async () => {
		httpRequestWithAuthentication
			.mockResolvedValueOnce(response(429, CONCURRENCY))
			.mockResolvedValueOnce(response(429, CONCURRENCY))
			.mockResolvedValueOnce(response(200, { success: true }));

		const result = await call();

		expect(result.statusCode).toBe(200);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(3);
		expect(vi.mocked(sleep).mock.calls).toEqual([[1000], [2000]]);
	});

	it('gives up after three retries on a rate-limit 429', async () => {
		httpRequestWithAuthentication.mockResolvedValue(response(429, RATE_LIMIT));

		const error = await caught(call(3));

		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toMatch(
			/^FraudNova rate limit reached: Rate limit exceeded\. Try again shortly\./,
		);
		expect(error.httpCode).toBe('429');
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(4);
		expect(vi.mocked(sleep).mock.calls).toEqual([[5000], [15000], [40000]]);
	});

	it('throws the mapped message with the http code for a 401', async () => {
		httpRequestWithAuthentication.mockResolvedValueOnce(
			response(401, { success: false, message: 'Unauthenticated.' }),
		);

		const error = await caught(call(2));

		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe(
			'FraudNova rejected the API key. Check the FraudNova API credential.',
		);
		expect(error.httpCode).toBe('401');
		expect(error.context.itemIndex).toBe(2);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('wraps a non-object body of a 503', async () => {
		httpRequestWithAuthentication.mockResolvedValueOnce(response(503, '<html>Bad gateway</html>'));

		const error = await caught(call());

		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('FraudNova returned HTTP 503: <html>Bad gateway</html>');
		expect(error.httpCode).toBe('503');
	});

	it('rethrows a transport failure as a NodeApiError', async () => {
		httpRequestWithAuthentication.mockRejectedValueOnce(new Error('socket hang up'));

		const error = await caught(call(5));

		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('FraudNova request failed: socket hang up');
		expect(error.context.itemIndex).toBe(5);
	});

	it('replaces the message of a NodeApiError raised by the helper', async () => {
		httpRequestWithAuthentication.mockRejectedValueOnce(
			new NodeApiError(context.getNode(), { message: 'socket hang up' } as JsonObject),
		);

		const error = await caught(call(4));

		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('FraudNova request failed: socket hang up');
		expect(error.context.itemIndex).toBe(4);
	});

	it('rejects a 2xx response whose body is not an object', async () => {
		httpRequestWithAuthentication.mockResolvedValueOnce(response(200, '<html>ok</html>'));

		const error = await caught(call(1));

		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('FraudNova returned an unexpected response (HTTP 200).');
		expect(error.httpCode).toBe('200');
		expect(error.context.itemIndex).toBe(1);
	});
});
