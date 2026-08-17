# cache-safe-injection — impossible here

slim's tag-strip-reappend trick, keeping volatile content in the tail message so the prompt prefix stays byte-stable.

**Why not.** It requires mutating the outgoing message array via `experimental.chat.messages.transform`. Claude Code exposes no equivalent hook — there is no interception point between conversation history and the bytes sent.

**What survives:** the discipline. Volatile content goes only into freshly-appended hook output, never into anything re-sent as stable history.
