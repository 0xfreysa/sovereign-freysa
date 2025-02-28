import Database from "better-sqlite3"
import {
  Chat,
  Message,
  Role,
  WidgetInteractionInput,
} from "../generated/graphql"
import { ChatStorage, CreateMessageInput } from "./types"

export class SQLiteChatStorage implements ChatStorage {
  constructor(private db: Database.Database) {
    // Enable UUID generation
    this.db.function("uuid_generate_v4", () => crypto.randomUUID())

    // Create tables if they don't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
        name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
        chat_id TEXT NOT NULL,
        text TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        tool_args TEXT,
        image_urls TEXT,
        role TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
      );
    `)
  }
  addWidgetInteraction(interaction: WidgetInteractionInput): Promise<any> {
    //@TODO: Implement this
    return Promise.resolve(null)
  }

  async createChat(name: string, userId: string): Promise<Chat> {
    const stmt = this.db.prepare(
      "INSERT INTO chats (name, user_id) VALUES (?, ?) RETURNING *"
    )
    const row = stmt.get(name, userId) as any
    return this.mapRowToChat(row)
  }

  async getChat(id: string): Promise<Chat | null> {
    const stmt = this.db.prepare("SELECT * FROM chats WHERE id = ?")
    const row = stmt.get(id) as any

    if (!row) {
      return null
    }

    const messages = await this.getMessages(id, 100, 0)
    return {
      ...this.mapRowToChat(row),
      messages,
    }
  }

  async getChats(
    first: number,
    offset: number,
    userId: string
  ): Promise<Chat[]> {
    const stmt = this.db.prepare(
      `SELECT * FROM chats WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    const rows = stmt.all(userId, first, offset) as any[]

    const chats = await Promise.all(
      rows.map(async (row) => ({
        ...this.mapRowToChat(row),
        messages: await this.getMessages(row.id, 100, 0),
      }))
    )

    return chats
  }

  async updateChatTitle(id: string, title: string): Promise<Chat> {
    const stmt = this.db.prepare(
      "UPDATE chats SET name = ? WHERE id = ? RETURNING *"
    )
    const row = stmt.get(title, id) as any

    if (!row) {
      throw new Error(`Chat with id ${id} not found`)
    }

    const messages = await this.getMessages(id, 100, 0)
    return {
      ...this.mapRowToChat(row),
      messages,
    }
  }

  async deleteChat(id: string): Promise<Chat> {
    const chatStmt = this.db.prepare("SELECT * FROM chats WHERE id = ?")
    const row = chatStmt.get(id) as any

    if (!row) {
      throw new Error(`Chat with id ${id} not found`)
    }

    const messages = await this.getMessages(id, 100, 0)
    const chat = this.mapRowToChat(row)

    const deleteChat = this.db.transaction(() => {
      // Due to CASCADE, we only need to delete the chat
      const deleteStmt = this.db.prepare("DELETE FROM chats WHERE id = ?")
      deleteStmt.run(id)
    })

    deleteChat()
    return { ...chat, messages }
  }

  async createMessage(
    chatId: string,
    input: CreateMessageInput
  ): Promise<Message> {
    const stmt = this.db.prepare(
      `INSERT INTO messages 
       (chat_id, text, role, tool_calls, tool_call_id, tool_args, image_urls) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    const result = stmt.run(
      chatId,
      input.text,
      input.role,
      JSON.stringify(input.toolCalls || []),
      input.toolCalls?.[0]?.id,
      JSON.stringify(input.toolArgs || []),
      JSON.stringify(input.imageUrls || [])
    )

    const insertedMessage = this.db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(result.lastInsertRowid)

    return this.mapRowToMessage(insertedMessage)
  }

  async getMessages(
    chatId: string,
    first: number,
    offset: number
  ): Promise<Message[]> {
    const stmt = this.db.prepare(
      `SELECT m.* 
       FROM messages m 
       WHERE m.chat_id = ? 
       ORDER BY m.created_at DESC 
       LIMIT ? OFFSET ?`
    )
    const rows = stmt.all(chatId, first, offset) as any[]

    return rows.map(this.mapRowToMessage)
  }

  async updateMessage(id: string, input: CreateMessageInput): Promise<Message> {
    const stmt = this.db.prepare(
      `UPDATE messages 
       SET text = ?, role = ?, image_urls = ?, tool_calls = ?, tool_args = ? 
       WHERE id = ?`
    )
    const result = stmt.run(
      input.text,
      input.role,
      JSON.stringify(input.imageUrls || []),
      JSON.stringify(input.toolCalls || []),
      JSON.stringify(input.toolArgs || []),
      id
    )
    if (result.changes === 0) {
      throw new Error(`Message with id ${id} not found`)
    }
    const updatedMessage = this.db
      .prepare(`SELECT * FROM messages WHERE id = ?`)
      .get(id)
    return this.mapRowToMessage(updatedMessage)
  }

  private mapRowToChat(row: any): Chat {
    return {
      id: row.id,
      name: row.name,
      createdAt: new Date(row.created_at),
      messages: [],
    }
  }

  private mapRowToMessage(row: any): Message {
    return {
      id: row.id,
      text: row.text,
      role: row.role as Role,
      createdAt: new Date(row.created_at),
      imageUrls: JSON.parse(row.image_urls || "[]"),
      toolCalls: JSON.parse(row.tool_calls || "[]"),
      toolArgs: JSON.parse(row.tool_args || "[]"),
    }
  }
}
