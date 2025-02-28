import { Memory } from "@/common/memory"
import { TModel } from "@/common/models"
import { Driver, driver, auth } from "neo4j-driver"

export type MemoryData = {
  sourceName: string
  memoryDate: string
  dataContent: string
  authorName: string
}

export class Neo4jMemory implements Memory {
  version = "1"
  driverInstance: Driver
  model: TModel

  constructor(model: TModel) {
    if (
      !process.env.NEO4J_URI ||
      !process.env.NEO4J_USER ||
      !process.env.NEO4J_PASSWORD
    ) {
      throw new Error("NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD must be set")
    }

    this.driverInstance = driver(
      process.env.NEO4J_URI,
      auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    )
    this.model = model
  }

  private async vectorSearch(
    searchQuery: string
  ): Promise<{ content: string; relatedContents: string }[]> {
    const session = this.driverInstance.session()
    try {
      const queryEmbedding = await this.model.embeddings({
        input: searchQuery,
      })

      let cypher = `
          CALL db.index.vector.queryNodes('data_embedding', 10, $queryEmbedding)
          YIELD node, score
          WITH node, score
          MATCH (node)-[:PART_OF|NEXT_CHUNK|CREATED_BY|SOURCED_FROM]-(relatedNode:Data)
          WHERE relatedNode <> node
          WITH node, score, collect(DISTINCT relatedNode) AS relatedNodes
          RETURN node.content AS content, score,
                 [n IN relatedNodes | n.content] AS relatedContents
          ORDER BY score DESC
          LIMIT 10
          `

      const result = await session.run(cypher, {
        queryEmbedding: queryEmbedding,
      })

      return result.records.map((record) => ({
        content: record.get("content") as string,
        relatedContents: record.get("relatedContents") as string,
      }))
    } finally {
      await session.close()
    }
  }

  async search(query: string): Promise<string[]> {
    const searches = await this.vectorSearch(query)
    const context = searches.flatMap((s) => {
      const mainContent = s.content
      const relatedContents = s.relatedContents || []
      return [mainContent, ...relatedContents]
    })

    return context
  }

  async store(content: string): Promise<void> {
    try {
      const parsedContent: MemoryData = JSON.parse(content)
      const session = this.driverInstance.session()

      try {
        await session.executeWrite(async (tx) => {
          const query = `
                  MERGE (s:Source {name: $sourceName})
                  MERGE (m:Memory {originally_created_at: $memoryDate, source: $sourceName, author: $authorName})
                  MERGE (d:Data {content: $dataContent})
                  MERGE (a:Author {name: $authorName, source: $sourceName})
                  MERGE (m)-[:SOURCED_FROM]->(s)
                  MERGE (a)-[:CREATES_ON]->(s)
                  MERGE (d)-[:PART_OF]->(m)
                  MERGE (m)-[:CREATED_BY]->(a)
                  MERGE (d)-[:CREATED_BY]->(a)
                  RETURN d
                `

          await tx.run(query, parsedContent)
        })
      } finally {
        await session.close()
      }
    } catch (error) {
      console.error("Error storing data:", error)
      throw error
    }
  }
}
