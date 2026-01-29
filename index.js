const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const { minimatch } = require('minimatch');
const fs = require('fs').promises;
const path = require('path');

/**
 * Main entry point for the GitHub Action
 */
async function run() {
  try {
    // Get and validate inputs
    const config = {
      githubToken: core.getInput('github-token', { required: true }),
      azureOpenAIKey: core.getInput('azure-openai-key', { required: true }),
      azureOpenAIEndpoint: core.getInput('azure-openai-endpoint', { required: true }),
      azureOpenAIDeployment: core.getInput('azure-openai-deployment', { required: true }),
      docsFolder: core.getInput('docs-folder') || 'docs',
      commitMessage: core.getInput('commit-message') || 'docs: auto-generated Azure integration documentation [skip ci]',
      filePatterns: (core.getInput('file-patterns') || '').split(',').map(p => p.trim()).filter(p => p),
      mode: core.getInput('mode') || 'pr',
      centralDocFile: core.getInput('central-doc-file') || 'azure-integrations.md',
      includeArchitectureDiagram: core.getInput('include-architecture-diagram') === 'true',
      includeSecurityNotes: core.getInput('include-security-notes') === 'true',
      includeCostImpact: core.getInput('include-cost-impact') === 'true',
      createPrComment: core.getInput('create-pr-comment') === 'true',
      failOnError: core.getInput('fail-on-error') === 'true',
      maxCommitsToAnalyze: parseInt(core.getInput('max-commits-to-analyze') || '5'),
      skipIfNoChanges: core.getInput('skip-if-no-changes') === 'true',
      autoUpdatePr: core.getInput('auto-update-pr') === 'true',
      updatePrTitle: core.getInput('update-pr-title') === 'true'
    };

    // Validate Azure OpenAI endpoint
    if (!config.azureOpenAIEndpoint.includes('openai.azure.com')) {
      throw new Error('Invalid Azure OpenAI endpoint. Must be an Azure OpenAI endpoint (*.openai.azure.com)');
    }

    // Validate mode
    if (!['pr', 'centralized', 'both'].includes(config.mode)) {
      throw new Error(`Invalid mode: ${config.mode}. Must be 'pr', 'centralized', or 'both'`);
    }

    // Set default file patterns if empty
    if (config.filePatterns.length === 0) {
      config.filePatterns = [
        '**/*.logicapp.json',
        '**/apim-policy.xml',
        '**/apim-*.xml',
        '**/servicebus-*.json',
        '**/eventhub-*.json',
        '**/function.json',
        '**/bicep/*.bicep',
        '**/terraform/*.tf',
        '**/*azure*.yaml',
        '**/*azure*.yml'
      ];
    }

    core.info('🔷 Using Azure OpenAI for documentation generation');
    core.info(`📍 Endpoint: ${config.azureOpenAIEndpoint.split('?')[0]}`);
    core.info(`🤖 Deployment: ${config.azureOpenAIDeployment}`);

    const { context } = github;
    const octokit = github.getOctokit(config.githubToken);

    // Determine the event type and route accordingly
    if (context.eventName === 'pull_request' || context.eventName === 'pull_request_target') {
      await handlePullRequest(context, octokit, config);
    } else if (context.eventName === 'push') {
      await handlePushEvent(context, octokit, config);
    } else if (context.eventName === 'schedule' || context.eventName === 'workflow_dispatch') {
      await handleScheduledAudit(context, octokit, config);
    } else {
      core.info(`Event type '${context.eventName}' not supported. Skipping...`);
      core.setOutput('docs-updated', 'false');
      core.setOutput('files-processed', '0');
    }

  } catch (error) {
    const failOnError = core.getInput('fail-on-error') === 'true';
    if (failOnError) {
      core.setFailed(`Action failed: ${error.message}`);
    } else {
      core.warning(`Action encountered an error but continuing: ${error.message}`);
      core.setOutput('docs-updated', 'false');
      core.setOutput('files-processed', '0');
    }
    core.debug(error.stack);
  }
}

/**
 * Handle pull request events
 */
