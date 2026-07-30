/**
 * Universal tool adapters — bring any external system into personaforge.
 */

export {
    fromOpenAITool,
    fromOpenAITools,
    jsonSchemaToZodObject,
    type OpenAIFunctionTool,
    type OpenAIToolAdapterOptions,
} from './from-openai.js';

export {
    fromHttpTool,
    type HttpToolOptions,
} from './from-http.js';

export {
    fromForeignTool,
    fromForeignTools,
    type ForeignTool,
} from './from-foreign.js';
