/* @__PURE__ */ import { ethers } from "ethers"
import { signAndBroadcastSafeTransaction } from "./safe"
import { GrpcEthereumSignerClient } from "./grpcEthereumSignerClient"
import { Wallet } from "ethers"
import { SigningKey } from "../generated/proto/key_pool"
export enum TransactionMode {
  SAFE_TEE = "safe_tee",
  PRIVATE_KEY = "private_key",
  GRPC_PK = "grpc_pk",
}

export interface SafeSignerConfig {
  type: TransactionMode.SAFE_TEE
  rpcUrl?: string
  safeAddress: string
  deployerProxy?: string
  grpcEthClientUrl?: string
  bearerToken?: string
  ssl?: boolean
}

export interface GrpcPKSignerConfig {
  type: TransactionMode.GRPC_PK
  rpcUrl: string
  grpcEthClientUrl?: string
  bearerToken?: string
  ssl?: boolean
}

export interface PrivateKeySignerConfig {
  type: TransactionMode.PRIVATE_KEY
  rpcUrl: string
  privateKey: string
}

export class SAFSigner {
  transactionOrigin: TransactionMode
  privateKey?: string
  rpcUrl?: string
  safeAddress?: string
  deployerProxy?: string
  grpcEthClient?: GrpcEthereumSignerClient

  constructor(
    config: SafeSignerConfig | PrivateKeySignerConfig | GrpcPKSignerConfig
  ) {
    if (config.type === TransactionMode.SAFE_TEE) {
      this.transactionOrigin = TransactionMode.SAFE_TEE
      this.rpcUrl = config.rpcUrl
      this.safeAddress = config.safeAddress
      this.deployerProxy = config.deployerProxy
      this.grpcEthClient = new GrpcEthereumSignerClient(
        config.grpcEthClientUrl,
        config.bearerToken,
        config.ssl
      )
    } else if (config.type === TransactionMode.PRIVATE_KEY) {
      this.transactionOrigin = TransactionMode.PRIVATE_KEY
      this.rpcUrl = config.rpcUrl
      this.privateKey = config.privateKey
    } else if (config.type === TransactionMode.GRPC_PK) {
      this.transactionOrigin = TransactionMode.GRPC_PK
      this.rpcUrl = config.rpcUrl
      this.grpcEthClient = new GrpcEthereumSignerClient(
        config.grpcEthClientUrl,
        config.bearerToken,
        config.ssl
      )
    } else {
      throw new Error("Invalid transaction mode")
    }
  }

  async signMessage(
    message: string,
    signingKeyIndex?: number
  ): Promise<string> {
    if (this.transactionOrigin === TransactionMode.PRIVATE_KEY) {
      if (!this.privateKey) {
        throw new Error("Missing PRIVATE_KEY in SAFSigner")
      }
      const wallet = new Wallet(this.privateKey)
      return wallet.signMessage(message)
    } else {
      if (!this.grpcEthClient) {
        throw new Error("GrpcEthereumSignerClient is not initialized")
      }
      if (!signingKeyIndex) {
        throw new Error("signingKeyIndex is not initialized")
      }
      const signingKey: SigningKey = {
        keyIndex: signingKeyIndex,
      }
      return this.grpcEthClient.signMessage(message, signingKey)
    }
  }

  async getWalletAddress(signingKeyIndex?: number): Promise<string> {
    if (
      this.transactionOrigin === TransactionMode.GRPC_PK ||
      this.transactionOrigin === TransactionMode.SAFE_TEE
    ) {
      if (!this.grpcEthClient) {
        throw new Error("GrpcEthereumSignerClient is not initialized")
      }
      if (!signingKeyIndex) {
        throw new Error("signingKeyIndex is not initialized")
      }
      const signingKey: SigningKey = {
        keyIndex: signingKeyIndex,
      }
      return await this.grpcEthClient.getAddress(signingKey)
    } else {
      if (!this.rpcUrl) {
        throw new Error("Missing RPC_URL in SAFSigner")
      }
      if (!this.privateKey) {
        throw new Error("Missing PRIVATE_KEY in SAFSigner")
      }
      const provider = new ethers.JsonRpcProvider(this.rpcUrl)
      const wallet = new ethers.Wallet(this.privateKey, provider)
      return wallet.address
    }
  }

