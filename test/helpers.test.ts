import { describe, expect, it } from 'vitest';
import {
	SIMPLIFIED_FIELDS,
	chunk,
	computeFlags,
	groupBy,
	mapBatchItemError,
	mapStatusError,
	normalizeCountry,
	retryDelayMs,
	shapeCheckOutput,
} from '../nodes/FraudNova/helpers';

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('SIMPLIFIED_FIELDS', () => {
	it('lists the spec fields verbatim', () => {
		expect(SIMPLIFIED_FIELDS.ip).toEqual([
			'fraud_score',
			'proxy',
			'vpn',
			'tor',
			'recent_abuse',
			'bot_status',
			'country_code',
			'city',
			'ISP',
		]);
		expect(SIMPLIFIED_FIELDS.email).toEqual([
			'valid',
			'fraud_score',
			'disposable',
			'deliverability',
			'recent_abuse',
			'honeypot',
			'leaked',
			'dns_valid',
			'sanitized_email',
		]);
		expect(SIMPLIFIED_FIELDS.phone).toEqual([
			'valid',
			'fraud_score',
			'VOIP',
			'prepaid',
			'risky',
			'active',
			'carrier',
			'line_type',
			'country',
			'formatted',
		]);
	});
});

describe('chunk', () => {
	it('returns [] for no items', () => {
		expect(chunk([], 100)).toEqual([]);
	});

	it('handles 1, 100, 101 and 250 items preserving order', () => {
		expect(chunk([1], 100)).toEqual([[1]]);
		expect(chunk(range(100), 100).map((c) => c.length)).toEqual([100]);
		expect(chunk(range(101), 100).map((c) => c.length)).toEqual([100, 1]);
		const big = range(250);
		const chunks = chunk(big, 100);
		expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
		expect(chunks.flat()).toEqual(big);
	});
});

describe('groupBy', () => {
	it('returns [] for no items', () => {
		expect(groupBy([], String)).toEqual([]);
	});

	it('groups by key in first-seen order, keeping input order within a group', () => {
		const items = ['a1', 'b1', 'a2', 'c1', 'b2', 'a3'];
		expect(groupBy(items, (item) => item[0])).toEqual([['a1', 'a2', 'a3'], ['b1', 'b2'], ['c1']]);
	});

	it('returns one group when every key is equal', () => {
		expect(groupBy(range(5), () => 'same')).toEqual([range(5)]);
	});
});

describe('computeFlags', () => {
	it('flags a score equal to the threshold', () => {
		expect(computeFlags({ fraud_score: 75 }, 75, [])).toEqual({
			flagged: true,
			flag_reasons: ['fraud_score'],
		});
	});

	it('does not flag a score below the threshold', () => {
		expect(computeFlags({ fraud_score: 74 }, 75, [])).toEqual({
			flagged: false,
			flag_reasons: [],
		});
	});

	it('flags score 0 at threshold 0', () => {
		expect(computeFlags({ fraud_score: 0 }, 0, [])).toEqual({
			flagged: true,
			flag_reasons: ['fraud_score'],
		});
	});

	it('ignores a null fraud_score', () => {
		expect(computeFlags({ fraud_score: null }, 0, [])).toEqual({
			flagged: false,
			flag_reasons: [],
		});
	});

	it('flags a true boolean listed in flagOn', () => {
		expect(computeFlags({ fraud_score: 10, proxy: true }, 75, ['proxy', 'vpn', 'tor'])).toEqual({
			flagged: true,
			flag_reasons: ['proxy'],
		});
	});

	it('ignores a null boolean', () => {
		expect(computeFlags({ vpn: null }, 75, ['proxy', 'vpn', 'tor'])).toEqual({
			flagged: false,
			flag_reasons: [],
		});
	});

	it('ignores true values when flagOn is empty', () => {
		expect(computeFlags({ fraud_score: 10, proxy: true }, 75, [])).toEqual({
			flagged: false,
			flag_reasons: [],
		});
	});

	it('flags phone VOIP', () => {
		expect(computeFlags({ fraud_score: 10, VOIP: true }, 75, ['VOIP', 'risky'])).toEqual({
			flagged: true,
			flag_reasons: ['VOIP'],
		});
	});

	it('orders fraud_score first, then flagOn order', () => {
		expect(
			computeFlags({ fraud_score: 90, proxy: true, tor: true, vpn: false }, 75, [
				'proxy',
				'vpn',
				'tor',
			]),
		).toEqual({ flagged: true, flag_reasons: ['fraud_score', 'proxy', 'tor'] });
	});
});

