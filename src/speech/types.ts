export type EngineState = 'idle' | 'loading' | 'listening' | 'error';

export interface EngineHandlers {
  /** Recognised text. `final` = this chunk is committed; otherwise it replaces the previous interim chunk. */
  onText(text: string, final: boolean): void;
  onState(state: EngineState, message?: string): void;
  /** 0..1 microphone level, when available. */
  onLevel?(level: number): void;
  /** Model download / load progress 0..1 */
  onProgress?(p: number, message: string): void;
}

export interface SpeechEngine {
  readonly id: string;
  start(): Promise<void>;
  stop(): void;
}
