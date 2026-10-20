// Modelos vía OpenRouter (`openrouter/<proveedor>/<modelo>` en el model router de Mastra).
// Requiere OPENROUTER_API_KEY. Se pueden sobrescribir desde .env.
export const FAST_MODEL = process.env.FAST_MODEL ?? 'openrouter/anthropic/claude-haiku-5.5'
export const OLIVIA_MODEL = process.env.OLIVIA_MODEL ?? 'openrouter/anthropic/claude-sonnet-5.5'
