class TemporaryProviderError extends Error {}

/** One bounded retry for timeouts and temporary upstream failures. Never retry invalid requests. */
export async function generateQuotationPlan(url: string, apiKey: string, body: string, budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Quotation analysis time budget exhausted');
    try {
      const response = await fetch(url, {
        method: 'POST', headers: {'content-type':'application/json','x-goog-api-key':apiKey},
        body, signal: AbortSignal.timeout(Math.min(50_000, remaining)),
      });
      if ([429, 500, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        throw new TemporaryProviderError(`Provider temporarily unavailable (${response.status})`);
      }
      if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
      const temporary = error instanceof TemporaryProviderError || error instanceof TypeError ||
        (typeof name === 'string' && ['AbortError','TimeoutError'].includes(name));
      if (!temporary || attempt === 1 || deadline - Date.now() < 500) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error('Quotation analysis unavailable');
}
