import { FileStorage } from "@/common/storage"

type ReplicateInput = {
  aspect_ratio: string
  extra_lora_scale: number
  go_fast: boolean
  guidance_scale: number
  lora_scale: number
  megapixels: string
  model: string
  num_inference_steps: number
  num_outputs: number
  output_format: string
  output_quality: number
  prompt: string
  prompt_strength: number
  replicate_weights?: string
}

type ReplicateUrls = {
  cancel: string
  get: string
  stream: string
}

type ReplicateResponse = {
  id: string
  model: string
  version: string
  input: ReplicateInput
  logs: string
  output: string
  data_removed: boolean
  error: string | null
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled"
  created_at: string
  urls: ReplicateUrls
}

export const replicateAPICall = async ({
  prompt,
  model,
  numOutputs = 1,
  outputFormat = "webp",
}: {
  prompt: string
  model: string
  numOutputs: number
  outputFormat?: "webp" | "png"
}) => {
  const token = process.env.REPLICATE_API_TOKEN
  if (!token) {
    throw new Error("REPLICATE_API_TOKEN is not set")
  }

  const response = await fetch(
    `https://api.replicate.com/v1/models/${model}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          go_fast: false,
          lora_scale: 0.82,
          megapixels: "1",
          num_outputs: numOutputs,
          aspect_ratio: "1:1",
          output_format: outputFormat,
          guidance_scale: 2.5,
          output_quality: 80,
          prompt_strength: 0.8,
          extra_lora_scale: 1,
          num_inference_steps: 28,
        },
      }),
    }
  )

  const data = (await response.json()) as ReplicateResponse
  if (!data.output) {
    throw new Error("No output from replicate")
  }
  return [data.output]
}

export const replicateRunAndSave = async ({
  prompt,
  model,
  storage,
  numOutputs = 1,
  outputFormat = "webp",
}: {
  prompt: string
  model: string
  storage: FileStorage
  numOutputs: number
  outputFormat?: "webp" | "png"
}) => {
  const imageUrls = await replicateAPICall({
    prompt,
    model,
    numOutputs,
    outputFormat,
  })

  const storedUrls = await Promise.all(
    imageUrls.map((url) => storage.upload(url))
  )

  return storedUrls
}
