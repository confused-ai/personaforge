/**
 * Secret Manager Adapters — unified interface for external secret stores.
 *
 * Abstracts AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, and
 * GCP Secret Manager behind a single `SecretManagerAdapter` interface so
 * your agent configuration can be swapped between environments without code changes.
 *
 * All adapters lazy-load their SDKs at runtime — there are **no required peer
 * dependencies**. Install only the SDK for the provider you use.
 *
 * @example
 * ```ts
 * import { createSecretManager } from 'personaforge/config';
 *
 * // AWS
 * const secrets = createSecretManager({ provider: 'aws', region: 'us-east-1' });
 * const apiKey = await secrets.getSecret('openai-api-key');
 *
 * // Azure
 * const secrets = createSecretManager({
 *   provider: 'azure',
 *   vaultUrl: 'https://myvault.vault.azure.net',
 * });
 *
 * // HashiCorp Vault
 * const secrets = createSecretManager({
 *   provider: 'vault',
 *   endpoint: 'http://localhost:8200',
 *   token: process.env.VAULT_TOKEN!,
 * });
 *
 * // GCP
 * const secrets = createSecretManager({
 *   provider: 'gcp',
 *   projectId: 'my-project',
 * });
 *
 * // Environment (dev / CI — reads process.env)
 * const secrets = createSecretManager({ provider: 'env' });
 * ```
 */

import { tryImport } from '../shared/index.js';

// ── Interface ──────────────────────────────────────────────────────────────

/**
 * Unified interface for fetching secrets from any external secret store.
 * Implementations should be stateless (lazy SDK init) and safe to call
 * concurrently.
 */
export interface SecretManagerAdapter {
    /**
     * Retrieve a secret value by name.
     * Throws if the secret does not exist or access is denied.
     *
     * @param name — Secret name / path / ARN (provider-specific format)
     * @param version — Optional version/revision (defaults to latest)
     */
    getSecret(name: string, version?: string): Promise<string>;

    /**
     * Poll a secret at a fixed interval and invoke `callback` whenever the
     * value changes.  Returns a `stop()` function that cancels the watcher.
     *
     * @param name             — Secret name to watch
     * @param callback         — Called with the new value on each change
     * @param intervalMs       — Polling interval in milliseconds (default: 5 min)
     */
    watch(
        name: string,
        callback: (newValue: string) => void | Promise<void>,
        intervalMs?: number,
    ): { stop(): void };
}

// ── Factory ────────────────────────────────────────────────────────────────

export type SecretManagerProvider = 'aws' | 'azure' | 'vault' | 'gcp' | 'env';

export interface AwsSecretManagerOptions {
    provider: 'aws';
    /** AWS region, e.g. `us-east-1`. Defaults to `AWS_DEFAULT_REGION` env var. */
    region?: string;
    /**
     * AWS credentials. When omitted, the SDK uses the default credential chain
     * (env vars → ~/.aws → EC2 instance role → ECS task role).
     */
    credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
}

export interface AzureSecretManagerOptions {
    provider: 'azure';
    /** Key Vault URL, e.g. `https://myvault.vault.azure.net`. */
    vaultUrl: string;
    /**
     * Azure credentials. When omitted, uses `DefaultAzureCredential` (managed identity,
     * env vars, Azure CLI, etc.).
     */
    credentials?: { tenantId: string; clientId: string; clientSecret: string };
}

export interface VaultSecretManagerOptions {
    provider: 'vault';
    /** Vault server endpoint. Default: `VAULT_ADDR` env var or `http://127.0.0.1:8200`. */
    endpoint?: string;
    /** Vault token. Default: `VAULT_TOKEN` env var. */
    token?: string;
    /** KV secrets engine mount path. Default: `secret`. */
    mount?: string;
}

export interface GcpSecretManagerOptions {
    provider: 'gcp';
    /** GCP project ID. Default: `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` env var. */
    projectId?: string;
}

