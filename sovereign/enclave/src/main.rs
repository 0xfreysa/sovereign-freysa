//! This crate contains code to run a pool of sovereign key pools running inside
//! trusted execution environments (TEE) with the following properties:
//! - all sovereigns in the pool share a secret (key material)
//! - the first sovereign to start generates its own secret
//! - subsequent sovereigns run the key sync protocol with an existing sovereign to fetch the secret
//! - sovereign' code, and the instance they run on, is authorized by a governance committee inside a Safe smart contract
//! - currently, only AWS Nitro Enclaves are supported, but the code is prepared for supporting additional TEE variants, such as TDX

use anyhow::{anyhow, bail, Context, Result};
use clap::Parser;
use elliptic_curve::rand_core::{self};
use http::full;
use hyper::{Request, StatusCode};
use secmod::{AttestationDocument, Secmod};
use serde_bytes::ByteBuf;
use std::{future::Future, pin::Pin, sync::Arc, time::Instant};

mod config;
mod grpc;
mod http;
mod key_server;
mod key_sync;
mod monitoring;
mod safe;
mod secmod;

#[cfg(feature = "nsm")]
mod nsm;

#[cfg(feature = "test-utils")]
mod mock_secmod;

use config::{SecretKeyRetrieval, SovereignConfig};

use key_server::{KeyServer, SecretKeyMaterial};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(long, help = "Configuration for sovereign as a JSON string")]
    config: Option<String>,
}

/// See `sovereign_main` for further information.
fn main() {
    // Parse command-line arguments
    let args = Args::parse();

    // Handle sovereign configuration
    let config: SovereignConfig = {
        if let Some(config_str) = args.config {
            match serde_json::from_str(&config_str) {
                Ok(config) => config,
                Err(e) => {
                    tracing::error!("unable to parse configuration: {}", e);
                    std::process::exit(1);
                }
            }
        } else {
            eprintln!("no config provided; exiting...");
            std::process::exit(1);
        }
    };
    let trace_level = match config.trace_level {
        0 => tracing::Level::TRACE,
        1 => tracing::Level::DEBUG,
        2 => tracing::Level::INFO,
        3 => tracing::Level::WARN,
        4 => tracing::Level::ERROR,
        _ => tracing::Level::INFO, // default to INFO for unknown values
    };
    tracing_subscriber::fmt()
        .with_target(false)
        .with_file(true)
        .with_line_number(true)
        .with_max_level(trace_level)
        .init();

    #[cfg(feature = "nsm")]
    type MainSecmod = nsm::Nsm;

    #[cfg(all(not(feature = "nsm"), feature = "test-utils"))]
    type MainSecmod = mock_secmod::MockSecmod;

    #[cfg(any(feature = "nsm", feature = "test-utils"))]
    {
        tracing::info!("starting sovereign...");

        let result = sovereign_main::<MainSecmod>(config);

        if let Err(e) = result {
            tracing::error!("fatal error: {}", e);
            std::process::exit(1);
        }
    }

    #[cfg(all(not(feature = "nsm"), not(feature = "test-utils")))]
    {
        eprintln!("no security module configured; exiting");
        std::process::exit(1);
    }
}

