import { Tool, ToolSchema, InferSchemaType } from "@/common/tools"
import { replicateRunAndSave } from "./replicate"
import {
  FileStorageConfig,
  FileStorage,
  FileStorageFactory,
} from "@/common/storage"

const schema = {
  type: "function",
  function: {
    name: "replicate_image_generation",
    description: "Generate image based on prompt instruction",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Description of what kind of image should be generated",
        },
      },
      required: ["prompt"],
    },
  },
} as const satisfies ToolSchema

type ReplicateInput = InferSchemaType<typeof schema>

export class ReplicateImageGenerationTool implements Tool<ReplicateInput> {
  name = schema.function.name
  schema = schema
  private model: string
  private numOutputs: number
  private storage: FileStorage
  private includeUrls: boolean

  constructor({
    model,
    storageConfig,
    numOutputs = 1,
    includeUrls = false,
  }: {
    model: string
    storageConfig: FileStorageConfig
    numOutputs?: number
    includeUrls?: boolean
  }) {
    this.model = model
    this.numOutputs = numOutputs
    this.includeUrls = includeUrls
    this.storage = FileStorageFactory.create(storageConfig)
  }

  execute = async (input: ReplicateInput) => {
    const storedUrls = await replicateRunAndSave({
      prompt: input.prompt,
      model: this.model as
        | `${string}/${string}`
        | `${string}/${string}:${string}`,
      numOutputs: this.numOutputs,
      storage: this.storage,
    })

    if (this.includeUrls) {
      return storedUrls.join(",")
    }

    return `Generated ${storedUrls.length} images at ${this.storage.getLocation()}.`
  }
}
