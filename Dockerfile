FROM docker.io/library/alpine:3.22 AS vendor
RUN apk add --no-cache bash curl
WORKDIR /src
COPY scripts/fetch_vendor_assets.sh scripts/
RUN bash scripts/fetch_vendor_assets.sh

FROM docker.io/library/caddy:2.10-alpine
COPY --chown=65532:65532 Caddyfile.container /etc/caddy/Caddyfile
COPY --chown=65532:65532 index.html manifest.json sw.js /srv/
COPY --chown=65532:65532 icons /srv/icons
COPY --chown=65532:65532 app /srv/app
COPY --from=vendor --chown=65532:65532 /src/vendor /srv/vendor
RUN apk add --no-cache libcap-utils && setcap -r /usr/bin/caddy && apk del libcap-utils && rm -rf /srv/app/node_modules /srv/app/tests
ENV XDG_CONFIG_HOME=/tmp XDG_DATA_HOME=/tmp
USER 65532:65532
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
