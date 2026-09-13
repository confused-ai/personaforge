/**
 * Stripe tools — customers, payment intents, subscriptions, refunds.
 * Requires: npm install stripe
 */

import { z } from 'zod';
import { BaseTool } from '../core/base-tool.js';
import { ToolCategory, type ToolContext } from '../core/types.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

export interface StripeToolConfig {
    secretKey?: string;
}

interface StripeClient {
    customers: {
        create(p: object): Promise<object>;
        retrieve(id: string): Promise<object>;
    };
    paymentIntents: {
        create(p: object): Promise<object>;
        retrieve(id: string): Promise<object>;
    };
    subscriptions: {
        create(p: object): Promise<object>;
        cancel(id: string): Promise<object>;
    };
    refunds: {
        create(p: object): Promise<object>;
    };
}

function getClient(config: StripeToolConfig): StripeClient {
    const key = config.secretKey ?? process.env['STRIPE_SECRET_KEY'];
    if (!key) throw new Error('StripeTools require STRIPE_SECRET_KEY');
    const Stripe = _require('stripe') as (k: string, o: object) => StripeClient;
    return Stripe(key, { apiVersion: '2024-12-18.acacia' });
}

// ── Schemas ────────────────────────────────────────────────────────────────

const CreateCustomerSchema = z.object({
    email: z.string().email().describe('Customer email'),
    name: z.string().optional().describe('Customer name'),
    metadata: z.record(z.string(), z.string()).optional().describe('Key-value metadata'),
});

const GetCustomerSchema = z.object({
    customerId: z.string().describe('Stripe customer ID (cus_...)'),
});

const CreatePaymentIntentSchema = z.object({
    amount: z.number().int().positive().describe('Amount in smallest currency unit (e.g. cents)'),
    currency: z.string().length(3).describe('ISO 4217 currency code (e.g. "usd")'),
    customerId: z.string().optional().describe('Stripe customer ID'),
    description: z.string().optional().describe('Payment description'),
});

const CreateSubscriptionSchema = z.object({
    customerId: z.string().describe('Stripe customer ID'),
    priceId: z.string().describe('Stripe Price ID (price_...)'),
    trialDays: z.number().int().min(0).optional().describe('Number of trial days'),
});

const CancelSubscriptionSchema = z.object({
    subscriptionId: z.string().describe('Stripe subscription ID (sub_...)'),
});

const RefundSchema = z.object({
    paymentIntentId: z.string().describe('Payment intent ID (pi_...)'),
    amount: z.number().int().positive().optional().describe('Partial refund amount in cents (omit for full refund)'),
});

// ── Tools ──────────────────────────────────────────────────────────────────

export class StripeCreateCustomerTool extends BaseTool<typeof CreateCustomerSchema, object> {
    constructor(private config: StripeToolConfig) {
        super({ id: 'stripe_create_customer', name: 'Stripe Create Customer', description: 'Create a new Stripe customer.', category: ToolCategory.API, parameters: CreateCustomerSchema });
    }
    protected async performExecute(input: z.infer<typeof CreateCustomerSchema>, _ctx: ToolContext) {
        return getClient(this.config).customers.create(input);
    }
}

export class StripeGetCustomerTool extends BaseTool<typeof GetCustomerSchema, object> {
    constructor(private config: StripeToolConfig) {
        super({ id: 'stripe_get_customer', name: 'Stripe Get Customer', description: 'Retrieve a Stripe customer by ID.', category: ToolCategory.API, parameters: GetCustomerSchema });
    }
    protected async performExecute(input: z.infer<typeof GetCustomerSchema>, _ctx: ToolContext) {
        return getClient(this.config).customers.retrieve(input.customerId);
    }
}

export class StripeCreatePaymentIntentTool extends BaseTool<typeof CreatePaymentIntentSchema, object> {
    constructor(private config: StripeToolConfig) {
        super({ id: 'stripe_create_payment_intent', name: 'Stripe Create Payment Intent', description: 'Create a Stripe Payment Intent to charge a customer.', category: ToolCategory.API, parameters: CreatePaymentIntentSchema });
    }
    protected async performExecute(input: z.infer<typeof CreatePaymentIntentSchema>, _ctx: ToolContext) {
        return getClient(this.config).paymentIntents.create({
            amount: input.amount,
            currency: input.currency,
            customer: input.customerId,
            description: input.description,
            automatic_payment_methods: { enabled: true },
        });
    }
}

export class StripeCreateSubscriptionTool extends BaseTool<typeof CreateSubscriptionSchema, object> {
    constructor(private config: StripeToolConfig) {
        super({ id: 'stripe_create_subscription', name: 'Stripe Create Subscription', description: 'Create a recurring subscription for a Stripe customer.', category: ToolCategory.API, parameters: CreateSubscriptionSchema });
    }
    protected async performExecute(input: z.infer<typeof CreateSubscriptionSchema>, _ctx: ToolContext) {
        return getClient(this.config).subscriptions.create({
            customer: input.customerId,
            items: [{ price: input.priceId }],
            trial_period_days: input.trialDays,
        });
    }
}

export class StripeCancelSubscriptionTool extends BaseTool<typeof CancelSubscriptionSchema, object> {
    constructor(private config: StripeToolConfig) {
        super({ id: 'stripe_cancel_subscription', name: 'Stripe Cancel Subscription', description: 'Cancel a Stripe subscription immediately.', category: ToolCategory.API, parameters: CancelSubscriptionSchema });
    }
    protected async performExecute(input: z.infer<typeof CancelSubscriptionSchema>, _ctx: ToolContext) {
        return getClient(this.config).subscriptions.cancel(input.subscriptionId);
    }
}

export class StripeRefundTool extends BaseTool<typeof RefundSchema, object> {
    constructor(private config: StripeToolConfig) {
        super({ id: 'stripe_refund', name: 'Stripe Refund', description: 'Issue a full or partial refund for a payment intent.', category: ToolCategory.API, parameters: RefundSchema });
    }
    protected async performExecute(input: z.infer<typeof RefundSchema>, _ctx: ToolContext) {
        return getClient(this.config).refunds.create({
            payment_intent: input.paymentIntentId,
            amount: input.amount,
        });
    }
}

// ── Toolkit ────────────────────────────────────────────────────────────────

export class StripeToolkit {
    readonly tools: BaseTool[];
    constructor(config: StripeToolConfig = {}) {
        this.tools = [
            new StripeCreateCustomerTool(config),
            new StripeGetCustomerTool(config),
            new StripeCreatePaymentIntentTool(config),
            new StripeCreateSubscriptionTool(config),
            new StripeCancelSubscriptionTool(config),
            new StripeRefundTool(config),
        ];
    }
}
