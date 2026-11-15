# The Polybar environment for pnpm verify and pnpm render: Polybar on i3,
# on Xvfb. ubuntu:24.04 ships Polybar 3.7.1, ubuntu:26.04 Polybar 3.7.2.
ARG BASE=ubuntu:26.04
FROM ${BASE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      polybar i3-wm xvfb xterm hsetroot imagemagick fonts-jetbrains-mono ca-certificates \
 && rm -rf /var/lib/apt/lists/*