  async signTransactionAndBroadcast({
    to,
    data,
    value = "0",
    signingKeyIndex,
  }: {
    to: string
    data: string
    value?: string
    signingKeyIndex?: number
  }): Promise<any> {
    if (this.transactionOrigin === TransactionMode.SAFE_TEE) {
      if (!this.grpcEthClient) {
        throw new Error("GrpcEthereumSignerClient is not initialized")
      }
      if (!this.safeAddress) {
        throw new Error("Safe address is not initialized")
      }
      if (!this.rpcUrl) {
        throw new Error("RPC URL is not initialized")
      }
      if (!signingKeyIndex) {
        throw new Error("signingKeyIndex is not initialized")
      }
      const signingKey: SigningKey = {
        keyIndex: signingKeyIndex,
      }
      return signAndBroadcastSafeTransaction({
        to,
        value,
        data,
        grpcClient: this.grpcEthClient,
        safeAddress: this.safeAddress,
        deployerProxy: this.deployerProxy,
        rpcUrl: this.rpcUrl,
        signingKey,
      })
    } else if (this.transactionOrigin === TransactionMode.PRIVATE_KEY) {
      return this.signAndBroadcastPKTransaction(to, data, value)
    } else if (this.transactionOrigin === TransactionMode.GRPC_PK) {
      if (!signingKeyIndex) {
        throw new Error("signingKeyIndex is not initialized")
      }
      if (!this.rpcUrl) {
        throw new Error("RPC URL is not initialized")
      }
      if (!this.grpcEthClient) {
        throw new Error("GrpcEthereumSignerClient is not initialized")
      }

      const signingKey: SigningKey = {
        keyIndex: signingKeyIndex,
      }

      const provider = new ethers.JsonRpcProvider(this.rpcUrl)

      const walletAddress = await this.getWalletAddress(signingKeyIndex)

      const rlpEncoded2 = await this.encodeRawTransactionBytes(
        walletAddress,
        to,
        data,
        value
      )

      const signedTxBytes = await this.grpcEthClient.signTransaction(
        hexToUint8Array(rlpEncoded2),
        signingKey
      )

      const signedTxHex =
        "0x" +
        Array.from(signedTxBytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")

      const response = await provider.broadcastTransaction(signedTxHex)

      return response.hash
    }
  }

  private async encodeRawTransactionBytes(
    signerAddress: string,
    to: string,
    data: string,
    value: string
  ): Promise<string> {
    if (!this.rpcUrl) {
      throw new Error("Missing RPC_URL in SAFSigner")
    }
    const provider = new ethers.JsonRpcProvider(this.rpcUrl)

    const nonce = await provider.getTransactionCount(signerAddress)
    const feeData = await provider.getFeeData()
    const chainId = (await provider.getNetwork()).chainId

    const rawTxFields = [
      nonce === 0 ? new Uint8Array([]) : ethers.getBytes(ethers.toBeHex(nonce)), //nonce
      ethers.getBytes(
        ethers.toBeHex(feeData.gasPrice || ethers.parseUnits("10", "gwei")) //gasPrice
      ),
      ethers.getBytes(ethers.toBeHex(100000)), // 100k gas limit
      ethers.getBytes(to),
      ethers.getBytes(value),
      ethers.getBytes(data),
      ethers.getBytes(ethers.toBeHex(chainId)),
      new Uint8Array([]), // r
      new Uint8Array([]), // s
    ]
    return ethers.encodeRlp(rawTxFields)
  }
  private async signAndBroadcastPKTransaction(
    to: string,
    data: string,
    value = "0"
  ): Promise<any> {
    if (!this.rpcUrl) {
      throw new Error("Missing RPC_URL in SAFSigner")
    }

    if (!this.privateKey) {
      throw new Error("Missing PRIVATE_KEY in SAFSigner")
    }

    const provider = new ethers.JsonRpcProvider(this.rpcUrl)
    const wallet = new ethers.Wallet(this.privateKey, provider)

    const tx = await wallet.sendTransaction({
      to,
      data,
      value: value,
    })

    const receipt = await tx.wait()
    return receipt
  }

  private async executePrivateKeySwap(
    to: string,
    data: string,
    value = "0"
  ): Promise<any> {
    if (!this.rpcUrl) {
      throw new Error("Missing RPC_URL in SAFSigner")
    }

    if (!this.privateKey) {
      throw new Error("Missing PRIVATE_KEY in SAFSigner")
    }

    const provider = new ethers.JsonRpcProvider(this.rpcUrl)
    const wallet = new ethers.Wallet(this.privateKey, provider)

    const tx = await wallet.sendTransaction({
      to,
      data,
      value: value,
    })

    const receipt = await tx.wait()
    return receipt
  }
}

function padToEven(hex: string): string {
  return hex.length % 2 === 0 ? hex : "0" + hex
}

function numberToHex(value: number): string {
  const hex = value.toString(16)
  return "0x" + padToEven(hex)
}

function hexToUint8Array(hexString: string): Uint8Array {
  // Remove '0x' prefix if present
  hexString = hexString.startsWith("0x") ? hexString.slice(2) : hexString

  // Ensure even length
  if (hexString.length % 2 !== 0) {
    throw new Error("Hex string must have an even number of characters")
  }

  const bytes = new Uint8Array(hexString.length / 2)

  for (let i = 0; i < hexString.length; i += 2) {
    bytes[i / 2] = parseInt(hexString.slice(i, i + 2), 16)
  }

  return bytes
}
