import { Pool } from "pg"
import Database from "better-sqlite3"
import { ChatStorage } from "./types"
import { PostgresChatStorage } from "./postgres"
import { SQLiteChatStorage } from "./sqlite"

export type DatabaseType = "postgres" | "sqlite"

type PostgresConnectionString = {
  connectionString: string
}

type PostgresConnectionParams = {
  host: string
  port: number
  database: string
  user: string
  password: string
}

export type PostgresConfig = PostgresConnectionString | PostgresConnectionParams

export interface StorageConfig {
  type: DatabaseType
  postgres?: PostgresConfig
  sqlite?: {
    filename: string
  }
}

export class StorageFactory {
  static async create(config: StorageConfig): Promise<ChatStorage> {
    switch (config.type) {
      case "postgres":
        if (!config.postgres) {
          throw new Error("Postgres configuration is required")
        }
        const pool = new Pool(config.postgres)
        // Test connection
        await pool.query("SELECT 1")
        return new PostgresChatStorage(pool)

      case "sqlite":
        if (!config.sqlite) {
          throw new Error("SQLite configuration is required")
        }
        const db = new Database(config.sqlite.filename)
        return new SQLiteChatStorage(db)

      default:
        throw new Error(`Unsupported database type: ${config.type}`)
    }
  }
}
