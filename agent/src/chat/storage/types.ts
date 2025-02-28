import {
  Chat,
  Message,
  Role,
  ToolArg,
  ToolCall,
  WidgetInteraction,
  WidgetInteractionInput,
} from "../generated/graphql"

export interface ChatStorage {
  createChat(name: string, userId: string): Promise<Chat>
  getChat(id: string): Promise<Chat | null>
  getChats(first: number, offset: number, userId: string): Promise<Chat[]>
  updateChatTitle(id: string, title: string): Promise<Chat>
  deleteChat(id: string): Promise<Chat>
  addWidgetInteraction(
    interaction: WidgetInteractionInput
  ): Promise<WidgetInteraction>

  createMessage(chatId: string, input: CreateMessageInput): Promise<Message>
  getMessages(chatId: string, first: number, offset: number): Promise<Message[]>
  updateMessage(id: string, input: CreateMessageInput): Promise<Message>
}

export interface CreateMessageInput {
  text?: string
  role: Role
  imageUrls?: string[]
  toolCalls?: ToolCall[]
  toolArgs?: ToolArg[]
}
