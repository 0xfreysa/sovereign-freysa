import { ToolSchema } from "../tools/types"
import {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/index"

export type TChatCompletion = ChatCompletion
export type TChatMessage = ChatCompletionMessageParam
export type TChatMessageToolCall = ChatCompletionMessageToolCall

export type TModel = {
  modelName: string
  completions(body: TModelCall): Promise<TChatCompletion>
  toolCompletions(body: TModelCall): Promise<TChatMessageToolCall[]>
  embeddings(body: TEmbedCall): Promise<number[]>
}

export type TModelCall = {
  messages: Array<TChatMessage>
  tools?: Array<ToolSchema>
  toolChoice?: "required" | "auto"
  temperature?: number
}

export type TEmbedCall = {
  input: string
}
