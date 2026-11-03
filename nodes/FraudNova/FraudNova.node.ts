import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import type { CheckType } from './helpers';
import { executeCheck, executeCheckMany, executeGetBalance } from './operations';
import { fraudNovaProperties } from './properties';

const CHECK_TYPES: string[] = ['ip', 'email', 'phone'];

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
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		if (resource === 'account' && operation === 'getBalance') {
			return [await executeGetBalance.call(this)];
		}
		if (CHECK_TYPES.includes(resource)) {
			const type = resource as CheckType;
			if (operation === 'check') {
				return [await executeCheck.call(this, type, items)];
			}
			if (operation === 'checkMany') {
				return [await executeCheckMany.call(this, type, items)];
			}
		}
		throw new NodeOperationError(
			this.getNode(),
			`Unsupported operation "${operation}" for resource "${resource}".`,
		);
	}
}
