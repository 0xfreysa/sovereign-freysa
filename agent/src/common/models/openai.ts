import OpenAI from "openai"
import { ChatCompletion } from "openai/resources/index"
import { TEmbedCall, TModel, TModelCall } from "./types"

/**
 * A model implementation compatible with services that implement the OpenAI API specification.
 * This includes OpenAI's own API as well as compatible services like:
 * - Ollama
 * - LocalAI
 * - OpenRouter (Claude etc.)
 * - Azure OpenAI
 * - Mistral AI
 * - Open source models via compatible servers (LM Studio, etc.)
 *
 * Note: Services must implement the OpenAI chat completions API format, including
 * support for system messages and the standard chat completion parameters.
 */
export class OAICompatibleModel implements TModel {
  private client: OpenAI
  modelName: string
  /**
   * Creates a new OpenAI-compatible model instance
   * @param baseUrl - The base URL of the API endpoint (e.g., 'http://localhost:11434/v1' for Ollama)
   * @param apiKey - The API key for authentication. Falls back to OPENAI_API_KEY environment variable if not provided
   * @param projectId - Optional project ID for services that support project-based organization
   */
  constructor(opts: {
    modelName: string
    baseUrl?: string
    apiKey?: string
    projectId?: string
  }) {
    this.modelName = opts.modelName
    this.client = new OpenAI({
      baseURL: opts.baseUrl,
      apiKey: opts.apiKey || process.env.OPENAI_API_KEY,
      project: opts.projectId,
    })
  }

  /**
   * Sends a chat completion request to the model
   * @param body - The request parameters conforming to the OpenAI chat completion format
   * @returns Promise resolving to a ChatCompletion response
   */
  async completions(body: TModelCall): Promise<ChatCompletion> {
    return await this.client.chat.completions.create({
      model: this.modelName,
      messages: body.messages,
      tools: body.tools,
      tool_choice: body.toolChoice,
      temperature: body.temperature,
    })
  }

  /**
   * Sends a chat completion request to the model with tool calls enabled
   * @param body - The request parameters conforming to the OpenAI chat completion format
   * @returns Promise resolving to an array of tool calls
   */
  async toolCompletions(body: TModelCall) {
    const completion = await this.client.chat.completions.create({
      model: this.modelName,
      messages: body.messages,
      tools: body.tools,
      tool_choice: body.toolChoice,
      temperature: body.temperature,
    })
    const choice = completion.choices[0]
    return choice.message.tool_calls ?? []
  }

  /**
   * Generates embeddings for the given input text using the specified model
   * @param body - The embedding request parameters
   * @param body.model - The name of the embedding model to use (e.g., 'text-embedding-ada-002')
   * @param body.input - The text to generate embeddings for
   * @returns Promise resolving to an array of numbers representing the embedding vector
   *
   * @remarks
   * Note: This method is not compatible with OpenRouter as it does not currently support embeddings.
   * Compatible services include OpenAI, Azure OpenAI, and local embedding models served through
   * compatible APIs.
   *
   * @example
   * ```typescript
   * const embeddings = await model.embeddings({
   *   model: 'text-embedding-ada-002',
   *   input: 'Hello world'
   * });
   * ```
   */
  async embeddings(body: TEmbedCall): Promise<number[]> {
    const embedding = await this.client.embeddings.create({
      model: this.modelName,
      input: body.input,
    })

    return embedding.data?.[0]?.embedding ?? []
  }
}