async function handlePullRequest(context, octokit, config) {
  const pullRequest = context.payload.pull_request;
  if (!pullRequest) {
    throw new Error('Pull request data not found in payload');
  }

  core.info(`📋 Processing PR #${pullRequest.number}: ${pullRequest.title}`);

  // Check if this is a documentation update commit (to avoid infinite loops)
  if (config.commitMessage && context.payload.action === 'synchronize') {
    const { data: commits } = await octokit.rest.pulls.listCommits({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: pullRequest.number,
      per_page: 1
    });
    
    const latestCommit = commits[commits.length - 1];
    if (latestCommit && latestCommit.commit.message.includes('[skip ci]')) {
      core.info('⏭️ Skipping - last commit was auto-generated documentation');
      core.setOutput('docs-updated', 'false');
      core.setOutput('pr-updated', 'false');
      return;
    }
  }

  // Get changed files in the PR
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pullRequest.number,
    per_page: 100
  });

  const azureFiles = filterAzureFiles(files, config.filePatterns);

  if (azureFiles.length === 0) {
    core.info('No Azure integration files detected in this PR.');
    if (config.skipIfNoChanges) {
      core.setOutput('docs-updated', 'false');
      core.setOutput('files-processed', '0');
      core.setOutput('pr-updated', 'false');
      return;
    }
  }

  core.info(`Found ${azureFiles.length} Azure integration file(s):`);
  azureFiles.forEach(file => core.info(`  - ${file.filename} (${file.status})`));

  // Extract diffs
  const fileDiffs = extractFileDiffs(azureFiles);

  if (fileDiffs.length === 0) {
    core.warning('Could not retrieve diffs for any Azure integration files.');
    core.setOutput('docs-updated', 'false');
    core.setOutput('files-processed', '0');
    core.setOutput('pr-updated', 'false');
    return;
  }

  // Generate documentation
  core.info('🤖 Generating documentation with AI...');
  const documentation = await generateDocumentation(
    fileDiffs,
    {
      title: pullRequest.title,
      number: pullRequest.number,
      body: pullRequest.body || '',
      author: pullRequest.user.login,
      type: 'pull_request'
    },
    config
  );

  // Write documentation
  const docPaths = await writeDocumentation(documentation, pullRequest.number, config);

  // Commit documentation
  await commitDocumentation(
    octokit,
    context,
    pullRequest.head.ref,
    docPaths,
    config.commitMessage
  );
  
  core.info('✅ Documentation committed successfully!');
  core.setOutput('docs-updated', 'true');

  // Auto-update PR comment if enabled
  if (config.autoUpdatePr && config.createPrComment) {
    await updateOrCreatePrComment(octokit, context, pullRequest.number, {
      filesProcessed: fileDiffs.length,
      docPaths: docPaths,
      documentation: documentation,
      isUpdate: context.payload.action === 'synchronize'
    });
    core.setOutput('pr-comment-created', 'true');
    core.setOutput('pr-updated', 'true');
  } else if (config.createPrComment && azureFiles.length > 0) {
    await createPrComment(octokit, context, pullRequest.number, {
      filesProcessed: fileDiffs.length,
      docPaths: docPaths,
      documentation: documentation
    });
    core.setOutput('pr-comment-created', 'true');
    core.setOutput('pr-updated', 'false');
  }

  // Update PR title if enabled
  if (config.updatePrTitle && context.payload.action === 'synchronize' && !pullRequest.title.includes('[docs updated]')) {
    await updatePrTitle(octokit, context, pullRequest.number, pullRequest.title);
  }

  core.setOutput('files-processed', fileDiffs.length.toString());
  core.setOutput('documentation-path', docPaths.join(', '));
  core.setOutput('changes-summary', `${azureFiles.length} Azure files modified in PR #${pullRequest.number}`);
}

/**
 * Update or create PR comment with documentation summary
 */
