import { replicateRunAndSave } from "../../src/common/tools/replicate/replicate"
import { FileStorageFactory } from "../../src/common/storage"
import dotenv from "dotenv"
dotenv.config()

async function test() {
  const fileStorage = FileStorageFactory.create({
    type: "s3",
    s3: {
      bucket: process.env.AWS_BUCKET_NAME!,
      region: process.env.AWS_REGION!,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      prefix: "images",
      baseUrlOverride: process.env.AWS_CLOUDFRONT_URL!,
    },
  })

  const imageUrls = await replicateRunAndSave({
    prompt: "A beautiful sunset over a calm ocean",
    model: "stability-ai/stable-diffusion-3",
    numOutputs: 1,
    outputFormat: "png",
    storage: fileStorage,
  })
  console.log(imageUrls)
}

test().catch((err) => {
  console.error(err)
  process.exit(1)
})
