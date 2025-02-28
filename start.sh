#!/bin/sh

# -----------------------------------------------------------------------------
# DESCRIPTION.
#
# This script runs inside the enclave.
#
# Compare the script run_enclave.sh which prepares the host and starts the
# enclave. Many of the commands in this script corresponds with commands in
# run_enclave.sh.
#
# NOTES ON THE USE OF TAP.
#
# The enclave network uses a /31 subnet (10.0.0.0/31) which provides two usable IPs:
# - 10.0.0.0: host side of the TAP interface
# - 10.0.0.1: enclave side of the TAP interface
# This is a point-to-point link between the host and enclave.
# -----------------------------------------------------------------------------



# -----------------------------------------------------------------------------
# DEFINITIONS.
# -----------------------------------------------------------------------------

# Specify '', '-d', '-d -d', or '-d -d -d' for increasing log levels for socat.
# Only useful in debug mode as the output is written to the enclave's console, 
# i.e., not visible on the host.
SOCAT_OPTIONS=''

# TAP port: bridge VSOCK:$TAP_PORT to tap interface tap0.
# Must match the corresponding port in the host's 'run_enclave.sh'.
# If not specified in environment it defaults to 12345.
# TAP_PORT=${TAP_PORT:-12345}

# Configuration port: the host will send the configuration to this VSOCK
# port once the enclave has started.
# Must match the corresponding port in the host's 'run_enclave.sh'.
# If not specified in environment it defaults to 72345 (leet `Freys`).
CONFIG_PORT=${CONFIG_PORT:-72345}

# Port on which setup.sh sends logging information to the host.
SETUP_LOGGING_PORT=${SETUP_LOGGING_PORT:-7777}

# Log to the host - so that logging is visible also for production enclaves.
log_to_host() {
    echo "$(date -Iseconds): $1" | socat -u $SOCAT_OPTIONS STDIN VSOCK-CONNECT:3:$SETUP_LOGGING_PORT
}

# Log a list of running processes.
log_processes() {
    local ps_output
    ps_output=$(ps ax)
    if [ -n "$ps_output" ]; then
        log_to_host "active processes:$'\n'$ps_output"
    else
        log_to_host "no processes found"
    fi
}



# -----------------------------------------------------------------------------
# STEP 0. Cleanup environment and cleanup on error.
# -----------------------------------------------------------------------------


# Give time to attach a console
STARTUP_SLEEP=3
log_to_host "sleeping $STARTUP_SLEEP to allow for a console to attach (to debug config errors)"
sleep $STARTUP_SLEEP

# Everything happens inside the 'app' folder.
cd /app



# -----------------------------------------------------------------------------
# STEP 1: Get configuration
# -----------------------------------------------------------------------------

log_to_host "requesting configuration from host on VSOCK port $CONFIG_PORT"

# See https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-concepts.html
# "The CID used by the parent instance is always 3."
# NOTE: for some reason, this fails with log levels lower than '-d -d'.
socat -u -d -d VSOCK-CONNECT:3:$CONFIG_PORT STDOUT > config.json || {
    log_to_host "ERROR: failed to connect to host for configuration"
    exit 1
}

log_to_host "configuration received"

# Verify that we got something...
if ! [ -s config.json ]; then
    log_to_host "ERROR: failed to receive configuration"
    exit 1
fi

# Check that config file is valid JSON.
if ! jq empty config.json >/dev/null 2>&1; then
    log_to_host "ERROR: configuration is not valid JSON"
    exit 1
fi

# Extract logging ports from config
SOVEREIGN_STDOUT=$(jq '.logging.sovereign.stdout' config.json)
AGENT_STDOUT=$(jq '.logging.agent.stdout' config.json)



# -----------------------------------------------------------------------------
# STEP 2: Setup networking
# -----------------------------------------------------------------------------

