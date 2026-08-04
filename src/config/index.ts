/**
 * Configuration management for the agent framework
 *
 * Handles environment variables with validation, defaults, and helpful error messages.
 */

export * from './loader.js';
export * from './validator.js';
export * from './types.js';
export { loadConfigFile } from './file-loader.js';

// Secret managers — AWS, Azure, GCP, Vault, Env
export {
    createSecretManager,
    EnvSecretManagerAdapter,
    AwsSecretsManagerAdapter,
    AzureKeyVaultAdapter,
    VaultAdapter,
    GcpSecretManagerAdapter,
} from './secret-manager.js';
export type {
    SecretManagerAdapter,
    SecretManagerProvider,
    CreateSecretManagerOptions,
    AwsSecretManagerOptions,
    AzureSecretManagerOptions,
    VaultSecretManagerOptions,
    GcpSecretManagerOptions,
    EnvSecretManagerOptions,
} from './secret-manager.js';
