import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { FraudNova } from '../nodes/FraudNova/FraudNova.node';
import { BASE_URL } from '../nodes/FraudNova/transport';
import { EMAIL_DATA, ERROR_BODIES, IP_DATA, PHONE_DATA } from './fixtures';

type Param = unknown | ((i: number) => unknown);

const response = (statusCode: number, body: unknown) => ({ body, headers: {}, statusCode });

const inputs = (count: number): INodeExecutionData[] =>
	Array.from({ length: count }, (_, i) => ({ json: { row: i } }));

function ctx({
	items,
	params,
	continueOnFail = false,
}: {
	items: INodeExecutionData[];
	params: Record<string, Param>;
	continueOnFail?: boolean;
}) {
	const http = vi.fn();
	const context = {
		getInputData: () => items,
		getNodeParameter: (name: string, i: number, fallback?: unknown) => {
			const value = params[name];
			if (value === undefined) {
				return fallback;
			}
			return typeof value === 'function' ? (value as (i: number) => unknown)(i) : value;
		},
		continueOnFail: () => continueOnFail,
		getNode: () => ({
			name: 'FraudNova',
			type: 'n8n-nodes-fraudnova.fraudNova',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
			id: 'node-1',
		}),
		helpers: { httpRequestWithAuthentication: http },
	} as unknown as IExecuteFunctions;
	return { context, http };
}

const run = (context: IExecuteFunctions) => new FraudNova().execute.call(context);

const request = (
	method: 'GET' | 'POST',
	path: string,
	extra: { qs?: object; body?: object },
	timeout: number,
) => [
	'fraudNovaApi',
	{
		method,
		url: BASE_URL + path,
		qs: extra.qs,
		body: extra.body,
		json: true,
		timeout,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	},
];

const OUT_OF_CREDITS =
	'FraudNova account is out of credits. Buy credits at https://fraudnova.com/dashboard/billing.';
const BAD_KEY = 'FraudNova rejected the API key. Check the FraudNova API credential.';

const simplifiedIp = (ip: string, creditsRemaining: number) => ({
	ip,
	fraud_score: 20,
	proxy: false,
	vpn: false,
	tor: false,
	recent_abuse: false,
	bot_status: false,
	country_code: 'US',
	city: 'Mountain View',
	ISP: 'Google',
	flagged: false,
	flag_reasons: [],
	credits_remaining: creditsRemaining,
});

const simplifiedEmail = (email: string, creditsRemaining: number) => ({
	email,
	valid: true,
	fraud_score: 10,
	disposable: false,
	deliverability: 'high',
	recent_abuse: false,
	honeypot: false,
	leaked: false,
	dns_valid: true,
	sanitized_email: 'user@example.com',
	flagged: false,
	flag_reasons: [],
	credits_remaining: creditsRemaining,
});

