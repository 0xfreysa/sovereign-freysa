import Fastify, { FastifyInstance } from "fastify"
import cors from "@fastify/cors"
import { Agent } from "../common/agents"
import { chatPlugin, ChatServiceType } from "./index"
import { StorageConfig } from "./storage/factory"
import { logger } from "@/common"

export interface ChatServerConfig {
  port?: number
  host?: string
  storage: StorageConfig
  agent: Agent
  fastify?: FastifyInstance
  chatService?: ChatServiceType
}

export async function createChatServer(config: ChatServerConfig) {
  const fastify = config.fastify || Fastify({ logger: true })

  await fastify.register(cors, {
    origin: true,
  })

  await fastify.register(require("@fastify/middie"))

  await fastify.register(chatPlugin, {
    storage: config.storage,
    agent: config.agent,
    chatService: config.chatService,
  })

  // Health check endpoint
  fastify.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() }
  })

  if (!config.fastify) {
    const port = config.port
    const host = config.host || "0.0.0.0"

    try {
      await fastify.listen({ port, host })
      logger.info(`Chat server running at ${fastify.server.address()}`)
    } catch (err) {
      logger.error({ err }, "Failed to start chat server")
      throw err
    }
  }

  return fastify
}
