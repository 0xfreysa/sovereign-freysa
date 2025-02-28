#!/bin/bash

# TODO: deal with 'alt-names'
# PUBLIC_HOSTNAME=$(ec2-metadata -p | cut -d: -f2 | xargs)
# PUBLIC_IP=$(ec2-metadata -v | cut -d: -f2 | xargs)
# LOCAL_HOSTNAME=$(ec2-metadata -h | cut -d: -f2 | xargs)
# LOCAL_IP=$(ec2-metadata -o | cut -d: -f2 | xargs)

# -----------------------------------------------------------------------------
# DESCRIPTION.
#
# This script will start enclave.eif and associated services.
#
# NOTES ON THE USE OF TAP.
#
# The enclave network uses a /31 subnet (10.0.0.0/31) which provides two usable IPs:
# - 10.0.0.0: host side of the TAP interface
# - 10.0.0.1: enclave side of the TAP interface
# This is a point-to-point link between the host and enclave.
# -----------------------------------------------------------------------------

# Check if any enclave is already running.
if [ "$(nitro-cli describe-enclaves | jq -r 'length')" != "0" ]; then
    echo "$(date -Iseconds): ERROR: enclave already running; run 'nitro-cli terminate-enclave --all' to stop it."
    exit 1
fi



# -----------------------------------------------------------------------------
# DEFINITIONS.
# -----------------------------------------------------------------------------

# These options are passed to `nitro-cli run-enclave`. Note that debug mode is
# selected in the config file.

# TODO: enclave.eif should not be in the sovereign folder.
ENCLAVE_OPTIONS='--eif-path enclave.eif --cpu-count 2 --memory 2048'

if [ "$(jq -r '."debug-mode"' config.json)" = "true" ]; then
    ENCLAVE_OPTIONS="$ENCLAVE_OPTIONS --debug-mode"
    echo "$(date -Iseconds): DEBUG MODE IN CONFIG - will add flag '--debug-mode' when starting enclave"
fi

# Specify '', '-d', '-d -d', or '-d -d -d' for increasing log levels for socat.
SOCAT_OPTIONS='-d -d'

# TAP port: the host will bridge VSOCK-LISTEN:$TAP_PORT to tap interface tap0.
# Must match the corresponding port in the enclave's 'start.sh'.
# If not specified in environment it defaults to 12345.
# TAP_PORT=${TAP_PORT:-12345}

# Configuration port: the host will send the configuration to this VSOCK
# port once the enclave has started.
# Must match the corresponding port in the enclave's 'start.sh'.
# If not specified in environment it defaults to 72345 (leet `Freys`).
CONFIG_PORT=${CONFIG_PORT:-72345}

# VSOCK port on which setup.sh sends logging information to the host.
SETUP_LOGGING_PORT=${SETUP_LOGGING_PORT:-7777}

