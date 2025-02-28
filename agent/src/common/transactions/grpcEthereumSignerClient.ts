import {
  SignMessageRequest,
  SignEthereumTransactionRequest,
  GetEthereumAddressRequest,
  SigningKey,
  HashFunction,
  KeyPoolServiceClient,
} from "../generated/proto/key_pool"
import { credentials, Metadata } from "@grpc/grpc-js"

export class GrpcEthereumSignerClient {
  private client: KeyPoolServiceClient
  private bearerToken?: string

  constructor(
    grpcServerUrl: string = "unix:///tmp/enclave.sock",
    bearerToken?: string,
    ssl: boolean = true
  ) {
    this.client = new KeyPoolServiceClient(
      grpcServerUrl,
      ssl ? credentials.createSsl() : credentials.createInsecure()
    )
    this.bearerToken = bearerToken
  }

  async signMessage(message: string, signingKey: SigningKey): Promise<string> {
    const request: SignMessageRequest = {
      signingKey: signingKey,
      hashFunction: HashFunction.HASH_FUNCTION_KECCAK256,
      message: Buffer.from(message),
    }
    const metadata = new Metadata()
    if (this.bearerToken)
      metadata.add("authorization", `Bearer ${this.bearerToken}`)

    return new Promise<string>((resolve, reject) => {
      this.client.signMessage(request, metadata, (error, response) => {
        if (error) {
          return reject(error)
        }
        if (response.signature) {
          const signatureHex =
            "0x" + Buffer.from(response.signature).toString("hex")
          resolve(signatureHex)
        } else {
          reject(new Error("Unknown error"))
        }
      })
    })
  }

  async signTransaction(
    txData: Uint8Array,
    signingKey: SigningKey
  ): Promise<Uint8Array> {
    const request: SignEthereumTransactionRequest = {
      signingKey: signingKey,
      txData: Buffer.from(txData),
    }
    const metadata = new Metadata()
    if (this.bearerToken)
      metadata.add("authorization", `Bearer ${this.bearerToken}`)
    return new Promise<Uint8Array>((resolve, reject) => {
      this.client.signEthereumTransaction(
        request,
        metadata,
        (error, response) => {
          if (error) {
            return reject(error)
          }
          if (response.txData) {
            resolve(response.txData)
          } else {
            reject(new Error("Unknown error"))
          }
        }
      )
    })
  }

  async getAddress(signingKey: SigningKey): Promise<string> {
    const request: GetEthereumAddressRequest = {
      signingKey: signingKey,
    }
    const metadata = new Metadata()
    if (this.bearerToken)
      metadata.add("Authorization", `Bearer ${this.bearerToken}`)

    return new Promise<string>((resolve, reject) => {
      this.client.getEthereumAddress(request, metadata, (error, response) => {
        if (error) {
          return reject(error)
        }
        const address = response.ethereumAddress
        resolve(address.startsWith("0x") ? address : `0x${address}`)
      })
    })
  }
}