async function updateOrCreatePrComment(octokit, context, prNumber, summary) {
  try {
    const commentIdentifier = '<!-- azure-integration-doc-agent -->';
    const docPreview = summary.documentation.substring(0, 500) + '...';
    
    const updateBadge = summary.isUpdate ? '🔄 **Updated**' : '✨ **New**';
    const timestamp = new Date().toISOString();
    
    const commentBody = `${commentIdentifier}
## 📚 Azure Integration Documentation ${updateBadge}

✅ **Files Processed:** ${summary.filesProcessed}
📄 **Documentation:** ${summary.docPaths.map(p => `\`${p}\``).join(', ')}
⏰ **Last Updated:** ${timestamp}

### Preview

${docPreview}

<details>
<summary>View Full Documentation</summary>

${summary.documentation}

</details>

---
*Auto-generated by Azure Integration Doc Agent 🤖 | ${summary.isUpdate ? 'Updated on new commits' : 'Created on PR'}*`;

    // Try to find existing comment
    const { data: comments } = await octokit.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber
    });

    const existingComment = comments.find(comment => 
      comment.body && comment.body.includes(commentIdentifier)
    );

    if (existingComment) {
      // Update existing comment
      await octokit.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: existingComment.id,
        body: commentBody
      });
      core.info('🔄 PR comment updated');
    } else {
      // Create new comment
      await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: commentBody
      });
      core.info('💬 PR comment created');
    }
  } catch (error) {
    core.warning(`Failed to update/create PR comment: ${error.message}`);
  }
}

/**
 * Update PR title with documentation update tag
 */
async function updatePrTitle(octokit, context, prNumber, currentTitle) {
  try {
    const newTitle = `${currentTitle} [docs updated]`;
    
    await octokit.rest.pulls.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber,
      title: newTitle
    });
    
    core.info(`📝 PR title updated: ${newTitle}`);
  } catch (error) {
    core.warning(`Failed to update PR title: ${error.message}`);
  }
}

/**
 * Handle push events (commit-based documentation)
 */
async function handlePushEvent(context, octokit, config) {
  core.info(`📦 Processing push to ${context.ref}`);
  
  const commits = context.payload.commits || [];
  const commitsToAnalyze = commits.slice(-config.maxCommitsToAnalyze);

  core.info(`Analyzing ${commitsToAnalyze.length} recent commit(s)...`);

  // Get the comparison to find changed files
  const comparison = await octokit.rest.repos.compareCommits({
    owner: context.repo.owner,
    repo: context.repo.repo,
    base: context.payload.before,
    head: context.payload.after
  });

  const azureFiles = filterAzureFiles(comparison.data.files, config.filePatterns);

  if (azureFiles.length === 0) {
    core.info('No Azure integration files detected in this push.');
    if (config.skipIfNoChanges) {
      core.setOutput('docs-updated', 'false');
      core.setOutput('files-processed', '0');
      return;
    }
  }

  core.info(`Found ${azureFiles.length} Azure integration file(s) in commits`);

  const fileDiffs = extractFileDiffs(azureFiles);

  // Generate documentation
  const documentation = await generateDocumentation(
    fileDiffs,
    {
      title: `Commit ${context.payload.after.substring(0, 7)} to ${context.ref}`,
      commits: commitsToAnalyze,
      branch: context.ref.replace('refs/heads/', ''),
      type: 'push'
    },
    config
  );

  // For push events, use centralized mode by default
  const effectiveMode = config.mode === 'pr' ? 'centralized' : config.mode;
  const modifiedConfig = { ...config, mode: effectiveMode };

  const docPaths = await writeDocumentation(documentation, null, modifiedConfig);
  
  const branch = context.ref.replace('refs/heads/', '');
  await commitDocumentation(
    octokit,
    context,
    branch,
    docPaths,
    config.commitMessage
  );
  
  core.info('✅ Documentation committed successfully!');
  core.setOutput('docs-updated', 'true');

  core.setOutput('files-processed', fileDiffs.length.toString());
  core.setOutput('documentation-path', docPaths.join(', '));
  core.setOutput('changes-summary', `${azureFiles.length} Azure files modified in ${commitsToAnalyze.length} commit(s)`);
}

/**
 * Handle scheduled audit (comprehensive documentation generation)
 */
async function handleScheduledAudit(context, octokit, config) {
  core.info('📊 Running scheduled Azure integration audit...');

  // Find all Azure integration files in the repository
  const { data: tree } = await octokit.rest.git.getTree({
    owner: context.repo.owner,
    repo: context.repo.repo,
    tree_sha: context.sha,
    recursive: 'true'
  });

  const allFiles = tree.tree
    .filter(item => item.type === 'blob')
    .filter(item => config.filePatterns.some(pattern => minimatch(item.path, pattern)));

  core.info(`Found ${allFiles.length} Azure integration files in repository`);

  if (allFiles.length === 0) {
    core.info('No Azure integration files found. Skipping audit.');
    core.setOutput('docs-updated', 'false');
    core.setOutput('files-processed', '0');
    return;
  }

  // Generate audit documentation
  const documentation = generateAuditDocumentation(allFiles);

  const docPath = path.join(config.docsFolder, 'azure-integration-audit.md');
  await fs.mkdir(config.docsFolder, { recursive: true });
  await fs.writeFile(docPath, documentation, 'utf8');

  const branch = context.ref.replace('refs/heads/', '') || 'main';
  await commitDocumentation(
    octokit,
    context,
    branch,
    [docPath],
    'docs: automated Azure integration audit'
  );

  core.info('✅ Audit documentation generated!');
  core.setOutput('docs-updated', 'true');
  core.setOutput('files-processed', allFiles.length.toString());
  core.setOutput('documentation-path', docPath);
}

/**
 * Filter files for Azure integrations
 */
function filterAzureFiles(files, patterns) {
  return files.filter(file => 
    patterns.some(pattern => minimatch(file.filename || file.path, pattern))
  );
}

/**
 * Extract diffs from files
 */
function extractFileDiffs(files) {
  return files.map(file => {
    if (file.status === 'removed') {
      return {
        filename: file.filename,
        status: file.status,
        diff: '(File removed)',
        additions: 0,
        deletions: file.deletions || 0
      };
    }

    return {
      filename: file.filename,
      status: file.status,
      diff: file.patch || '(Binary or very large file)',
      additions: file.additions || 0,
      deletions: file.deletions || 0
    };
  }).filter(d => d !== null);
}

/**
 * Generate documentation using Azure OpenAI
 */
async function generateDocumentation(fileDiffs, metadata, config) {
  const prompt = buildDocumentationPrompt(fileDiffs, metadata, config);

  try {
    core.info('🤖 Calling Azure OpenAI API...');
    core.info(`Endpoint: ${config.azureOpenAIEndpoint.split('?')[0]}`);
    core.info(`Deployment: ${config.azureOpenAIDeployment}`);
    
    // Build the full Azure OpenAI endpoint URL with deployment and API version
    const apiVersion = '2024-02-15-preview';
    let fullEndpoint = config.azureOpenAIEndpoint;
    
    // Check if endpoint already includes the full path or just the base URL
    if (!fullEndpoint.includes('/openai/deployments/')) {
      // Remove trailing slash if present
      fullEndpoint = fullEndpoint.replace(/\/$/, '');
      // Build the complete endpoint
      fullEndpoint = `${fullEndpoint}/openai/deployments/${config.azureOpenAIDeployment}/chat/completions?api-version=${apiVersion}`;
    }
    
    core.debug(`Full API URL: ${fullEndpoint}`);
    
    const response = await axios.post(
      fullEndpoint,
      {
        messages: [
          {
            role: 'system',
            content: buildSystemPrompt(config)
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 3000
      },
      {
        headers: {
          'api-key': config.azureOpenAIKey,
          'Content-Type': 'application/json'
        },
        timeout: 60000,
        validateStatus: function (status) {
          return status >= 200 && status < 600; // Don't throw on any status
        }
      }
    );

    // Log response structure for debugging
    core.debug(`Response status: ${response.status}`);
    core.debug(`Response data keys: ${Object.keys(response.data || {}).join(', ')}`);
    
    // Check for HTTP errors first
    if (response.status >= 400) {
      core.error(`Azure OpenAI API Error: ${response.status} ${response.statusText}`);
      core.error(`Response data: ${JSON.stringify(response.data, null, 2)}`);
      
      if (response.status === 401) {
        throw new Error('Azure OpenAI authentication failed. Check your API key in Azure Portal.');
      } else if (response.status === 404) {
        throw new Error('Azure OpenAI deployment not found. Verify your endpoint URL and deployment name. Expected format: https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-02-15-preview');
      } else if (response.status === 429) {
        throw new Error('Azure OpenAI rate limit exceeded. Check your quota in Azure Portal.');
      } else if (response.status === 400) {
        const errorMsg = response.data?.error?.message || 'Bad request';
        throw new Error(`Azure OpenAI bad request: ${errorMsg}`);
      } else {
        throw new Error(`Azure OpenAI API request failed with status ${response.status}: ${JSON.stringify(response.data)}`);
      }
    }
    
    // Validate response structure
    if (!response.data) {
      core.error('Response object structure:');
      core.error(`- status: ${response.status}`);
      core.error(`- statusText: ${response.statusText}`);
      core.error(`- headers: ${JSON.stringify(response.headers)}`);
      throw new Error('Azure OpenAI returned empty response data. The API may be returning an unexpected format.');
    }
    
    if (!response.data.choices || !Array.isArray(response.data.choices)) {
      core.error('Unexpected response structure from Azure OpenAI');
      core.error(`Response keys: ${Object.keys(response.data).join(', ')}`);
      core.error(`Full response: ${JSON.stringify(response.data, null, 2)}`);
      throw new Error('Azure OpenAI response missing "choices" array. Check your endpoint URL format and API version.');
    }
    
    if (response.data.choices.length === 0) {
      core.error(`Response data: ${JSON.stringify(response.data, null, 2)}`);
      throw new Error('Azure OpenAI returned empty choices array. The model may have filtered the content or encountered an error.');
    }
    
    if (!response.data.choices[0].message || !response.data.choices[0].message.content) {
      core.error(`Choice structure: ${JSON.stringify(response.data.choices[0], null, 2)}`);
      throw new Error('Azure OpenAI response missing message content. The response may have been filtered or is incomplete.');
    }

    const generatedText = response.data.choices[0].message.content;
    core.info('✨ Documentation generated successfully');
    core.info(`Generated ${generatedText.length} characters of documentation`);
    
    // Log token usage if available
    if (response.data.usage) {
      core.info(`Token usage: ${response.data.usage.prompt_tokens} prompt + ${response.data.usage.completion_tokens} completion = ${response.data.usage.total_tokens} total`);
    }
    
    return generatedText;

  } catch (error) {
    if (error.response) {
      core.error(`Azure OpenAI API Error: ${error.response.status} ${error.response.statusText}`);
      core.error(`Response headers: ${JSON.stringify(error.response.headers, null, 2)}`);
      core.error(`Response data: ${JSON.stringify(error.response.data, null, 2)}`);
      
      if (error.response.status === 401) {
        throw new Error('Azure OpenAI authentication failed. Check your API key in Azure Portal.');
      } else if (error.response.status === 404) {
        throw new Error('Azure OpenAI deployment not found. Verify your endpoint URL and deployment name. Expected format: https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-02-15-preview');
      } else if (error.response.status === 429) {
        throw new Error('Azure OpenAI rate limit exceeded. Check your quota in Azure Portal.');
      } else if (error.response.status === 400) {
        const errorMsg = error.response.data?.error?.message || 'Bad request';
        throw new Error(`Azure OpenAI bad request: ${errorMsg}`);
      } else {
        throw new Error(`Azure OpenAI API request failed with status ${error.response.status}: ${JSON.stringify(response.data)}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Azure OpenAI request timeout. The API took longer than 60 seconds to respond.');
    } else if (error.code === 'ENOTFOUND') {
      throw new Error('Azure OpenAI endpoint not found. Check your endpoint URL.');
    } else if (error.code === 'ECONNREFUSED') {
      throw new Error('Connection refused to Azure OpenAI endpoint. Check your network and endpoint URL.');
    }
    
    throw new Error(`Failed to generate documentation: ${error.message}`);
  }
}