# mkdir -p /run/resolvconf
# echo "nameserver 1.1.1.1" > /run/resolvconf/resolv.conf
# ip link set lo up
# log_to_host "start 'dnsmasq' with nameserver 1.1.1.1"
# dnsmasq &

# log_to_host "configure TAP "
# socat $SOCAT_OPTIONS VSOCK-CONNECT:3:$TAP_PORT TUN:10.0.0.1/31,tun-type=tap,up &
# log_to_host "started socat TUN/TAP device 'tap0' on VSOCK port $TAP_PORT"

# Wait up to 5 seconds for TAP interface to appear
# for i in $(seq 0 50); do
#     if [ $i -eq 50 ]; then
#         log_to_host "ERROR: timeout waiting for TAP interface 'tap0' to appear"
#         exit 1
#     fi
#     if ip link show tap0 >/dev/null 2>&1; then
#         log_to_host "TAP interface 'tap0' is up"
#         break
#     fi
#     sleep 0.1
# done

# ip route add default via 10.0.0.0 dev tap0
# log_to_host "added default route to 10.0.0.0 (host)"



# -----------------------------------------------------------------------------
# STEP 3: Start binaries
# -----------------------------------------------------------------------------

# ls -l ./enclave
# ldd ./enclave
# file ./enclave
# ls -l /lib

# Start enclave with output redirection
# Note: the -u option to socat makes it unidirectional.
./enclave --config="$(jq '.sovereign' config.json)" 2>&1 | socat -u $SOCAT_OPTIONS STDIN VSOCK-CONNECT:3:$SOVEREIGN_STDOUT &
log_to_host "sovereign binary started"

# Extract agent configuration and set environment variables
# while IFS=': ' read -r key value; do
#     # Remove quotes, convert to uppercase
#     key=$(echo "$key" | tr -d '"' | tr '[:lower:]' '[:upper:]')
#     value=$(echo "$value" | tr -d '"')
#     export "$key"="$value"
#     log_to_host "setting environment variable $key=$value"
# done < <(jq -r '.agent | to_entries | .[] | "\(.key): \(.value)"' config.json)

# Start agent with output redirection
# node dist/server.js 2>&1 | socat -u $SOCAT_OPTIONS STDIN VSOCK-CONNECT:3:$AGENT_STDOUT &
# log_to_host "agent binary started"

log_to_host "enclave startup complete"

# if [ "$(jq -r '."debug-mode"' config.json)" = "true" ]; then
#     log_to_host "network connectivity tests"
    
#     log_to_host "request to https://1.1.1.1:443 to check TAP connectivity"
#     echo -e "GET /help/ HTTP/1.1\r\nHost: one.one.one.one\r\n\r\n" | socat $SOCAT_OPTIONS STDIO OPENSSL:1.1.1.1:443,verify=0,no-sni=1 | grep "HTTP/1.1"

#     log_to_host "request to https://one.one.one.one:443 to check TAP connectivity"
#     echo -e "GET /help/ HTTP/1.1\r\nHost: one.one.one.one\r\n\r\n" | socat $SOCAT_OPTIONS STDIO OPENSSL:one.one.one.one:443,verify=0,no-sni=1 | grep "HTTP/1.1"
# fi

# Start a background heartbeat process
(
    while true; do
        log_to_host "heartbeat from start script"
        sleep 60
    done
) &
heartbeat_pid=$!

log_processes
# Loop waiting.
while true; do
    log_to_host "monitoring background processes..."

    # Wait for any process to finish
    wait -n
    exit_code=$?
    
    log_to_host "process exited with code $exit_code"
    log_processes
    
    # If all sub-processes are gone, exit
    if ! ps -o pid= --ppid $$ | grep -v "^$heartbeat_pid$" | grep -q .; then
        log_to_host "no remaining processes, shutting down (last exit code: $exit_code)"
        kill $heartbeat_pid  # Clean up heartbeat process
        exit $exit_code
    fi
    
    log_to_host "some processes still running, continuing monitoring"
done