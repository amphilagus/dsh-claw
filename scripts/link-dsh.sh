#!/usr/bin/env bash
# Recreate the @deepseek-ai symlinks under node_modules/ that the DSH checkout
# provides for typecheck/tests. Run after `pnpm install` wiped node_modules.
# Assumes the DSH checkout sits at ../deepseek-harness.
set -euo pipefail
cd "$(dirname "$0")/.."
H=../../../deepseek-harness
mkdir -p node_modules/@deepseek-ai

ln -sfn "$H/vendor/cordis" node_modules/@deepseek-ai/cordis
ln -sfn "$H/packages/core/agent" node_modules/@deepseek-ai/dsh-agent
ln -sfn "$H/packages/core/agent-loop" node_modules/@deepseek-ai/dsh-agent-loop
ln -sfn "$H/packages/test-support/agent-loop-testkit" node_modules/@deepseek-ai/dsh-agent-loop-testkit
ln -sfn "$H/packages/util/home-paths" node_modules/@deepseek-ai/dsh-home-paths
ln -sfn "$H/packages/runtime-diagnostics/invariants" node_modules/@deepseek-ai/dsh-invariants
ln -sfn "$H/packages/llm/llm" node_modules/@deepseek-ai/dsh-llm
ln -sfn "$H/packages/sandbox/sandbox" node_modules/@deepseek-ai/dsh-sandbox
ln -sfn "$H/packages/sandbox/sandbox-local" node_modules/@deepseek-ai/dsh-sandbox-local
ln -sfn "$H/packages/core/session" node_modules/@deepseek-ai/dsh-session
ln -sfn "$H/packages/core/system-prompt" node_modules/@deepseek-ai/dsh-system-prompt
ln -sfn "$H/packages/core/tools" node_modules/@deepseek-ai/dsh-tools

echo "links ready"
