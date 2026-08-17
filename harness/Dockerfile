FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      tmux git ca-certificates procps jq \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code@2.1.212

# Claude Code refuses --dangerously-skip-permissions as root, and the e2e gate
# test needs writes to actually execute rather than park on a prompt. The `node`
# base image already ships uid 1000; reuse it.
RUN mkdir -p /home/node/.claude /project && chown -R node:node /home/node /project
COPY seed.sh /usr/local/bin/seed.sh
RUN chmod +x /usr/local/bin/seed.sh

USER node
ENV HOME=/home/node
WORKDIR /project
ENTRYPOINT ["/bin/bash"]