export interface EnvSecretManagerOptions {
    provider: 'env';
    /**
     * Optional prefix to prepend to secret names when reading env vars.
     * E.g. prefix `APP_` → `getSecret('KEY')` reads `process.env.APP_KEY`.
     */
    prefix?: string;
}

export type CreateSecretManagerOptions =
    | AwsSecretManagerOptions
    | AzureSecretManagerOptions
    | VaultSecretManagerOptions
    | GcpSecretManagerOptions
    | EnvSecretManagerOptions;

/**
 * Factory: create a `SecretManagerAdapter` for the given provider.
 *
 * The adapter lazy-loads the underlying SDK on first call, so startup
 * is not blocked by secret resolution.
 */
export function createSecretManager(options: CreateSecretManagerOptions): SecretManagerAdapter {
    switch (options.provider) {
        case 'aws':
            return new AwsSecretsManagerAdapter(options);
        case 'azure':
            return new AzureKeyVaultAdapter(options);
        case 'vault':
            return new VaultAdapter(options);
        case 'gcp':
            return new GcpSecretManagerAdapter(options);
        case 'env':
            return new EnvSecretManagerAdapter(options);
        default:
            throw new Error(`Unknown secret manager provider: ${(options as { provider: string }).provider}`);
    }
}

// ── Polling watcher helper ─────────────────────────────────────────────────

const DEFAULT_WATCH_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * Create a polling-based secret watcher.
 * Resolves the initial value, then polls at `intervalMs` and fires `callback`
 * whenever the value changes (detected by strict equality on string value).
 */
function createPollingWatcher(
    getSecret: (name: string) => Promise<string>,
    name: string,
    callback: (newValue: string) => void | Promise<void>,
    intervalMs = DEFAULT_WATCH_INTERVAL_MS,
): { stop(): void } {
    let lastValue: string | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
        try {
            const value = await getSecret(name);
            if (lastValue !== null && value !== lastValue) {
                await callback(value);
            }
            lastValue = value;
        } catch {
            // Swallow errors — the watcher should not crash the caller.
        }
    };

    // Prime lastValue immediately (no await — fire-and-forget in background).
    void poll();
    timer = setInterval(() => { void poll(); }, intervalMs);

    return {
        stop(): void {
            if (timer !== null) {
                clearInterval(timer);
                timer = null;
            }
        },
    };
}

// ── Env adapter (zero deps) ────────────────────────────────────────────────

export class EnvSecretManagerAdapter implements SecretManagerAdapter {
    private prefix: string;

    constructor(options: EnvSecretManagerOptions) {
        this.prefix = options.prefix ?? '';
    }

    async getSecret(name: string): Promise<string> {
        const envKey = `${this.prefix}${name}`;
        const value = process.env[envKey];
        if (value === undefined || value === '') {
            throw new Error(`Secret not found in environment: ${envKey}`);
        }
        return value;
    }

    watch(name: string, callback: (v: string) => void | Promise<void>, intervalMs?: number) {
        return createPollingWatcher(n => this.getSecret(n), name, callback, intervalMs);
    }
}

// ── AWS Secrets Manager ────────────────────────────────────────────────────

export class AwsSecretsManagerAdapter implements SecretManagerAdapter {
    private options: AwsSecretManagerOptions;

    private client: any = null;

    constructor(options: AwsSecretManagerOptions) {
        this.options = options;
    }


    private async getClient(): Promise<any> {
        if (this.client) return this.client;
        let SM: new (opts: object) => unknown;
        const mod = await tryImport<{ SecretsManagerClient: new (opts: object) => unknown }>('@aws-sdk/client-secrets-manager');
        if (!mod) {
            throw new Error(
                'AwsSecretsManagerAdapter requires @aws-sdk/client-secrets-manager.\n' +
                'Install: npm install @aws-sdk/client-secrets-manager'
            );
        }
        SM = mod.SecretsManagerClient;
        this.client = new SM({
            region: this.options.region ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
            ...(this.options.credentials ? { credentials: this.options.credentials } : {}),
        });
        return this.client;
    }