describe('shapeCheckOutput', () => {
	const ipData = {
		fraud_score: 80,
		proxy: true,
		vpn: false,
		tor: false,
		recent_abuse: false,
		bot_status: false,
		country_code: 'US',
		city: 'Austin',
		ISP: 'Example ISP',
		ASN: 64500,
		operating_system: 'Windows 10',
	};
	const opts = { simplify: true, riskThreshold: 75, flagOn: ['proxy', 'vpn', 'tor'] };

	it('returns only the simplified fields when simplify is on', () => {
		const out = shapeCheckOutput('ip', '1.2.3.4', ipData, 99, opts);
		expect(Object.keys(out).sort()).toEqual(
			[
				'ip',
				'fraud_score',
				'proxy',
				'vpn',
				'tor',
				'recent_abuse',
				'bot_status',
				'country_code',
				'city',
				'ISP',
				'flagged',
				'flag_reasons',
				'credits_remaining',
			].sort(),
		);
		expect(out.ip).toBe('1.2.3.4');
		expect(out.flagged).toBe(true);
		expect(out.flag_reasons).toEqual(['fraud_score', 'proxy']);
		expect(out.credits_remaining).toBe(99);
	});

	it('returns every field when simplify is off', () => {
		const out = shapeCheckOutput('ip', '1.2.3.4', ipData, null, { ...opts, simplify: false });
		expect(out.ASN).toBe(64500);
		expect(out.operating_system).toBe('Windows 10');
		expect(out.credits_remaining).toBeNull();
	});

	it('omits simplified keys missing from the data and computes flags on full data', () => {
		const out = shapeCheckOutput('phone', '+15551234567', { VOIP: true, name: 'x' }, 5, {
			simplify: true,
			riskThreshold: 75,
			flagOn: ['VOIP'],
		});
		expect(out).toEqual({
			phone: '+15551234567',
			VOIP: true,
			flagged: true,
			flag_reasons: ['VOIP'],
			credits_remaining: 5,
		});
	});
});

