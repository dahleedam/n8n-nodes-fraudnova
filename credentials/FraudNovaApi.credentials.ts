import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class FraudNovaApi implements ICredentialType {
	name = 'fraudNovaApi';

	displayName = 'FraudNova API';

	icon: Icon = {
		light: 'file:../nodes/FraudNova/fraudnova.svg',
		dark: 'file:../nodes/FraudNova/fraudnova.svg',
	};

	documentationUrl = 'https://fraudnova.com/docs#authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Create one at fraudnova.com/dashboard/api-keys. It starts with fn_.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://fraudnova.com/api/v1',
			url: '/balance',
			method: 'GET',
		},
	};
}
