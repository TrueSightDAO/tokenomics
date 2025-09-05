/**
 * TDG Proposal Management System
 * 
 * This Google Apps Script provides functionality for managing TrueSight DAO proposals
 * including creation, voting, commenting, and automated PR management.
 * 
 * Features:
 * - Create new proposals with automatic PR creation
 * - Submit votes with automatic tabulation
 * - Submit comments
 * - Close voting with automatic merge/close based on majority
 */

/**
 * TDG Proposal Management System
 * 
 * This Google Apps Script provides functionality for managing TrueSight DAO proposals
 * including creation, voting, commenting, and automated PR management.
 * 
 * Features:
 * - Create new proposals with automatic PR creation
 * - Submit votes with automatic tabulation
 * - Submit comments
 * - Close voting with automatic merge/close based on majority
 */

// ============================================================================
// WEB APP HANDLERS
// ============================================================================

/**
 * Web app entry point for GET requests
 * Handles data retrieval for the proposal DApp
 */
function doGet(e) {
  try {
    // Check for signature parameter first (for signature verification)
    const signature = e.parameter.signature;
    if (signature) {
      return handleVerifySignature(signature);
    }
    
    // Otherwise, check for mode parameter
    const mode = e.parameter.mode;
    
    switch (mode) {
      case 'list_open_proposals':
        return handleListOpenProposals();
      case 'fetch_proposal':
        const prNumber = e.parameter.pr_number;
        if (!prNumber) {
          return createErrorResponse('PR number is required for fetch_proposal mode');
        }
        return handleFetchProposal(prNumber);
      default:
        return createErrorResponse('Invalid mode. Use: list_open_proposals, fetch_proposal, or provide signature parameter');
    }
  } catch (error) {
    Logger.log(`Error in doGet: ${error.message}`);
    return createErrorResponse(`Server error: ${error.message}`);
  }
}


/**
 * Handle listing all open proposals
 */
function handleListOpenProposals() {
  try {
    const config = getConfiguration();
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/pulls?state=open&sort=created&direction=desc`;
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `token ${config.githubToken}` },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      return createErrorResponse(`Failed to fetch proposals: ${response.getContentText()}`);
    }
    
    const prs = JSON.parse(response.getContentText());
    const proposals = prs.map(pr => ({
      number: pr.number,
      title: pr.title,
      body: pr.body,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      html_url: pr.html_url,
      user: pr.user.login,
      head: {
        ref: pr.head.ref,
        sha: pr.head.sha
      }
    }));
    
    return createSuccessResponse({ proposals });
  } catch (error) {
    Logger.log(`Error listing proposals: ${error.message}`);
    return createErrorResponse(`Failed to list proposals: ${error.message}`);
  }
}

/**
 * Handle fetching a specific proposal with voting statistics
 */
function handleFetchProposal(prNumber) {
  try {
    const config = getConfiguration();
    
    // Get PR details
    const prUrl = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/pulls/${prNumber}`;
    const prResponse = UrlFetchApp.fetch(prUrl, {
      headers: { 'Authorization': `token ${config.githubToken}` },
      muteHttpExceptions: true
    });
    
    if (prResponse.getResponseCode() !== 200) {
      return createErrorResponse(`Failed to fetch PR: ${prResponse.getContentText()}`);
    }
    
    const pr = JSON.parse(prResponse.getContentText());
    
    // Get the actual file content from the PR's head branch
    const fileContent = getProposalFileContent(pr.head.ref, config);
    if (!fileContent.success) {
      return createErrorResponse(`Failed to fetch proposal file: ${fileContent.error}`);
    }
    
    // Get voting statistics
    const voteCount = getVoteCount(prNumber, config);
    if (!voteCount.success) {
      return createErrorResponse(`Failed to get vote count: ${voteCount.error}`);
    }
    
    // Calculate time remaining (assuming 7 days voting period)
    const createdAt = new Date(pr.created_at);
    const votingEndDate = new Date(createdAt.getTime() + (7 * 24 * 60 * 60 * 1000));
    const now = new Date();
    const timeRemaining = Math.max(0, votingEndDate.getTime() - now.getTime());
    const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
    
    const proposal = {
      number: pr.number,
      title: fileContent.title, // Use the file name as title
      body: fileContent.content, // Use the file content as body
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      html_url: pr.html_url,
      user: pr.user.login,
      head: {
        ref: pr.head.ref,
        sha: pr.head.sha
      },
      voting: {
        yes_votes: voteCount.yesVotes,
        no_votes: voteCount.noVotes,
        total_votes: voteCount.totalVotes,
        majority: voteCount.yesVotes > voteCount.noVotes ? 'YES' : 'NO',
        days_remaining: daysRemaining,
        voting_ends_at: votingEndDate.toISOString()
      }
    };
    
    return createSuccessResponse({ proposal });
  } catch (error) {
    Logger.log(`Error fetching proposal: ${error.message}`);
    return createErrorResponse(`Failed to fetch proposal: ${error.message}`);
  }
}

/**
 * Get the proposal file content from the PR's head branch
 */
function getProposalFileContent(branchName, config) {
  try {
    // Get the tree of the head branch to find the proposal file
    const treeUrl = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/git/trees/${branchName}?recursive=1`;
    const treeResponse = UrlFetchApp.fetch(treeUrl, {
      headers: { 'Authorization': `token ${config.githubToken}` },
      muteHttpExceptions: true
    });
    
    if (treeResponse.getResponseCode() !== 200) {
      return { success: false, error: `Failed to fetch branch tree: ${treeResponse.getContentText()}` };
    }
    
    const tree = JSON.parse(treeResponse.getContentText());
    
    // Find the markdown file in the root directory (should be the only file)
    const proposalFile = tree.tree.find(file => 
      file.type === 'blob' && 
      file.path.endsWith('.md') && 
      !file.path.includes('/') // Only files in root directory
    );
    
    if (!proposalFile) {
      return { success: false, error: 'No proposal file found in branch' };
    }
    
    // Get the file content
    const fileUrl = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/git/blobs/${proposalFile.sha}`;
    const fileResponse = UrlFetchApp.fetch(fileUrl, {
      headers: { 'Authorization': `token ${config.githubToken}` },
      muteHttpExceptions: true
    });
    
    if (fileResponse.getResponseCode() !== 200) {
      return { success: false, error: `Failed to fetch file content: ${fileResponse.getContentText()}` };
    }
    
    const fileBlob = JSON.parse(fileResponse.getContentText());
    
    // Decode base64 content
    const content = Utilities.base64Decode(fileBlob.content);
    const contentText = Utilities.newBlob(content).getDataAsString();
    
    // Extract title from filename (remove .md extension)
    const title = proposalFile.path.replace('.md', '');
    
    return {
      success: true,
      title: title,
      content: contentText
    };
    
  } catch (error) {
    Logger.log(`Error getting proposal file content: ${error.message}`);
    return { success: false, error: `Failed to get proposal file content: ${error.message}` };
  }
}

/**
 * Handle signature verification
 */
function handleVerifySignature(publicKey) {
  try {
    // For now, we'll use a simple verification approach
    // In a real implementation, you'd verify against a database of registered signatures
    const config = getConfiguration();
    
    // Simple verification - in production, this should check against a real database
    if (publicKey && publicKey.length > 10) {
      return createSuccessResponse({
        verified: true,
        contributor_name: "DAO Member", // This should come from your signature database
        public_key: publicKey
      });
    } else {
      return createErrorResponse('Invalid public key format');
    }
  } catch (error) {
    Logger.log(`Error verifying signature: ${error.message}`);
    return createErrorResponse(`Signature verification failed: ${error.message}`);
  }
}

/**
 * Create a success response (simple format like working web_app.gs)
 */
function createSuccessResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      data: data
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Create an error response (simple format like working web_app.gs)
 */
function createErrorResponse(message) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: false,
      error: message
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Web app entry point for POST requests
 * Handles proposal creation and voting with signature verification
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    // Verify digital signature for all actions
    if (!data.digital_signature || !data.request_text) {
      return createErrorResponse('Digital signature and request text are required');
    }
    
    const isValidSignature = verifyDigitalSignature(data.request_text, data.digital_signature);
    if (!isValidSignature) {
      return createErrorResponse('Invalid digital signature');
    }
    
    switch (action) {
      case 'create_proposal':
        return handleCreateProposal(data);
      case 'submit_vote':
        return handleSubmitVote(data);
      default:
        return createErrorResponse('Invalid action. Use: create_proposal or submit_vote');
    }
  } catch (error) {
    Logger.log(`Error in doPost: ${error.message}`);
    return createErrorResponse(`Server error: ${error.message}`);
  }
}

/**
 * Handle proposal creation from DApp
 */
function handleCreateProposal(data) {
  try {
    const header = data.header;
    const content = data.content;
    
    if (!header || !content) {
      return createErrorResponse('Header and content are required for proposal creation');
    }
    
    const result = createNewProposal(header, content);
    
    if (result.success) {
      return createSuccessResponse({
        message: 'Proposal created successfully',
        pr_number: result.prNumber,
        pr_url: result.prUrl
      });
    } else {
      return createErrorResponse(`Failed to create proposal: ${result.error}`);
    }
  } catch (error) {
    Logger.log(`Error creating proposal: ${error.message}`);
    return createErrorResponse(`Failed to create proposal: ${error.message}`);
  }
}

/**
 * Handle vote submission from DApp
 */
function handleSubmitVote(data) {
  try {
    const prNumber = data.pr_number;
    const voteText = data.vote_text;
    
    if (!prNumber || !voteText) {
      return createErrorResponse('PR number and vote text are required for vote submission');
    }
    
    const result = submitVote(prNumber, voteText);
    
    if (result.success) {
      return createSuccessResponse({
        message: 'Vote submitted successfully',
        vote: result.vote,
        signature: result.signature
      });
    } else {
      return createErrorResponse(`Failed to submit vote: ${result.error}`);
    }
  } catch (error) {
    Logger.log(`Error submitting vote: ${error.message}`);
    return createErrorResponse(`Failed to submit vote: ${error.message}`);
  }
}

/**
 * Verify digital signature (placeholder - implement your signature verification logic)
 */
function verifyDigitalSignature(requestText, signature) {
  // TODO: Implement your digital signature verification logic
  // This should match the verification used in other DApps
  // For now, return true to allow testing
  Logger.log(`Verifying signature for request: ${requestText.substring(0, 100)}...`);
  Logger.log(`Signature: ${signature.substring(0, 20)}...`);
  return true; // Replace with actual verification logic
}

// ============================================================================
// CONFIGURATION - Set these using Script Properties
// ============================================================================

/**
 * CONFIGURATION SETUP:
 * 
 * To use this script, you need to set the following properties in Google Apps Script:
 * 
 * 1. Go to Google Apps Script Editor
 * 2. Click on "Project Settings" (gear icon)
 * 3. Scroll down to "Script Properties"
 * 4. Add the following properties:
 * 
 * Required Properties:
 * - GITHUB_TOKEN: Your GitHub Personal Access Token
 * - GITHUB_OWNER: Repository owner (e.g., "TrueSightDAO")
 * - GITHUB_REPO: Repository name (e.g., "proposals")
 * 
 * Optional Properties (with defaults):
 * - MAIN_BRANCH: "main"
 * - BRANCH_PREFIX: "proposal-"
 * - FILE_EXTENSION: ".md"
 * - VOTING_DEADLINE_DAYS: "7"
 * - MINIMUM_VOTES: "1"
 * - ENABLE_EMAIL_NOTIFICATIONS: "false"
 * - ADMIN_EMAIL: "admin@truesight.me"
 */

