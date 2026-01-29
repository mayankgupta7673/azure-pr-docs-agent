# Azure Integration Doc Agent

🔷 **AI-powered documentation for Azure integrations using Azure OpenAI**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Enterprise-ready GitHub Action that automatically documents Azure integration changes (Logic Apps, APIM, Service Bus, Event Hub, Functions, Bicep, Terraform) using **Azure OpenAI Service**.

## ✨ Features

- 🔷 **Azure-Native** - Built exclusively for Azure OpenAI Service
- 🎯 **Multi-Event** - Works with PRs, commits, and scheduled audits
- 💰 **Cost Efficient** - Sends only diffs, not full files (~$0.10 per PR)
- 📊 **Flexible** - Per-PR, centralized, or both documentation modes
- 🔒 **Enterprise Secure** - Keeps data in your Azure tenant
- 🏢 **Compliance Ready** - Supports HIPAA, SOC 2, and other standards

## 🚀 Quick Start

### 1. Setup Azure OpenAI

1. **Create Azure OpenAI resource** in [Azure Portal](https://portal.azure.com)
2. **Deploy a model** in Azure OpenAI Studio:
   - Go to **Deployments** → Create new deployment
   - Choose: **GPT-4** or **GPT-3.5-Turbo**
   - Name it: `gpt-4-docs` (remember this!)
3. **Get credentials**:
   - Go to **Keys and Endpoint**
   - Copy **KEY 1** and **Endpoint URL**

### 2. Construct Endpoint URL

Format:
```
https://<resource-name>.openai.azure.com/openai/deployments/<deployment-name>/chat/completions?api-version=2024-02-15-preview
```

Example:
```
https://my-company-openai.openai.azure.com/openai/deployments/gpt-4-docs/chat/completions?api-version=2024-02-15-preview
```

### 3. Add GitHub Secrets

Repository → **Settings** → **Secrets and variables** → **Actions**:
- `AZURE_OPENAI_KEY`: Your API key
- `AZURE_OPENAI_ENDPOINT`: Your full endpoint URL

### 4. Add Workflow File

Create `.github/workflows/azure-docs.yml`:

```yaml
name: Azure Integration Documentation

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
      
      - uses: ./  # Or mayankgupta7673/azure-integration-doc-agent@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          azure-openai-key: ${{ secrets.AZURE_OPENAI_KEY }}
          azure-openai-endpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
          azure-openai-deployment: gpt-4-docs
```

### 5. Done! 🎉

Create a PR with Azure file changes and documentation will be auto-generated.

## ⚙️ Configuration

### Required Inputs

| Input | Description |
|-------|-------------|
| `github-token` | GitHub token (use `secrets.GITHUB_TOKEN`) |
| `azure-openai-key` | Azure OpenAI API key from Azure Portal |
| `azure-openai-endpoint` | Full Azure OpenAI endpoint URL |
| `azure-openai-deployment` | Your deployment name (e.g., `gpt-4-docs`) |

### Optional Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `mode` | `pr` | `pr`, `centralized`, or `both` |
| `docs-folder` | `docs` | Documentation output folder |
| `file-patterns` | See below | Azure file patterns to watch |
| `include-architecture-diagram` | `true` | Generate Mermaid diagrams |
| `include-security-notes` | `true` | Include security analysis |
| `include-cost-impact` | `true` | Include cost analysis |
| `create-pr-comment` | `true` | Add PR comment with summary |
| `fail-on-error` | `false` | Fail workflow on error |
| `commit-message` | Auto | Custom commit message |

**Default file patterns:**
```
**/*.logicapp.json, **/apim-*.xml, **/servicebus-*.json, 
**/eventhub-*.json, **/function.json, **/*.bicep, **/*.tf, 
**/*azure*.yaml
```

## 📖 Usage Examples

### Basic Usage

```yaml
- uses: mayankgupta7673/azure-integration-doc-agent@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    azure-openai-key: ${{ secrets.AZURE_OPENAI_KEY }}
    azure-openai-endpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azure-openai-deployment: gpt-4-docs
```

### Centralized Documentation

```yaml
- uses: mayankgupta7673/azure-integration-doc-agent@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    azure-openai-key: ${{ secrets.AZURE_OPENAI_KEY }}
    azure-openai-endpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azure-openai-deployment: gpt-4-docs
    mode: centralized
    central-doc-file: AZURE_CHANGELOG.md
```

### Cost-Optimized (GPT-3.5)

```yaml
- uses: mayankgupta7673/azure-integration-doc-agent@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    azure-openai-key: ${{ secrets.AZURE_OPENAI_KEY }}
    azure-openai-endpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azure-openai-deployment: gpt-35-turbo  # Cheaper model
    include-architecture-diagram: false
    include-cost-impact: false
```

### Custom File Patterns

```yaml
- uses: mayankgupta7673/azure-integration-doc-agent@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    azure-openai-key: ${{ secrets.AZURE_OPENAI_KEY }}
    azure-openai-endpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azure-openai-deployment: gpt-4-docs
    file-patterns: '**/*.bicep,**/infrastructure/**/*.json,**/workflows/**/*.json'
```

### Weekly Audit

```yaml
name: Weekly Azure Audit

on:
  schedule:
    - cron: '0 0 * * 0'  # Sunday midnight
  workflow_dispatch:

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: mayankgupta7673/azure-integration-doc-agent@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          azure-openai-key: ${{ secrets.AZURE_OPENAI_KEY }}
          azure-openai-endpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
          azure-openai-deployment: gpt-4-docs
```

### Multi-Environment Setup

```yaml
- name: Set Azure OpenAI Config
  id: config
  run: |
    if [[ "${{ github.ref }}" == "refs/heads/main" ]]; then
      echo "deployment=gpt-4-prod" >> $GITHUB_OUTPUT
    else
      echo "deployment=gpt-35-turbo-dev" >> $GITHUB_OUTPUT
    fi

- uses: mayankgupta7673/azure-integration-doc-agent@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    azure-openai-key: ${{ secrets.AZURE_OPENAI_KEY }}
    azure-openai-endpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
    azure-openai-deployment: ${{ steps.config.outputs.deployment }}
```

## 📊 Supported Azure Services

| Service | File Patterns |
|---------|---------------|
| Logic Apps | `*.logicapp.json` |
| API Management | `apim-*.xml`, `*policy.xml` |
| Service Bus | `servicebus-*.json` |
| Event Hub | `eventhub-*.json` |
| Azure Functions | `function.json` |
| Bicep IaC | `*.bicep` |
| Terraform | `*.tf` |
| Azure Configs | `*azure*.yaml/yml` |

## 🔒 Security & Compliance

✅ **Data stays in your Azure tenant** - Not sent to third parties  
✅ **SLA-backed** - 99.9% uptime with Azure OpenAI  
✅ **Compliance ready** - HIPAA, SOC 2, ISO certifications  
✅ **Managed Identity support** - Use Azure RBAC for auth  
✅ **Private endpoints** - Deploy in your VNet  
✅ **No secrets in logs** - All sensitive data masked  

## 🛠️ Troubleshooting

### "Azure OpenAI authentication failed"
- Verify API key in Azure Portal → Keys and Endpoint
- Regenerate key if expired
- Ensure no extra spaces in GitHub secret

### "Deployment not found"
- Check deployment name in Azure OpenAI Studio → Deployments
- Use **deployment name**, not model name
- Ensure endpoint URL matches deployment

### "Rate limit exceeded"
- Check quota in Azure Portal
- Increase tokens-per-minute in deployment settings
- Use `fail-on-error: false` for non-critical workflows

### Documentation not committed
- Ensure `contents: write` permission in workflow
- Check `ref: ${{ github.head_ref }}`
- Verify no branch protection blocking commits

## 💰 Cost Analysis

**Azure OpenAI Pricing:**
- **GPT-4**: $0.03/1K input tokens, $0.06/1K output tokens
- **GPT-3.5-Turbo**: $0.0015/1K input, $0.002/1K output

**Per PR Cost:**
- Input: ~1,500 tokens (diffs + prompt)
- Output: ~1,000 tokens (documentation)
- **GPT-4**: ~$0.10 per PR
- **GPT-3.5**: ~$0.005 per PR (95% cheaper!)

**Monthly Cost Example:**
- 100 PRs/month with GPT-4: **~$10**
- 100 PRs/month with GPT-3.5: **~$0.50**

## 🎯 For Managers

### Business Benefits
- ⏱️ **80% time savings** - Automates documentation work
- 📋 **Standardization** - Consistent docs across teams
- ✅ **Compliance** - Automatic audit trails
- 🔍 **Quality** - Catches security/cost issues early
- 🔒 **Enterprise Security** - Data stays in your Azure tenant

### ROI Calculation
- **Manual**: 30 min per PR × 100 PRs = 50 hours/month
- **Automated**: 2 min per PR × 100 PRs = 3.3 hours/month
- **Savings**: 46.7 hours/month (93% reduction)
- **Cost**: $10-50/month (Azure OpenAI)

## 🌍 Azure Regions

Azure OpenAI is available in:
- East US
- West Europe
- Canada East
- Japan East
- Australia East
- France Central
- Switzerland North

Choose the region closest to your team for best performance.

## 📄 License

MIT License - see [LICENSE](LICENSE)

## 🔗 Resources

- [Azure OpenAI Service](https://azure.microsoft.com/products/ai-services/openai-service)
- [Azure OpenAI Pricing](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/)
- [Azure OpenAI Documentation](https://learn.microsoft.com/azure/ai-services/openai/)
- [Report Issues](https://github.com/mayankgupta7673/azure-integration-doc-agent/issues)

---

Made with 🔷 for Azure teams
