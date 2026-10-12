# cadre live-smoke harness: Claude Code pinned (CLAUDE_VERSION) + bd + git + bwrap + tmux, non-root.
# Build: docker build -t cadre-harness harness            (installs Claude Code from the official installer)
# Fast path: put a local binary named claude-<CLAUDE_VERSION> in harness/ and it is used instead (must match the image arch).
FROM node:22-bookworm-slim
ARG CLAUDE_VERSION=2.1.295
RUN apt-get update && apt-get install -y --no-install-recommends git bubblewrap socat curl ca-certificates python3 procps iproute2 golang-go cargo tmux \
    && rm -rf /var/lib/apt/lists/*
RUN npm i -g @beads/bd && bd version
# VIA=ccr runs (ccr-up.sh): the router version real users run in front of Claude Code
RUN npm i -g @musistudio/claude-code-router@3.0.22 && ccr --help >/dev/null
# Dockerfile always matches the glob, so the COPY succeeds with or without a local binary
COPY Dockerfile claude-${CLAUDE_VERSION}* /tmp/ctx/
RUN set -e; mkdir -p /opt/claude; \
    if [ -f /tmp/ctx/claude-${CLAUDE_VERSION} ]; then cp /tmp/ctx/claude-${CLAUDE_VERSION} /opt/claude/claude; \
    else HOME=/tmp/inst curl -fsSL https://claude.ai/install.sh | HOME=/tmp/inst bash -s "${CLAUDE_VERSION}" \
      && cp "$(readlink -f /tmp/inst/.local/bin/claude)" /opt/claude/claude; fi; \
    chmod 755 /opt/claude/claude && ln -s /opt/claude/claude /usr/local/bin/claude; rm -rf /tmp/ctx /tmp/inst; \
    claude --version | grep -q "${CLAUDE_VERSION}"
# non-root; run.sh passes --user <hostuid>:<hostgid> so the mounted credentials file is readable
RUN mkdir -p /cchome/.claude /work /out && chmod -R 777 /cchome /work /out
LABEL cadre.harness.home=/cchome
ENV HOME=/cchome DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_AUTOUPDATE=1 BD_NON_INTERACTIVE=1
WORKDIR /work
ENTRYPOINT ["claude"]