    async getSecret(name: string, version?: string): Promise<string> {
        const client = await this.getClient();
        let GetSecretValue: new (opts: object) => unknown;
        const mod2 = await tryImport<{ GetSecretValueCommand: new (opts: object) => unknown }>('@aws-sdk/client-secrets-manager');
        if (!mod2) {
            throw new Error('Failed to load GetSecretValueCommand from @aws-sdk/client-secrets-manager');
        }
        GetSecretValue = mod2.GetSecretValueCommand;

        const cmd = new GetSecretValue({
            SecretId: name,
            ...(version ? { VersionStage: version } : {}),
        });


        const response = await (client as any).send(cmd) as { SecretString?: string; SecretBinary?: Uint8Array };
        if (response.SecretString) return response.SecretString;
        if (response.SecretBinary) return Buffer.from(response.SecretBinary).toString('utf8');
        throw new Error(`AWS secret "${name}" has no string or binary value`);
    }

    watch(name: string, callback: (v: string) => void | Promise<void>, intervalMs?: number) {
        return createPollingWatcher(n => this.getSecret(n), name, callback, intervalMs);
    }
}

// ── Azure Key Vault ────────────────────────────────────────────────────────

export class AzureKeyVaultAdapter implements SecretManagerAdapter {
    private options: AzureSecretManagerOptions;

    private client: any = null;

    constructor(options: AzureSecretManagerOptions) {
        this.options = options;
    }


    private async getClient(): Promise<any> {
        if (this.client) return this.client;
        let SecretClient: new (url: string, cred: unknown) => unknown;
        let credential: unknown;

        const kvMod = await tryImport<{ SecretClient: new (url: string, cred: unknown) => unknown }>('@azure/keyvault-secrets');
        if (!kvMod) {
            throw new Error(
                'AzureKeyVaultAdapter requires @azure/keyvault-secrets.\n' +
                'Install: npm install @azure/keyvault-secrets @azure/identity'
            );
        }
        SecretClient = kvMod.SecretClient;

        if (this.options.credentials) {
            const idMod = await tryImport<{ ClientSecretCredential: new (t: string, c: string, s: string) => unknown }>('@azure/identity');
            if (!idMod) {
                throw new Error(
                    'AzureKeyVaultAdapter: explicit credentials require @azure/identity.\n' +
                    'Install: npm install @azure/identity'
                );
            }
            credential = new idMod.ClientSecretCredential(
                this.options.credentials.tenantId,
                this.options.credentials.clientId,
                this.options.credentials.clientSecret,
            );
        } else {
            const idMod = await tryImport<{ DefaultAzureCredential: new () => unknown }>('@azure/identity');
            if (!idMod) {
                throw new Error(
                    'AzureKeyVaultAdapter requires @azure/identity for DefaultAzureCredential.\n' +
                    'Install: npm install @azure/identity'
                );
            }
            credential = new idMod.DefaultAzureCredential();
        }

        this.client = new SecretClient(this.options.vaultUrl, credential);
        return this.client;
    }

    async getSecret(name: string, version?: string): Promise<string> {
        const client = await this.getClient();

        const secret = await (client as any).getSecret(name, version ? { version } : {}) as {
            value?: string;
        };
        if (secret.value === undefined || secret.value === null) {
            throw new Error(`Azure Key Vault secret "${name}" has no value`);
        }
        return secret.value;
    }

    watch(name: string, callback: (v: string) => void | Promise<void>, intervalMs?: number) {
        return createPollingWatcher(n => this.getSecret(n), name, callback, intervalMs);
    }
}

// ── HashiCorp Vault ────────────────────────────────────────────────────────

export class VaultAdapter implements SecretManagerAdapter {
    private endpoint: string;
    private token: string;
    private mount: string;