#[tokio::main]
pub async fn sovereign_main<SM: Secmod + 'static>(config: SovereignConfig) -> Result<()> {
    config.validate()?;

    // TODO: this is needed for something - don't remember what...
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|e| anyhow!("failed to install rustls crypto provider: {:?}", e))?;

    tracing::info!("initializing attestor...");
    let attestor = SM::init_attestor()?;

    // Generate or retrieve secret key material for this new sovereign according to the configuration.
    let secret_key_material = match config.secret_keys_from {
        SecretKeyRetrieval::Generate(num_keys) => {
            tracing::info!("generating {} secret keys...", num_keys);
            SecretKeyMaterial::generate_random(num_keys, &mut rand_core::OsRng)?
        }
        SecretKeyRetrieval::KeySync(port) => {
            tracing::info!("retreiving secret key material from VSOCK {}...", port);
            let mut stream = SM::connect(port).await?;
            tracing::debug!("connected accepted on VSOCK {}...", port);
            let key_material = key_sync::serve_follower_key_sync::<SM, _>(
                &attestor,
                &config.governance,
                &mut stream,
            )
            .await?;
            // TODO: consider not using JSON here. Just receive the raw bytes?
            let secret_key_material: SecretKeyMaterial = serde_json::from_slice(&key_material)?;
            tracing::info!("secret key material received");
            secret_key_material
        }
    };

    // Create the full state from the config and the secret key material.
    let state = KeyServer::new(attestor, config, secret_key_material)?;

    // Extend the PCR values with the public keys corresponding to the secret key material.
    // TODO: consider using a Merkle tree of public keys so that any public key can be verified.
    // Or, even better, use key-derivation instead of multiple keys...
    let measurements = vec![
        state.cert_public_key_der.to_vec(),
        state.pairs[0].public_key.to_sec1_bytes().to_vec(),
        state.pairs[1].public_key.to_sec1_bytes().to_vec(),
        serde_json::to_vec(&state.config)?,
    ];
    SM::measure_enclave(&state.attestor, measurements)?;

    // Wrap inside an Arc as it needs to be shared between multiple async threads.
    // Not ideal, but still looking for a better solution...
    let state = Arc::new(state);

    // Local alias to state.config.
    let config = &state.config;

    let server_config = {
        let certificate_der = state.cert.der().clone();
        let cert_chain = vec![certificate_der];
        let builder = rustls::ServerConfig::builder();
        builder
            .with_no_client_auth()
            .with_single_cert(cert_chain, state.cert_secret_key_der.clone_key())
            .context("failed to create TLS config")?
    };
    let tls_acceptor =
        Arc::new(tokio_rustls::TlsAcceptor::from(std::sync::Arc::new(server_config)));
    tracing::debug!("https configured");

    let grpc_future = {
        use grpc::pb::key_pool_service_server::KeyPoolServiceServer;
        use grpc::SignerServiceImpl;
        use tonic_reflection::server::Builder;

        // Create the service
        let signer = SignerServiceImpl { key: state.clone() };
        // Wrap the service
        let svc = KeyPoolServiceServer::new(signer);

        let file_descriptor_set: &[u8] = include_bytes!("descriptor.bin");

        let reflection_service = Builder::configure()
            .register_encoded_file_descriptor_set(file_descriptor_set)
            .build_v1()?;

        let state = state.clone();
        let router = tonic::transport::Server::builder()
            .layer(monitoring::MetricsLayer { metrics: state.metrics.clone() })
            .add_service(reflection_service)
            .add_service(svc);
        match &config.grpc_config {
            config::GrpcConfig::UnixDomainSocket(uds_path) => {
                tracing::info!("Starting gRPC server on UDS: {}", uds_path);
                use tokio::net::UnixListener;
                use tokio_stream::wrappers::UnixListenerStream;
                // Remove existing socket file if it exists
                let _ = std::fs::remove_file(uds_path);
                // Create a UnixListener
                let unix_listener = UnixListener::bind(uds_path)?;
                // Create a stream from the listener
                let incoming = UnixListenerStream::new(unix_listener);
                // Code below is duplicated as `incoming` in the two branches do not
                // have a common type, despite both being valid arguments to `serve_with_incoming`.
                tokio::spawn(async move { router.serve_with_incoming(incoming).await })
            }
            config::GrpcConfig::Vsock(vsock_listen_port) => {
                tracing::info!("Starting gRPC server on VSOCK port: {}", vsock_listen_port);
                // NOTE: we're not using SM::listen here as then we switch between TCP and VSOCK
                // instead of UDS and VSOCK.
                let vsock_addr =
                    tokio_vsock::VsockAddr::new(tokio_vsock::VMADDR_CID_ANY, *vsock_listen_port);
                let vsock_listener = tokio_vsock::VsockListener::bind(vsock_addr)?;
                let incoming = VsockListenerStream { inner: vsock_listener };
                // Code below is duplicated as `incoming` in the two branches do not
                // have a common type, despite both being valid arguments to `serve_with_incoming`.
                tokio::spawn(async move { router.serve_with_incoming(incoming).await })
            }
        }
    };

    // Serve key-sync requests using custom protocol.
    let key_sync_fn: ConnectionHandler<SM::Stream, Arc<KeyServer<SM>>> =
        Arc::new(|mut stream, state: Arc<KeyServer<SM>>| {
            Box::pin(async move {
                let time_start = Instant::now();
                let result = key_sync::serve_leader_key_sync::<SM, _>(
                    &state.attestor,
                    &state.config.governance,
                    // TODO: consider not using JSON here. Just send the raw bytes?
                    &serde_json::to_vec(&state.extract_secret_key_material())?,
                    &mut stream,
                )
                .await;
                let status = match result {
                    Ok(()) => "Ok",
                    Err(e) => {
                        tracing::error!("key-sync (leader) error: {}", e);
                        "Failed"
                    }
                };
                let elapsed = time_start.elapsed().as_secs_f64();
                state
                    .metrics
                    .stream_request_duration_seconds
                    .with_label_values(&["key-sync", "leader_key_sync", status])
                    .observe(elapsed);
                Ok(())
            })
        });
    let key_sync: Option<HostAcceptor<SM, Arc<KeyServer<SM>>>> = config.key_sync_port.map(|port| {
        HostAcceptor { protocol: "key-sync", method: "leader_key_sync", port, handler: key_sync_fn }
    });

    // Serve prometheus monitoring using http.
    let monitoring: Option<HostAcceptor<SM, Arc<KeyServer<SM>>>> = config
        .monitoring_port
        .map(|port| HostAcceptor::http("monitoring", port, serve_metrics::<SM>));

    // Serve attestation using http.
    let http_attestation: Option<HostAcceptor<SM, Arc<KeyServer<SM>>>> = config
        .http_attestation_port
        .map(|port| HostAcceptor::http("attestation", port, serve_attestation::<SM>));

    // Serve attestation using https.
    let https_attestation_fn: ConnectionHandler<SM::Stream, Arc<KeyServer<SM>>> =
        Arc::new(move |stream, state: Arc<KeyServer<SM>>| {
            // Move the tls_acceptor into the https accept thread.
            let tls_acceptor = tls_acceptor.clone();
            Box::pin(async move {
                match tls_acceptor.accept(stream).await {
                    Ok(tls_stream) => {
                        let io = hyper_util::rt::TokioIo::new(tls_stream);
                        http::serve_http_connection::<SM, _, _, _>(io, move |x| {
                            HostAcceptor::wrap_monitoring(
                                "https",
                                "attestation",
                                serve_attestation::<SM>,
                            )(state.clone(), x)
                        })
                        .await?;
                    }
                    Err(e) => {
                        tracing::error!("TLS accept error: {}", e.to_string());
                    }
                }
                Ok(())
            })
        });
    let https_attestation: Option<HostAcceptor<SM, Arc<KeyServer<SM>>>> =
        config.https_attestation_port.map(|port| HostAcceptor {
            protocol: "https",
            method: "attestation",
            port,
            handler: https_attestation_fn,
        });

    let host_acceptors = HostAcceptors::<SM, Arc<KeyServer<SM>>> {
        // Collect all values that are not-none (i.e., some).
        connections: vec![key_sync, monitoring, http_attestation, https_attestation]
            .into_iter()
            .flatten()
            .collect(),
    };

    host_acceptors.do_listen(state).await?;

    let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(60));
    let heartbeat_future = async {
        loop {
            heartbeat.tick().await;
            tracing::debug!("heartbeat: server is alive");
        }
    };

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("received Ctrl-C, shutting down...");
        }
        res = grpc_future => {
            match res {
                Ok(Err(e)) => tracing::error!("gRPC server error: {}", e),
                Ok(Ok(())) => tracing::error!("gRPC server terminated without error"),
                Err(e) => tracing::error!("gRPC join error: {}", e)
            }
        }
        _ = heartbeat_future => {}
    }

    Ok(())
}

