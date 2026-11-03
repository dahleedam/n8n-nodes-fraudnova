import { describe, expect, it } from 'vitest';
import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { FLAG_OPTIONS, fraudNovaProperties } from '../nodes/FraudNova/properties';

type Resource = 'ip' | 'email' | 'phone';

function find(name: string, resource: string): INodeProperties | undefined {
	return fraudNovaProperties.find(
		(p) =>
			p.name === name &&
			(p.displayOptions?.show?.resource as string[] | undefined)?.includes(resource),
	);
}

function optionsCollection(resource: string): INodeProperties | undefined {
	return find('options', resource);
}

function fieldsOf(resource: string): INodeProperties[] {
	return (optionsCollection(resource)?.options ?? []) as INodeProperties[];
}

function field(resource: string, name: string): INodeProperties {
	const found = fieldsOf(resource).find((o) => o.name === name);
	if (!found) throw new Error(`Missing field ${name} for ${resource}`);
	return found;
}

const FIELD_NAMES: Record<Resource, string[]> = {
	ip: ['strictness', 'mobile', 'userAgent', 'userLanguage', 'simplify', 'riskThreshold', 'flagOn'],
	email: ['simplify', 'riskThreshold', 'flagOn'],
	phone: ['country', 'simplify', 'riskThreshold', 'flagOn'],
};

describe('fraudNovaProperties', () => {
	it.each(['ip', 'email', 'phone'] as Resource[])('has a required %s subject field', (resource) => {
		const subject = find(resource, resource);
		expect(subject).toBeDefined();
		expect(subject?.type).toBe('string');
		expect(subject?.required).toBe(true);
		expect(subject?.default).toBe('');
		expect(subject?.displayOptions?.show?.operation).toEqual(['check', 'checkMany']);
	});

	it.each(['ip', 'email', 'phone'] as Resource[])(
		'has the exact option fields for %s',
		(resource) => {
			const collection = optionsCollection(resource);
			expect(collection?.type).toBe('collection');
			expect(collection?.placeholder).toBe('Add option');
			expect(collection?.default).toEqual({});
			expect(collection?.displayOptions?.show?.operation).toEqual(['check', 'checkMany']);
			expect(fieldsOf(resource).map((o) => o.name)).toEqual(FIELD_NAMES[resource]);
		},
	);

	it('defines strictness and mobile for ip', () => {
		const strictness = field('ip', 'strictness');
		expect(strictness.type).toBe('number');
		expect(strictness.default).toBe(2);
		expect(strictness.typeOptions).toMatchObject({ minValue: 0, maxValue: 3 });
		const mobile = field('ip', 'mobile');
		expect(mobile.type).toBe('boolean');
		expect(mobile.default).toBe(false);
	});

	it('defines simplify and riskThreshold for every resource', () => {
		for (const resource of ['ip', 'email', 'phone']) {
			expect(field(resource, 'simplify').default).toBe(true);
			const threshold = field(resource, 'riskThreshold');
			expect(threshold.type).toBe('number');
			expect(threshold.default).toBe(75);
			expect(threshold.typeOptions).toMatchObject({ minValue: 0, maxValue: 100 });
		}
	});

	it('defines flagOn from FLAG_OPTIONS for every resource', () => {
		for (const resource of ['ip', 'email', 'phone'] as Resource[]) {
			const flagOn = field(resource, 'flagOn');
			expect(flagOn.type).toBe('multiOptions');
			// n8n lint requires multiOptions to be alphabetized by name, so compare as sets.
			const values = (flagOn.options as INodePropertyOptions[]).map((o) => o.value as string);
			expect([...values].sort()).toEqual([...FLAG_OPTIONS[resource].all].sort());
			expect(flagOn.default).toEqual(FLAG_OPTIONS[resource].defaults);
		}
	});

	it('exposes the pinned FLAG_OPTIONS', () => {
		expect(FLAG_OPTIONS).toEqual({
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
		});
	});

	it('has the phone country hint', () => {
		const country = field('phone', 'country');
		expect(country.type).toBe('string');
		expect(country.default).toBe('');
	});

	it('shows no options collection for account', () => {
		expect(optionsCollection('account')).toBeUndefined();
	});

	it('uses no emoji in display names', () => {
		const emoji = /\p{Extended_Pictographic}/u;
		const names: string[] = [];
		const walk = (props: Array<INodeProperties | INodePropertyOptions>) => {
			for (const p of props) {
				names.push('displayName' in p ? p.displayName : p.name);
				if ('options' in p && Array.isArray(p.options)) walk(p.options);
			}
		};
		walk(fraudNovaProperties);
		for (const name of names) expect(name).not.toMatch(emoji);
	});
});
