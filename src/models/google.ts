/**
 * @personaforge/models — Google Gemini adapter. Lazy SDK import.
 */

import type { LLMProvider, Message, GenerateOptions, GenerateResult } from '../core/index.js';
import type { ModelAdapterConfig } from './types.js';

const MISSING_SDK_MSG =
  '[personaforge] Google adapter requires the @google/generative-ai package.\n' +
  '  Install: npm install @google/generative-ai';

const DEFAULT_MODEL = 'gemini-2.0-flash';

export function google(config: ModelAdapterConfig = {}): LLMProvider {
  const apiKey = config.apiKey ?? process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY'];
  const model  = config.model  ?? DEFAULT_MODEL;

  let _genai: unknown = null;

  async function getModel(): Promise<import('@google/generative-ai').GenerativeModel> {
    if (_genai) return _genai as import('@google/generative-ai').GenerativeModel;
    const mod = await import('@google/generative-ai').catch(() => { throw new Error(MISSING_SDK_MSG); });
    const genAI = new mod.GoogleGenerativeAI(apiKey ?? '');
    _genai = genAI.getGenerativeModel({ model });
    return _genai as import('@google/generative-ai').GenerativeModel;
  }

  async function getModelWithConfig(generationConfig: Record<string, unknown>): Promise<import('@google/generative-ai').GenerativeModel> {
    const mod = await import('@google/generative-ai').catch(() => { throw new Error(MISSING_SDK_MSG); });
    const genAI = new mod.GoogleGenerativeAI(apiKey ?? '');
    // generationConfig is a supported ModelParams field at runtime (SDK ≥0.1);
    // the cast covers older bundled type snapshots that only list { model }.
    const params = { model, generationConfig } as Parameters<typeof genAI.getGenerativeModel>[0];
    return genAI.getGenerativeModel(params) as import('@google/generative-ai').GenerativeModel;
  }

  /** Convert messages to Gemini Content format. O(n). */
  function toGeminiContents(msgs: Message[]): import('@google/generative-ai').Content[] {
    return msgs
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
      }));
  }

  async function generateText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    const genModel = await getModel();
    const contents = toGeminiContents(messages);
    const last     = contents.pop(); // last user turn is the prompt
    const history  = contents;

    // The SDK pins generation config at model creation, so rebuild the
    // model handle when per-call overrides are present.
    const maxTokens = opts?.maxTokens ?? config.maxTokens;
    const temperature = opts?.temperature ?? config.temperature;
    const model = (maxTokens !== undefined || temperature !== undefined)
      ? await getModelWithConfig({
          ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
        })
      : genModel;

    const chat = model.startChat({ history });
    // The SDK has no AbortSignal support — race so callers still observe cancellation.
    const res = opts?.signal
      ? await Promise.race([
          chat.sendMessage(last?.parts[0]?.text ?? ''),
          new Promise<never>((_, reject) => {
            if (opts.signal!.aborted) reject(new Error('Aborted.'));
            else opts.signal!.addEventListener('abort', () => reject(new Error('Aborted.')), { once: true });
          }),
        ])
      : await chat.sendMessage(last?.parts[0]?.text ?? '');
    const text = res.response.text();
    const usageMetadata = res.response.usageMetadata;
    const usage = {
      ...(usageMetadata?.promptTokenCount !== undefined && { promptTokens: usageMetadata.promptTokenCount }),
      ...(usageMetadata?.candidatesTokenCount !== undefined && { completionTokens: usageMetadata.candidatesTokenCount }),
      ...(usageMetadata?.totalTokenCount !== undefined && { totalTokens: usageMetadata.totalTokenCount }),
    };

    return {
      text,
      finishReason: 'stop',
      ...(Object.keys(usage).length > 0 && { usage }),
    };
  }

  async function streamText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    const genModel = await getModel();
    const contents = toGeminiContents(messages);
    const last     = contents.pop();
    const history  = contents;

    const chat   = genModel.startChat({ history });
    const result = await chat.sendMessageStream(last?.parts[0]?.text ?? '');
    let fullText = '';

    for await (const chunk of result.stream) {
      const delta = chunk.text();
      if (delta) {
        fullText += delta;
        opts?.onChunk?.(delta);
      }
    }

    return { text: fullText, finishReason: 'stop' };
  }

  return { generateText, streamText };
}