// Wrap a VSOCK listener in a stream to make it 'tonic' compatible.
struct VsockListenerStream {
    inner: tokio_vsock::VsockListener,
}

impl futures::Stream for VsockListenerStream {
    type Item = Result<VsockStreamConnected, std::io::Error>;

    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        // Use Pin projection to access inner field
        let inner = &self.inner;
        match futures::ready!(inner.poll_accept(cx)) {
            Ok((stream, _addr)) => std::task::Poll::Ready(Some(Ok(VsockStreamConnected(stream)))),
            Err(e) => std::task::Poll::Ready(Some(Err(e))),
        }
    }
}

struct VsockStreamConnected(tokio_vsock::VsockStream);

impl tonic::transport::server::Connected for VsockStreamConnected {
    /// The connection info type the IO resources generates.
    // all these bounds are necessary to set this as a request extension
    type ConnectInfo = Option<tokio_vsock::VsockAddr>;

    /// Create type holding information about the connection.
    fn connect_info(&self) -> Self::ConnectInfo {
        match self.0.peer_addr() {
            Ok(peer) => Some(peer),
            Err(e) => {
                tracing::warn!("connect_info error; continuing without: {}", e);
                None
            }
        }
    }
}

impl tokio::io::AsyncRead for VsockStreamConnected {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        Pin::new(&mut self.0).poll_read(cx, buf)
    }
}