describe('FraudNova.execute — Check', () => {
	it('runs one GET /check per item, sequentially, sending only the subject', async () => {
		const ips = ['8.8.8.8', '1.1.1.1'];
		const { context, http } = ctx({
			items: inputs(2),
			params: { resource: 'ip', operation: 'check', ip: (i: number) => ips[i] },
		});
		let inFlight = 0;
		let maxInFlight = 0;
		const credits = [97, 96];
		http.mockImplementation(async () => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await Promise.resolve();
			inFlight--;
			return response(200, { success: true, data: IP_DATA, credits_remaining: credits.shift() });
		});

		const result = await run(context);

		expect(maxInFlight).toBe(1);
		expect(http.mock.calls).toEqual([
			request('GET', '/check', { qs: { ip: '8.8.8.8' } }, 30000),
			request('GET', '/check', { qs: { ip: '1.1.1.1' } }, 30000),
		]);
		expect(result).toEqual([
			[
				{ json: simplifiedIp('8.8.8.8', 97), pairedItem: { item: 0 } },
				{ json: simplifiedIp('1.1.1.1', 96), pairedItem: { item: 1 } },
			],
		]);
	});

	it('sends the IP options and returns every field when simplify is off', async () => {
		const { context, http } = ctx({
			items: inputs(1),
			params: {
				resource: 'ip',
				operation: 'check',
				ip: '8.8.8.8',
				options: {
					strictness: 3,
					mobile: true,
					userAgent: 'UA',
					userLanguage: 'en',
					simplify: false,
					riskThreshold: 10,
				},
			},
		});
		http.mockResolvedValueOnce(
			response(200, { success: true, data: IP_DATA, credits_remaining: 97 }),
		);

		const result = await run(context);

		expect(http.mock.calls).toEqual([
			request(
				'GET',
				'/check',
				{
					qs: {
						ip: '8.8.8.8',
						strictness: 3,
						mobile: '1',
						user_agent: 'UA',
						user_language: 'en',
					},
				},
				30000,
			),
		]);
		expect(result[0][0].json).toEqual({
			ip: '8.8.8.8',
			...IP_DATA,
			flagged: true,
			flag_reasons: ['fraud_score'],
			credits_remaining: 97,
		});
		expect(result[0][0].json.ASN).toBe(15169);
	});

	it('sends mobile as 0 when it is set to false', async () => {
		const { context, http } = ctx({
			items: inputs(1),
			params: { resource: 'ip', operation: 'check', ip: '8.8.8.8', options: { mobile: false } },
		});
		http.mockResolvedValueOnce(
			response(200, { success: true, data: IP_DATA, credits_remaining: 97 }),
		);

		await run(context);

		expect(http.mock.calls[0][1].qs).toEqual({ ip: '8.8.8.8', mobile: '0' });
	});

	it('uppercases the phone country and flags on score, VOIP and risky', async () => {
		const { context, http } = ctx({
			items: inputs(1),
			params: {
				resource: 'phone',
				operation: 'check',
				phone: '+1 817-679-1808',
				options: { country: 'us' },
			},
		});
		http.mockResolvedValueOnce(
			response(200, { success: true, data: PHONE_DATA, credits_remaining: 50 }),
		);

		const result = await run(context);

		expect(http.mock.calls).toEqual([
			request('GET', '/check/phone', { qs: { phone: '+1 817-679-1808', country: 'US' } }, 30000),
		]);
		expect(result[0][0].json).toEqual({
			phone: '+1 817-679-1808',
			valid: true,
			fraud_score: 85,
			VOIP: true,
			prepaid: false,
			risky: true,
			active: true,
			carrier: 'T-Mobile',
			line_type: 'Wireless',
			country: 'US',
			formatted: '+1 817-679-1808',
			flagged: true,
			flag_reasons: ['fraud_score', 'VOIP', 'risky'],
			credits_remaining: 50,
		});
	});

	it('turns a 402 into an error item and continues when On Error is Continue', async () => {
		const emails = ['a@x.com', 'b@x.com'];
		const { context, http } = ctx({
			items: inputs(2),
			params: { resource: 'email', operation: 'check', email: (i: number) => emails[i] },
			continueOnFail: true,
		});
		http
			.mockResolvedValueOnce(response(402, ERROR_BODIES[402]))
			.mockResolvedValueOnce(
				response(200, { success: true, data: EMAIL_DATA, credits_remaining: 3 }),
			);

		const result = await run(context);

		expect(http).toHaveBeenCalledTimes(2);
		expect(http.mock.calls[1]).toEqual(
			request('GET', '/check/email', { qs: { email: 'b@x.com' } }, 30000),
		);
		expect(result).toEqual([
			[
				{ json: { error: OUT_OF_CREDITS, email: 'a@x.com' }, pairedItem: { item: 0 } },
				{ json: simplifiedEmail('b@x.com', 3), pairedItem: { item: 1 } },
			],
		]);
		expect(result[0][0].json).not.toHaveProperty('flagged');
	});

	it('throws a 402 when On Error is not Continue', async () => {
		const emails = ['a@x.com', 'b@x.com'];
		const { context, http } = ctx({
			items: inputs(2),
			params: { resource: 'email', operation: 'check', email: (i: number) => emails[i] },
		});
		http.mockResolvedValueOnce(response(402, ERROR_BODIES[402]));

		await expect(run(context)).rejects.toThrow(OUT_OF_CREDITS);
		expect(http).toHaveBeenCalledTimes(1);
	});

	it('fails an empty subject without a request', async () => {
		const { context, http } = ctx({
			items: inputs(1),
			params: { resource: 'ip', operation: 'check', ip: '  ' },
			continueOnFail: true,
		});

		const result = await run(context);

		expect(http).not.toHaveBeenCalled();
		expect(result).toEqual([
			[
				{
					json: { error: 'The ip field is empty for this item.', ip: '' },
					pairedItem: { item: 0 },
				},
			],
		]);
	});

	it('throws on an empty subject when On Error is not Continue', async () => {
		const { context, http } = ctx({
			items: inputs(1),
			params: { resource: 'ip', operation: 'check', ip: '' },
		});

		await expect(run(context)).rejects.toThrow('The ip field is empty for this item.');
		expect(http).not.toHaveBeenCalled();
	});
});