describe('mapStatusError', () => {
	it('maps 401', () => {
		expect(mapStatusError(401, {})).toBe(
			'FraudNova rejected the API key. Check the FraudNova API credential.',
		);
	});

	it('maps 402', () => {
		expect(mapStatusError(402, {})).toBe(
			'FraudNova account is out of credits. Buy credits at https://fraudnova.com/dashboard/billing.',
		);
	});

	it('maps 403', () => {
		expect(mapStatusError(403, {})).toBe(
			'FraudNova account is suspended. Contact support@fraudnova.com.',
		);
	});

	it('maps 422 with the body message', () => {
		expect(mapStatusError(422, { message: 'The ip field is required.' })).toBe(
			'FraudNova rejected the input: The ip field is required.',
		);
	});

	it('maps 429 in the after-retries form', () => {
		expect(mapStatusError(429, { message: 'Rate limit exceeded. Try again shortly.' })).toBe(
			'FraudNova rate limit reached: Rate limit exceeded. Try again shortly. Use "Check many" for lists or add a Wait node.',
		);
	});

	it('maps 502', () => {
		expect(mapStatusError(502, { message: 'Upstream lookup failed.' })).toBe(
			'FraudNova could not complete the check: Upstream lookup failed. The credit was refunded.',
		);
	});

	it('maps 503 like 502', () => {
		expect(mapStatusError(503, { message: 'Upstream lookup failed.' })).toBe(
			'FraudNova could not complete the check: Upstream lookup failed. The credit was refunded.',
		);
	});

	it("uses a Cloudflare error page's title when there is no message", () => {
		expect(
			mapStatusError(502, {
				type: 'x',
				title: 'Error 502: Bad gateway',
				status: 502,
				detail: 'y',
			}),
		).toBe(
			'FraudNova could not complete the check: Error 502: Bad gateway. The credit was refunded.',
		);
	});

	it('adds a period to a 422 message that lacks one', () => {
		expect(mapStatusError(422, { message: 'Bad input' })).toBe(
			'FraudNova rejected the input: Bad input.',
		);
	});

	it('keeps the generic form raw', () => {
		expect(mapStatusError(500, { message: 'Oops.' })).toBe('FraudNova returned HTTP 500: Oops.');
	});

	it('serializes an object body without a string message', () => {
		expect(mapStatusError(500, { errors: ['x'] })).toBe(
			'FraudNova returned HTTP 500: {"errors":["x"]}',
		);
	});

	it('maps other statuses with a JSON body message', () => {
		expect(mapStatusError(418, { message: 'I am a teapot' })).toBe(
			'FraudNova returned HTTP 418: I am a teapot',
		);
	});

	it('maps other statuses with a string body', () => {
		expect(mapStatusError(504, '<html>Gateway Timeout</html>')).toBe(
			'FraudNova returned HTTP 504: <html>Gateway Timeout</html>',
		);
	});

	it('truncates a non-message body to 200 characters', () => {
		expect(mapStatusError(500, 'x'.repeat(300))).toBe(
			`FraudNova returned HTTP 500: ${'x'.repeat(200)}`,
		);
	});
});

describe('mapBatchItemError', () => {
	it('maps the invalid codes', () => {
		expect(mapBatchItemError('ip', '1.2.3', 'invalid_ip')).toBe(
			'FraudNova rejected "1.2.3" as an invalid IP address.',
		);
		expect(mapBatchItemError('email', 'nope', 'invalid_email')).toBe(
			'FraudNova rejected "nope" as an invalid email address.',
		);
		expect(mapBatchItemError('phone', '12', 'invalid_phone')).toBe(
			'FraudNova rejected "12" as an invalid phone number.',
		);
	});

	it('maps insufficient_credits to the 402 message', () => {
		expect(mapBatchItemError('ip', '1.1.1.1', 'insufficient_credits')).toBe(
			'FraudNova account is out of credits. Buy credits at https://fraudnova.com/dashboard/billing.',
		);
	});

	it('maps upstream_failed', () => {
		expect(mapBatchItemError('ip', '1.1.1.1', 'upstream_failed')).toBe(
			'FraudNova could not complete the check: upstream_failed. The credit was refunded.',
		);
	});

	it('maps unknown codes', () => {
		expect(mapBatchItemError('ip', '1.1.1.1', 'weird')).toBe(
			'FraudNova returned error code weird for "1.1.1.1".',
		);
	});
});

describe('retryDelayMs', () => {
	const concurrent = 'Too many concurrent requests for this account. Please retry.';
	const rate = 'Rate limit exceeded. Try again shortly.';

	it('backs off 1s/2s/4s for the concurrency cap', () => {
		expect([1, 2, 3, 4].map((a) => retryDelayMs(concurrent, a))).toEqual([1000, 2000, 4000, null]);
	});

	it('backs off 5s/15s/40s for the rate limit', () => {
		expect([1, 2, 3, 4].map((a) => retryDelayMs(rate, a))).toEqual([5000, 15000, 40000, null]);
	});
});

describe('normalizeCountry', () => {
	it('trims and uppercases a 2-letter code', () => {
		expect(normalizeCountry(' us ')).toBe('US');
	});

	it('rejects anything else', () => {
		expect(normalizeCountry('usa')).toBeUndefined();
		expect(normalizeCountry(undefined)).toBeUndefined();
		expect(normalizeCountry(12)).toBeUndefined();
		expect(normalizeCountry('u1')).toBeUndefined();
	});
});
