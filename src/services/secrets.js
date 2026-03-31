import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION ?? 'us-east-1'
});

const cache = {};  // cache for the lifetime of the Lambda container

export async function getSecret(name) {
  if (cache[name]) return cache[name];
  const res = await client.send(new GetSecretValueCommand({ SecretId: name }));
  cache[name] = JSON.parse(res.SecretString);
  return cache[name];
}
