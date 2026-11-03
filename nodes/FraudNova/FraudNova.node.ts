import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { fraudNovaProperties } from './properties';

export class FraudNova implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'FraudNova',
		name: 'fraudNova',
		icon: { light: 'file:fraudnova.svg', dark: 'file:fraudnova.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Fraud scores for IP addresses, email addresses and phone numbers',
		defaults: {
			name: 'FraudNova',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'fraudNovaApi', required: true }],
		properties: fraudNovaProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return [this.getInputData().map((item, i) => ({ json: item.json, pairedItem: { item: i } }))];
	}
}