/**
 * Build system prompt based on configuration
 */
function buildSystemPrompt(config) {
  let prompt = `You are an expert technical writer and Azure solutions architect. Generate clear, comprehensive documentation for Azure integration changes including Logic Apps, APIM policies, Service Bus, Event Hub, Azure Functions, Bicep templates, and Terraform configurations.

Focus on:
- What changed and why
- Integration impacts and dependencies
- Configuration requirements`;

  if (config.includeSecurityNotes) {
    prompt += '\n- Security considerations and compliance impacts';
  }

  if (config.includeCostImpact) {
    prompt += '\n- Cost implications of the changes';
  }

  if (config.includeArchitectureDiagram) {
    prompt += '\n- Mermaid diagram suggestions for architecture visualization';
  }

  prompt += '\n\nUse clear, professional language suitable for both technical and management audiences.';

  return prompt;
}

/**
 * Build the LLM prompt with file diffs
 */
function buildDocumentationPrompt(fileDiffs, metadata, config) {
  let prompt = '';

  if (metadata.type === 'pull_request') {
    prompt = `# Documentation Request for Pull Request

**PR Title:** ${metadata.title}
**PR Number:** #${metadata.number}
**Author:** @${metadata.author}
**Description:**
${metadata.body || '(No description provided)'}

---
`;
  } else if (metadata.type === 'push') {
    prompt = `# Documentation Request for Commit

**Branch:** ${metadata.branch}
**Title:** ${metadata.title}
**Commits Analyzed:** ${metadata.commits.length}

Recent Commits:
${metadata.commits.map(c => `- ${c.id.substring(0, 7)}: ${c.message} (${c.author.name})`).join('\n')}

---
`;
  }

  prompt += `## Azure Integration Changes

Generate comprehensive documentation including:

1. **Executive Summary** - High-level overview for management
2. **Technical Summary** - Detailed changes for developers
3. **Files Changed** - Per-file analysis with descriptions
4. **Integration Impact** - Downstream effects and dependencies
5. **Configuration Requirements** - Environment variables, secrets, connection strings`;

  if (config.includeSecurityNotes) {
    prompt += '\n6. **Security Considerations** - Authentication, authorization, data protection';
  }

  if (config.includeCostImpact) {
    prompt += '\n7. **Cost Impact** - Resource consumption and billing implications';
  }

  if (config.includeArchitectureDiagram) {
    prompt += '\n8. **Architecture Diagram** - Mermaid diagram showing integration flow';
  }

  prompt += '\n9. **Testing Checklist** - Verification steps\n10. **Deployment Notes** - Rollout considerations\n\n';

  prompt += '### Changed Files and Diffs:\n\n';

  fileDiffs.forEach(file => {
    prompt += `#### File: \`${file.filename}\`\n`;
    prompt += `- **Status:** ${file.status}\n`;
    prompt += `- **Changes:** +${file.additions} / -${file.deletions} lines\n`;
    prompt += `- **Type:** ${detectAzureServiceType(file.filename)}\n\n`;
    prompt += '```diff\n';
    prompt += file.diff.substring(0, 2000);
    prompt += '\n```\n\n';
  });

  prompt += `---

Generate the documentation in well-formatted Markdown with clear sections, tables where appropriate, and professional formatting.`;

  return prompt;
}

