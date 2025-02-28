#!/bin/bash

sudo dnf group install -y "Development Tools"

sudo amazon-linux-extras enable aws-nitro-enclaves-cli
sudo dnf clean metadata && sudo dnf makecache

# Pin version for reproducable .EIF files
sudo dnf install -y aws-nitro-enclaves-cli-devel-1.3.4

sudo dnf install -y socat

sudo dnf install -y docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

sudo dnf install -y aws-nitro-enclaves-cli
sudo systemctl enable nitro-enclaves-allocator.service
sudo systemctl start nitro-enclaves-allocator.service

mkdir -p bin
sudo mkdir -p /var/log/nitro_enclaves
sudo chown root:ne /var/log/nitro_enclaves
sudo chmod 775 /var/log/nitro_enclaves
sudo usermod -aG ne $USER

sudo dnf install -y openssl-devel pkgconfig
sudo dnf install -y protobuf protobuf-compiler protobuf-devel

sudo dnf install -y glibc-static
sudo dnf install -y libstdc++-static

sudo tee /etc/nitro_enclaves/allocator.yaml << 'EOF'
---
# Enclave configuration file.
#
# How much memory to allocate for enclaves (in MiB).
memory_mib: 2048
#
# How many CPUs to reserve for enclaves.
cpu_count: 2
#
# Alternatively, the exact CPUs to be reserved for the enclave can be explicitly
# configured by using `cpu_pool` (like below), instead of `cpu_count`.
# Note: cpu_count and cpu_pool conflict with each other. Only use exactly one of them.
# Example of reserving CPUs 2, 3, and 6 through 9:
# cpu_pool: 2,3,6-9
EOF

sudo systemctl restart nitro-enclaves-allocator.service

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env

sudo modprobe vhost_vsock
