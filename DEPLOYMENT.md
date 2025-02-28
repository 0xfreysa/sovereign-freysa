# Deployment instructions

## Starting enclaves

The first enclave needs to generate keys. The argument `.secret-keys-from.generate` specifies the number of keys to generate. The port numbers and the `safe` configuration can be left as in the example below.

> WARNING: it is important to set `debug-mode` to `false` for a production enclave.

```json
{
  "debug-mode" : false,
  "logging" : {
    "sovereign" : {
      "stdout" : 54321
    },
    "agent" : {
      "stdout" : 54320
    }
  },
  "sovereign" : {
    "grpc-config": {
      "vsock" : 50555
    },
    "secret-keys-from": {
      "generate": 50000
    },
    "governance": {
      "safe": {
        "wallet-address": "0xb4D537b3A15a20be34657DFe6b976aFA3B8b18c7",
        "threshold": 1,
        "http-endpoint": "https://safe-transaction-sepolia.safe.global:443/api/v1/messages",
        "http-endpoint-port": 50000,
        "chain-id": 11155111
      }
    },
    "key-sync-port" : 50001,
    "monitoring-port" : 50051,
    "http-attestation-port" : 58080,
    "https-attestation-port": 58443,
    "alt-names" : [],
    "trace-level" : 1
  },
  "agent" : {}
}
```

Subsequent enclaves use `secret-keys-from.key-sync` with port `55995`, i.e.,

```json
    "secret-keys-from": {
      "key-sync": 55995
    },
```

When using this option, the environment variable `KEY_SYNC_IP` must be set to the IP address of an enclave from which the keys will be retrieved.

### Upgrading all enclaves

Once started, all enclaves are equal. Thus, to upgrade all enclaves to a new version, all enclaves should have key-sync configured and have `KEY_SYNC_IP` point to another enclave. Here a ring configuration can be used, e.g., `A -> B -> C -> ... -> A`, or for two enclaves simply `A -> B -> A`. With this setup, the two commands

```sh
nitro-cli terminate-enclave --all
bash run_enclave.sh
```

can be run to restart each enclave (folder `/home/ec2-user/sovereign-freysa`).

## Using Nginx for authentication

### Installation

Run `sudo yum install nginx`.

### Configuration

After editing the configuration, you need to restart nginx using `sudo systemctl restart nginx`.

#### Sample configuration

> WARNING: without SSL, this configuration is not suitable for production use.

```nginx
server {
    # Bind to all interfaces
    listen 0.0.0.0:4000;
    http2 on;

    # Ensure proper content type handling for gRPC
    grpc_set_header Content-Type application/grpc;

    large_client_header_buffers 4 64k;

    location / {
        auth_request /auth;
        grpc_pass grpc://localhost:50555;

        grpc_set_header Host $host;
        grpc_set_header X-Real-IP $remote_addr;

        # Add gRPC specific settings
        grpc_read_timeout 1h;
        grpc_send_timeout 1h;
    }

    location = /auth {
        internal;
        if ($http_authorization != "Bearer your-expected-token") {
            return 401;
        }
    return 204;
    }
}
```

## Communicating with running enclaves

Define the enclave to communicate with.

```sh
export ENCLAVE_IP=127.0.0.1
```

Example commands

```sh
grpcurl -H "Authorization: Bearer your-expected-token" -d '{"hash_function": "HASH_FUNCTION_KECCAK256", "message": "'"$(echo -n "ec098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a764000080018080" | xxd -r -p | base64)"'"}' -plaintext $ENCLAVE_IP:4000 key_pool.KeyPoolService.SignMessage
```

```sh
grpcurl -H "Authorization: Bearer your-expected-token" -d '{"hash_function": "HASH_FUNCTION_KECCAK256", "message": "'"$(echo -n "ec098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a764000080018080" | xxd -r -p | base64)"'"}' -plaintext $ENCLAVE_IP:4000 key_pool.KeyPoolService.SignMessage
```

## Enclave logging

The script `run_enclave.sh` creates several log files. Most of them are output from `socat` proxies which are not interesting unless there is a specific connection issue to debug.

The two important log files are:

- `start.log` which contains the output of the script `start.sh` which is started inside the enclave;
- `sovereign.log` which contains the logging of the Rust binary running inside the enclave.

Using `tail -f start.log sovereign.log` is an easy way to see what's going on.

> WARNING: the script `run_enclave.sh` just keeps appending to the log files, so for extended production use, some form of log trunction must be implemented.