/**
 * Detect Azure service type from filename
 */
function detectAzureServiceType(filename) {
  if (filename.includes('logicapp')) return 'Azure Logic App';
  if (filename.includes('apim') || filename.includes('policy')) return 'API Management';
  if (filename.includes('servicebus')) return 'Service Bus';
  if (filename.includes('eventhub')) return 'Event Hub';
  if (filename.includes('function')) return 'Azure Function';
  if (filename.endsWith('.bicep')) return 'Bicep IaC';
  if (filename.endsWith('.tf')) return 'Terraform IaC';
  if (filename.includes('azure')) return 'Azure Configuration';
  return 'Azure Integration';
}

/**
 * Generate audit documentation for scheduled runs
 */
function generateAuditDocumentation(files) {
  const filesByType = {};
  
  files.forEach(file => {
    const type = detectAzureServiceType(file.path);
    if (!filesByType[type]) filesByType[type] = [];
    filesByType[type].push(file.path);
  });

  let doc = `# Azure Integration Audit Report

**Generated:** ${new Date().toISOString()}
**Total Files:** ${files.length}

## Summary

This repository contains ${files.length} Azure integration files across ${Object.keys(filesByType).length} service types.

## Files by Service Type

`;

  Object.entries(filesByType).forEach(([type, paths]) => {
    doc += `### ${type} (${paths.length} files)\n\n`;
    paths.forEach(p => doc += `- \`${p}\`\n`);
    doc += '\n';
  });

  doc += `## Recommendations

1. Ensure all integration files have corresponding documentation
2. Review security configurations regularly
3. Monitor cost implications of integrations
4. Keep IaC templates updated with infrastructure changes
5. Maintain integration dependency diagrams

---
*This audit was automatically generated by Azure Integration Doc Agent*
`;

  return doc;
}

