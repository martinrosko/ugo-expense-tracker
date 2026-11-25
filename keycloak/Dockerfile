# syntax=docker/dockerfile:1
# Keycloak built once for Postgres so it starts in production mode with --optimized
FROM quay.io/keycloak/keycloak:26.2 AS builder
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.2
COPY --from=builder /opt/keycloak/ /opt/keycloak/
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
