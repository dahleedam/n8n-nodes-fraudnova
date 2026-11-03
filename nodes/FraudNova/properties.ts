import type { INodeProperties } from 'n8n-workflow';

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
];
