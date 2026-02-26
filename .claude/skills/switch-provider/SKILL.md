---
name: switch-provider
description: Switch Claude Code provider (Bedrock, Vertex, Ollama, LiteLLM, Anthropic API). Modifies .env file to change the active provider configuration. Triggers on "switch provider", "change provider", "use bedrock", "use vertex", "use ollama", "use litellm", "use anthropic".
---

# Switch Claude Code Provider

Interactive script that detects the current provider from `.env` and lets the user switch between AWS Bedrock, Google Vertex AI, Ollama, LiteLLM, and Anthropic API (direct).

## Usage

Run the script interactively:

```bash
bash switch-claude-provider.sh
```

This will:
1. Display the current provider configuration read from `.env`
2. Present a menu of available providers
3. Prompt for provider-specific settings (region, model, API key, etc.)
4. Update `.env` with the new provider configuration (removing old provider keys first)
5. Display the updated configuration

## Non-Interactive Usage

If the user specifies which provider they want (e.g., "switch to Bedrock" or "use Vertex") and all values are known (no API key needed, or it's already in `.env`), you can edit `.env` directly — but **NEVER read, display, or log API key values**. Use the Edit tool to change only the non-secret keys.

**SECURITY**: If the provider requires an API key (Anthropic direct, LiteLLM with a real key), always run the interactive script (`bash switch-claude-provider.sh`) so the user can enter the key via silent `read -s` in the terminal. Do NOT ask the user to paste API keys into the chat, and do NOT use Read/Edit tools on `.env` lines containing `ANTHROPIC_API_KEY` values.

For providers that don't need a secret key (Bedrock uses IAM, Vertex uses gcloud, Ollama uses a dummy key):

1. Read `.env` to see current non-secret config
2. Remove provider-related keys (except leave `ANTHROPIC_API_KEY` removal to the script if a real key exists)
3. Add the new provider keys (see Provider Configs below)
4. Preserve any non-provider keys (e.g., `ASSISTANT_NAME`, `CLAUDE_CODE_OAUTH_TOKEN`)

## Provider Configs

### AWS Bedrock
```
CLAUDE_CODE_USE_BEDROCK=1
AWS_REGION=us-west-2
AWS_DEFAULT_REGION=us-west-2
AWS_PROFILE=default
ANTHROPIC_MODEL=us.anthropic.claude-opus-4-6-v1
ANTHROPIC_DEFAULT_HAIKU_MODEL=us.anthropic.claude-haiku-4-5-20251001
ANTHROPIC_SMALL_FAST_MODEL=us.anthropic.claude-haiku-4-5-20251001
```

### Google Vertex AI
```
CLAUDE_CODE_USE_VERTEX=1
CLOUD_ML_PROJECT_ID=<project-id>
CLOUD_ML_REGION=us-central1
ANTHROPIC_MODEL=claude-opus-4-6-v1
ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5-20251001
```

### Ollama (local)
```
ANTHROPIC_BASE_URL=http://localhost:11434
ANTHROPIC_API_KEY=ollama
ANTHROPIC_MODEL=gpt-oss:20b
ANTHROPIC_DEFAULT_HAIKU_MODEL=gpt-oss:20b
ANTHROPIC_SMALL_FAST_MODEL=gpt-oss:20b
```

### LiteLLM (proxy)
```
ANTHROPIC_BASE_URL=https://litellm-prod.engineering-ai.amwayglobal.com
ANTHROPIC_API_KEY=lm-studio
ANTHROPIC_MODEL=claude-opus
ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-sonnet
ANTHROPIC_SMALL_FAST_MODEL=claude-haiku
```

### Anthropic API (direct)
```
ANTHROPIC_API_KEY=<api-key>
ANTHROPIC_MODEL=claude-opus-4-6-v1
ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5-20251001
```

## After Switching

Remind the user that G2 needs a restart for `.env` changes to take effect. Suggest using `/restart`.
