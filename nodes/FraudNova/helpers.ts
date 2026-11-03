export type CheckType = 'ip' | 'email' | 'phone';

export const SIMPLIFIED_FIELDS: Record<CheckType, string[]> = {
	ip: [
		'fraud_score',
		'proxy',
		'vpn',
		'tor',
		'recent_abuse',
		'bot_status',
		'country_code',
		'city',
		'ISP',
	],
	email: [
		'valid',
		'fraud_score',
		'disposable',
		'deliverability',
		'recent_abuse',
		'honeypot',
		'leaked',
		'dns_valid',
		'sanitized_email',
	],
	phone: [
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
	],
};

const OUT_OF_CREDITS =
	'FraudNova account is out of credits. Buy credits at https://fraudnova.com/dashboard/billing.';

export function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

export function computeFlags(
	data: Record<string, unknown>,
	riskThreshold: number,
	flagOn: string[],
): { flagged: boolean; flag_reasons: string[] } {
	const flag_reasons: string[] = [];
	if (typeof data.fraud_score === 'number' && data.fraud_score >= riskThreshold) {
		flag_reasons.push('fraud_score');
	}
	for (const name of flagOn) {
		if (data[name] === true) {
			flag_reasons.push(name);
		}
	}
	return { flagged: flag_reasons.length > 0, flag_reasons };
}

export function shapeCheckOutput(
	type: CheckType,
	subject: string,
	data: Record<string, unknown>,
	creditsRemaining: number | null,
	opts: { simplify: boolean; riskThreshold: number; flagOn: string[] },
): Record<string, unknown> {
	const keys = opts.simplify
		? SIMPLIFIED_FIELDS[type].filter((key) => key in data)
		: Object.keys(data);
	const fields: Record<string, unknown> = {};
	for (const key of keys) {
		fields[key] = data[key];
	}
	const { flagged, flag_reasons } = computeFlags(data, opts.riskThreshold, opts.flagOn);
	return {
		[type]: subject,
		...fields,
		flagged,
		flag_reasons,
		credits_remaining: creditsRemaining,
	};
}

function stripTrailingPeriod(text: string): string {
	return text.endsWith('.') ? text.slice(0, -1) : text;
}

function bodyMessage(body: unknown): string {
	if (typeof body === 'object' && body !== null) {
		const message = (body as { message?: unknown }).message;
		if (typeof message === 'string') {
			return message;
		}
	}
	return String(body).slice(0, 200);
}

export function mapStatusError(status: number, body: unknown): string {
	const message = bodyMessage(body);
	const fragment = stripTrailingPeriod(message);
	switch (status) {
		case 401:
			return 'FraudNova rejected the API key. Check the FraudNova API credential.';
		case 402:
			return OUT_OF_CREDITS;
		case 403:
			return 'FraudNova account is suspended. Contact support@fraudnova.com.';
		case 422:
			return `FraudNova rejected the input: ${fragment}.`;
		case 429:
			return `FraudNova rate limit reached: ${fragment}. Use "Check many" for lists or add a Wait node.`;
		case 502:
			return `FraudNova could not complete the check: ${fragment}. The credit was refunded.`;
		default:
			return `FraudNova returned HTTP ${status}: ${message}`;
	}
}

const SUBJECT_NOUN: Record<CheckType, string> = {
	ip: 'IP address',
	email: 'email address',
	phone: 'phone number',
};

const INVALID_CODES = ['invalid_ip', 'invalid_email', 'invalid_phone'];

export function mapBatchItemError(type: CheckType, subject: string, code: string): string {
	if (INVALID_CODES.includes(code)) {
		return `FraudNova rejected "${subject}" as an invalid ${SUBJECT_NOUN[type]}.`;
	}
	if (code === 'insufficient_credits') {
		return OUT_OF_CREDITS;
	}
	if (code === 'upstream_failed') {
		return 'FraudNova could not complete the check: upstream_failed. The credit was refunded.';
	}
	return `FraudNova returned error code ${code} for "${subject}".`;
}

const CONCURRENCY_DELAYS_MS = [1000, 2000, 4000];
const RATE_LIMIT_DELAYS_MS = [5000, 15000, 40000];

export function retryDelayMs(message: string, attempt: number): number | null {
	const schedule = message.includes('Too many concurrent requests')
		? CONCURRENCY_DELAYS_MS
		: RATE_LIMIT_DELAYS_MS;
	return schedule[attempt - 1] ?? null;
}

export function normalizeCountry(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const code = value.trim().toUpperCase();
	return /^[A-Z]{2}$/.test(code) ? code : undefined;
}
