---
title: Secret Manager
description: Fetch secrets at runtime from AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, or GCP Secret Manager via a unified createSecretManager() factory with optional secret watching.
outline: [2, 3]
---

# Secret Manager

`createSecretManager()` gives you a unified interface to fetch secrets from any cloud provider. Swap backends at deploy time without changing application code.

```ts
import { createSecretManager } from 'personaforge/config';
```

---

## Quick start

```ts
import { createSecretManager } from 'personaforge/config';

// Reads from AWS Secrets Manager
const secrets = createSecretManager({ provider: 'aws', region: 'us-east-1' });

const apiKey = await secrets.getSecret('openai-api-key');
const dbUrl  = await secrets.getSecret('database-url');

// Use with agent
const agent = createAgent({
  name: 'my-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey,
});
```

---

## Backends

### AWS Secrets Manager

```ts
const secrets = createSecretManager({
  provider: 'aws',
  region: 'us-east-1',
  // credentials optional — defaults to IAM role / env vars / ~/.aws
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
```

### Azure Key Vault

```ts
const secrets = createSecretManager({
  provider: 'azure',
  vaultUrl: 'https://myvault.vault.azure.net',
  // credentials optional — defaults to DefaultAzureCredential (managed identity, CLI, env vars)
  credentials: {
    tenantId: process.env.AZURE_TENANT_ID!,
    clientId: process.env.AZURE_CLIENT_ID!,
    clientSecret: process.env.AZURE_CLIENT_SECRET!,
  },
});
```

### HashiCorp Vault

```ts
const secrets = createSecretManager({
  provider: 'vault',
  endpoint: process.env.VAULT_ADDR,   // default: http://127.0.0.1:8200
  token: process.env.VAULT_TOKEN!,
  mount: 'secret',                    // KV mount path (default: 'secret')
});
```

### GCP Secret Manager

```ts
const secrets = createSecretManager({
  provider: 'gcp',
  projectId: process.env.GOOGLE_CLOUD_PROJECT,  // or GCLOUD_PROJECT
});
```

### Environment (development / CI)

Reads from `process.env` — useful in development when you don't have a cloud secret store:

```ts
const secrets = createSecretManager({ provider: 'env' });

// Reads process.env.OPENAI_API_KEY
const apiKey = await secrets.getSecret('OPENAI_API_KEY');
```

---

## `getSecret(name, version?)`

```ts
// Latest version (default)
const value = await secrets.getSecret('my-api-key');

// Specific version (AWS ARN, Azure version ID, Vault version, GCP version)
const value = await secrets.getSecret('my-api-key', '2');
```

Throws if the secret doesn't exist or access is denied.

---

## Live secret watching

Poll for changes and react without restarting:

```ts
const watcher = secrets.watch(
  'openai-api-key',
  async (newValue) => {
    console.log('API key rotated — updating client');
    openaiClient.apiKey = newValue;
  },
  300_000,  // poll interval ms (default: 5 minutes)
);

// Stop watching when done
watcher.stop();
```

---

## `SecretManagerAdapter` interface

Implement this to add any backend:

```ts
interface SecretManagerAdapter {
  getSecret(name: string, version?: string): Promise<string>;
  watch(
    name: string,
    callback: (newValue: string) => void | Promise<void>,
    intervalMs?: number,
  ): { stop(): void };
}
```

---

## Where to go next

- [Production](./production) — circuit breakers, rate limiters, audit stores.
- [Custom adapter](./custom-adapter) — plug in your own infrastructure bindings.
