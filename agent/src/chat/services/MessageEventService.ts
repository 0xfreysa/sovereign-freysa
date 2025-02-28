import EventEmitter from "events"
import { Message, Role, ToolArg } from "../generated/graphql"
import { ChatStorage } from "../storage/types"
import { setTimeout as setTimeoutPromise } from "timers/promises"
import { TOOL_EVENTS, ToolName, WIDGET_TOOL_PREFIX } from "@/common/tools"

export const globalEventEmitter = new EventEmitter()

export interface MessageEventServiceType {
  waitForSubscription: (chatId: string, timeout?: number) => Promise<void>
  emitMessage: (chatId: string, message: Message) => void
  createSubscription: (
    chatId: string,
    storage: ChatStorage
  ) => SubscriptionHandlers
  waitForToolStart: (toolName: string, chatId: string) => Promise<void>
}

export interface SubscriptionHandlers {
  messageListener: (message: Message) => void
  toolStartListener: (event: ToolEvent) => Promise<void>
  toolEndListener: (event: ToolEvent) => Promise<void>
  next: () => Promise<IteratorResult<{ messageAdded: Message }>>
  cleanup: () => void
}

const toolNameMap: Record<ToolName, string> = {
  replicate_image_generation: "Image Generation Tool",
  plan: "Plan Tool",
  widget_createDonateWidget: "Donate Widget Tool",
}

export interface ToolEvent {
  toolName: ToolName
  toolChatId?: string
  timestamp: string
  result?: string
}

export class MessageEventService implements MessageEventServiceType {
  private static instance: MessageEventService
  public messageEmitter = new EventEmitter()
  private toolMessagesMap = new Map<string, string>()

  private constructor() {}

  public static getInstance(): MessageEventService {
    if (!MessageEventService.instance) {
      MessageEventService.instance = new MessageEventService()
    }
    return MessageEventService.instance
  }

  hasSubscribers(chatId: string): boolean {
    return this.messageEmitter.listenerCount(`CHAT_${chatId}`) > 0
  }

