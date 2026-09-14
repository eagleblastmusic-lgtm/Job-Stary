import { createHash, randomUUID } from 'node:crypto';
import type { JobDatabase } from './db.js';
import type { AppConfig } from './config.js';

export interface AiRequest<T> {
  userId: string | null;
  taskType: string;
  promptVersion: string;
  outputSchemaName: string;
  system: string;
  input: string;
  validate: (value: unknown) => T;
}

export class AiGateway {
  constructor(private readonly db: JobDatabase, private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.aiBaseUrl && this.config.aiApiKey && this.config.aiModel);
  }

  async structured<T>(request: AiRequest<T>): Promise<T> {
    if (!this.config.aiBaseUrl || !this.config.aiApiKey || !this.config.aiModel) throw new Error('AI provider nie jest skonfigurowany.');
    const started = Date.now();
    const inputHash = createHash('sha256').update(request.input).digest('hex');
    let success = 0;
    let errorCode: string | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.aiTimeoutMs);
      const response = await fetch(`${this.config.aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.aiApiKey}` },
        body: JSON.stringify({
          model: this.config.aiModel,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.input }
          ]
        }),
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));
      if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error('AI_EMPTY_OUTPUT');
      const parsed: unknown = JSON.parse(content);
      const validated = request.validate(parsed);
      success = 1;
      this.log(request, inputHash, Date.now() - started, payload.usage?.total_tokens ?? null, success, null);
      return validated;
    } catch (error) {
      errorCode = error instanceof Error ? error.message.slice(0, 80) : 'AI_UNKNOWN';
      this.log(request, inputHash, Date.now() - started, null, success, errorCode);
      throw error;
    }
  }

  private log<T>(request: AiRequest<T>, inputHash: string, latencyMs: number, tokenUsage: number | null, success: number, errorCode: string | null): void {
    this.db.db.prepare(`INSERT INTO ai_requests(id,user_id,task_type,model,prompt_version,input_hash,output_schema,latency_ms,token_usage,estimated_cost,success,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      randomUUID(), request.userId, request.taskType, this.config.aiModel ?? 'unconfigured', request.promptVersion, inputHash, request.outputSchemaName, latencyMs, tokenUsage, null, success, errorCode, new Date().toISOString()
    );
  }
}
