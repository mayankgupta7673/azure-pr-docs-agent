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

// ...remaining code unchanged...

// Run the action
run();