  async waitForSubscription(chatId: string, timeout = 5000) {
    try {
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(
          () => reject(new Error("Subscription wait timeout")),
          timeout
        )

        const checkReady = async () => {
          if (this.messageEmitter.listenerCount(`CHAT_${chatId}`) > 0) {
            clearTimeout(timeoutId)
            resolve()
          } else {
            await setTimeoutPromise(50)
            checkReady()
          }
        }
        checkReady()
      })
    } catch (error: any) {
      console.warn(
        `[SEND] ${error.message} for chat ${chatId}, proceeding anyway`
      )
    }
  }

  emitMessage(chatId: string, message: Message) {
    this.messageEmitter.emit(`CHAT_${chatId}`, message)
  }

  createSubscription(
    chatId: string,
    storage: ChatStorage
  ): SubscriptionHandlers {
    const queue: Message[] = []
    let resolvers: ((
      value: IteratorResult<{ messageAdded: Message }>
    ) => void)[] = []

    const messageListener = this.createMessageListener(queue, resolvers)
    const toolStartListener = this.createToolStartListener(
      chatId,
      storage,
      queue,
      resolvers
    )
    const toolEndListener = this.createToolEndListener(
      chatId,
      storage,
      queue,
      resolvers
    )

    // Add all listeners
    this.messageEmitter.addListener(`CHAT_${chatId}`, messageListener)
    globalEventEmitter.addListener(TOOL_EVENTS.TOOL_START, toolStartListener)
    globalEventEmitter.addListener(TOOL_EVENTS.TOOL_END, toolEndListener)

    return {
      messageListener,
      toolStartListener,
      toolEndListener,
      next: () => this.handleNext(queue, resolvers),
      cleanup: () =>
        this.cleanup(
          chatId,
          messageListener,
          toolStartListener,
          toolEndListener
        ),
    }
  }

  private createMessageListener(
    queue: Message[],
    resolvers: Array<(value: IteratorResult<{ messageAdded: Message }>) => void>
  ) {
    return (message: Message) => {
      if (resolvers.length > 0) {
        const resolve = resolvers.shift()!
        resolve({ value: { messageAdded: message }, done: false })
      } else {
        queue.push(message)
      }
    }
  }

  private getToolMapKey(chatId: string, toolName: string): string {
    return `${chatId}:${toolName}`
  }

  private createToolStartListener(
    chatId: string,
    storage: ChatStorage,
    queue: Message[],
    resolvers: Array<(value: IteratorResult<{ messageAdded: Message }>) => void>
  ) {
    return async ({ toolName, toolChatId, timestamp }: ToolEvent) => {
      // Skip if this event is for a different chat
      if (!toolChatId || toolChatId !== chatId) {
        console.log(
          `Skipping tool start for ${toolName} - event toolChatId: ${toolChatId}, subscription chatId: ${chatId}`
        )
        return
      }

      try {
        const chat = await storage.getChat(chatId)
        if (!chat) {
          console.error(
            `Chat ${chatId} not found when starting tool ${toolName}`
          )
          return
        }

        const toolMessage = await storage.createMessage(chatId, {
          text: `Starting tool: ${toolNameMap[toolName] || toolName}`,
          role: Role.Assistant,
          imageUrls: [],
          toolCalls: [
            {
              id: toolName,
              isCompleted: false,
              name: toolNameMap[toolName] || toolName,
            },
          ],
          toolArgs: [],
        })

        const mapKey = this.getToolMapKey(chatId, toolName)
        console.log(`Setting map key: ${mapKey}, message ID: ${toolMessage.id}`)
        this.toolMessagesMap.set(mapKey, toolMessage.id)

        if (resolvers.length > 0) {
          const resolve = resolvers.shift()!
          resolve({ value: { messageAdded: toolMessage }, done: false })
        } else {
          queue.push(toolMessage)
        }

        // Emit a chat-specific event with both toolName and chatId
        globalEventEmitter.emit(TOOL_EVENTS.TOOL_START_PROCESSED, {
          toolName,
          chatId: toolChatId,
        })
      } catch (error) {
        console.error(
          `Error processing tool start for ${toolName} in chat ${chatId}:`,
          error
        )
      }
    }
  }

  private createToolEndListener(
    chatId: string,
    storage: ChatStorage,
    queue: Message[],
    resolvers: Array<(value: IteratorResult<{ messageAdded: Message }>) => void>
  ) {
    return async ({ toolName, toolChatId, result, timestamp }: ToolEvent) => {
      // Skip if this event is for a different chat
      if (!toolChatId || toolChatId !== chatId) {
        console.log(
          `Skipping tool end for ${toolName} - event toolChatId: ${toolChatId}, subscription chatId: ${chatId}`
        )
        return
      }

      const mapKey = this.getToolMapKey(chatId, toolName)
      console.log(`Looking up map key: ${mapKey}`)

      let messageId = this.toolMessagesMap.get(mapKey)

      if (!messageId) {
        console.log(
          `Message ID not found immediately for ${mapKey}, retrying...`
        )
        for (let i = 0; i < 3; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          messageId = this.toolMessagesMap.get(mapKey)
          if (messageId) {
            console.log(`Found message ID on retry ${i + 1}: ${messageId}`)
            break
          }
        }
      }

      if (!messageId) {
        console.error(
          `No message found for tool: ${toolName} in chat: ${chatId}`
        )
        return
      }

      try {
        let toolArgs: ToolArg[] = []
        if (toolName.startsWith(WIDGET_TOOL_PREFIX) && result) {
          try {
            const parsedResult = JSON.parse(result)
            if (
              Array.isArray(parsedResult) &&
              parsedResult.every((arg) => arg.name && arg.arguments)
            ) {
              toolArgs = parsedResult.map((arg) => ({
                name: arg.name,
                arguments:
                  typeof arg.arguments === "string"
                    ? arg.arguments
                    : JSON.stringify(arg.arguments),
              }))
            } else {
              console.error("Invalid toolArgs format:", parsedResult)
            }
          } catch (error) {
            console.error("Error parsing tool result:", error)
          }
        }

        const updatedMessage = await storage.updateMessage(messageId, {
          text: `Completed tool: ${toolNameMap[toolName] || toolName}\nResult: ${result}`,
          toolCalls: [
            {
              id: toolName,
              isCompleted: true,
              name: toolNameMap[toolName] || toolName,
            },
          ],
          role: Role.Assistant,
          toolArgs: toolArgs,
        })

        if (resolvers.length > 0) {
          const resolve = resolvers.shift()!
          resolve({ value: { messageAdded: updatedMessage }, done: false })
        } else {
          queue.push(updatedMessage)
        }

        this.toolMessagesMap.delete(mapKey)
      } catch (error) {
        console.error(
          `Error processing tool end for ${toolName} in chat ${chatId}:`,
          error
        )
      }
    }
  }

  private async handleNext(
    queue: Message[],
    resolvers: Array<(value: IteratorResult<{ messageAdded: Message }>) => void>
  ): Promise<IteratorResult<{ messageAdded: Message }>> {
    if (queue.length > 0) {
      const message = queue.shift()!
      return { value: { messageAdded: message }, done: false }
    }

    return new Promise((resolve) => {
      resolvers.push(resolve)
    })
  }

  private cleanup(
    chatId: string,
    messageListener: (message: Message) => void,
    toolStartListener: (event: ToolEvent) => Promise<void>,
    toolEndListener: (event: ToolEvent) => Promise<void>
  ) {
    this.messageEmitter.removeListener(`CHAT_${chatId}`, messageListener)
    globalEventEmitter.removeListener(TOOL_EVENTS.TOOL_START, toolStartListener)
    globalEventEmitter.removeListener(TOOL_EVENTS.TOOL_END, toolEndListener)
    return Promise.resolve({ value: undefined, done: true })
  }

  async waitForToolStart(toolName: string, chatId: string): Promise<void> {
    return new Promise((resolve) => {
      const listener = (data: { toolName: string; chatId: string }) => {
        if (data.toolName === toolName && data.chatId === chatId) {
          globalEventEmitter.removeListener(
            TOOL_EVENTS.TOOL_START_PROCESSED,
            listener
          )
          resolve()
        }
      }
      globalEventEmitter.on(TOOL_EVENTS.TOOL_START_PROCESSED, listener)
    })
  }
}

export const messageEventService = MessageEventService.getInstance()
