import { Agent } from "@/common"
import { ChatStorage } from "../storage/types"
import { ChatServiceType, transformToOpenAIMessages } from "../types"
import { Role, WidgetInteractionInput } from "../generated/graphql"
import { MessageEventService } from "./MessageEventService"

export class ChatService implements ChatServiceType {
  private readonly NUMBER_OF_MESSAGES = 100

  constructor(
    private storage: ChatStorage,
    private agent: Agent,
    private messageEventService: MessageEventService
  ) {}

  async getChats(first: number, offset: number, userId: string) {
    try {
      return await this.storage.getChats(first, offset, userId)
    } catch (error) {
      console.error("Error fetching chats:", error)
      throw new Error("Failed to fetch chats")
    }
  }

  async getChat(id: string) {
    try {
      const chat = await this.storage.getChat(id)
      if (!chat) {
        throw new Error(`Chat with id ${id} not found`)
      }
      return chat
    } catch (error) {
      console.error(`Error fetching chat ${id}:`, error)
      throw new Error("Failed to fetch chat")
    }
  }

  async createChat(name: string, userId: string) {
    try {
      return await this.storage.createChat(name, userId)
    } catch (error) {
      console.error("Error creating chat:", error)
      throw new Error("Failed to create chat")
    }
  }

  async addWidgetInteraction(interaction: WidgetInteractionInput) {
    try {
      return await this.storage.addWidgetInteraction(interaction)
    } catch (error) {
      console.error("Error creating widget interaction:", error)
      throw new Error("Failed to create widget interaction")
    }
  }

  async sendMessage(chatId: string, text: string) {
    try {
      await this.validateChat(chatId)

      // Create and emit user message
      const userMessage = await this.createUserMessage(chatId, text)
      await this.messageEventService.waitForSubscription(chatId)
      this.messageEventService.emitMessage(chatId, userMessage)

      // Handle AI response asynchronously
      void this.handleAIResponse(chatId)

      return userMessage
    } catch (error) {
      console.error("Error sending message:", error)
      throw new Error("Failed to send message")
    }
  }

  async updateChatTitle(chatId: string, title: string) {
    try {
      const updatedChat = await this.storage.updateChatTitle(chatId, title)
      if (!updatedChat) {
        throw new Error(`Chat with id ${chatId} not found`)
      }
      return updatedChat
    } catch (error) {
      console.error("Error updating chat title:", error)
      throw new Error("Failed to update chat title")
    }
  }

  async deleteChat(chatId: string) {
    try {
      const deletedChat = await this.storage.deleteChat(chatId)
      if (!deletedChat) {
        throw new Error(`Chat with id ${chatId} not found`)
      }
      return deletedChat
    } catch (error) {
      console.error("Error deleting chat:", error)
      throw new Error("Failed to delete chat")
    }
  }

  private async validateChat(chatId: string) {
    const chat = await this.storage.getChat(chatId)
    if (!chat) {
      throw new Error(`Chat with id ${chatId} not found`)
    }
    return chat
  }

  private async createUserMessage(chatId: string, text: string) {
    return await this.storage.createMessage(chatId, {
      text,
      role: Role.User,
      imageUrls: [],
      toolCalls: [],
    })
  }

  private async handleAIResponse(chatId: string) {
    try {
      const messages = await this.storage.getMessages(
        chatId,
        this.NUMBER_OF_MESSAGES,
        0
      )
      const openAIMessages = transformToOpenAIMessages(messages)

      const result = await this.agent.execute(openAIMessages, chatId)
      if (!result) {
        throw new Error("No response from AI agent")
      }

      const aiResponse = await this.storage.createMessage(chatId, {
        text: result.toString(),
        role: Role.Assistant,
        imageUrls: [],
        toolCalls: [],
        toolArgs: [],
      })

      if (this.messageEventService.hasSubscribers(chatId)) {
        this.messageEventService.emitMessage(chatId, aiResponse)
      }
    } catch (error) {
      console.error(`Error generating AI response for chat ${chatId}`, error)

      const errorMessage = await this.storage.createMessage(chatId, {
        text: `An error occurred while processing your request. Please try again later.`,
        role: Role.Assistant,
        imageUrls: [],
        toolCalls: [],
        toolArgs: [],
      })

      if (this.messageEventService.hasSubscribers(chatId)) {
        this.messageEventService.emitMessage(chatId, errorMessage)
      }
    }
  }
}