impl tokio::io::AsyncWrite for VsockStreamConnected {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::result::Result<usize, std::io::Error>> {
        Pin::new(&mut self.0).poll_write(cx, buf)
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::result::Result<(), std::io::Error>> {
        Pin::new(&mut self.0).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::result::Result<(), std::io::Error>> {
        Pin::new(&mut self.0).poll_shutdown(cx)
    }
}

async fn serve_metrics<SM: Secmod>(
    state: Arc<KeyServer<SM>>,
    _request: hyper::Request<hyper::body::Incoming>,
) -> Result<hyper::Response<http_body_util::Full<hyper::body::Bytes>>> {
    use prometheus::Encoder;

    // Gather all metrics
    let metric_families = state.metrics.registry.gather();

    // Create a text encoder
    let encoder = prometheus::TextEncoder::new();

    // Encode metrics to text format
    let mut buffer = String::new();
    encoder.encode_utf8(&metric_families, &mut buffer)?;

    tracing::debug!("retrieving metrics: {}", buffer);

    let response = hyper::Response::builder()
        .status(200)
        .header("Content-Type", encoder.format_type())
        .body(full(buffer))
        .unwrap();
    Ok(response)
}

async fn serve_attestation<SM: Secmod>(
    state: Arc<KeyServer<SM>>,
    request: hyper::Request<hyper::body::Incoming>,
) -> Result<hyper::Response<http_body_util::Full<hyper::body::Bytes>>> {
    let (parts, _body) = request.into_parts();
    let uri = parts.uri;
    let method = parts.method;
    tracing::info!("Received request: {} {}", method, uri);
    match (&method, uri.path()) {
        (&hyper::Method::GET, "/") => {
            let query = uri.query();
            let get_query_param = |param: &str| -> Result<Option<ByteBuf>> {
                match http::get_query_param(query, param) {
                    Some(x) => Ok(Some(ByteBuf::from(hex::decode(x)?))),
                    None => Ok(None),
                }
            };
            let nonce = get_query_param("nonce")?;
            let public_key = get_query_param("public-key")?;
            let user_data = get_query_param("user-data")?;
            let att = SM::new_attestation(&state.attestor, nonce, public_key, user_data)?;
            http::encode_with_encoding(att, &uri)
        }
        _ => bail!("invalid request"),
    }
}

type ConnectionHandler<Stream, State> = Arc<
    dyn Fn(Stream, State) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send>>
        + Send
        + Sync
        + 'static,
>;

struct HostAcceptor<SM: Secmod, State> {
    protocol: &'static str,
    method: &'static str,
    port: u32,
    handler: ConnectionHandler<SM::Stream, State>,
}

impl<SM: Secmod + 'static> HostAcceptor<SM, Arc<KeyServer<SM>>> {
    fn wrap_monitoring<F, S>(
        protocol: &'static str,
        method: &'static str,
        service: F,
    ) -> impl Fn(
        Arc<KeyServer<SM>>,
        Request<hyper::body::Incoming>,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<hyper::Response<http_body_util::Full<hyper::body::Bytes>>>,
                > + Send,
        >,
    > + Send
           + Sync
           + Clone
           + 'static
    where
        F: 'static
            + Clone
            + Send
            + Sync
            + Fn(Arc<KeyServer<SM>>, Request<hyper::body::Incoming>) -> S,
        S: 'static
            + Send
            + Future<Output = Result<hyper::Response<http_body_util::Full<hyper::body::Bytes>>>>,
    {
        move |state: Arc<KeyServer<SM>>, request| {
            let service = service.clone();
            Box::pin(async move {
                let time_start = Instant::now();
                let response = service(state.clone(), request).await?;
                let status = response.status();
                let status_str = format!("{:?}", status);
                let elapsed = time_start.elapsed().as_secs_f64();
                state
                    .metrics
                    .stream_request_duration_seconds
                    .with_label_values(&[protocol, method, &status_str])
                    .observe(elapsed);
                Ok(response)
            })
        }
    }

    fn http<F, S>(method: &'static str, port: u32, service: F) -> Self
    where
        F: 'static
            + Clone
            + Send
            + Sync
            + Fn(Arc<KeyServer<SM>>, Request<hyper::body::Incoming>) -> S,
        S: 'static
            + Send
            + Future<Output = Result<hyper::Response<http_body_util::Full<hyper::body::Bytes>>>>,
    {
        let protocol = "http";
        let handler = Arc::new(move |stream, state: Arc<KeyServer<SM>>| {
            let state = state.clone();
            let service = Self::wrap_monitoring("http", method, service.clone());
            Box::pin(async move {
                let time_start = Instant::now();
                let service_state = state.clone();
                let io = hyper_util::rt::TokioIo::new(stream);
                let builder = hyper::server::conn::http1::Builder::new();
                let service_fn = hyper::service::service_fn(move |x| {
                    let service = service.clone();
                    let service_state = service_state.clone();
                    async move {
                        let resp = service(service_state.clone(), x).await.unwrap_or_else(|e| {
                            http::error_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                        });
                        let status = resp.status();
                        let status_str = format!("{:?}", status);
                        let elapsed = time_start.elapsed().as_secs_f64();
                        service_state
                            .metrics
                            .stream_request_duration_seconds
                            .with_label_values(&[protocol, method, &status_str])
                            .observe(elapsed);
                        Ok::<_, hyper::Error>(resp)
                    }
                });
                builder.serve_connection(io, service_fn).await.map_err(anyhow::Error::from)
            }) as Pin<Box<dyn Future<Output = Result<(), anyhow::Error>> + Send>>
        });
        HostAcceptor { protocol, method, port, handler }
    }
}

struct HostAcceptors<SM: Secmod, State> {
    connections: Vec<HostAcceptor<SM, State>>,
}

impl<SM: Secmod + 'static, State: Clone + Send + 'static> HostAcceptors<SM, State> {
    pub fn log_if_error<F>(
        service: F,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>
    where
        F: 'static + Send + Future<Output = Result<()>>,
    {
        Box::pin(async move {
            match service.await {
                Ok(()) => (),
                Err(e) => tracing::error!("error: {}", e.to_string()),
            }
        })
    }

    /// Start listening to all connections on their specified port,
    /// using the specified connection handler and then start a loop on the
    /// current thread that accepts connections and serves them.
    pub async fn do_listen(self, state: State) -> Result<()> {
        for HostAcceptor { protocol, method, port, handler } in self.connections.into_iter() {
            let listener = SM::listen(port).await?;
            tracing::info!("serving {} (protocol {}) on VSOCK port {}", method, protocol, port);
            let state = state.clone();
            // handle each listener in a separate task
            tokio::spawn(async move {
                let state = state.clone();
                //let handler = handler.clone();
                loop {
                    let state = state.clone();
                    let handler = handler.clone();
                    match SM::accept(&listener).await {
                        Ok(stream) => {
                            // Handle stream in separate task.
                            tracing::debug!("starting stream handling connection on {}", port);
                            tokio::spawn(Self::log_if_error(handler(stream, state)));
                        }
                        Err(e) => tracing::error!("accept: {}", e.to_string()),
                    }
                }
            });
        }
        Ok(())
    }
}

#[cfg(all(test, feature = "test-utils"))]
mod tests {

    use mock_secmod::MockSecmod;

    use super::*;

    #[test]
    fn test_secret_key_material_roundtrip() -> Result<()> {
        let secret = SecretKeyMaterial::generate_random(&mut rand_core::OsRng)?;
        let attestor = MockSecmod::init_attestor()?;
        let config = SovereignConfig::default();
        let state = KeyServer::<MockSecmod>::new(attestor, config.clone(), secret.clone())?;
        let secret2 = state.extract_secret_key_material();
        assert!(secret == secret2);
        assert!(state.config == config);
        Ok(())
    }
}
