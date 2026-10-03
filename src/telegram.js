// Minimal Telegram Bot API client on Node's built-in fetch. No dependencies.
export class Telegram {
  constructor(token) {
    this.base = `https://api.telegram.org/bot${token}/`;
  }

  async call(method, params = {}, { timeout = 15000 } = {}) {
    const res = await fetch(this.base + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeout),
    });
    const data = await res.json();
    if (!data.ok) {
      const err = new Error(`${method}: ${data.description}`);
      err.code = data.error_code;
      err.retryAfter = data.parameters?.retry_after;
      throw err;
    }
    return data.result;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
