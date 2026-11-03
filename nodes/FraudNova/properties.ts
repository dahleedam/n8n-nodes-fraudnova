import type { INodeProperties } from 'n8n-workflow';

export const FLAG_OPTIONS: Record<'ip' | 'email' | 'phone', { all: string[]; defaults: string[] }> =
	{
		ip: {
			all: ['proxy', 'vpn', 'tor', 'recent_abuse', 'bot_status'],
			defaults: ['proxy', 'vpn', 'tor'],
		},
		email: {
			all: ['disposable', 'honeypot', 'recent_abuse', 'leaked', 'suspect'],
			defaults: ['disposable'],
		},
		phone: {
			all: ['VOIP', 'risky', 'recent_abuse', 'spammer', 'leaked', 'do_not_call'],
			defaults: ['VOIP', 'risky'],
		},
	};

const checkOperations = ['check', 'checkMany'];

const simplifyField: INodeProperties = {
	displayName: 'Simplify',
	name: 'simplify',
	type: 'boolean',
	default: true,
	description: 'Whether to return only the most useful fields instead of every field',
};

const riskThresholdField: INodeProperties = {
	displayName: 'Risk Threshold',
	name: 'riskThreshold',
	type: 'number',
	default: 75,
	typeOptions: { minValue: 0, maxValue: 100 },
	description: 'A fraud_score at or above this value sets flagged to true',
};

function optionsCollection(
	resource: 'ip' | 'email' | 'phone',
	options: INodeProperties[],
): INodeProperties {
	return {
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { resource: [resource], operation: checkOperations } },
		options,
	};
}

export const fraudNovaProperties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'IP Address', value: 'ip' },
			{ name: 'Email Address', value: 'email' },
			{ name: 'Phone Number', value: 'phone' },
			{ name: 'Account', value: 'account' },
		],
		default: 'ip',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['ip'] } },
		options: [
			{ name: 'Check', value: 'check', action: 'Check an IP address' },
			{ name: 'Check Many', value: 'checkMany', action: 'Check many IP addresses' },
		],
		default: 'check',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['email'] } },
		options: [
			{ name: 'Check', value: 'check', action: 'Check an email address' },
			{ name: 'Check Many', value: 'checkMany', action: 'Check many email addresses' },
		],
		default: 'check',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['phone'] } },
		options: [
			{ name: 'Check', value: 'check', action: 'Check a phone number' },
			{ name: 'Check Many', value: 'checkMany', action: 'Check many phone numbers' },
		],
		default: 'check',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['account'] } },
		options: [{ name: 'Get Balance', value: 'getBalance', action: 'Get the credit balance' }],
		default: 'getBalance',
	},
	{
		displayName: 'IP Address',
		name: 'ip',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['ip'], operation: checkOperations } },
		description: 'IPv4 or IPv6 address to check',
	},
	{
		displayName: 'Email Address',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['email'], operation: checkOperations } },
		description: 'Email address to check',
	},
	{
		displayName: 'Phone Number',
		name: 'phone',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['phone'], operation: checkOperations } },
		description: 'Phone number to check, digits with optional +, spaces, dashes or brackets',
	},
	optionsCollection('ip', [
		{
			displayName: 'Strictness',
			name: 'strictness',
			type: 'number',
			default: 2,
			typeOptions: { minValue: 0, maxValue: 3 },
			description: '0 = lenient, 3 = strict. Default 2.',
		},
		{
			displayName: 'Mobile',
			name: 'mobile',
			type: 'boolean',
			default: false,
			description: 'Whether the request comes from a mobile device',
		},
		{
			displayName: 'User Agent',
			name: 'userAgent',
			type: 'string',
			default: '',
			description: 'Visitor user agent, enables device and browser fields (max 512 characters)',
		},
		{
			displayName: 'User Language',
			name: 'userLanguage',
			type: 'string',
			default: '',
			description: 'Visitor Accept-Language value (max 32 characters)',
		},
		simplifyField,
		riskThresholdField,
		{
			displayName: 'Flag On',
			name: 'flagOn',
			type: 'multiOptions',
			options: [
				{ name: 'Bot Status', value: 'bot_status' },
				{ name: 'Proxy', value: 'proxy' },
				{ name: 'Recent Abuse', value: 'recent_abuse' },
				{ name: 'Tor', value: 'tor' },
				{ name: 'VPN', value: 'vpn' },
			],
			default: ['proxy', 'vpn', 'tor'],
			description: 'Fields that set flagged to true when they are true',
		},
	]),
	optionsCollection('email', [
		simplifyField,
		riskThresholdField,
		{
			displayName: 'Flag On',
			name: 'flagOn',
			type: 'multiOptions',
			options: [
				{ name: 'Disposable', value: 'disposable' },
				{ name: 'Honeypot', value: 'honeypot' },
				{ name: 'Leaked', value: 'leaked' },
				{ name: 'Recent Abuse', value: 'recent_abuse' },
				{ name: 'Suspect', value: 'suspect' },
			],
			default: ['disposable'],
			description: 'Fields that set flagged to true when they are true',
		},
	]),
	optionsCollection('phone', [
		{
			displayName: 'Country',
			name: 'country',
			type: 'string',
			default: '',
			description: 'Two-letter country code hint for the phone number, e.g. US',
		},
		simplifyField,
		riskThresholdField,
		{
			displayName: 'Flag On',
			name: 'flagOn',
			type: 'multiOptions',
			options: [
				{ name: 'Do Not Call', value: 'do_not_call' },
				{ name: 'Leaked', value: 'leaked' },
				{ name: 'Recent Abuse', value: 'recent_abuse' },
				{ name: 'Risky', value: 'risky' },
				{ name: 'Spammer', value: 'spammer' },
				{ name: 'VOIP', value: 'VOIP' },
			],
			default: ['VOIP', 'risky'],
			description: 'Fields that set flagged to true when they are true',
		},
	]),
];