    constructor(options: VaultSecretManagerOptions) {
        this.endpoint =
            options.endpoint ??
            process.env.VAULT_ADDR ??
            'http://127.0.0.1:8200';
        this.token = options.token ?? process.env.VAULT_TOKEN ?? '';
        this.mount = options.mount ?? 'secret';
    }

    async getSecret(name: string, version?: string): Promise<string> {
        if (!this.token) {
            throw new Error(
                'VaultAdapter: no token provided. Set options.token or VAULT_TOKEN env var.'
            );
        }

        // KV v2 path: /v1/{mount}/data/{name}
        const versionQuery = version ? `?version=${version}` : '';
        const url = `${this.endpoint}/v1/${this.mount}/data/${name}${versionQuery}`;

        const response = await fetch(url, {
            headers: {
                'X-Vault-Token': this.token,
                'Content-Type': 'application/json',
            },
        });

        if (response.status === 404) {
            throw new Error(`Vault secret not found: ${name}`);
        }
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Vault request failed (${response.status}): ${body}`);
        }

        const json = (await response.json()) as {
            data?: { data?: Record<string, string> };
        };

        const data = json.data?.data;
        if (!data) {
            throw new Error(`Vault secret "${name}" has no data`);
        }

        // Return the first value, or look for a key named "value" or same as name
        if (Object.prototype.hasOwnProperty.call(data, 'value')) return data['value']!;
        const key = name.split('/').pop() ?? name;
        if (Object.prototype.hasOwnProperty.call(data, key)) return data[key]!;
        // Return the first value if only one key exists
        const values = Object.values(data);
        if (values.length === 1) return values[0]!;
        throw new Error(
            `Vault secret "${name}" has multiple keys: ${Object.keys(data).join(', ')}. ` +
            `Use getSecret('${name}') with a specific key path.`
        );
    }

    watch(name: string, callback: (v: string) => void | Promise<void>, intervalMs?: number) {
        return createPollingWatcher(n => this.getSecret(n), name, callback, intervalMs);
    }
}

// ── GCP Secret Manager ─────────────────────────────────────────────────────

export class GcpSecretManagerAdapter implements SecretManagerAdapter {
    private projectId: string;

    private client: any = null;

    constructor(options: GcpSecretManagerOptions) {
        this.projectId =
            options.projectId ??
            process.env.GCLOUD_PROJECT ??
            process.env.GOOGLE_CLOUD_PROJECT ??
            '';
    }


    private async getClient(): Promise<any> {
        if (this.client) return this.client;
        let SecretManagerServiceClient: new () => unknown;
        const mod = await tryImport<{ SecretManagerServiceClient: new () => unknown }>('@google-cloud/secret-manager');
        if (!mod) {
            throw new Error(
                'GcpSecretManagerAdapter requires @google-cloud/secret-manager.\n' +
                'Install: npm install @google-cloud/secret-manager'
            );
        }
        SecretManagerServiceClient = mod.SecretManagerServiceClient;
        this.client = new SecretManagerServiceClient();
        return this.client;
    }

    async getSecret(name: string, version = 'latest'): Promise<string> {
        if (!this.projectId) {
            throw new Error(
                'GcpSecretManagerAdapter: no project ID. Set options.projectId or GOOGLE_CLOUD_PROJECT env var.'
            );
        }
        const client = await this.getClient();
        // Full resource name: projects/{project}/secrets/{name}/versions/{version}
        const secretName = name.startsWith('projects/')
            ? `${name}/versions/${version}`
            : `projects/${this.projectId}/secrets/${name}/versions/${version}`;


        const [response] = await (client as any).accessSecretVersion({ name: secretName }) as [
            { payload?: { data?: Buffer | Uint8Array } }
        ];
        const data = response.payload?.data;
        if (!data) throw new Error(`GCP secret "${name}" has no payload data`);
        return Buffer.from(data).toString('utf8');
    }

    watch(name: string, callback: (v: string) => void | Promise<void>, intervalMs?: number) {
        return createPollingWatcher(n => this.getSecret(n), name, callback, intervalMs);
    }
}
