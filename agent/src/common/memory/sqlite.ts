import * as sqliteVec from "sqlite-vec"
import Database from "better-sqlite3"
import { OAICompatibleModel, Memory, chunkText } from ".."

export class SQLiteMemory implements Memory {
  private model: OAICompatibleModel
  private db: Database.Database
  version = "1"

  constructor(dbPath: string = ":memory:", model: OAICompatibleModel) {
    this.model = model

    this.db = new Database(dbPath)
    sqliteVec.load(this.db)

    this.initializeDatabase()
  }

  private initializeDatabase() {
    this.db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(content TEXT, embedding float[1536])"
    )
  }

  async search(query: string): Promise<string[]> {
    const queryEmbedding = await this.model.embeddings({
      input: query,
    })

    const rows = this.db
      .prepare(
        `
      SELECT
        content,
        distance
      FROM vec_items
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT 5
    `
      )
      .all(new Float32Array(queryEmbedding))

    return rows.map((row: any) => row.content)
  }

  async store(content: string): Promise<void> {
    const chunks = chunkText(content)

    for (const chunk of chunks) {
      const embedding = await this.model.embeddings({
        input: chunk,
      })

      const insertStmt = this.db.prepare(
        "INSERT INTO vec_items(content, embedding) VALUES (?, ?)"
      )

      insertStmt.run(chunk, new Float32Array(embedding))
    }
  }
}