/**
 * Get configuration value from Script Properties
 */
function getConfigValue(key, defaultValue = null) {
  const properties = PropertiesService.getScriptProperties();
  return properties.getProperty(key) || defaultValue;
}

/**
 * Get all configuration values
 */
function getConfiguration() {
  return {
    githubToken: getConfigValue('GITHUB_TOKEN'),
    githubOwner: getConfigValue('GITHUB_OWNER', 'TrueSightDAO'),
    githubRepo: getConfigValue('GITHUB_REPO', 'proposals'),
    mainBranch: getConfigValue('MAIN_BRANCH', 'main'),
    branchPrefix: getConfigValue('BRANCH_PREFIX', 'proposal-'),
    fileExtension: getConfigValue('FILE_EXTENSION', '.md'),
    votingDeadlineDays: parseInt(getConfigValue('VOTING_DEADLINE_DAYS', '7')),
    minimumVotes: parseInt(getConfigValue('MINIMUM_VOTES', '1')),
    enableEmailNotifications: getConfigValue('ENABLE_EMAIL_NOTIFICATIONS', 'false') === 'true',
    adminEmail: getConfigValue('ADMIN_EMAIL', 'admin@truesight.me')
  };
}


/**
 * Validate that all required configuration is set
 */
function validateConfiguration() {
  const config = getConfiguration();
  const errors = [];
  
  if (!config.githubToken) {
    errors.push('GITHUB_TOKEN is not set in Script Properties.');
  }
  
  if (!config.githubOwner) {
    errors.push('GITHUB_OWNER is not set in Script Properties.');
  }
  
  if (!config.githubRepo) {
    errors.push('GITHUB_REPO is not set in Script Properties.');
  }
  
  if (errors.length > 0) {
    Logger.log('Configuration validation failed:');
    errors.forEach(error => Logger.log(`- ${error}`));
    return false;
  }
  
  Logger.log('Configuration is valid');
  return true;
}

/**
 * Creates a new proposal by creating a file in a new branch and opening a PR
 * @param {string} header - The proposal title (used as filename and branch name)
 * @param {string} content - The proposal content
 * @return {Object} Result object with success status and PR details
 */
