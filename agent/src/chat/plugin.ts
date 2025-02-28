import { FastifyPluginAsync } from "fastify"
import mercurius from "mercurius"
import { readFileSync } from "fs"
import { join } from "path"
import { resolvers } from "./resolvers"
import { StorageFactory, StorageConfig } from "./storage/factory"
import { ChatStorage } from "./storage/types"
import { Agent } from "../common/agents"
import { createAuthMiddlereFromJwtService } from "../common/middlewares/auth"
import { ChatService } from "./services/ChatService"
import { messageEventService } from "./services/MessageEventService"
import { JWTService } from "../common/middlewares/jwt"
import { ChatServiceType } from "./types"

declare module "fastify" {
  interface FastifyRequest {
    userId: string
  }
}

export interface ChatPluginOptions {
  storage: StorageConfig
  agent: Agent
  userId?: string
  chatService?: ChatServiceType
}

export const chatPlugin: FastifyPluginAsync<ChatPluginOptions> = async (
  fastify,
  options
) => {
  const storage: ChatStorage = await StorageFactory.create(options.storage)

  let chatService: ChatServiceType
  if (options.chatService) {
    chatService = options.chatService
  } else {
    chatService = new ChatService(storage, options.agent, messageEventService)
  }

  const schema = readFileSync(join(__dirname, "schema.graphql"), "utf8")

  const openRoutes = ["/health", "/graphiql"]

  const jwtService = new JWTService(
    process.env.JWT_PUBLIC_KEY!,
    process.env.JWT_ISSUER!,
    process.env.JWT_AUDIENCE!
  )

  const authenticateUserMiddleware =
    createAuthMiddlereFromJwtService(jwtService)

  fastify.addHook("preHandler", async (request, reply) => {
    try {
      if (openRoutes.includes(request.url)) {
        return
      }

      // Skip authentication for WebSocket/subscription connections
      if (request.headers["sec-websocket-protocol"]) {
        return
      }

      // Skip authentication for subscription operations
      const body = request.body as any
      if (body?.query?.includes("subscription")) {
        return
      }

      await authenticateUserMiddleware(request, reply)
    } catch (error) {
      console.error("Error in preHandler", error)
      reply.status(401).send({ error: "Unauthorized" })
    }
  })

  await fastify.register(mercurius, {
    schema,
    resolvers,
    context: (request) => {
      return {
        storage,
        agent: options.agent,
        userId: request.userId,
        chatService,
      }
    },
    subscription: {
      context: (_, request) => ({
        storage,
        agent: options.agent,
        userId: request.userId,
        chatService,
      }),
    },
    graphiql: true,
  })

  fastify.addHook("onClose", async () => {
    console.log("Closing chat plugin")
    // await storage.close?.()
  })

  fastify.decorate("chatStorage", storage)
  fastify.decorate("chatService", chatService)
}

export default require("fastify-plugin")(chatPlugin)
