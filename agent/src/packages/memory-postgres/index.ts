import pg from "pg"
import { v4 as uuidv4 } from "uuid"
import pgvector from "pgvector/pg"
import { Memory, OAICompatibleModel, chunkText } from "@/common"

const { Client } = pg

export class PostgresMemory implements Memory {
  private tableName: string
  client: pg.Client
  model: OAICompatibleModel
  version = "1"

  constructor(tableName: string = "memories", model: OAICompatibleModel) {
    this.tableName = tableName
    this.model = model
    this.client = new Client({
      connectionString: process.env.POSTGRES_CONNECTION_STR ?? "",
    })
  }

  async initialize(): Promise<boolean> {
    await this.client.connect()

    await this.client.query("CREATE EXTENSION IF NOT EXISTS vector")
    await pgvector.registerType(this.client)
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id UUID PRIMARY KEY,
        content TEXT,
        embedding vector(1536)
      )
    `)
    await this.client.query(
      `CREATE INDEX IF NOT EXISTS ${this.tableName}_embedding_idx ON ${this.tableName} USING hnsw (embedding vector_l2_ops)`
    )

    return true
  }

  async search(query: string): Promise<string[]> {
    const embedding = await this.model.embeddings({
      input: query,
    })

    try {
      const result = await this.client.query(
        `
          SELECT content, embedding <-> $1 AS distance
          FROM ${this.tableName}
          ORDER BY distance
          LIMIT 5
        `,
        [pgvector.toSql(embedding)]
      )
      console.log("Got results", result)

      return result.rows.map((row) => row.content)
    } catch (error) {
      console.error("Error searching data:", error)
      return []
    }
  }

  async store(content: string): Promise<void> {
    const chunks = chunkText(content)

    for (const chunk of chunks) {
      const embedding = await this.model.embeddings({
        input: chunk,
      })

      try {
        await this.client.query(
          `
            INSERT INTO ${this.tableName} (id, content, embedding)
            VALUES ($1, $2, $3)
            `,
          [uuidv4(), chunk, pgvector.toSql(embedding)]
        )
      } catch (error) {
        console.error("Error storing data:", error)
      }
    }
  }

  async close(): Promise<void> {
    await this.client.end()
  }
}
