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

  Logger.log(`Creating test proposal: ${proposalTitle}`);
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
function testSubmitMultipleVotes(prNumber = 2) {
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
function testSubmitComments(prNumber = 2) {
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
function testVoteTabulation(prNumber = 2) {
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
function testCloseVoting(prNumber = 2) {
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
function testSubmitVoteOnly(prNumber = 2) {
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
function testSubmitCommentOnly(prNumber = 2) {
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
function testVoteUpdate(prNumber = 2) {
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