/**
 * Write documentation to files based on mode
 */
async function writeDocumentation(documentation, prNumber, config) {
  await fs.mkdir(config.docsFolder, { recursive: true });
  const docPaths = [];

  if (config.mode === 'pr' && prNumber) {
    const docPath = path.join(config.docsFolder, `pr-${prNumber}-azure-integrations.md`);
    await fs.writeFile(docPath, documentation, 'utf8');
    docPaths.push(docPath);
    core.info(`📄 Per-PR documentation: ${docPath}`);
  }

  if (config.mode === 'centralized' || config.mode === 'both') {
    const centralPath = path.join(config.docsFolder, config.centralDocFile);
    
    let centralContent = documentation;
    
    try {
      const existingContent = await fs.readFile(centralPath, 'utf8');
      const timestamp = new Date().toISOString();
      centralContent = `${existingContent}\n\n---\n\n_Updated: ${timestamp}_\n\n${documentation}`;
    } catch (error) {
      // File doesn't exist, use new content
    }
    
    await fs.writeFile(centralPath, centralContent, 'utf8');
    docPaths.push(centralPath);
    core.info(`📄 Centralized documentation: ${centralPath}`);
  }

  return docPaths;
}

/**
 * Commit documentation changes
 */
async function commitDocumentation(octokit, context, branch, filePaths, commitMessage) {
  try {
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    core.info(`Committing ${filePaths.length} file(s) to branch: ${branch}`);

    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`
    });
    const currentCommitSha = refData.object.sha;

    const { data: commitData } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: currentCommitSha
    });
    const currentTreeSha = commitData.tree.sha;

    const treeItems = await Promise.all(
      filePaths.map(async (filePath) => {
        const content = await fs.readFile(filePath, 'utf8');
        const { data: blobData } = await octokit.rest.git.createBlob({
          owner,
          repo,
          content: Buffer.from(content).toString('base64'),
          encoding: 'base64'
        });

        return {
          path: filePath,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha
        };
      })
    );

    const { data: newTreeData } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: currentTreeSha,
      tree: treeItems
    });

    const { data: newCommitData } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: commitMessage,
      tree: newTreeData.sha,
      parents: [currentCommitSha]
    });

    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommitData.sha
    });

    core.info(`✅ Commit created: ${newCommitData.sha}`);

  } catch (error) {
    throw new Error(`Failed to commit documentation: ${error.message}`);
  }
}

/**
 * Create PR comment with documentation summary
 */
async function createPrComment(octokit, context, prNumber, summary) {
  try {
    const docPreview = summary.documentation.substring(0, 500) + '...';
    
    const comment = `## 📚 Azure Integration Documentation Generated

✅ **Files Processed:** ${summary.filesProcessed}
📄 **Documentation:** ${summary.docPaths.map(p => `\`${p}\``).join(', ')}

### Preview

${docPreview}

<details>
<summary>View Full Documentation</summary>

${summary.documentation}

</details>

---
*Generated by Azure Integration Doc Agent 🤖*`;

    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: comment
    });

    core.info('💬 PR comment created');
  } catch (error) {
    core.warning(`Failed to create PR comment: ${error.message}`);
  }
}

// Run the action
run();