describe('FraudNova.execute — Check many', () => {
	const ipAt = (i: number) => `10.0.${Math.floor(i / 256)}.${i % 256}`;

	it('posts 250 items as chunks of 100, 100 and 50 in order', async () => {
		const { context, http } = ctx({
			items: inputs(250),
			params: { resource: 'ip', operation: 'checkMany', ip: ipAt, options: { strictness: 1 } },
		});
		const credits = [900, 800, 750];
		http.mockImplementation(async (_credential: string, options: { body: { ips: string[] } }) =>
			response(200, {
				success: true,
				results: options.body.ips.map((ip) => ({ ip, success: true, data: IP_DATA })),
				credits_remaining: credits.shift(),
			}),
		);

		const result = await run(context);

		const all = Array.from({ length: 250 }, (_, i) => ipAt(i));
		expect(http.mock.calls).toEqual([
			request('POST', '/check/batch', { body: { ips: all.slice(0, 100), strictness: 1 } }, 300000),
			request(
				'POST',
				'/check/batch',
				{ body: { ips: all.slice(100, 200), strictness: 1 } },
				300000,
			),
			request('POST', '/check/batch', { body: { ips: all.slice(200), strictness: 1 } }, 300000),
		]);
		expect(result[0]).toHaveLength(250);
		result[0].forEach((item, i) => {
			const expected = i < 100 ? 900 : i < 200 ? 800 : 750;
			expect(item).toEqual({ json: simplifiedIp(ipAt(i), expected), pairedItem: { item: i } });
		});
	});

	it('sends one request per set of request options, keeping output in input order', async () => {
		const agents = ['A', 'B', 'A'];
		const { context, http } = ctx({
			items: inputs(3),
			params: {
				resource: 'ip',
				operation: 'checkMany',
				ip: ipAt,
				options: (i: number) => ({ userAgent: agents[i] }),
			},
		});
		const credits = [10, 9];
		http.mockImplementation(async (_credential: string, options: { body: { ips: string[] } }) =>
			response(200, {
				success: true,
				results: options.body.ips.map((ip) => ({ ip, success: true, data: IP_DATA })),
				credits_remaining: credits.shift(),
			}),
		);

		const result = await run(context);

		expect(http.mock.calls).toEqual([
			request(
				'POST',
				'/check/batch',
				{ body: { ips: [ipAt(0), ipAt(2)], user_agent: 'A' } },
				300000,
			),
			request('POST', '/check/batch', { body: { ips: [ipAt(1)], user_agent: 'B' } }, 300000),
		]);
		expect(result).toEqual([
			[
				{ json: simplifiedIp(ipAt(0), 10), pairedItem: { item: 0 } },
				{ json: simplifiedIp(ipAt(1), 9), pairedItem: { item: 1 } },
				{ json: simplifiedIp(ipAt(2), 10), pairedItem: { item: 2 } },
			],
		]);
	});

	it('applies the threshold and flag options of each item to its own output', async () => {
		const thresholds = [10, 90];
		const { context, http } = ctx({
			items: inputs(2),
			params: {
				resource: 'ip',
				operation: 'checkMany',
				ip: ipAt,
				options: (i: number) => ({ riskThreshold: thresholds[i] }),
			},
		});
		http.mockResolvedValueOnce(
			response(200, {
				success: true,
				results: [0, 1].map((i) => ({ ip: ipAt(i), success: true, data: IP_DATA })),
				credits_remaining: 5,
			}),
		);

		const result = await run(context);

		expect(http).toHaveBeenCalledTimes(1);
		expect(result[0][0].json).toMatchObject({ flagged: true, flag_reasons: ['fraud_score'] });
		expect(result[0][1].json).toMatchObject({ flagged: false, flag_reasons: [] });
	});

	it('never throws on per-item batch failures', async () => {
		const emails = ['a@x.com', 'bad', 'c@x.com'];
		const { context, http } = ctx({
			items: inputs(3),
			params: { resource: 'email', operation: 'checkMany', email: (i: number) => emails[i] },
			continueOnFail: false,
		});
		http.mockResolvedValueOnce(
			response(200, {
				success: true,
				results: [
					{ email: 'a@x.com', success: true, data: EMAIL_DATA },
					{ email: 'bad', success: false, error: 'invalid_email' },
					{ email: 'c@x.com', success: false, error: 'upstream_failed' },
				],
				credits_remaining: 41,
			}),
		);

		const result = await run(context);

		expect(http.mock.calls).toEqual([
			request('POST', '/check/email/batch', { body: { emails } }, 300000),
		]);
		expect(result).toEqual([
			[
				{ json: simplifiedEmail('a@x.com', 41), pairedItem: { item: 0 } },
				{
					json: {
						error: 'FraudNova rejected "bad" as an invalid email address.',
						code: 'invalid_email',
						email: 'bad',
					},
					pairedItem: { item: 1 },
				},
				{
					json: {
						error:
							'FraudNova could not complete the check: upstream_failed. The credit was refunded.',
						code: 'upstream_failed',
						email: 'c@x.com',
					},
					pairedItem: { item: 2 },
				},
			],
		]);
		expect(result[0][1].json).not.toHaveProperty('flagged');
		expect(result[0][2].json).not.toHaveProperty('flagged');
	});

	it('sends the phone country in the batch body', async () => {
		const phones = ['+44 20 7946 0958', '+44 20 7946 0959'];
		const { context, http } = ctx({
			items: inputs(2),
			params: {
				resource: 'phone',
				operation: 'checkMany',
				phone: (i: number) => phones[i],
				options: { country: 'gb' },
			},
		});
		http.mockResolvedValueOnce(
			response(200, {
				success: true,
				results: phones.map((phone) => ({ phone, success: true, data: PHONE_DATA })),
				credits_remaining: 8,
			}),
		);

		await run(context);

		expect(http.mock.calls).toEqual([
			request('POST', '/check/phone/batch', { body: { phones, country: 'GB' } }, 300000),
		]);
	});

	it('throws a whole-request 401 when On Error is not Continue', async () => {
		const { context, http } = ctx({
			items: inputs(3),
			params: { resource: 'ip', operation: 'checkMany', ip: ipAt },
		});
		http.mockResolvedValueOnce(response(401, ERROR_BODIES[401]));

		await expect(run(context)).rejects.toThrow(BAD_KEY);
		expect(http).toHaveBeenCalledTimes(1);
	});

	it('turns every item of a failed chunk into an error item when On Error is Continue', async () => {
		const { context, http } = ctx({
			items: inputs(3),
			params: { resource: 'ip', operation: 'checkMany', ip: ipAt },
			continueOnFail: true,
		});
		http.mockResolvedValueOnce(response(401, ERROR_BODIES[401]));

		const result = await run(context);

		expect(result).toEqual([
			[0, 1, 2].map((i) => ({ json: { error: BAD_KEY, ip: ipAt(i) }, pairedItem: { item: i } })),
		]);
	});

	it('rejects a batch response whose result count does not match the chunk', async () => {
		const { context, http } = ctx({
			items: inputs(2),
			params: { resource: 'ip', operation: 'checkMany', ip: ipAt },
		});
		http.mockResolvedValueOnce(
			response(200, {
				success: true,
				results: [{ ip: ipAt(0), success: true, data: IP_DATA }],
				credits_remaining: 5,
			}),
		);

		await expect(run(context)).rejects.toThrow('FraudNova returned 1 results for 2 items.');
	});

	it('returns nothing and calls nothing for zero items', async () => {
		const { context, http } = ctx({
			items: [],
			params: { resource: 'ip', operation: 'checkMany', ip: ipAt },
		});

		expect(await run(context)).toEqual([[]]);
		expect(http).not.toHaveBeenCalled();
	});

	it('returns an empty-subject error item without a request', async () => {
		const { context, http } = ctx({
			items: inputs(1),
			params: { resource: 'ip', operation: 'checkMany', ip: '' },
		});

		const result = await run(context);

		expect(http).not.toHaveBeenCalled();
		expect(result).toEqual([
			[
				{
					json: { error: 'The ip field is empty for this item.', code: 'empty', ip: '' },
					pairedItem: { item: 0 },
				},
			],
		]);
	});

	it('leaves empty subjects out of the chunks', async () => {
		const subject = (i: number) => (i === 50 ? '' : ipAt(i));
		const { context, http } = ctx({
			items: inputs(101),
			params: { resource: 'ip', operation: 'checkMany', ip: subject },
		});
		http.mockImplementation(async (_credential: string, options: { body: { ips: string[] } }) =>
			response(200, {
				success: true,
				results: options.body.ips.map((ip) => ({ ip, success: true, data: IP_DATA })),
				credits_remaining: 5,
			}),
		);

		const result = await run(context);

		expect(http).toHaveBeenCalledTimes(1);
		expect(http.mock.calls[0][1].body.ips).toHaveLength(100);
		expect(http.mock.calls[0][1].body.ips).not.toContain('');
		expect(result[0]).toHaveLength(101);
		expect(result[0][50]).toEqual({
			json: { error: 'The ip field is empty for this item.', code: 'empty', ip: '' },
			pairedItem: { item: 50 },
		});
		expect(result[0][51]).toEqual({ json: simplifiedIp(ipAt(51), 5), pairedItem: { item: 51 } });
	});
});

describe('FraudNova.execute — Get balance and dispatch', () => {
	it('calls GET /balance once whatever the number of items', async () => {
		const { context, http } = ctx({
			items: inputs(5),
			params: { resource: 'account', operation: 'getBalance' },
		});
		http.mockResolvedValueOnce(response(200, { success: true, credits_remaining: 97 }));

		const result = await run(context);

		expect(http.mock.calls).toEqual([request('GET', '/balance', {}, 30000)]);
		expect(result).toEqual([[{ json: { credits_remaining: 97 }, pairedItem: { item: 0 } }]]);
	});

	it('rejects an unsupported operation', async () => {
		const { context, http } = ctx({
			items: inputs(1),
			params: { resource: 'account', operation: 'check' },
		});

		await expect(run(context)).rejects.toThrow(
			'Unsupported operation "check" for resource "account".',
		);
		expect(http).not.toHaveBeenCalled();
	});
});