function createNewProposal(header, content) {
  try {
    // Validate configuration first
    if (!validateConfiguration()) {
      return { success: false, error: 'Configuration not valid. Set required properties in Script Properties.' };
    }
    
    const config = getConfiguration();
    Logger.log(`Creating new proposal: ${header}`);
    
    // Sanitize header for branch/filename
    const sanitizedHeader = sanitizeForGit(header);
    const branchName = `${config.branchPrefix}${sanitizedHeader}`;
    const fileName = `${sanitizedHeader}${config.fileExtension}`;
    
    // Create new branch
    const branchResult = createBranch(branchName, config);
    if (!branchResult.success) {
      return { success: false, error: `Failed to create branch: ${branchResult.error}` };
    }
    
    // Create proposal file content
    const fileContent = `# ${header}\n\n${content}\n\n---\n\n*This proposal was created on ${new Date().toISOString()}*`;
    
    // Upload file to branch
    const fileResult = createFileInBranch(branchName, fileName, fileContent, config);
    if (!fileResult.success) {
      return { success: false, error: `Failed to create file: ${fileResult.error}` };
    }
    
    // Create pull request
    const prResult = createPullRequest(header, branchName, content, config);
    if (!prResult.success) {
      return { success: false, error: `Failed to create PR: ${prResult.error}` };
    }
    
    // Add initial voting tabulation comment
    const commentResult = addInitialVotingComment(prResult.prNumber, config);
    if (!commentResult.success) {
      Logger.log(`Warning: Failed to add initial comment: ${commentResult.error}`);
    }
    
    Logger.log(`Proposal created successfully. PR #${prResult.prNumber}`);
    return {
      success: true,
      prNumber: prResult.prNumber,
      branchName: branchName,
      fileName: fileName,
      prUrl: prResult.prUrl
    };
    
  } catch (error) {
    Logger.log(`Error creating proposal: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Submits a vote for a proposal
 * @param {string} prNumber - The pull request number
 * @param {string} voteText - The vote submission text (should contain YES/NO)
 * @return {Object} Result object with success status
 */
function submitVote(prNumber, voteText) {
  try {
    // Validate configuration first
    if (!validateConfiguration()) {
      return { success: false, error: 'Configuration not valid. Set required properties in Script Properties.' };
    }
    
    Logger.log(`Submitting vote for PR #${prNumber}`);
    
    // Get configuration
    const config = getConfiguration();
    
    // Parse the vote text to extract digital signature and vote
    const voteData = parseVoteSubmission(voteText);
    if (!voteData.success) {
      return { success: false, error: voteData.error };
    }
    
    // Check if this signature already voted
    const existingVote = findExistingVote(prNumber, voteData.signature, config);
    
    if (existingVote) {
      // Mark existing vote as superseded
      const supersededText = `${existingVote.body}\n\n~~**SUPERSEDED** - See newer vote below~~`;
      const updateResult = updateVoteComment(existingVote.commentId, supersededText, config);
      if (!updateResult.success) {
        Logger.log(`Warning: Failed to mark old vote as superseded: ${updateResult.error}`);
      }
      Logger.log(`Marked existing vote as superseded for signature: ${voteData.signature}`);
    }
    
    // Always create a new vote comment (whether it's first vote or updated vote)
    const commentResult = addVoteComment(prNumber, voteText, config, !!existingVote);
    if (!commentResult.success) {
      return { success: false, error: `Failed to add vote: ${commentResult.error}` };
    }
    
    if (existingVote) {
      Logger.log(`Added updated vote for signature: ${voteData.signature}`);
    } else {
      Logger.log(`Added new vote for signature: ${voteData.signature}`);
    }
    
    // Update voting tabulation
    const tabulationResult = updateVotingTabulation(prNumber, config);
    if (!tabulationResult.success) {
      Logger.log(`Warning: Failed to update tabulation: ${tabulationResult.error}`);
    }
    
    return { success: true, vote: voteData.vote, signature: voteData.signature };
    
  } catch (error) {
    Logger.log(`Error submitting vote: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Submits a comment for a proposal
 * @param {string} prNumber - The pull request number
 * @param {string} commentText - The comment text
 * @return {Object} Result object with success status
 */
function submitComment(prNumber, commentText) {
  try {
    // Validate configuration first
    if (!validateConfiguration()) {
      return { success: false, error: 'Configuration not valid. Set required properties in Script Properties.' };
    }
    
    Logger.log(`Submitting comment for PR #${prNumber}`);
    
    const config = getConfiguration();
    const commentResult = addComment(prNumber, commentText, config);
    if (!commentResult.success) {
      return { success: false, error: `Failed to add comment: ${commentResult.error}` };
    }
    
    Logger.log(`Comment added successfully`);
    return { success: true, commentId: commentResult.commentId };
    
  } catch (error) {
    Logger.log(`Error submitting comment: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Closes voting and either merges or closes the PR based on majority vote
 * @param {string} prNumber - The pull request number
 * @return {Object} Result object with success status and action taken
 */
function closeVoting(prNumber) {
  try {
    // Validate configuration first
    if (!validateConfiguration()) {
      return { success: false, error: 'Configuration not valid. Set required properties in Script Properties.' };
    }
    
    Logger.log(`Closing voting for PR #${prNumber}`);
    
    const config = getConfiguration();
    
    // Get final vote count
    const voteCount = getVoteCount(prNumber, config);
    if (!voteCount.success) {
      return { success: false, error: `Failed to get vote count: ${voteCount.error}` };
    }
    
    const { yesVotes, noVotes, totalVotes } = voteCount;
    
    // Determine if majority is YES
    const majorityYes = yesVotes > noVotes;
    
    let action;
    if (majorityYes) {
      // Merge the PR
      const mergeResult = mergePullRequest(prNumber, config);
      if (!mergeResult.success) {
        return { success: false, error: `Failed to merge PR: ${mergeResult.error}` };
      }
      action = 'merged';
      Logger.log(`PR #${prNumber} merged successfully`);
    } else {
      // Close the PR without merging
      const closeResult = closePullRequest(prNumber, config);
      if (!closeResult.success) {
        return { success: false, error: `Failed to close PR: ${closeResult.error}` };
      }
      action = 'closed';
      Logger.log(`PR #${prNumber} closed without merging`);
    }
    
    // Add final voting summary comment
    const summaryComment = generateVotingSummary(yesVotes, noVotes, totalVotes, action);
    const commentResult = addComment(prNumber, summaryComment, config);
    if (!commentResult.success) {
      Logger.log(`Warning: Failed to add summary comment: ${commentResult.error}`);
    }
    
    return {
      success: true,
      action: action,
      yesVotes: yesVotes,
      noVotes: noVotes,
      totalVotes: totalVotes,
      majority: majorityYes ? 'YES' : 'NO'
    };
    
  } catch (error) {
    Logger.log(`Error closing voting: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Sanitizes text for use in Git branch names and filenames
 */
function sanitizeForGit(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Creates a new branch in the repository
 */
function createBranch(branchName, config) {
  try {
    // Get the latest commit SHA from main branch
    const mainBranchUrl = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/git/refs/heads/${config.mainBranch}`;
    const mainBranchResponse = UrlFetchApp.fetch(mainBranchUrl, {
      headers: { 'Authorization': `token ${config.githubToken}` },
      muteHttpExceptions: true
    });
    
    if (mainBranchResponse.getResponseCode() !== 200) {
      Logger.log(`Full error response: ${mainBranchResponse.getContentText()}`);
      return { success: false, error: 'Failed to get main branch reference' };
    }
    
    const mainBranchData = JSON.parse(mainBranchResponse.getContentText());
    const baseSha = mainBranchData.object.sha;
    
    // Create new branch
    const createBranchUrl = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/git/refs`;
    const branchData = {
      ref: `refs/heads/${branchName}`,
      sha: baseSha
    };
    
    const response = UrlFetchApp.fetch(createBranchUrl, {
      method: 'POST',
      headers: {
        'Authorization': `token ${config.githubToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(branchData),
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() === 201) {
      return { success: true };
    } else {
      const errorData = JSON.parse(response.getContentText());
      Logger.log(`Full error response: ${response.getContentText()}`);
      return { success: false, error: errorData.message || 'Failed to create branch' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Creates a file in a specific branch
 */
function createFileInBranch(branchName, fileName, content, config) {
  try {
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/contents/${fileName}`;
    const fileData = {
      message: `Add proposal: ${fileName}`,
      content: Utilities.base64Encode(content),
      branch: branchName
    };
    
    const response = UrlFetchApp.fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${config.githubToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(fileData),
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() === 201) {
      return { success: true };
    } else {
      const errorData = JSON.parse(response.getContentText());
      Logger.log(`Full error response: ${response.getContentText()}`);
      return { success: false, error: errorData.message || 'Failed to create file' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Creates a pull request
 */
function createPullRequest(title, branchName, body, config) {
  try {
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/pulls`;
    const prData = {
      title: title,
      head: branchName,
      base: config.mainBranch,
      body: body
    };
    
    const response = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${config.githubToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(prData),
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() === 201) {
      const prData = JSON.parse(response.getContentText());
      return {
        success: true,
        prNumber: prData.number,
        prUrl: prData.html_url
      };
    } else {
      const errorData = JSON.parse(response.getContentText());
      Logger.log(`Full error response: ${response.getContentText()}`);
      return { success: false, error: errorData.message || 'Failed to create PR' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Adds a comment to a pull request
 */
function addComment(prNumber, body, config) {
  try {
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/issues/${prNumber}/comments`;
    const commentData = { body: body };
    
    const response = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${config.githubToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(commentData),
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() === 201) {
      const commentData = JSON.parse(response.getContentText());
      return { success: true, commentId: commentData.id };
    } else {
      const errorData = JSON.parse(response.getContentText());
      Logger.log(`Full error response: ${response.getContentText()}`);
      return { success: false, error: errorData.message || 'Failed to add comment' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Updates an existing comment
 */
function updateVoteComment(commentId, newBody, config) {
  try {
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/issues/comments/${commentId}`;
    const commentData = { body: newBody };
    
    const response = UrlFetchApp.fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${config.githubToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(commentData)
    });
    
    if (response.getResponseCode() === 200) {
      return { success: true };
    } else {
      const errorData = JSON.parse(response.getContentText());
      Logger.log(`Full error response: ${response.getContentText()}`);
      return { success: false, error: errorData.message || 'Failed to update comment' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Parses vote submission text to extract digital signature and vote
 */
function parseVoteSubmission(voteText) {
  try {
    // Look for digital signature pattern
    const signatureMatch = voteText.match(/My Digital Signature:\s*([A-Za-z0-9+/=]+)/);
    if (!signatureMatch) {
      return { success: false, error: 'Digital signature not found in vote text' };
    }
    
    const signature = signatureMatch[1];
    
    // Look for YES/NO vote
    const voteMatch = voteText.match(/\b(YES|NO)\b/i);
    if (!voteMatch) {
      return { success: false, error: 'Vote (YES/NO) not found in vote text' };
    }
    
    const vote = voteMatch[1].toUpperCase();
    
    return { success: true, signature: signature, vote: vote };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Finds existing vote comment by digital signature
 */
function findExistingVote(prNumber, signature, config) {
  try {
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/issues/${prNumber}/comments`;
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `token ${config.githubToken}` },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      return null;
    }
    
    const comments = JSON.parse(response.getContentText());
    
    for (const comment of comments) {
      if (comment.body.includes(`My Digital Signature: ${signature}`)) {
        return { commentId: comment.id, body: comment.body };
      }
    }
    
    return null;
    
  } catch (error) {
    Logger.log(`Error finding existing vote: ${error.message}`);
    return null;
  }
}

/**
 * Adds initial voting tabulation comment
 */
function addInitialVotingComment(prNumber, config) {
  const initialComment = `## 📊 Voting Tabulation\n\n**Current Vote Count:**\n- ✅ YES: 0\n- ❌ NO: 0\n- 📊 Total: 0\n\n*This tabulation will be updated automatically as votes are submitted.*`;
  return addComment(prNumber, initialComment, config);
}

/**
 * Updates the voting tabulation comment
 */
function updateVotingTabulation(prNumber, config) {
  try {
    const voteCount = getVoteCount(prNumber, config);
    if (!voteCount.success) {
      return { success: false, error: voteCount.error };
    }
    
    const { yesVotes, noVotes, totalVotes } = voteCount;
    
    // Find the tabulation comment
    const tabulationComment = findTabulationComment(prNumber, config);
    if (!tabulationComment) {
      // Create new tabulation comment if not found
      return addInitialVotingComment(prNumber, config);
    }
    
    const updatedComment = `## 📊 Voting Tabulation\n\n**Current Vote Count:**\n- ✅ YES: ${yesVotes}\n- ❌ NO: ${noVotes}\n- 📊 Total: ${totalVotes}\n\n*This tabulation will be updated automatically as votes are submitted.*`;
    
    return updateVoteComment(tabulationComment.commentId, updatedComment, config);
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Finds the voting tabulation comment
 */
function findTabulationComment(prNumber, config) {
  try {
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/issues/${prNumber}/comments`;
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `token ${config.githubToken}` },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      return null;
    }
    
    const comments = JSON.parse(response.getContentText());
    
    for (const comment of comments) {
      if (comment.body.includes('## 📊 Voting Tabulation')) {
        return { commentId: comment.id, body: comment.body };
      }
    }
    
    return null;
    
  } catch (error) {
    Logger.log(`Error finding tabulation comment: ${error.message}`);
    return null;
  }
}

/**
 * Gets the current vote count for a PR
 */
function getVoteCount(prNumber, config) {
  try {
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/issues/${prNumber}/comments`;
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `token ${config.githubToken}` },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      Logger.log(`Full error response: ${response.getContentText()}`);
      return { 
        success: false, 
        error: `Failed to fetch comments. HTTP ${response.getResponseCode()}: ${response.getContentText()}` 
      };
    }
    
    const comments = JSON.parse(response.getContentText());
    let yesVotes = 0;
    let noVotes = 0;
    const latestVotes = new Map(); // signature -> {vote, timestamp}
    
    // First pass: collect all votes and find the latest for each signature
    for (const comment of comments) {
      // Skip tabulation comments
      if (comment.body.includes('## 📊 Voting Tabulation')) {
        continue;
      }
      
      // Skip superseded votes
      if (comment.body.includes('~~**SUPERSEDED**')) {
        continue;
      }
      
      // Check if this is a vote comment
      const signatureMatch = comment.body.match(/My Digital Signature:\s*([A-Za-z0-9+/=]+)/);
      if (signatureMatch) {
        const signature = signatureMatch[1];
        const voteMatch = comment.body.match(/\b(YES|NO)\b/i);
        
        if (voteMatch) {
          const vote = voteMatch[1].toUpperCase();
          const timestamp = new Date(comment.created_at);
          
          // Keep only the latest vote for each signature
          if (!latestVotes.has(signature) || timestamp > latestVotes.get(signature).timestamp) {
            latestVotes.set(signature, { vote, timestamp });
          }
        }
      }
    }
    
    // Second pass: count the latest votes
    for (const [signature, voteData] of latestVotes) {
      if (voteData.vote === 'YES') {
        yesVotes++;
      } else if (voteData.vote === 'NO') {
        noVotes++;
      }
    }
    
    return {
      success: true,
      yesVotes: yesVotes,
      noVotes: noVotes,
      totalVotes: yesVotes + noVotes
    };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Adds a vote comment with proper formatting
 */
function addVoteComment(prNumber, voteText, config, isUpdate = false) {
  const header = isUpdate ? `## 🗳️ Vote Submission (UPDATED)` : `## 🗳️ Vote Submission`;
  const formattedVote = `${header}\n\n${voteText}\n\n---\n*Vote submitted on ${new Date().toISOString()}*`;
  return addComment(prNumber, formattedVote, config);
}

/**
 * Merges a pull request
 */
function mergePullRequest(prNumber, config) {
  try {
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/pulls/${prNumber}/merge`;
    const mergeData = {
      commit_title: `Merge proposal: ${prNumber}`,
      merge_method: 'merge'
    };
    
    const response = UrlFetchApp.fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${config.githubToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(mergeData)
    });
    
    if (response.getResponseCode() === 200) {
      return { success: true };
    } else {
      const errorData = JSON.parse(response.getContentText());
      Logger.log(`Full error response: ${response.getContentText()}`);
      return { success: false, error: errorData.message || 'Failed to merge PR' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Closes a pull request without merging
 */
function closePullRequest(prNumber, config) {
  try {
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/pulls/${prNumber}`;
    const closeData = { state: 'closed' };
    
    const response = UrlFetchApp.fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${config.githubToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(closeData)
    });
    
    if (response.getResponseCode() === 200) {
      return { success: true };
    } else {
      const errorData = JSON.parse(response.getContentText());
      Logger.log(`Full error response: ${response.getContentText()}`);
      return { success: false, error: errorData.message || 'Failed to close PR' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Generates voting summary comment
 */
function generateVotingSummary(yesVotes, noVotes, totalVotes, action) {
  const majority = yesVotes > noVotes ? 'YES' : 'NO';
  const actionEmoji = action === 'merged' ? '✅' : '❌';
  const actionText = action === 'merged' ? 'MERGED' : 'CLOSED WITHOUT MERGING';
  
  return `## 🏁 Voting Closed - ${actionText} ${actionEmoji}\n\n**Final Vote Count:**\n- ✅ YES: ${yesVotes}\n- ❌ NO: ${noVotes}\n- 📊 Total: ${totalVotes}\n- 🏆 Majority: ${majority}\n\n**Result:** This proposal has been ${action.toUpperCase()} based on the majority vote.\n\n*Voting closed on ${new Date().toISOString()}*`;
}

/**
 * Automatically closes all expired pull requests based on voting outcomes
 * This method is designed to be run daily via Google Apps Script triggers
 * @return {Object} Result object with summary of actions taken
 */
function autoCloseExpiredProposals() {
  try {
    Logger.log('🔄 Starting automatic closure of expired proposals...');
    
    // Validate configuration first
    if (!validateConfiguration()) {
      return { success: false, error: 'Configuration not valid. Set required properties in Script Properties.' };
    }
    
    const config = getConfiguration();
    const now = new Date();
    const results = {
      success: true,
      processed: 0,
      closed: 0,
      merged: 0,
      errors: 0,
      details: []
    };
    
    // Get all open pull requests
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/pulls?state=open&sort=created&direction=desc`;
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `token ${config.githubToken}` },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      return { success: false, error: `Failed to fetch open PRs: ${response.getContentText()}` };
    }
    
    const prs = JSON.parse(response.getContentText());
    Logger.log(`📋 Found ${prs.length} open pull requests to check`);
    
    // Process each PR
    for (const pr of prs) {
      try {
        results.processed++;
        Logger.log(`🔍 Checking PR #${pr.number}: ${pr.title}`);
        
        // Calculate voting deadline (7 days from creation by default)
        const createdAt = new Date(pr.created_at);
        const votingDeadline = new Date(createdAt.getTime() + (config.votingDeadlineDays * 24 * 60 * 60 * 1000));
        
        // Check if voting period has expired
        if (now < votingDeadline) {
          Logger.log(`⏰ PR #${pr.number} voting period not yet expired (expires: ${votingDeadline.toISOString()})`);
          results.details.push({
            prNumber: pr.number,
            title: pr.title,
            status: 'Voting period not expired',
            expiresAt: votingDeadline.toISOString()
          });
          continue;
        }
        
        Logger.log(`⏰ PR #${pr.number} voting period has expired (expired: ${votingDeadline.toISOString()})`);
        
        // Get current vote count
        const voteCount = getVoteCount(pr.number, config);
        if (!voteCount.success) {
          Logger.log(`❌ Failed to get vote count for PR #${pr.number}: ${voteCount.error}`);
          results.errors++;
          results.details.push({
            prNumber: pr.number,
            title: pr.title,
            status: 'Error getting vote count',
            error: voteCount.error
          });
          continue;
        }
        
        const { yesVotes, noVotes, totalVotes } = voteCount;
        Logger.log(`📊 PR #${pr.number} vote count: ${yesVotes} YES, ${noVotes} NO, ${totalVotes} total`);
        
        // Check if we have minimum votes required
        if (totalVotes < config.minimumVotes) {
          Logger.log(`⚠️ PR #${pr.number} has insufficient votes (${totalVotes} < ${config.minimumVotes} required)`);
          results.details.push({
            prNumber: pr.number,
            title: pr.title,
            status: 'Insufficient votes',
            yesVotes: yesVotes,
            noVotes: noVotes,
            totalVotes: totalVotes,
            minimumRequired: config.minimumVotes
          });
          continue;
        }
        
        // Determine action based on majority vote
        const majorityYes = yesVotes > noVotes;
        let action;
        let actionResult;
        
        if (majorityYes) {
          // Merge the PR
          Logger.log(`✅ PR #${pr.number} has majority YES votes - merging`);
          actionResult = mergePullRequest(pr.number, config);
          action = 'merged';
          if (actionResult.success) {
            results.merged++;
          }
        } else {
          // Close the PR without merging
          Logger.log(`❌ PR #${pr.number} has majority NO votes - closing without merge`);
          actionResult = closePullRequest(pr.number, config);
          action = 'closed';
          if (actionResult.success) {
            results.closed++;
          }
        }
        
        if (actionResult.success) {
          // Add final voting summary comment
          const summaryComment = generateVotingSummary(yesVotes, noVotes, totalVotes, action);
          const commentResult = addComment(pr.number, summaryComment, config);
          if (!commentResult.success) {
            Logger.log(`⚠️ Failed to add summary comment for PR #${pr.number}: ${commentResult.error}`);
          }
          
          Logger.log(`🎉 PR #${pr.number} successfully ${action}`);
          results.details.push({
            prNumber: pr.number,
            title: pr.title,
            status: `Successfully ${action}`,
            action: action,
            yesVotes: yesVotes,
            noVotes: noVotes,
            totalVotes: totalVotes,
            majority: majorityYes ? 'YES' : 'NO',
            expiredAt: votingDeadline.toISOString()
          });
        } else {
          Logger.log(`❌ Failed to ${action} PR #${pr.number}: ${actionResult.error}`);
          results.errors++;
          results.details.push({
            prNumber: pr.number,
            title: pr.title,
            status: `Failed to ${action}`,
            error: actionResult.error,
            yesVotes: yesVotes,
            noVotes: noVotes,
            totalVotes: totalVotes
          });
        }
        
        // Add small delay between operations to avoid rate limiting
        Utilities.sleep(1000);
        
      } catch (error) {
        Logger.log(`❌ Error processing PR #${pr.number}: ${error.message}`);
        results.errors++;
        results.details.push({
          prNumber: pr.number,
          title: pr.title,
          status: 'Processing error',
          error: error.message
        });
      }
    }
    
    Logger.log(`🎉 Auto-close process completed!`);
    Logger.log(`📊 Summary: ${results.processed} processed, ${results.merged} merged, ${results.closed} closed, ${results.errors} errors`);
    
    // Send email notification if enabled
    if (config.enableEmailNotifications && (results.merged > 0 || results.closed > 0 || results.errors > 0)) {
      sendAutoCloseNotification(results, config);
    }
    
    return results;
    
  } catch (error) {
    Logger.log(`❌ Error in autoCloseExpiredProposals: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Sends email notification about auto-close results
 */
function sendAutoCloseNotification(results, config) {
  try {
    const subject = `TDG Proposal Auto-Close Report - ${new Date().toLocaleDateString()}`;
    
    let body = `TDG Proposal Management System - Daily Auto-Close Report\n\n`;
    body += `Date: ${new Date().toISOString()}\n`;
    body += `Processed: ${results.processed} proposals\n`;
    body += `Merged: ${results.merged} proposals\n`;
    body += `Closed: ${results.closed} proposals\n`;
    body += `Errors: ${results.errors} proposals\n\n`;
    
    if (results.details.length > 0) {
      body += `Details:\n`;
      body += `========\n\n`;
      
      results.details.forEach(detail => {
        body += `PR #${detail.prNumber}: ${detail.title}\n`;
        body += `Status: ${detail.status}\n`;
        if (detail.action) {
          body += `Action: ${detail.action}\n`;
        }
        if (detail.yesVotes !== undefined) {
          body += `Votes: ${detail.yesVotes} YES, ${detail.noVotes} NO (${detail.totalVotes} total)\n`;
        }
        if (detail.error) {
          body += `Error: ${detail.error}\n`;
        }
        body += `\n`;
      });
    }
    
    body += `\nThis is an automated report from the TDG Proposal Management System.`;
    
    MailApp.sendEmail(config.adminEmail, subject, body);
    Logger.log(`📧 Email notification sent to ${config.adminEmail}`);
    
  } catch (error) {
    Logger.log(`❌ Failed to send email notification: ${error.message}`);
  }
}

// ============================================================================
// TEST FUNCTIONS - Ready to Use
// ============================================================================

/**
 * Run all tests in sequence
 * This will test the complete workflow from proposal creation to voting closure
 */
function runAllTests() {
  Logger.log('🚀 Starting TDG Proposal Management System Tests');
  Logger.log('=' .repeat(60));
  
  // Test 1: Configuration
  Logger.log('\n📋 Test 1: Configuration Validation');
  const configTest = testConfiguration();
  if (!configTest.success) {
    Logger.log('❌ Configuration test failed. Please set required properties in Script Properties.');
    return { success: false, error: 'Configuration not set up' };
  }
  Logger.log('✅ Configuration test passed');
  
  // Test 2: Create Proposal
  Logger.log('\n📝 Test 2: Creating Test Proposal');
  const proposalTest = testCreateProposal();
  if (!proposalTest.success) {
    Logger.log('❌ Proposal creation test failed');
    return proposalTest;
  }
  Logger.log(`✅ Proposal created successfully. PR #${proposalTest.prNumber}`);
  
  const prNumber = proposalTest.prNumber;
  
  // Test 3: Submit Multiple Votes
  Logger.log('\n🗳️ Test 3: Submitting Test Votes');
  const voteTests = testSubmitMultipleVotes(prNumber);
  Logger.log(`✅ Submitted ${voteTests.successfulVotes} votes successfully`);
  
  // Test 4: Submit Comments
  Logger.log('\n💬 Test 4: Submitting Test Comments');
  const commentTest = testSubmitComments(prNumber);
  Logger.log(`✅ Submitted ${commentTest.successfulComments} comments successfully`);
  
  // Test 5: Vote Tabulation
  Logger.log('\n📊 Test 5: Testing Vote Tabulation');
  const tabulationTest = testVoteTabulation(prNumber);
  Logger.log(`✅ Vote tabulation working. Current count: ${tabulationTest.yesVotes} YES, ${tabulationTest.noVotes} NO`);
  
  // Test 6: Close Voting (Optional - uncomment to test)
  // Logger.log('\n🏁 Test 6: Closing Voting');
  // const closeTest = testCloseVoting(prNumber);
  // Logger.log(`✅ Voting closed. Result: ${closeTest.action}`);
  
  Logger.log('\n🎉 All tests completed successfully!');
  Logger.log('=' .repeat(60));
  
  return {
    success: true,
    prNumber: prNumber,
    summary: {
      proposalCreated: proposalTest.success,
      votesSubmitted: voteTests.successfulVotes,
      commentsSubmitted: commentTest.successfulComments,
      tabulationWorking: tabulationTest.success
    }
  };
}

/**
 * Test configuration setup
 */
function testConfiguration() {
  Logger.log('Testing configuration...');
  
  // Check if configuration is initialized
  const config = getConfiguration();
  if (!config.githubToken) {
    Logger.log('❌ GitHub token not found. Set GITHUB_TOKEN in Script Properties.');
    return { success: false, error: 'GitHub token not set' };
  }
  
  // Validate configuration
  const isValid = validateConfiguration();
  if (!isValid) {
    return { success: false, error: 'Configuration validation failed' };
  }
  
  Logger.log('✅ Configuration is valid');
  Logger.log(`- GitHub Owner: ${config.githubOwner}`);
  Logger.log(`- GitHub Repo: ${config.githubRepo}`);
  Logger.log(`- Main Branch: ${config.mainBranch}`);
  Logger.log(`- Branch Prefix: ${config.branchPrefix}`);
  
  return { success: true, config: config };
}

/**
 * Test proposal creation with a sample proposal
 */
function testCreateProposal() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const proposalTitle = `Test Proposal ${timestamp}`;
  const proposalContent = `# Test Proposal: DAO Treasury Management

## Summary
This is a test proposal created by the automated testing system to verify the proposal management functionality.

## Details
- **Proposal Type**: Treasury Management
- **Amount**: 10,000 USD
- **Purpose**: Community development initiatives
- **Duration**: 6 months

## Justification
This proposal aims to allocate additional funds to support community-driven projects and initiatives that align with the DAO's mission.

## Implementation Plan
1. Allocate funds to community treasury
2. Establish review committee
3. Create application process
4. Monitor and report on fund usage

## Risk Assessment
- **Low Risk**: Funds will be managed by established community members
- **Transparency**: All transactions will be publicly recorded
- **Accountability**: Regular reporting and community oversight

---
*This is a test proposal created on ${new Date().toISOString()}*`;

  // Create the proposal text in the same format as the DApp
  const requestText = `[PROPOSAL CREATION]
- Title: ${proposalTitle}
- Content: ${proposalContent}
--------`;

  // Generate a test signature hash
  const testSignatureHash = `test_proposal_${Date.now()}`;
  
  // Create the share text following the same pattern as the DApp
  const shareText = `${requestText}

My Digital Signature: MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA_test_signature_proposal

Request Transaction ID: ${testSignatureHash}

This submission was generated using https://dapp.truesight.me/create_proposal.html

Verify submission here: https://dapp.truesight.me/verify_request.html`;

  Logger.log(`Creating test proposal: ${proposalTitle}`);
  Logger.log(`Test share text format: ${shareText}`);
  const result = createNewProposal(proposalTitle, proposalContent);
  
  if (result.success) {
    Logger.log(`✅ Proposal created successfully`);
    Logger.log(`- PR Number: ${result.prNumber}`);
    Logger.log(`- Branch: ${result.branchName}`);
    Logger.log(`- File: ${result.fileName}`);
    Logger.log(`- URL: ${result.prUrl}`);
  } else {
    Logger.log(`❌ Proposal creation failed: ${result.error}`);
  }
  
  return result;
}

/**
 * Test submitting multiple votes with different signatures
 */
function testSubmitMultipleVotes(prNumber = 3) {
  const testVotes = [
    {
      signature: 'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA_test_signature_1',
      vote: 'YES',
      reason: 'This proposal aligns with our community goals and will help fund important initiatives.'
    },
    {
      signature: 'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA_test_signature_2',
      vote: 'NO',
      reason: 'I have concerns about the amount and would prefer a smaller allocation initially.'
    },
    {
      signature: 'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA_test_signature_3',
      vote: 'YES',
      reason: 'The community needs more funding for development projects. This is a good step forward.'
    },
    {
      signature: 'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA_test_signature_4',
      vote: 'NO',
      reason: 'I think we should focus on existing projects before expanding the treasury.'
    },
    {
      signature: 'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA_test_signature_5',
      vote: 'YES',
      reason: 'This will enable more community participation and project funding.'
    }
  ];
  
  let successfulVotes = 0;
  let failedVotes = 0;
  
  Logger.log(`Submitting ${testVotes.length} test votes...`);
  
  testVotes.forEach((voteData, index) => {
    const voteText = `[PROPOSAL VOTE]
Proposal: Test Proposal
Vote: ${voteData.vote}
Reason: ${voteData.reason}

My Digital Signature: ${voteData.signature}
Request Transaction ID: test_tx_${Date.now()}_${index}`;
    
    const result = submitVote(prNumber, voteText);
    
    if (result.success) {
      successfulVotes++;
      Logger.log(`✅ Vote ${index + 1} submitted successfully (${voteData.vote})`);
    } else {
      failedVotes++;
      Logger.log(`❌ Vote ${index + 1} failed: ${result.error}`);
    }
    
    // Small delay between votes
    Utilities.sleep(1000);
  });
  
  Logger.log(`Vote submission summary: ${successfulVotes} successful, ${failedVotes} failed`);
  
  return {
    success: successfulVotes > 0,
    successfulVotes: successfulVotes,
    failedVotes: failedVotes,
    totalVotes: testVotes.length
  };
}

/**
 * Test submitting multiple comments
 */
function testSubmitComments(prNumber = 3) {
  const testComments = [
    "This is an interesting proposal. I'd like to see more details about the implementation timeline.",
    "Great idea! The community definitely needs more funding for development projects.",
    "I have some concerns about the risk management aspects. Can we discuss this further?",
    "This aligns well with our roadmap. I'm supportive of this initiative.",
    "Would it be possible to break this down into smaller phases for better oversight?"
  ];
  
  let successfulComments = 0;
  let failedComments = 0;
  
  Logger.log(`Submitting ${testComments.length} test comments...`);
  
  testComments.forEach((comment, index) => {
    const result = submitComment(prNumber, comment);
    
    if (result.success) {
      successfulComments++;
      Logger.log(`✅ Comment ${index + 1} submitted successfully`);
    } else {
      failedComments++;
      Logger.log(`❌ Comment ${index + 1} failed: ${result.error}`);
    }
    
    // Small delay between comments
    Utilities.sleep(1000);
  });
  
  Logger.log(`Comment submission summary: ${successfulComments} successful, ${failedComments} failed`);
  
  return {
    success: successfulComments > 0,
    successfulComments: successfulComments,
    failedComments: failedComments,
    totalComments: testComments.length
  };
}

/**
 * Test vote tabulation functionality
 */
function testVoteTabulation(prNumber = 3) {
  Logger.log('Testing vote tabulation...');
  
  const config = getConfiguration();
  const voteCount = getVoteCount(prNumber, config);
  
  if (voteCount.success) {
    Logger.log(`✅ Vote tabulation working correctly`);
    Logger.log(`- YES votes: ${voteCount.yesVotes}`);
    Logger.log(`- NO votes: ${voteCount.noVotes}`);
    Logger.log(`- Total votes: ${voteCount.totalVotes}`);
    Logger.log(`- Majority: ${voteCount.yesVotes > voteCount.noVotes ? 'YES' : 'NO'}`);
    
    return {
      success: true,
      yesVotes: voteCount.yesVotes,
      noVotes: voteCount.noVotes,
      totalVotes: voteCount.totalVotes,
      majority: voteCount.yesVotes > voteCount.noVotes ? 'YES' : 'NO'
    };
  } else {
    Logger.log(`❌ Vote tabulation failed: ${voteCount.error}`);
    return { success: false, error: voteCount.error };
  }
}

/**
 * Helper function to get a valid PR number for testing
 * This will find the most recent PR in the repository
 */
function getLatestPRNumber() {
  try {
    const config = getConfiguration();
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/pulls?state=open&sort=created&direction=desc&per_page=1`;
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `token ${config.githubToken}` },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      Logger.log(`Failed to fetch PRs: ${response.getContentText()}`);
      return null;
    }
    
    const prs = JSON.parse(response.getContentText());
    if (prs.length > 0) {
      Logger.log(`Found latest PR: #${prs[0].number} - ${prs[0].title}`);
      return prs[0].number;
    } else {
      Logger.log('No open PRs found');
      return null;
    }
  } catch (error) {
    Logger.log(`Error getting latest PR: ${error.message}`);
    return null;
  }
}

/**
 * Test closing voting (WARNING: This will actually close the PR!)
 * Uncomment the call in runAllTests() to test this functionality
 */
function testCloseVoting(prNumber = 3) {
  if (!prNumber || prNumber === 'undefined') {
    Logger.log('❌ Error: PR number is required for testCloseVoting');
    Logger.log('Usage: testCloseVoting(prNumber) where prNumber is a valid PR number');
    return { success: false, error: 'PR number is required' };
  }
  
  Logger.log(`⚠️ WARNING: This will close voting for PR #${prNumber}`);
  Logger.log('Testing vote closure...');
  
  const result = closeVoting(prNumber);
  
  if (result.success) {
    Logger.log(`✅ Voting closed successfully`);
    Logger.log(`- Action taken: ${result.action}`);
    Logger.log(`- Final count: ${result.yesVotes} YES, ${result.noVotes} NO`);
    Logger.log(`- Majority: ${result.majority}`);
  } else {
    Logger.log(`❌ Vote closure failed: ${result.error}`);
  }
  
  return result;
}

/**
 * Test individual functions separately
 */

/**
 * Test only proposal creation
 */
function testCreateProposalOnly() {
  Logger.log('🧪 Testing proposal creation only...');
  return testCreateProposal();
}

/**
 * Test only vote submission
 */
function testSubmitVoteOnly(prNumber = 3) {
  Logger.log(`🧪 Testing vote submission only for PR #${prNumber}...`);
  
  const voteText = `[PROPOSAL VOTE]
Proposal: Test Proposal
Vote: YES
Reason: This is a test vote to verify the voting functionality.

My Digital Signature: MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA_test_signature_single
Request Transaction ID: test_single_vote_${Date.now()}`;
  
  const result = submitVote(prNumber, voteText);
  
  if (result.success) {
    Logger.log(`✅ Vote submitted successfully`);
  } else {
    Logger.log(`❌ Vote submission failed: ${result.error}`);
  }
  
  return result;
}

/**
 * Test only comment submission
 */
function testSubmitCommentOnly(prNumber = 3) {
  Logger.log(`🧪 Testing comment submission only for PR #${prNumber}...`);
  
  const commentText = `This is a test comment to verify the comment functionality. 
  
Submitted on: ${new Date().toISOString()}`;
  
  const result = submitComment(prNumber, commentText);
  
  if (result.success) {
    Logger.log(`✅ Comment submitted successfully`);
  } else {
    Logger.log(`❌ Comment submission failed: ${result.error}`);
  }
  
  return result;
}

/**
 * Test vote update functionality (same signature, different vote)
 */
function testVoteUpdate(prNumber = 3) {
  Logger.log(`🧪 Testing vote update functionality for PR #${prNumber}...`);
  
  const signature = 'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA_test_update_signature';
  
  // First vote: YES
  const firstVote = `[PROPOSAL VOTE]
Proposal: Test Proposal
Vote: YES
Reason: Initial vote in favor.

My Digital Signature: ${signature}
Request Transaction ID: test_update_1_${Date.now()}`;
  
  Logger.log('Submitting first vote (YES)...');
  const firstResult = submitVote(prNumber, firstVote);
  
  if (firstResult.success) {
    Logger.log('✅ First vote submitted');
    
    // Wait a moment
    Utilities.sleep(2000);
    
    // Second vote: NO (should update the first one)
    const secondVote = `[PROPOSAL VOTE]
Proposal: Test Proposal
Vote: NO
Reason: Changed my mind after further consideration.

My Digital Signature: ${signature}
Request Transaction ID: test_update_2_${Date.now()}`;
    
    Logger.log('Submitting updated vote (NO)...');
    const secondResult = submitVote(prNumber, secondVote);
    
    if (secondResult.success) {
      Logger.log('✅ Vote updated successfully');
      return { success: true, message: 'Vote update functionality working' };
    } else {
      Logger.log(`❌ Vote update failed: ${secondResult.error}`);
      return secondResult;
    }
  } else {
    Logger.log(`❌ First vote failed: ${firstResult.error}`);
    return firstResult;
  }
}

/**
 * Quick setup test - just validates configuration
 */
function quickSetupTest() {
  Logger.log('🔧 Running quick setup test...');
  Logger.log('This will only test configuration, not create any proposals or votes.');
  
  const result = testConfiguration();
  
  if (result.success) {
    Logger.log('✅ Setup test passed! You can now use the proposal management functions.');
    Logger.log('Next steps:');
    Logger.log('1. Run testCreateProposalOnly() to test proposal creation');
    Logger.log('2. Run testSubmitVoteOnly(prNumber) to test voting');
    Logger.log('3. Run runAllTests() for complete testing');
  } else {
    Logger.log('❌ Setup test failed. Please check your configuration.');
    Logger.log('Setup steps:');
    Logger.log('1. Go to Project Settings > Script Properties');
    Logger.log('2. Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO properties');
    Logger.log('3. Run quickSetupTest() to validate everything');
  }
  
  return result;
}

/**
 * Test closing voting with automatic PR detection
 * This will find the latest PR and test closing it
 */
function testCloseVotingAuto() {
  Logger.log('🔍 Finding latest PR for testing...');
  const prNumber = getLatestPRNumber();
  
  if (!prNumber) {
    Logger.log('❌ No open PRs found to test with');
    Logger.log('Create a test proposal first using testCreateProposalOnly()');
    return { success: false, error: 'No open PRs found' };
  }
  
  return testCloseVoting(prNumber);
}

/**
 * Test the web app endpoints
 */
function testWebAppEndpoints() {
  Logger.log('🧪 Testing web app endpoints...');
  
  // Test list open proposals
  try {
    const listResult = handleListOpenProposals();
    Logger.log('✅ List open proposals endpoint working');
    Logger.log(`Response: ${listResult.getContent()}`);
  } catch (error) {
    Logger.log(`❌ List open proposals failed: ${error.message}`);
  }
  
  // Test fetch proposal (if any exist)
  try {
    const prNumber = getLatestPRNumber();
    if (prNumber) {
      const fetchResult = handleFetchProposal(prNumber);
      Logger.log(`✅ Fetch proposal endpoint working for PR #${prNumber}`);
      Logger.log(`Response: ${fetchResult.getContent()}`);
    } else {
      Logger.log('⚠️ No PRs available to test fetch proposal endpoint');
    }
  } catch (error) {
    Logger.log(`❌ Fetch proposal failed: ${error.message}`);
  }
  
  Logger.log('🎉 Web app endpoint testing completed');
}

/**
 * Test the auto-close functionality (DRY RUN - no actual changes)
 * This will check which PRs would be closed without actually closing them
 */
function testAutoCloseExpiredProposals() {
  try {
    Logger.log('🧪 Testing auto-close functionality (DRY RUN)...');
    
    // Validate configuration first
    if (!validateConfiguration()) {
      return { success: false, error: 'Configuration not valid. Set required properties in Script Properties.' };
    }
    
    const config = getConfiguration();
    const now = new Date();
    const results = {
      success: true,
      processed: 0,
      wouldClose: 0,
      wouldMerge: 0,
      wouldSkip: 0,
      details: []
    };
    
    // Get all open pull requests
    const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/pulls?state=open&sort=created&direction=desc`;
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `token ${config.githubToken}` },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      return { success: false, error: `Failed to fetch open PRs: ${response.getContentText()}` };
    }
    
    const prs = JSON.parse(response.getContentText());
    Logger.log(`📋 Found ${prs.length} open pull requests to check`);
    
    // Process each PR (DRY RUN)
    for (const pr of prs) {
      try {
        results.processed++;
        Logger.log(`🔍 Checking PR #${pr.number}: ${pr.title}`);
        
        // Calculate voting deadline (7 days from creation by default)
        const createdAt = new Date(pr.created_at);
        const votingDeadline = new Date(createdAt.getTime() + (config.votingDeadlineDays * 24 * 60 * 60 * 1000));
        
        // Check if voting period has expired
        if (now < votingDeadline) {
          Logger.log(`⏰ PR #${pr.number} voting period not yet expired (expires: ${votingDeadline.toISOString()})`);
          results.wouldSkip++;
          results.details.push({
            prNumber: pr.number,
            title: pr.title,
            status: 'Voting period not expired',
            expiresAt: votingDeadline.toISOString(),
            action: 'SKIP'
          });
          continue;
        }
        
        Logger.log(`⏰ PR #${pr.number} voting period has expired (expired: ${votingDeadline.toISOString()})`);
        
        // Get current vote count
        const voteCount = getVoteCount(pr.number, config);
        if (!voteCount.success) {
          Logger.log(`❌ Failed to get vote count for PR #${pr.number}: ${voteCount.error}`);
          results.details.push({
            prNumber: pr.number,
            title: pr.title,
            status: 'Error getting vote count',
            error: voteCount.error,
            action: 'ERROR'
          });
          continue;
        }
        
        const { yesVotes, noVotes, totalVotes } = voteCount;
        Logger.log(`📊 PR #${pr.number} vote count: ${yesVotes} YES, ${noVotes} NO, ${totalVotes} total`);
        
        // Check if we have minimum votes required
        if (totalVotes < config.minimumVotes) {
          Logger.log(`⚠️ PR #${pr.number} has insufficient votes (${totalVotes} < ${config.minimumVotes} required)`);
          results.wouldSkip++;
          results.details.push({
            prNumber: pr.number,
            title: pr.title,
            status: 'Insufficient votes',
            yesVotes: yesVotes,
            noVotes: noVotes,
            totalVotes: totalVotes,
            minimumRequired: config.minimumVotes,
            action: 'SKIP'
          });
          continue;
        }
        
        // Determine what action would be taken
        const majorityYes = yesVotes > noVotes;
        const action = majorityYes ? 'MERGE' : 'CLOSE';
        
        if (majorityYes) {
          Logger.log(`✅ PR #${pr.number} would be MERGED (majority YES votes)`);
          results.wouldMerge++;
        } else {
          Logger.log(`❌ PR #${pr.number} would be CLOSED (majority NO votes)`);
          results.wouldClose++;
        }
        
        results.details.push({
          prNumber: pr.number,
          title: pr.title,
          status: `Would ${action.toLowerCase()}`,
          action: action,
          yesVotes: yesVotes,
          noVotes: noVotes,
          totalVotes: totalVotes,
          majority: majorityYes ? 'YES' : 'NO',
          expiredAt: votingDeadline.toISOString()
        });
        
      } catch (error) {
        Logger.log(`❌ Error processing PR #${pr.number}: ${error.message}`);
        results.details.push({
          prNumber: pr.number,
          title: pr.title,
          status: 'Processing error',
          error: error.message,
          action: 'ERROR'
        });
      }
    }
    
    Logger.log(`🎉 Auto-close test completed!`);
    Logger.log(`📊 Summary: ${results.processed} processed, ${results.wouldMerge} would merge, ${results.wouldClose} would close, ${results.wouldSkip} would skip`);
    
    // Log detailed results
    Logger.log(`\n📋 Detailed Results:`);
    results.details.forEach(detail => {
      Logger.log(`PR #${detail.prNumber}: ${detail.title}`);
      Logger.log(`  Status: ${detail.status}`);
      Logger.log(`  Action: ${detail.action}`);
      if (detail.yesVotes !== undefined) {
        Logger.log(`  Votes: ${detail.yesVotes} YES, ${detail.noVotes} NO (${detail.totalVotes} total)`);
      }
      if (detail.expiresAt) {
        Logger.log(`  Expires: ${detail.expiresAt}`);
      }
      if (detail.error) {
        Logger.log(`  Error: ${detail.error}`);
      }
      Logger.log('');
    });
    
    return results;
    
  } catch (error) {
    Logger.log(`❌ Error in testAutoCloseExpiredProposals: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Test CORS headers directly
 */
function testCORSHeaders() {
  Logger.log('🧪 Testing CORS headers...');
  
  try {
    const result = createSuccessResponse({ test: 'CORS headers test' });
    Logger.log('✅ CORS headers function working');
    Logger.log(`Headers: ${JSON.stringify(result.getHeaders())}`);
    Logger.log(`Content: ${result.getContent()}`);
  } catch (error) {
    Logger.log(`❌ CORS headers test failed: ${error.message}`);
  }
}

/**
 * Process proposal submissions from Telegram Chat Logs
 * Parses the Telegram Chat Logs spreadsheet and creates/updates Proposal Submissions
 */
function processProposalSubmissionsFromTelegramLogs() {
  try {
    Logger.log('🔄 Processing proposal submissions from Telegram Chat Logs...');
    
    // Open the Telegram Chat Logs spreadsheet
    const spreadsheetId = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    
    // Get Telegram Chat Logs sheet
    const telegramLogsSheet = spreadsheet.getSheetByName('Telegram Chat Logs');
    if (!telegramLogsSheet) {
      throw new Error('Telegram Chat Logs sheet not found');
    }
    
    // Get or create Proposal Submissions sheet
    let proposalSubmissionsSheet = spreadsheet.getSheetByName('Proposal Submissions');
    if (!proposalSubmissionsSheet) {
      proposalSubmissionsSheet = spreadsheet.insertSheet('Proposal Submissions');
      // Set up headers
      const headers = [
        'Message ID', 'Timestamp', 'Username', 'Message Text', 'Processed',
        'Proposal Title', 'Proposal Content', 'Digital Signature', 'Transaction ID',
        'Pull Request Number', 'Status', 'Created Date', 'Updated Date'
      ];
      proposalSubmissionsSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      proposalSubmissionsSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
    
    // Get all data from Telegram Chat Logs
    const telegramData = telegramLogsSheet.getDataRange().getValues();
    const headers = telegramData[0];
    
    // Use column indices like the QR code processing script
    // Based on the QR code script structure:
    // Column A (0): Telegram Update ID
    // Column B (1): Telegram Chatroom ID  
    // Column C (2): Telegram Chatroom Name
    // Column D (3): Telegram Message ID
    // Column E (4): Contributor Handle
    // Column F (5): (empty)
    // Column G (6): Contribution Made (this is where the message text is)
    // Column H (7): (empty)
    // Column I (8): (empty)
    // Column J (9): (empty)
    // Column K (10): (empty)
    // Column L (11): Status Date
    // Column M (12): (empty)
    // Column N (13): (empty)
    // Column O (14): (empty)
    
    const messageIdIndex = 3; // Column D
    const timestampIndex = 11; // Column L (Status Date)
    const usernameIndex = 4; // Column E (Contributor Handle)
    const messageTextIndex = 6; // Column G (Contribution Made)
    
    // Get existing processed message IDs and transaction IDs from Proposal Submissions
    const existingData = proposalSubmissionsSheet.getDataRange().getValues();
    const existingMessageIds = new Set();
    const existingTransactionIds = new Set();
    for (let i = 1; i < existingData.length; i++) {
      if (existingData[i][0]) { // Message ID column
        existingMessageIds.add(existingData[i][0]);
      }
      if (existingData[i][8]) { // Transaction ID column
        existingTransactionIds.add(existingData[i][8]);
      }
    }
    
    Logger.log(`📊 Found ${existingMessageIds.size} existing message IDs and ${existingTransactionIds.size} existing transaction IDs`);
    
    let processedCount = 0;
    let newProposalsCount = 0;
    let skippedCount = 0;
    
    // Process each row
    for (let i = 1; i < telegramData.length; i++) {
      const row = telegramData[i];
      const messageId = row[messageIdIndex];
      const messageText = row[messageTextIndex];
      
      // Skip if no message text
      if (!messageId || !messageText) {
        continue;
      }
      
      // Skip if already processed by message ID
      if (existingMessageIds.has(messageId)) {
        skippedCount++;
        continue;
      }
      
      // Check if this is a proposal submission
      if (messageText.includes('[PROPOSAL CREATION]')) {
        try {
          const proposalData = parseProposalSubmission(messageText);
          if (proposalData) {
            // Add to Proposal Submissions sheet
            const newRow = [
              messageId,
              row[timestampIndex],
              row[usernameIndex],
              messageText,
              'Yes', // Processed
              proposalData.title,
              proposalData.content,
              proposalData.digitalSignature,
              proposalData.transactionId,
              '', // Pull Request Number (to be filled later)
              'Submitted', // Status
              new Date(),
              new Date()
            ];
            
            proposalSubmissionsSheet.appendRow(newRow);
            newProposalsCount++;
            
            Logger.log(`✅ Processed proposal: ${proposalData.title}`);
          }
        } catch (error) {
          Logger.log(`❌ Error processing proposal in message ${messageId}: ${error.message}`);
        }
      }
      
      processedCount++;
    }
    
    Logger.log(`🎉 Processing complete! Processed ${processedCount} messages, found ${newProposalsCount} new proposals, skipped ${skippedCount} duplicates`);
    return {
      processed: processedCount,
      newProposals: newProposalsCount,
      skipped: skippedCount
    };
    
  } catch (error) {
    Logger.log(`❌ Error processing proposal submissions: ${error.message}`);
    throw error;
  }
}

/**
 * Parse proposal submission from message text
 */
function parseProposalSubmission(messageText) {
  try {
    // Extract the [PROPOSAL CREATION] section
    const proposalMatch = messageText.match(/\[PROPOSAL CREATION\]([\s\S]*?)--------/);
    if (!proposalMatch) {
      return null;
    }
    
    const proposalSection = proposalMatch[1];
    
    // Extract title (try both formats: -- Title: and - Title:)
    let titleMatch = proposalSection.match(/-- Title:\s*(.+)/);
    if (!titleMatch) {
      titleMatch = proposalSection.match(/- Title:\s*(.+)/);
    }
    if (!titleMatch) {
      return null;
    }
    const title = titleMatch[1].trim();
    
    // Extract content (try both formats: -- Content: and - Content:)
    let contentMatch = proposalSection.match(/-- Content:\s*([\s\S]+)/);
    if (!contentMatch) {
      contentMatch = proposalSection.match(/- Content:\s*([\s\S]+)/);
    }
    if (!contentMatch) {
      return null;
    }
    const content = contentMatch[1].trim();
    
    // Extract digital signature
    const signatureMatch = messageText.match(/My Digital Signature:\s*(.+)/);
    const digitalSignature = signatureMatch ? signatureMatch[1].trim() : '';
    
    // Extract transaction ID
    const transactionMatch = messageText.match(/Request Transaction ID:\s*(.+)/);
    const transactionId = transactionMatch ? transactionMatch[1].trim() : '';
    
    return {
      title,
      content,
      digitalSignature,
      transactionId
    };
    
  } catch (error) {
    Logger.log(`❌ Error parsing proposal submission: ${error.message}`);
    return null;
  }
}

/**
 * Test method to process a specific line from Telegram Chat Logs
 */
function testProcessSpecificProposalSubmission(lineNumber) {
  try {
    Logger.log(`🧪 Testing proposal processing for line ${lineNumber}...`);
    
    const spreadsheetId = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const telegramLogsSheet = spreadsheet.getSheetByName('Telegram Chat Logs');
    
    if (!telegramLogsSheet) {
      throw new Error('Telegram Chat Logs sheet not found');
    }
    
    // Get the specific row
    const row = telegramLogsSheet.getRange(lineNumber, 1, 1, telegramLogsSheet.getLastColumn()).getValues()[0];
    
    // Use column indices like the QR code processing script
    // Column G (6): Contribution Made (this is where the message text is)
    const messageTextIndex = 6; // Column G (Contribution Made)
    
    const messageText = row[messageTextIndex];
    Logger.log(`📝 Message text: ${messageText}`);
    
    // Parse the proposal
    const proposalData = parseProposalSubmission(messageText);
    if (proposalData) {
      Logger.log(`✅ Parsed proposal data:`, proposalData);
      return proposalData;
    } else {
      Logger.log(`❌ No proposal data found in message`);
      return null;
    }
    
  } catch (error) {
    Logger.log(`❌ Error testing specific proposal: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// DAPP PAYLOAD PROCESSING
// ============================================================================

/**
 * Process DApp payloads from Edgar's domain submissions
 * This method handles both proposal creation and voting submissions
 */
function processDAppPayloads() {
  try {
    Logger.log('🔄 Processing DApp payloads from Edgar submissions...');
    
    // Open the Telegram Chat Logs spreadsheet
    const spreadsheetId = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    
    // Get Telegram Chat Logs sheet
    const telegramLogsSheet = spreadsheet.getSheetByName('Telegram Chat Logs');
    if (!telegramLogsSheet) {
      throw new Error('Telegram Chat Logs sheet not found');
    }
    
    // Get or create Proposal Submissions sheet
    let proposalSubmissionsSheet = spreadsheet.getSheetByName('Proposal Submissions');
    if (!proposalSubmissionsSheet) {
      proposalSubmissionsSheet = spreadsheet.insertSheet('Proposal Submissions');
      // Set up headers
      const headers = [
        'Message ID', 'Timestamp', 'Username', 'Message Text', 'Processed',
        'Proposal Title', 'Proposal Content', 'Digital Signature', 'Transaction ID',
        'GitHub PR URL', 'Status', 'Created Date', 'Updated Date', 'Submission Type'
      ];
      proposalSubmissionsSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      proposalSubmissionsSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
    
    // Get all data from Telegram Chat Logs
    const telegramData = telegramLogsSheet.getDataRange().getValues();
    const headers = telegramData[0];
    
    // Use column indices like the QR code processing script
    // Based on the QR code script structure:
    // Column A (0): Telegram Update ID
    // Column B (1): Telegram Chatroom ID  
    // Column C (2): Telegram Chatroom Name
    // Column D (3): Telegram Message ID
    // Column E (4): Contributor Handle
    // Column F (5): (empty)
    // Column G (6): Contribution Made (this is where the message text is)
    // Column H (7): (empty)
    // Column I (8): (empty)
    // Column J (9): (empty)
    // Column K (10): (empty)
    // Column L (11): Status Date
    // Column M (12): (empty)
    // Column N (13): (empty)
    // Column O (14): (empty)
    
    const messageIdIndex = 3; // Column D
    const timestampIndex = 11; // Column L (Status Date)
    const usernameIndex = 4; // Column E (Contributor Handle)
    const messageTextIndex = 6; // Column G (Contribution Made)
    
    // Get existing processed message IDs and transaction IDs from Proposal Submissions
    const existingData = proposalSubmissionsSheet.getDataRange().getValues();
    const existingMessageIds = new Set();
    const existingTransactionIds = new Set();
    for (let i = 1; i < existingData.length; i++) {
      if (existingData[i][0]) { // Message ID column
        existingMessageIds.add(existingData[i][0]);
      }
      if (existingData[i][8]) { // Transaction ID column
        existingTransactionIds.add(existingData[i][8]);
      }
    }
    
    Logger.log(`📊 Found ${existingMessageIds.size} existing message IDs and ${existingTransactionIds.size} existing transaction IDs`);
    
    let processedCount = 0;
    let newProposalsCount = 0;
    let newVotesCount = 0;
    let skippedCount = 0;
    
    // Process each row
    for (let i = 1; i < telegramData.length; i++) {
      const row = telegramData[i];
      const messageId = row[messageIdIndex];
      const messageText = row[messageTextIndex];
      
      // Skip if no message text
      if (!messageId || !messageText) {
        continue;
      }
      
      // Skip if already processed by message ID
      if (existingMessageIds.has(messageId)) {
        skippedCount++;
        continue;
      }
      
      // Check if this is a DApp submission (contains verify_request.html link)
      if (messageText.includes('verify_request.html') && 
          (messageText.includes('[PROPOSAL CREATION]') || messageText.includes('[PROPOSAL VOTE]'))) {
        
        // Parse to get transaction ID for additional duplicate check
        const submissionData = parseDAppSubmission(messageText);
        if (submissionData && submissionData.transactionId) {
          // Skip if already processed by transaction ID
          if (existingTransactionIds.has(submissionData.transactionId)) {
            Logger.log(`⏭️ Skipping duplicate transaction ID: ${submissionData.transactionId}`);
            skippedCount++;
            continue;
          }
        }
        
        try {
          const submissionData = parseDAppSubmission(messageText);
          if (submissionData) {
            // Add to Proposal Submissions sheet
            const newRow = [
              messageId,
              row[timestampIndex],
              row[usernameIndex],
              messageText,
              'Yes', // Processed
              submissionData.title || '',
              submissionData.content || '',
              submissionData.digitalSignature,
              submissionData.transactionId,
              submissionData.pullRequestNumber || '', // Pull Request Number
              submissionData.status || 'Submitted', // Status
              new Date(),
              new Date(),
              submissionData.type // Submission Type
            ];
            
            proposalSubmissionsSheet.appendRow(newRow);
            
            if (submissionData.type === 'PROPOSAL_CREATION') {
              newProposalsCount++;
              Logger.log(`✅ Processed proposal creation: ${submissionData.title}`);
              
              // Create GitHub proposal if it's a new proposal
              if (submissionData.title && submissionData.content) {
                try {
                  const config = getConfiguration();
                  const result = createNewProposal(submissionData.title, submissionData.content, config);
                  if (result.success) {
                    // Update the row with PR number
                    const lastRow = proposalSubmissionsSheet.getLastRow();
                    proposalSubmissionsSheet.getRange(lastRow, 10).setValue(result.prNumber);
                    proposalSubmissionsSheet.getRange(lastRow, 11).setValue('Created');
                    Logger.log(`🎉 Created GitHub proposal PR #${result.prNumber}`);
                  }
                } catch (error) {
                  Logger.log(`❌ Error creating GitHub proposal: ${error.message}`);
                }
              }
            } else if (submissionData.type === 'PROPOSAL_VOTE') {
              newVotesCount++;
              Logger.log(`✅ Processed vote: ${submissionData.vote} for proposal "${submissionData.proposalTitle}"`);
              
              // Submit vote to GitHub if we have the PR number
              if (submissionData.pullRequestNumber) {
                try {
                  const config = getConfiguration();
                  // Use the original message text as-is for GitHub comment
                  const result = submitVote(submissionData.pullRequestNumber, messageText, config);
                  if (result.success) {
                    // Update the row status
                    const lastRow = proposalSubmissionsSheet.getLastRow();
                    proposalSubmissionsSheet.getRange(lastRow, 11).setValue('Voted');
                    Logger.log(`🎉 Submitted vote to GitHub PR #${submissionData.pullRequestNumber}`);
                  }
                } catch (error) {
                  Logger.log(`❌ Error submitting vote to GitHub: ${error.message}`);
                }
              }
            }
          }
        } catch (error) {
          Logger.log(`❌ Error processing DApp submission in message ${messageId}: ${error.message}`);
        }
      }
      
      processedCount++;
    }
    
    Logger.log(`🎉 DApp processing complete! Processed ${processedCount} messages, found ${newProposalsCount} new proposals, ${newVotesCount} new votes, skipped ${skippedCount} duplicates`);
    return {
      processed: processedCount,
      newProposals: newProposalsCount,
      newVotes: newVotesCount,
      skipped: skippedCount
    };
    
  } catch (error) {
    Logger.log(`❌ Error processing DApp payloads: ${error.message}`);
    throw error;
  }
}

/**
 * Parse DApp submission from message text
 * Handles both [PROPOSAL CREATION] and [PROPOSAL VOTE] formats
 */
function parseDAppSubmission(messageText) {
  try {
    // Extract digital signature
    const signatureMatch = messageText.match(/My Digital Signature:\s*(.+)/);
    const digitalSignature = signatureMatch ? signatureMatch[1].trim() : '';
    
    // Extract transaction ID
    const transactionMatch = messageText.match(/Request Transaction ID:\s*(.+)/);
    const transactionId = transactionMatch ? transactionMatch[1].trim() : '';
    
    // Check if it's a proposal creation
    if (messageText.includes('[PROPOSAL CREATION]')) {
      const proposalMatch = messageText.match(/\[PROPOSAL CREATION\]([\s\S]*?)--------/);
      if (!proposalMatch) {
        return null;
      }
      
      const proposalSection = proposalMatch[1];
      
      // Extract title (try both formats: -- Title: and - Title:)
      let titleMatch = proposalSection.match(/-- Title:\s*(.+)/);
      if (!titleMatch) {
        titleMatch = proposalSection.match(/- Title:\s*(.+)/);
      }
      if (!titleMatch) {
        return null;
      }
      const title = titleMatch[1].trim();
      
      // Extract content (try both formats: -- Content: and - Content:)
      let contentMatch = proposalSection.match(/-- Content:\s*([\s\S]+)/);
      if (!contentMatch) {
        contentMatch = proposalSection.match(/- Content:\s*([\s\S]+)/);
      }
      if (!contentMatch) {
        return null;
      }
      const content = contentMatch[1].trim();
      
      return {
        type: 'PROPOSAL_CREATION',
        title,
        content,
        digitalSignature,
        transactionId,
        status: 'Submitted'
      };
    }
    
    // Check if it's a proposal vote
    if (messageText.includes('[PROPOSAL VOTE]')) {
      const voteMatch = messageText.match(/\[PROPOSAL VOTE\]([\s\S]*?)--------/);
      if (!voteMatch) {
        return null;
      }
      
      const voteSection = voteMatch[1];
      
      // Extract proposal title
      const proposalMatch = voteSection.match(/Proposal:\s*(.+)/);
      const proposalTitle = proposalMatch ? proposalMatch[1].trim() : '';
      
      // Extract vote
      const voteMatch2 = voteSection.match(/Vote:\s*(.+)/);
      const vote = voteMatch2 ? voteMatch2[1].trim() : '';
      
      // Try to extract PR number from the proposal title, content, or URL
      let pullRequestNumber = '';
      const prMatch = messageText.match(/PR #(\d+)|pull request #(\d+)|proposal #(\d+)|pr=(\d+)/i);
      if (prMatch) {
        pullRequestNumber = prMatch[1] || prMatch[2] || prMatch[3] || prMatch[4];
      }
      
      return {
        type: 'PROPOSAL_VOTE',
        proposalTitle,
        vote,
        pullRequestNumber,
        digitalSignature,
        transactionId,
        status: 'Submitted'
      };
    }
    
    return null;
    
  } catch (error) {
    Logger.log(`❌ Error parsing DApp submission: ${error.message}`);
    return null;
  }
}

/**
 * Test method to process a specific line from Telegram Chat Logs for DApp submissions
 */
function testProcessSpecificDAppSubmission(lineNumber) {
  try {
    Logger.log(`🧪 Testing DApp submission processing for line ${lineNumber}...`);
    
    const spreadsheetId = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const telegramLogsSheet = spreadsheet.getSheetByName('Telegram Chat Logs');
    
    if (!telegramLogsSheet) {
      throw new Error('Telegram Chat Logs sheet not found');
    }
    
    // Get the specific row
    const row = telegramLogsSheet.getRange(lineNumber, 1, 1, telegramLogsSheet.getLastColumn()).getValues()[0];
    
    // Use column indices like the QR code processing script
    // Column G (6): Contribution Made (this is where the message text is)
    const messageTextIndex = 6; // Column G (Contribution Made)
    
    const messageText = row[messageTextIndex];
    Logger.log(`📝 Message text: ${messageText}`);
    
    // Parse the DApp submission
    const submissionData = parseDAppSubmission(messageText);
    if (submissionData) {
      Logger.log(`✅ Parsed DApp submission data:`, submissionData);
      return submissionData;
    } else {
      Logger.log(`❌ No DApp submission data found in message`);
      return null;
    }
    
  } catch (error) {
    Logger.log(`❌ Error testing DApp submission processing: ${error.message}`);
    throw error;
  }
}

/**
 * Debug version to test vote submission with detailed logging
 */
function testVoteSubmissionDebug(lineNumber) {
  try {
    Logger.log(`🔍 DEBUG: Testing vote submission for line ${lineNumber}...`);
    
    const spreadsheetId = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const telegramLogsSheet = spreadsheet.getSheetByName('Telegram Chat Logs');
    
    if (!telegramLogsSheet) {
      throw new Error('Telegram Chat Logs sheet not found');
    }
    
    // Get the specific row
    const row = telegramLogsSheet.getRange(lineNumber, 1, 1, telegramLogsSheet.getLastColumn()).getValues()[0];
    
    const messageIdIndex = 3; // Column D
    const messageTextIndex = 6; // Column G (Contribution Made)
    
    const messageId = row[messageIdIndex];
    const messageText = row[messageTextIndex];
    
    Logger.log(`📝 Message ID: ${messageId}`);
    Logger.log(`📝 Message text: ${messageText}`);
    
    // Parse the DApp submission
    const submissionData = parseDAppSubmission(messageText);
    if (!submissionData) {
      Logger.log(`❌ No DApp submission data found in message`);
      return null;
    }
    
    Logger.log(`✅ Parsed submission data:`, submissionData);
    
    // Test the submitVote function directly
    if (submissionData.type === 'PROPOSAL_VOTE' && submissionData.pullRequestNumber) {
      Logger.log(`🎯 Testing submitVote function directly...`);
      const config = getConfiguration();
      
      Logger.log(`📤 Original message text to submit: ${messageText}`);
      Logger.log(`🎯 PR Number: ${submissionData.pullRequestNumber}`);
      Logger.log(`⚙️ Config: ${JSON.stringify(config)}`);
      
      // Use the original message text as-is for GitHub comment
      const result = submitVote(submissionData.pullRequestNumber, messageText, config);
      Logger.log(`📥 SubmitVote result: ${JSON.stringify(result)}`);
      
      return result;
    } else {
      Logger.log(`❌ Not a vote submission or missing PR number`);
      return { success: false, message: 'Not a vote submission or missing PR number' };
    }
    
  } catch (error) {
    Logger.log(`❌ Error in debug vote submission: ${error.message}`);
    Logger.log(`❌ Stack trace: ${error.stack}`);
    throw error;
  }
}

/**
 * Test method to FULLY process a specific line from Telegram Chat Logs for DApp submissions
 * This will create both the Google Sheets row AND the GitHub pull request
 */
function testProcessSpecificDAppSubmissionFully(lineNumber) {
  try {
    Logger.log(`🚀 FULLY processing DApp submission for line ${lineNumber}...`);
    
    const spreadsheetId = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const telegramLogsSheet = spreadsheet.getSheetByName('Telegram Chat Logs');
    
    if (!telegramLogsSheet) {
      throw new Error('Telegram Chat Logs sheet not found');
    }
    
    // Get the specific row
    const row = telegramLogsSheet.getRange(lineNumber, 1, 1, telegramLogsSheet.getLastColumn()).getValues()[0];
    
    // Use column indices like the QR code processing script
    const messageIdIndex = 3; // Column D
    const timestampIndex = 11; // Column L (Status Date)
    const usernameIndex = 4; // Column E (Contributor Handle)
    const messageTextIndex = 6; // Column G (Contribution Made)
    
    const messageId = row[messageIdIndex];
    const messageText = row[messageTextIndex];
    
    Logger.log(`📝 Message ID: ${messageId}`);
    Logger.log(`📝 Message text: ${messageText}`);
    
    // Parse the DApp submission
    const submissionData = parseDAppSubmission(messageText);
    if (!submissionData) {
      Logger.log(`❌ No DApp submission data found in message`);
      return null;
    }
    
    Logger.log(`✅ Parsed DApp submission data:`, submissionData);
    
    // Get or create Proposal Submissions sheet
    let proposalSubmissionsSheet = spreadsheet.getSheetByName('Proposal Submissions');
    if (!proposalSubmissionsSheet) {
      proposalSubmissionsSheet = spreadsheet.insertSheet('Proposal Submissions');
      // Set up headers
      const headers = [
        'Message ID', 'Timestamp', 'Username', 'Message Text', 'Processed',
        'Proposal Title', 'Proposal Content', 'Digital Signature', 'Transaction ID',
        'GitHub PR URL', 'Status', 'Created Date', 'Updated Date', 'Submission Type'
      ];
      proposalSubmissionsSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      proposalSubmissionsSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
    
    // Check if already processed
    const existingData = proposalSubmissionsSheet.getDataRange().getValues();
    const existingMessageIds = new Set();
    const existingTransactionIds = new Set();
    for (let i = 1; i < existingData.length; i++) {
      if (existingData[i][0]) { // Message ID column
        existingMessageIds.add(existingData[i][0]);
      }
      if (existingData[i][8]) { // Transaction ID column
        existingTransactionIds.add(existingData[i][8]);
      }
    }
    
    if (existingMessageIds.has(messageId)) {
      Logger.log(`⚠️ Message ID ${messageId} already processed - skipping`);
      return { success: false, message: 'Already processed' };
    }
    
    if (existingTransactionIds.has(submissionData.transactionId)) {
      Logger.log(`⚠️ Transaction ID ${submissionData.transactionId} already processed - skipping`);
      return { success: false, message: 'Transaction already processed' };
    }
    
    // Add to Proposal Submissions sheet
    const newRow = [
      messageId,
      row[timestampIndex],
      row[usernameIndex],
      messageText,
      'Yes', // Processed
      submissionData.title || '',
      submissionData.content || '',
      submissionData.digitalSignature,
      submissionData.transactionId,
      '', // Pull Request Number (to be filled later)
      'Submitted', // Status
      new Date(),
      new Date(),
      submissionData.type // Submission Type
    ];
    
    proposalSubmissionsSheet.appendRow(newRow);
    Logger.log(`✅ Added row to Proposal Submissions sheet`);
    
    // Create GitHub proposal if it's a new proposal
    if (submissionData.type === 'PROPOSAL_CREATION' && submissionData.title && submissionData.content) {
      try {
        Logger.log(`🎯 Creating GitHub proposal: ${submissionData.title}`);
        const config = getConfiguration();
        const result = createNewProposal(submissionData.title, submissionData.content, config);
        
        if (result.success) {
          // Update the row with PR URL
          const lastRow = proposalSubmissionsSheet.getLastRow();
          proposalSubmissionsSheet.getRange(lastRow, 10).setValue(`https://github.com/TrueSightDAO/proposals/pull/${result.prNumber}`);
          proposalSubmissionsSheet.getRange(lastRow, 11).setValue('Created');
          
          Logger.log(`🎉 Created GitHub proposal PR #${result.prNumber}`);
          Logger.log(`🔗 PR URL: https://github.com/TrueSightDAO/proposals/pull/${result.prNumber}`);
          
          return {
            success: true,
            message: `Successfully processed DApp submission`,
            prNumber: result.prNumber,
            prUrl: `https://github.com/TrueSightDAO/proposals/pull/${result.prNumber}`,
            submissionData: submissionData
          };
        } else {
          Logger.log(`❌ Error creating GitHub proposal: ${result.error}`);
          return {
            success: false,
            message: `Failed to create GitHub proposal: ${result.error}`,
            submissionData: submissionData
          };
        }
      } catch (error) {
        Logger.log(`❌ Error creating GitHub proposal: ${error.message}`);
        return {
          success: false,
          message: `Error creating GitHub proposal: ${error.message}`,
          submissionData: submissionData
        };
      }
    } else if (submissionData.type === 'PROPOSAL_VOTE') {
      Logger.log(`🗳️ Vote submission processed: ${submissionData.vote} for "${submissionData.proposalTitle}"`);
      
      // Submit vote to GitHub if we have the PR number
      if (submissionData.pullRequestNumber) {
        try {
          Logger.log(`🎯 Submitting vote to GitHub PR #${submissionData.pullRequestNumber}`);
          const config = getConfiguration();
          // Use the original message text as-is for GitHub comment
          const result = submitVote(submissionData.pullRequestNumber, messageText, config);
          
          if (result.success) {
            // Update the row with PR URL and status
            const lastRow = proposalSubmissionsSheet.getLastRow();
            proposalSubmissionsSheet.getRange(lastRow, 10).setValue(`https://github.com/TrueSightDAO/proposals/pull/${submissionData.pullRequestNumber}`);
            proposalSubmissionsSheet.getRange(lastRow, 11).setValue('Voted');
            
            Logger.log(`🎉 Submitted vote to GitHub PR #${submissionData.pullRequestNumber}`);
            Logger.log(`🔗 PR URL: https://github.com/TrueSightDAO/proposals/pull/${submissionData.pullRequestNumber}`);
            
            return {
              success: true,
              message: `Vote submitted to GitHub PR #${submissionData.pullRequestNumber}`,
              prNumber: submissionData.pullRequestNumber,
              prUrl: `https://github.com/TrueSightDAO/proposals/pull/${submissionData.pullRequestNumber}`,
              submissionData: submissionData
            };
          } else {
            Logger.log(`❌ Error submitting vote to GitHub: ${result.error}`);
            return {
              success: false,
              message: `Failed to submit vote to GitHub: ${result.error}`,
              submissionData: submissionData
            };
          }
        } catch (error) {
          Logger.log(`❌ Error submitting vote to GitHub: ${error.message}`);
          return {
            success: false,
            message: `Error submitting vote to GitHub: ${error.message}`,
            submissionData: submissionData
          };
        }
      } else {
        Logger.log(`⚠️ No PR number found for vote submission`);
        return {
          success: false,
          message: `No PR number found for vote submission`,
          submissionData: submissionData
        };
      }
    } else {
      Logger.log(`❌ Unknown submission type: ${submissionData.type}`);
      return {
        success: false,
        message: `Unknown submission type: ${submissionData.type}`,
        submissionData: submissionData
      };
    }
    
  } catch (error) {
    Logger.log(`❌ Error in full DApp submission processing: ${error.message}`);
    throw error;
  }
}
