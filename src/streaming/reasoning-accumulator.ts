/**
 * Small in-memory buffer for reasoning/thinking-token blocks streamed
 * during one agent run or provider call. Instantiate one per call site —
 * there is no cross-instance shared state, so no run-id keying is needed.
 */
export class ReasoningAccumulator {
    private blocks: { text: string; title?: string }[] = [];

    push(block: { text: string; title?: string }): void {
        this.blocks.push(block);
    }

    /** Returns the accumulated blocks and clears the buffer. */
    flush(): { text: string; title?: string }[] {
        const out = this.blocks;
        this.blocks = [];
        return out;
    }
}

/** Repo-convention kill switch: `ENABLE_<FEATURE>`, default-on. */
export function isReasoningStreamEnabled(): boolean {
    return process.env.ENABLE_REASONING_STREAM !== 'false';
}
