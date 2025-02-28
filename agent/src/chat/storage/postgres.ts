import { Pool } from "pg"
import {
  Chat,
  Message,
  Role,
  WidgetInteraction,
  WidgetInteractionInput,
} from "../generated/graphql"
import { ChatStorage, CreateMessageInput } from "./types"

export class PostgresChatStorage implements ChatStorage {
  constructor(private pool: Pool) {}

  async createChat(name: string, userId: string): Promise<Chat> {
    const result = await this.pool.query(
      "INSERT INTO chats (name, user_id) VALUES ($1, $2) RETURNING *",
      [name, userId]
    )
    return this.mapRowToChat(result.rows[0])
  }

  async getChat(id: string): Promise<Chat | null> {
    const result = await this.pool.query("SELECT * FROM chats WHERE id = $1", [
      id,
    ])
    if (result.rows.length === 0) return null

    const chat = result.rows[0]
    const messages = await this.getMessages(id, 100, 0)
    return {
      ...this.mapRowToChat(chat),
      messages,
    }
  }

  async getChats(
    first: number,
    offset: number,
    userId: string
  ): Promise<Chat[]> {
    const result = await this.pool.query(
      `SELECT * FROM chats WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, first, offset]
    )

    const chats = await Promise.all(
      result.rows.map(async (row) => ({
        ...this.mapRowToChat(row),
        messages: await this.getMessages(row.id, 100, 0),
      }))
    )

    return chats
  }

  async updateChatTitle(id: string, title: string): Promise<Chat> {
    const result = await this.pool.query(
      "UPDATE chats SET name = $1 WHERE id = $2 RETURNING *",
      [title, id]
    )

    if (result.rows.length === 0) {
      throw new Error(`Chat with id ${id} not found`)
    }

    const chat = result.rows[0]
    const messages = await this.getMessages(id, 100, 0)
    return {
      ...this.mapRowToChat(chat),
      messages,
    }
  }

  async deleteChat(id: string): Promise<Chat> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      const chatResult = await client.query(
        "SELECT * FROM chats WHERE id = $1",
        [id]
      )

      if (chatResult.rows.length === 0) {
        throw new Error(`Chat with id ${id} not found`)
      }

      const messages = await this.getMessages(id, 100, 0)
      const chat = this.mapRowToChat(chatResult.rows[0])

      await client.query("DELETE FROM chats WHERE id = $1", [id])

      await client.query("COMMIT")
      return { ...chat, messages }
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async addWidgetInteraction(
    input: WidgetInteractionInput
  ): Promise<WidgetInteraction> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Check if message exists
      const messageResult = await client.query(
        "SELECT * FROM messages WHERE id = $1",
        [input.messageId]
      )

      if (messageResult.rows.length === 0) {
        throw new Error(`Message with id ${input.messageId} not found`)
      }

      // Parse the interaction data
      let answer = null
      let options = null

      if (typeof input.interaction === "object") {
        if ("answer" in input.interaction) {
          answer = input.interaction.answer
        }
        if ("options" in input.interaction) {
          options = input.interaction.options
        }
      } else if (typeof input.interaction === "string") {
        answer = input.interaction
      }

      // Create widget interaction data
      const widgetInteractionData = {
        widgetId: input.widgetId,
        answer,
        options,
        createdAt: new Date(),
      }

      const result = await client.query(
        `UPDATE messages 
         SET widget_interaction = $1 
         WHERE id = $2
         RETURNING *`,
        [JSON.stringify(widgetInteractionData), input.messageId]
      )

      await client.query("COMMIT")

      return widgetInteractionData
    } catch (error) {
      await client.query("ROLLBACK")
      console.error("Error in addWidgetInteraction:", error)
      throw error
    } finally {
      client.release()
    }
  }

  async createMessage(
    chatId: string,
    input: CreateMessageInput
  ): Promise<Message> {
    const result = await this.pool.query(
      `INSERT INTO messages 
       (chat_id, text, role, tool_calls, tool_call_id, tool_args, image_urls) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [
        chatId,
        input.text,
        input.role,
        JSON.stringify(input.toolCalls || []),
        input.toolCalls?.[0]?.id,
        JSON.stringify(input.toolArgs || []),
        JSON.stringify(input.imageUrls || []),
      ]
    )

    return this.mapRowToMessage(result.rows[0])
  }

  async getMessages(
    chatId: string,
    first: number,
    offset: number
  ): Promise<Message[]> {
    const messageResult = await this.pool.query(
      `SELECT m.* 
       FROM messages m 
       WHERE m.chat_id = $1 
       ORDER BY m.created_at ASC 
       LIMIT $2 OFFSET $3`,
      [chatId, first, offset]
    )

    return messageResult.rows.map(this.mapRowToMessage)
  }

  async updateMessage(id: string, input: CreateMessageInput): Promise<Message> {
    const result = await this.pool.query(
      `UPDATE messages 
       SET text = $1, role = $2, image_urls = $3, tool_calls = $4, tool_args = $5 
       WHERE id = $6 
       RETURNING *`,
      [
        input.text,
        input.role,
        JSON.stringify(input.imageUrls || []),
        JSON.stringify(input.toolCalls || []),
        JSON.stringify(input.toolArgs || []),
        id,
      ]
    )
    if (result.rows.length === 0) {
      throw new Error(`Message with id ${id} not found`)
    }
    return this.mapRowToMessage(result.rows[0])
  }

  private mapRowToChat(row: any): Chat {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      messages: [],
    }
  }

  private mapRowToMessage(row: any): Message {
    return {
      id: row.id,
      text: row.text,
      role: row.role as Role,
      createdAt: row.created_at,
      imageUrls: row.image_urls || [],
      toolCalls: row.tool_calls || [],
      toolArgs: row.tool_args || [],
      widgetInteraction: row.widget_interaction || null,
    }
  }
}
