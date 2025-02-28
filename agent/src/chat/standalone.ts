import { Agent, OAICompatibleModel } from "../common"
import { createChatServer } from "./server"
import { PostgresConfig } from "./storage/factory"
import { ChatServiceType } from "./types"

interface ServerConfig {
  port?: number
  host?: string
  dbConfig?: {
    type: "postgres"
    postgres: PostgresConfig
  }
  tools?: any[]
  systemPrompt?: string
  modelName?: string
  chatService?: ChatServiceType
}

export async function createServer(config: ServerConfig = {}) {
  const {
    port,
    host = "0.0.0.0",
    dbConfig = {
      type: "postgres",
      postgres: {
        host: process.env.POSTGRES_HOST || "localhost",
        port: parseInt(process.env.POSTGRES_PORT || "5432"),
        database: process.env.POSTGRES_DB || "postgres",
        user: process.env.POSTGRES_USER || "postgres",
        password: process.env.POSTGRES_PASSWORD || "postgres",
      },
    },
    tools = [],
    systemPrompt = "You are a helpful assistant.",
    modelName = "gpt-4o-mini",
    chatService,
  } = config

  const model = new OAICompatibleModel({
    modelName,
  })

  const agent = new Agent({
    model,
    tools,
    systemPrompt,
  })

  return createChatServer({
    storage: dbConfig,
    agent,
    port,
    host,
    chatService,
  })
}

if (require.main === module) {
  createServer().catch((err) => {
    console.error("Failed to start server:", err)
    process.exit(1)
  })
}
