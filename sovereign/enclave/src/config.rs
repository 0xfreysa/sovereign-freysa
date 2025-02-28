//! This module deals with the configuration of a sovereign running inside a TEE pool.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

/// Configuration which instructs the sovereign how to access a Safe for
/// authorizing measurements during startup and in the key-sync protocol.
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct SafeConfig {
    #[serde(rename = "wallet-address")]
    pub wallet_address: String,
    #[serde(rename = "threshold")]
    pub threshold: usize,
    #[serde(rename = "http-endpoint")]
    pub http_endpoint: String,
    #[serde(rename = "http-endpoint-port")]
    pub http_endpoint_port: u32,
    #[serde(rename = "chain-id")]
    pub chain_id: u64,
}

/// A TEE pool is governed by a Safe (Ethereum smart contract).
/// Alternatively, a testing deployment can forgo the Safe authorizations,
/// but only for sovereigns that are running in debug mode.
#[derive(PartialEq, Default, Debug, Clone, Serialize, Deserialize)]
pub enum Governance {
    /// This governance version is only available in debug mode.
    /// It simply checks that the local and remote attestation documents are showing sovereigns running in debug mode.
    #[default]
    #[serde(rename = "testing-only")]
    TestingOnly,
    /// A production sovereign should use this configuration option.
    #[serde(rename = "safe")]
    Safe(SafeConfig),
}

/// Exactly one sovereign per TEE pool should generate its own secret keys.
/// Other sovereign retrieve their secret keys using the key-sync protocol.
/// If an sovereign is configured with `KeySync(port)`, the protcol will be
/// initiated on `port` on the follower side,
/// which will connect (through a tunnel) to the leader side.
#[derive(PartialEq, Debug, Clone, Serialize, Deserialize)]
pub enum SecretKeyRetrieval {
    /// Generate this many secret keys. Must be at least 2 and maximum 100,000.
    #[serde(rename = "generate")]
    Generate(u32),
    /// Port on which to initiate key-sync.
    #[serde(rename = "key-sync")]
    KeySync(u32),
}

impl SecretKeyRetrieval {
    pub fn validate(&self) -> Result<()> {
        match self {
            SecretKeyRetrieval::KeySync(_) => Ok(()),
            SecretKeyRetrieval::Generate(num) => {
                if *num < 2 || *num > 100000 {
                    bail!("number of keys must be >= 2 and <= 100,000: was {}", num);
                } else {
                    Ok(())
                }
            }
        }
    }
}

impl Default for SecretKeyRetrieval {
    fn default() -> Self {
        Self::Generate(2)
    }
}

/// Complete configuration of the sovereign.
#[derive(PartialEq, Default, Debug, Clone, Serialize, Deserialize)]
pub struct SovereignConfig {
    #[serde(rename = "secret-keys-from")]
    pub secret_keys_from: SecretKeyRetrieval,
    /// Governance configuration: how to approve remote attestations.
    #[serde(rename = "governance")]
    pub governance: Governance,
    /// Alternative names to use for the self-signed server certificate.
    #[serde(rename = "alt-names")]
    pub alt_names: Vec<String>,
    /// Port on which to serve key-sync requests.
    #[serde(rename = "key-sync-port")]
    pub key_sync_port: Option<u32>,
    /// Port on which to serve monitoring requests.
    #[serde(rename = "monitoring-port")]
    pub monitoring_port: Option<u32>,
    /// Port on which to serve HTTP attestation requests.
    #[serde(rename = "http-attestation-port")]
    pub http_attestation_port: Option<u32>,
    /// Port on which to serve HTTPs attestation requests.
    #[serde(rename = "https-attestation-port")]
    pub https_attestation_port: Option<u32>,
    // Trace = 0, Debug = 1, Info = 2, Warn = 3, Error = 4.
    #[serde(rename = "trace-level", default)]
    pub trace_level: usize,
    // GRPC server config.
    #[serde(rename = "grpc-config", default)]
    pub grpc_config: GrpcConfig,
}

impl SovereignConfig {
    pub fn validate(&self) -> Result<()> {
        self.secret_keys_from.validate()?;
        Ok(())
    }
}

#[derive(PartialEq, Debug, Clone, Serialize, Deserialize)]
pub enum GrpcConfig {
    #[serde(rename = "unix-domain-socket")]
    UnixDomainSocket(String),
    #[serde(rename = "vsock")]
    Vsock(u32),
}

impl Default for GrpcConfig {
    fn default() -> Self {
        Self::UnixDomainSocket("/tmp/enclave.sock".into())
    }
}
