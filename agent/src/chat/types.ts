import { Message } from "./generated/graphql"
import { Chat } from "./generated/graphql"

export interface ChatServiceType {
  getChats(first: number, offset: number, userId: string): Promise<Chat[]>
  getChat(id: string): Promise<Chat | null>
  createChat(name: string, userId: string): Promise<Chat | null>
  sendMessage(
    chatId: string,
    text: string,
    userId: string
  ): Promise<Message | null>
  updateChatTitle(chatId: string, title: string): Promise<Chat | null>
  deleteChat(chatId: string): Promise<Chat | null>
}

export interface OpenAIMessage {
  role: "user" | "assistant" | "system"
  content: string
}

export function transformToOpenAIMessages(messages: any[]): OpenAIMessage[] {
  return messages.map((msg) => ({
    role: msg.role.toLowerCase(),
    content: msg.text,
  }))
}
