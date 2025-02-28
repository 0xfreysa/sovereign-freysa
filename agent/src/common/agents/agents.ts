import { globalEventEmitter, messageEventService } from "@/chat"
import { Executor } from "@/common/executors"
import { Memory } from "@/common/memory"
import { TChatMessage, TModel } from "@/common/models"
import { PlanTool, Tool, TOOL_EVENTS } from "@/common/tools"
import { CompletionTool } from "@/common/tools/completion"
import { logger } from "@/common/utils/logger"

export type TAgentConfig = {
  model: TModel
  memory?: Memory
  tools?: Tool[]
  systemPrompt: string
  temperature?: number
}

export class Agent implements Executor {
  private model: TModel
  private tools?: Tool[]
  private toolsMap?: Record<string, Tool>
  private memory?: Memory
  private systemPrompt: string
  private temperature?: number
  private maxSteps = 30
  private defaultTools = [CompletionTool, PlanTool]

  constructor(config: TAgentConfig) {
    this.memory = config.memory
    this.systemPrompt = config.systemPrompt
    this.temperature = config.temperature
    this.model = config.model
    this.tools = [...this.defaultTools, ...(config.tools ?? [])]
    this.toolsMap = Object.fromEntries(
      this.tools.map((tool) => [tool.name, tool])
    )
    logger.info(`Tools: ${this.tools.map((tool) => tool.name).join(", ")}`)
  }

  async executeTask(task: string) {
    const messages: TChatMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: task },
    ]
    if (this.memory) {
      const context = await this.memory.search(task)
      messages.push({ role: "user", content: context.join("\n") })
    }
    return this.execute(messages)
  }

  private async preToolCallHook(toolName: string, chatId: string) {
    globalEventEmitter.emit(TOOL_EVENTS.TOOL_START, {
      toolName,
      toolChatId: chatId,
      timestamp: new Date().toISOString(),
    })

    // Wait for the tool start event to be fully processed
    await messageEventService.waitForToolStart(toolName, chatId)
  }

  private async postToolCallHook(
    toolName: string,
    result: string,
    chatId: string
  ) {
    globalEventEmitter.emit(TOOL_EVENTS.TOOL_END, {
      toolName,
      toolChatId: chatId,
      result,
      timestamp: new Date().toISOString(),
    })
  }

  async execute(messages: TChatMessage[], chatId?: string) {
    let isCompleted = false
    let currentStep = 0
    let response = ""

    while (!isCompleted && currentStep < this.maxSteps) {
      const completion = await this.model.completions({
        messages: messages,
        tools: this.tools?.map((tool) => tool.schema),
      })

      const choice = completion.choices[0]

      if (choice.message.tool_calls) {
        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.function.name === CompletionTool.name) {
            isCompleted = true
            logger.info("Execution completed")
          }

          chatId && (await this.preToolCallHook(toolCall.function.name, chatId))

          const toolResult = await this.executeTool(
            toolCall.function.name,
            toolCall.function.arguments
          )

          chatId &&
            this.postToolCallHook(toolCall.function.name, toolResult, chatId)

          messages.push({
            role: "assistant",
            content: null,
            tool_calls: [toolCall],
          })
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          })
        }
      } else if (choice.message.content) {
        // OpenAI can return both tool calls and content in the same response
        // Anthropic only returns either tool calls or content
        isCompleted = true
        logger.info("Execution completed")
      }

      response = choice.message.content ?? ""
      currentStep++
    }
    return response
  }

  async executeTool(toolName: string, toolArgs: string) {
    const tool = this.toolsMap?.[toolName]
    if (!tool) {
      logger.error(`Tool ${toolName} not found`)
      throw new Error(`Tool ${toolName} not found`)
    }

    let toolArgsDecoded: unknown
    try {
      toolArgsDecoded = JSON.parse(toolArgs)
    } catch (error) {
      logger.error(`Tool ${toolName} arguments are not valid JSON: ${toolArgs}`)
      throw new Error(
        `Tool ${toolName} arguments are not valid JSON: ${toolArgs}`
      )
    }

    const toolResult = await tool.execute(toolArgsDecoded)
    return toolResult
  }

  async storeMemory(input: string) {
    return await this.memory?.store(input)
  }

  async searchMemory(query: string) {
    return await this.memory?.search(query)
  }
}
