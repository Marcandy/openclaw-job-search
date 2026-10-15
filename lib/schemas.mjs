import Ajv from 'ajv';
const ajv = new Ajv({ allErrors: true, strict: true });
const schemas = {
  facts: {
    type: 'object',
    required: ['version', 'fields'],
    properties: {
      version: { type: 'string', minLength: 1 },
      fields: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          required: ['value', 'source', 'confirmedAt', 'uses'],
          properties: {
            value: {},
            source: { type: 'string', minLength: 1 },
            confirmedAt: { type: 'string', minLength: 1 },
            uses: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  manifest: {
    type: 'object',
    required: [
      'schemaVersion',
      'campaignDate',
      'profile',
      'configDigest',
      'factsPath',
      'factsHash',
      'factsVersion',
      'expiresAt',
      'maxSubmissions',
      'destinations',
    ],
    properties: {
      schemaVersion: { const: 1 },
      campaignDate: { type: 'string' },
      profile: { type: 'string' },
      configDigest: { type: 'string' },
      factsPath: { type: 'string' },
      factsHash: { type: 'string' },
      factsVersion: { type: 'string' },
      expiresAt: { type: 'string' },
      maxSubmissions: { type: 'integer', minimum: 1 },
      destinations: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: [
            'url',
            'company',
            'title',
            'location',
            'source',
            'resumePath',
            'resumeHash',
            'answers',
          ],
          properties: {
            url: { type: 'string' },
            company: { type: 'string' },
            title: { type: 'string' },
            location: { type: 'string' },
            source: { type: 'string' },
            resumePath: { type: 'string' },
            resumeHash: { type: 'string' },
            postingId: { type: 'string' },
            bucket: { enum: ['primary', 'backup'] },
            answers: { type: 'object', additionalProperties: { type: 'string' } },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
};
schemas.facts.properties.fields.additionalProperties.properties.employer = { type: 'string' };
schemas.manifest.required.push('sourceDigest');
schemas.manifest.properties.sourceDigest = { type: 'string', minLength: 64, maxLength: 64 };
schemas.config = {
  type: 'object',
  required: ['version', 'timezone', 'cities', 'paths'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    timezone: { type: 'string', minLength: 1 },
    cities: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'label', 'dailyQuota', 'minBackups', 'acceptedLocationAliases'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          dailyQuota: { type: 'integer', minimum: 0 },
          minBackups: { type: 'integer', minimum: 0 },
          acceptedLocationAliases: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: true,
      },
    },
    paths: {
      type: 'object',
      required: ['resume', 'ledgerCsv', 'state'],
      properties: {
        resume: { type: 'string' },
        ledgerCsv: { type: 'string' },
        state: { type: 'string' },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};
schemas.candidate = {
  type: 'object',
  required: ['company', 'title', 'cityId', 'location', 'url'],
  properties: {
    company: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    cityId: { type: 'string', minLength: 1 },
    location: { type: 'string', minLength: 1 },
    url: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    fitScore: { type: 'number', minimum: 0, maximum: 100 },
    salaryMin: { type: ['number', 'null'], minimum: 0 },
    salaryMax: { type: ['number', 'null'], minimum: 0 },
    answers: { type: 'object', additionalProperties: { type: 'string' } },
    companyProfile: {
      type: 'object',
      properties: {
        headcount: { type: 'number', minimum: 0 },
        thrivingSignals: { type: 'array', items: { type: 'object' } },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};
const validators = Object.fromEntries(Object.entries(schemas).map(([k, s]) => [k, ajv.compile(s)]));
export function validateData(kind, data) {
  if (!validators[kind]) throw new Error(`Unknown schema ${kind}`);
  if (!validators[kind](data))
    throw new Error(`${kind} schema: ${ajv.errorsText(validators[kind].errors)}`);
  return data;
}