# Function to start a proxy using socat
start_proxy() {
    local listen_spec="$1"
    local connect_spec="$2"
    local description="$3"

    local listen_port=${listen_spec#*:}  # Extract port number after colon
    listen_port=${listen_port%,*}        # Remove any options after port
    if ss -ln | grep -q ":$listen_port[[:space:]]"; then
        echo "$(date -Iseconds): ERROR: $description: port $listen_port is in use"
        exit 1
    fi

    socat $SOCAT_OPTIONS -lf "socat_$description.log" "$listen_spec" "$connect_spec" &
    disown -h $!
    echo "$(date -Iseconds): started proxy: $listen_spec -> $connect_spec; see socat_$description.log"
}

# The logger listens (once) to the specified port and appends to
# the specified file.
start_logger() {
    local vsock_port="$1"
    local log_file="$2"
    socat -u $SOCAT_OPTIONS -lf socat_$log_file VSOCK-LISTEN:$vsock_port OPEN:$log_file,creat,append,wronly &
    disown -h $!
    echo "$(date -Iseconds): started logger: VSOCK:$vsock_port -> $log_file; see socat_$log_file for socat messages"
}



# -----------------------------------------------------------------------------
# STEP 0. Cleanup environment and cleanup on error.
# -----------------------------------------------------------------------------

# Clean up background processes on script error
trap 'echo "$(date -Iseconds): ERROR: cleaning up background processes"; kill $(jobs -p) 2>/dev/null' ERR
trap 'echo "$(date -Iseconds): received interrupt, cleaning up"; kill $(jobs -p) 2>/dev/null; exit 1' INT

# Make ERR trap more aggressive
set -o errexit  # Exit on error
set -o pipefail # Exit on pipe error

echo "$(date -Iseconds): cleaning up any existing socat processes..."
sudo killall -q socat || true



# -----------------------------------------------------------------------------
# STEP 1. Prepare for starting the enclave.
# -----------------------------------------------------------------------------

# Check that config file is valid JSON.
if ! jq empty config.json >/dev/null 2>&1; then
    echo "$(date -Iseconds): ERROR: config.json is not valid JSON"
    exit 1
fi

# Extract information from the config file.
SAFE_PORT=$(jq '.sovereign.governance.safe."http-endpoint-port" // empty' config.json)
SAFE_HTTP_ENDPOINT=$(jq -r '.sovereign.governance.safe."http-endpoint" // empty' config.json)
HTTP_ATTESTATION_PORT=$(jq '.sovereign."http-attestation-port" // empty' config.json)
HTTPS_ATTESTATION_PORT=$(jq '.sovereign."https-attestation-port" // empty' config.json)
KEY_SYNC_PORT=$(jq '.sovereign."key-sync-port" // empty' config.json)
MONITORING_PORT=$(jq '.sovereign."monitoring-port" // empty' config.json)
GRPC_PORT=$(jq -r '.sovereign."grpc-config".vsock // empty' config.json)

# Recreate and configure TAP interface
# echo "$(date -Iseconds): delete existing tap0 interface"
# sudo ip link delete tap0 2>/dev/null || true
# echo "$(date -Iseconds): creating TAP interface 'tap0'"
# sudo ip tuntap add dev tap0 mode tap
# sudo ip addr add 10.0.0.0/31 dev tap0
# sudo ip link set tap0 up
# echo "$(date -Iseconds): TAP interface 'tap0' is up"

# Reset default policy
# sudo iptables -P FORWARD DROP
# Established and related connections - always safe to add once
# if ! sudo iptables -C FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null; then
#     sudo iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# fi
# Specific port forwarding and MASQUERADE rules for inbound internet access to the enclave.
# for PORT in 3002; do
#     # Remove existing rules first
#     sudo iptables -t nat -D PREROUTING -p tcp --dport $PORT -j DNAT --to-destination 10.0.0.1:$PORT 2>/dev/null || true
#     sudo iptables -t nat -D POSTROUTING -p tcp -d 10.0.0.1 --dport $PORT -j MASQUERADE 2>/dev/null || true

#     # Add rules
#     sudo iptables -t nat -A PREROUTING -p tcp --dport $PORT -j DNAT --to-destination 10.0.0.1:$PORT
#     sudo iptables -t nat -A POSTROUTING -p tcp -d 10.0.0.1 --dport $PORT -j MASQUERADE
#     echo "$(date -Iseconds): added DNAT and MASQUERADE rules for port $PORT"
# done
# echo "$(date -Iseconds): done setup global iptables rules"

# Get the main network interface that provides internet connectivity.
# On AWS EC2 this is typically 'ens5' but we detect it automatically by
# checking which interface would be used to reach an internet address (1.1.1.1).
# MAIN_IF=$(ip route get 1.1.1.1 | awk '{print $5; exit}')
# echo "$(date -Iseconds): main network interface is $MAIN_IF"

# Remove any existing tap0-specific rules
# sudo iptables -D FORWARD -i tap0 -o $MAIN_IF -j ACCEPT 2>/dev/null || true
# sudo iptables -D FORWARD -i tap0 -o $MAIN_IF -s 10.0.0.0/31 -j ACCEPT 2>/dev/null || true
# sudo iptables -t nat -D POSTROUTING -s 10.0.0.0/31 -o $MAIN_IF -j MASQUERADE 2>/dev/null || true

# Add tap0-specific rules
# sudo iptables -A FORWARD -i tap0 -o $MAIN_IF -s 10.0.0.0/31 -j ACCEPT
# sudo iptables -A FORWARD -i tap0 -o $MAIN_IF -j ACCEPT
# sudo iptables -t nat -A POSTROUTING -s 10.0.0.0/31 -o $MAIN_IF -j MASQUERADE

# echo "$(date -Iseconds): setup tap0-specific iptables rules"

# Start the TAP-VSOCK bridge
# if ss -H -l | grep -q "v_str.*:.*$TAP_PORT"; then
#     echo "$(date -Iseconds): ERROR: VSOCK port $TAP_PORT is already in use"
#     sudo ss -lptn | grep $TAP_PORT
#     exit 1
# fi
# Must run with sudo to be able to configure the tap0 interface.
# sudo socat $SOCAT_OPTIONS -lf socat_tap.log VSOCK-LISTEN:$TAP_PORT,fork,reuseaddr TUN,tun-device=/dev/net/tun,tun-name=tap0,tun-type=tap &
# Make the previous pipeline ignore SIGHUP so it survices shell termination
# disown -h $!
# echo "$(date -Iseconds): started socat TUN/TAP device 'tap0' on VSOCK port $TAP_PORT: see socat_tap.log"

# SAFE proxy setup
# Creates a reverse proxy from enclave's SAFE port to external SAFE endpoint
if [ -n "$SAFE_PORT" ] && [ -n "$SAFE_HTTP_ENDPOINT" ]; then
    SAFE_HOST=$(echo "$SAFE_HTTP_ENDPOINT" | sed 's|https://||' | sed 's|/.*||')
    start_proxy "VSOCK-LISTEN:$SAFE_PORT,reuseaddr,fork" "TCP:$SAFE_HOST" "safe"
fi

# Start loggers for each component and stream type
# for component in sovereign agent; do
for component in sovereign; do
    port=$(jq ".logging.$component.stdout" config.json)
    if [ -z "$port" ]; then
        echo "$(date -Iseconds): ERROR: no port configured for $component"
        exit 1
    fi
    start_logger "$port" "${component}.log"
done

# If the config file includes a key sync with a remote server, setup the necessary proxy.
KEY_SYNC_CONNECT_PORT=$(jq -r '.sovereign."secret-keys-from" | if type == "object" then ."key-sync" // empty else empty end' config.json)
if [ -n "$KEY_SYNC_CONNECT_PORT" ]; then
    if [ -z "$KEY_SYNC_IP" ]; then 
        echo "$(date -Iseconds): ERROR: required environment variable KEY_SYNC_IP not set, but key-sync requested in config.json"
        exit 1
    fi
    # This assumes that both enclaves are configured with the same KEY_SYNC_PORT (which is the listen port for key-sync requests)
    start_proxy "VSOCK-LISTEN:$KEY_SYNC_CONNECT_PORT" "TCP:$KEY_SYNC_IP:$KEY_SYNC_PORT" "key_sync_remote"
fi

# Start config listener that will serve config.json when enclave requests it
cat config.json | socat $SOCAT_OPTIONS -U -lf socat_config.log "VSOCK-LISTEN:$CONFIG_PORT" STDIN &
echo "$(date -Iseconds): started config server on VSOCK port $CONFIG_PORT: see socat_config.log"

# Logging from start.sh.
socat -u $SOCAT_OPTIONS -lf socat_start.log VSOCK-LISTEN:$SETUP_LOGGING_PORT,reuseaddr,fork OPEN:start.log,creat,append,wronly &
disown -h $!
echo "$(date -Iseconds): started listener on VSOCK port $SETUP_LOGGING_PORT for messages from start script: see start.log"



# -----------------------------------------------------------------------------
# STEP 2. Start the enclave.
# -----------------------------------------------------------------------------

# Start enclave. Will run `start.sh` inside the enclave.
if ! nitro-cli run-enclave $ENCLAVE_OPTIONS > enclave_stdout.log 2> enclave_stderr.log; then
    echo "$(date -Iseconds): ERROR: failed to start enclave"
    cat enclave_stderr.log
    exit 1
fi

# Check if we got the expected JSON output containing EnclaveCID
if ! CID=$(jq -r '.EnclaveCID' enclave_stdout.log); then
    echo "$(date -Iseconds): ERROR: failed to get EnclaveCID from output:"
    cat enclave_stdout.log
    exit 1
fi

echo "$(date -Iseconds): successfully started enclave with CID: $CID"



# -----------------------------------------------------------------------------
# STEP 3. Start "incoming" proxies that may connect to the enclave once it has
# been configured.
# -----------------------------------------------------------------------------

# HTTP attestation proxy setup
# Listens on 8080 and forwards to enclave's HTTP attestation port
if [ -n "$HTTP_ATTESTATION_PORT" ]; then
    start_proxy "TCP-LISTEN:8080,reuseaddr,fork" "VSOCK-CONNECT:$CID:$HTTP_ATTESTATION_PORT" "http_attestation"
fi

# HTTPS attestation proxy setup
# Listens on 8443 and forwards to enclave's HTTPS attestation port
if [ -n "$HTTPS_ATTESTATION_PORT" ]; then
    start_proxy "TCP-LISTEN:8443,reuseaddr,fork" "VSOCK-CONNECT:$CID:$HTTPS_ATTESTATION_PORT" "https_attestation"
fi

# Key sync proxy setup
# Listens on KEY_SYNC_PORT and forwards to enclave's VSOCK KEY_SYNC_PORT.
if [ -n "$KEY_SYNC_PORT" ]; then
    start_proxy "TCP-LISTEN:$KEY_SYNC_PORT,reuseaddr,fork" "VSOCK-CONNECT:$CID:$KEY_SYNC_PORT" "key_sync"
fi

# Monitoring proxy setup
# Listens on MONITORING_PORT and forwards to enclave's VSOCK MONITORING_PORT.
if [ -n "$MONITORING_PORT" ]; then
    start_proxy "TCP-LISTEN:$MONITORING_PORT,reuseaddr,fork" "VSOCK-CONNECT:$CID:$MONITORING_PORT" "monitoring"
fi

# gRPC proxy setup.
# Listens on port GRPC_PORT and forwards to enclave's VSOCK GRPC_PORT.
if [ -n "$GRPC_PORT" ]; then
    start_proxy "TCP-LISTEN:$GRPC_PORT,reuseaddr,fork" "VSOCK-CONNECT:$CID:$GRPC_PORT" "grpc"
fi
