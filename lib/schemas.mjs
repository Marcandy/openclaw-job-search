import Ajv from 'ajv';
const ajv = new Ajv({ allErrors: true, strict: true });
const schemas = {
  facts: { type:'object', required:['version','fields'], properties:{version:{type:'string',minLength:1},fields:{type:'object',additionalProperties:{type:'object',required:['value','source','confirmedAt','uses'],properties:{value:{},source:{type:'string',minLength:1},confirmedAt:{type:'string',minLength:1},uses:{type:'array',items:{type:'string'},minItems:1}},additionalProperties:false}}},additionalProperties:false },
  manifest: { type:'object',required:['schemaVersion','campaignDate','profile','configDigest','factsPath','factsHash','factsVersion','expiresAt','maxSubmissions','destinations'],properties:{schemaVersion:{const:1},campaignDate:{type:'string'},profile:{type:'string'},configDigest:{type:'string'},factsPath:{type:'string'},factsHash:{type:'string'},factsVersion:{type:'string'},expiresAt:{type:'string'},maxSubmissions:{type:'integer',minimum:1},destinations:{type:'array',minItems:1,items:{type:'object',required:['url','company','title','location','source','resumePath','resumeHash','answers'],properties:{url:{type:'string'},company:{type:'string'},title:{type:'string'},location:{type:'string'},source:{type:'string'},resumePath:{type:'string'},resumeHash:{type:'string'},postingId:{type:'string'},bucket:{enum:['primary','backup']},answers:{type:'object',additionalProperties:{type:'string'}}},additionalProperties:false}},},additionalProperties:false },
};
const validators = Object.fromEntries(Object.entries(schemas).map(([k,s])=>[k,ajv.compile(s)]));
export function validateData(kind, data) {
  if (!validators[kind]) throw new Error(`Unknown schema ${kind}`);
  if (!validators[kind](data)) throw new Error(`${kind} schema: ${ajv.errorsText(validators[kind].errors)}`);
  return data;
}
