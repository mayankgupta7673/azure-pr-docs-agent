# Azure Integration Doc Agent

🤖 **Automatically generate documentation for Azure integration changes**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Enterprise-ready GitHub Action that uses AI to document Azure integration changes in Logic Apps, APIM policies, Service Bus, Event Hub, Azure Functions, Bicep, and Terraform files.

## ✨ Features

- 🎯 **Multi-Event** - Works with PRs, commits, and scheduled audits
- 💰 **Cost Efficient** - Sends only diffs, not full files
- 🤖 **AI-Powered** - OpenAI or Azure OpenAI
- 📊 **Flexible** - Per-PR, centralized, or both modes
- 🔒 **Secure** - No secrets in logs, graceful failures

## 🚀 Quick Start

### 1. Add Workflow File

Create `.github/workflows/azure-docs.yml`:

```yaml
name: Azure Documentation

on:
  pull_request:
  push:
    branches: [main]

jobs:
  docs:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref || github.ref }}
          token: ${{ secrets.GITHUB_TOKEN }}
      
      - uses: your-org/azure-integration-doc-agent@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

### 2. Add API Key

**For OpenAI:**
- Get key from [platform.openai.com](https://platform.openai.com)
- Add as `OPENAI_API_KEY` in repo secrets

**For Azure OpenAI:**
- Get key from Azure Portal
- Add `AZURE_OPENAI_KEY` and `AZURE_OPENAI_ENDPOINT` secrets
- See [Azure OpenAI Setup](AZURE_OPENAI_SETUP.md)

### 3. Done! 🎉

Create a PR with Azure changes and watch the magic happen.

## ⚙️ Configuration

### Required Inputs

| Input | Description |
|-------|-------------|
| `github-token` | GitHub token (use `secrets.GITHUB_TOKEN`) |
| `openai-api-key` | OpenAI or Azure OpenAI API key |

### Common Optional Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `mode` | `pr` | `pr`, `centralized`, or `both` |
| `docs-folder` | `docs` | Where to store documentation |
| `openai-model` | `gpt-4` | Model or deployment name |
| `openai-api-endpoint` | OpenAI | Custom endpoint (for Azure OpenAI) |
| `create-pr-comment` | `true` | Add summary comment to PR |
| `fail-on-error` | `false` | Fail workflow on error |

[View all inputs in action.yml](action.yml)

## 📖 Usage Examples

### Basic (OpenAI)

```yaml
- uses: your-org/azure-integration-doc-agent@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

### Azure OpenAI

```yaml
- uses: your-org/azure-integration-doc-agent@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.AZURE_OPENAI_KEY }}
    openai-api-endpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    openai-model: gpt-4-deployment  # Your deployment name
```

### Centralized Documentation

```yaml
- uses: your-org/azure-integration-doc-agent@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    mode: centralized
    central-doc-file: AZURE_CHANGELOG.md
```

### Custom File Patterns

```yaml
- uses: your-org/azure-integration-doc-agent@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    file-patterns: '**/*.bicep,**/infrastructure/**/*.json'
```

### Weekly Audit

```yaml
name: Weekly Azure Audit

on:
  schedule:
    - cron: '0 0 * * 0'

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/azure-integration-doc-agent@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

## 📊 Supported Files

| Service | Patterns |
|---------|----------|
| Logic Apps | `*.logicapp.json` |
| API Management | `apim-*.xml`, `*policy.xml` |
| Service Bus | `servicebus-*.json` |
| Event Hub | `eventhub-*.json` |
| Azure Functions | `function.json` |
| Bicep | `*.bicep` |
| Terraform | `*.tf` |
| Azure Configs | `*azure*.yaml/yml` |

## 🔒 Security

✅ Store API keys in GitHub Secrets  
✅ Use `secrets.GITHUB_TOKEN` for GitHub access  
✅ No secrets logged (uses masked output)  
❌ Never commit API keys to repository  

## 🛠️ Troubleshooting

**Action doesn't run:**
- Check workflow file is on base branch
- Verify PR has Azure file changes

**Documentation not committed:**
- Ensure `contents: write` permission
- Check `ref: ${{ github.head_ref }}`

**API errors:**
- Verify API key is correct
- Check endpoint URL (for Azure OpenAI)
- Ensure model/deployment exists

## 💰 Cost Estimate

- **GPT-4**: ~$0.10 per PR
- **GPT-3.5-Turbo**: ~$0.005 per PR
- Sends only diffs (not full files) to minimize tokens

## 🎯 For Managers

**Benefits:**
- 80% reduction in documentation time
- Standardized documentation across teams
- Improved code review quality
- Compliance and audit trails
- Security and cost insights included

**ROI:**
- Manual: ~30 min per PR
- Automated: ~2 min
- **93% time savings**

## 📄 License

MIT License - see [LICENSE](LICENSE)

## 🔗 Resources

- [Azure OpenAI Setup Guide](AZURE_OPENAI_SETUP.md)
- [Report Issues](https://github.com/your-org/azure-integration-doc-agent/issues)
- [Discussions](https://github.com/your-org/azure-integration-doc-agent/discussions)

---

Made with ❤️ for Azure teams
