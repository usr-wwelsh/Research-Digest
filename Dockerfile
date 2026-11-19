FROM docker.io/library/alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf AS vendor
RUN apk add --no-cache bash curl
WORKDIR /src
COPY scripts/fetch_vendor_assets.sh scripts/
RUN bash scripts/fetch_vendor_assets.sh

FROM docker.io/library/node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS bundle
WORKDIR /src/app
COPY app/package.json app/package-lock.json app/vendor-entry.js ./
RUN npm ci --ignore-scripts && npm run build:vendor

FROM docker.io/library/golang:1.27-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS server
WORKDIR /src
COPY server/go.mod server/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server .

FROM scratch
COPY --from=server /out/server /server
COPY --chown=65532:65532 index.html manifest.json sw.js /srv/
COPY --chown=65532:65532 icons /srv/icons
COPY --chown=65532:65532 app /srv/app
COPY --from=bundle --chown=65532:65532 /src/app/vendor/transformers.min.js /srv/app/vendor/transformers.min.js
COPY --from=vendor --chown=65532:65532 /src/vendor /srv/vendor
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/server"]
