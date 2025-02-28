FROM --platform=linux/amd64 alpine:latest@sha256:21dc6063fd678b478f57c0e13f47560d0ea4eeba26dfc947b2a4f81f686b9f45

WORKDIR /app

RUN apk add --no-cache \
    nodejs=22.13.1-r0 \
    socat=1.8.0.1-r0 \
    ca-certificates=20241121-r1 \
    dnsmasq=2.90-r3 \
    jq=1.7.1-r0 \
    && rm -rf /var/cache/apk/*

COPY --from=ghcr.io/0xfreysa/sovereign-freysa-sovereign:latest  /prebuild/enclave        /app/enclave
COPY                                                            start.sh                 /app/start.sh

ARG TIMESTAMP=202501010000.00
RUN find /app -exec touch -h -t ${TIMESTAMP} {} \; \
    && find /app -type d -exec chmod 755 {} \; \
    && find /app -type f -exec chmod 644 {} \; \
    && chmod 755 /app/enclave /app/start.sh

CMD /app/start.sh
