FROM docker.io/library/alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a AS vendor
RUN apk add --no-cache bash curl
WORKDIR /src
COPY scripts/fetch_vendor_assets.sh scripts/
RUN bash scripts/fetch_vendor_assets.sh

FROM docker.io/library/golang:1.27-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS server
WORKDIR /src
COPY server/go.mod server/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server .

FROM scratch
COPY --from=server /out/server /server
COPY --chown=65532:65532 index.html manifest.json sw.js /srv/
COPY --chown=65532:65532 icons /srv/icons
COPY --chown=65532:65532 app /srv/app
COPY --from=vendor --chown=65532:65532 /src/vendor /srv/vendor
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/server"]
