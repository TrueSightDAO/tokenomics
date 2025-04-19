// Before running the script, ensure API keys are set in Script Properties.
// Go to 'Project Settings' > 'Script Properties' in the Apps Script editor and manually add:
// - 'TELEGRAM_API_TOKEN': Your Telegram Bot API token
// - 'OPENAI_API_KEY': Your OpenAI API key (if applicable)
// Alternatively, implement setApiKeys() locally to set these properties, then remove or comment it out.
// Example setApiKeys() implementation (run locally, then remove/comment out):
// function setApiKeys() {
//   PropertiesService.getScriptProperties().setProperty('TELEGRAM_API_TOKEN', 'your-telegram-token-here');
//   PropertiesService.getScriptProperties().setProperty('OPENAI_API_KEY', 'your-openai-key-here');
// }
// setApiKeys(); // Uncomment this only temporarily if using setApiKeys() to set keys locally.

// Calls a function to set API keys in Script Properties (not included in shared code for security).
// This line is commented out by default; uncomment only for local setup, then re-comment or remove.
setApiKeys();

var telegramBotKey = PropertiesService.getScriptProperties().getProperty('TELEGRAM_API_TOKEN');
// Defines the Google Sheet ID where Telegram chat logs are stored.
// The full URL for this Sheet is: https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit
// Replace this ID with your own Sheet ID to use a different spreadsheet.
var telegramGoogleSheetId = "1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ";

var telegramLogTab = SpreadsheetApp.openById(telegramGoogleSheetId).getSheetByName("Telegram Chat Logs");

function processTelegramLogs() {
  setNextAirDropDate();

  var off_set = getMostRecentUpdateId();
  var request_url = "https://api.telegram.org/bot" + PropertiesService.getScriptProperties().getProperty('TELEGRAM_API_TOKEN') + "/getUpdates?offset=" + off_set;  

  Logger.log("Telegram API Request: " + request_url);
  var response = UrlFetchApp.fetch(request_url);
  var content = response.getContentText();
  var response_obj = JSON.parse(content); 
  var chat_ids = []; 
  var chat_packets = {};

  response_obj.result.forEach(function(entry) {
    if (entry.message) {
      if (checkMessageRecordExists(entry.update_id)) {
        Logger.log("Existing Record " + entry.message.message_id + " : " + entry.message.text);
      } else {
        Logger.log("New Record  " + entry.message.message_id + " : " + entry.message.text);
        var contributor_handle = (entry.message.from.username || entry.message.from.first_name);
        var contributor_text = (
          entry.message.text || 
          entry.message.caption || 
          entry.message.reply_to_message && (
            entry.message.reply_to_message.text || 
            entry.message.reply_to_message.caption             
          )
        );

        var all_contributors = checkAdditionalContributors(contributor_text);
        all_contributors.push(contributor_handle);

        all_contributors.forEach(function(current_contributor_handle) {
          var tdg_issued = addTabulationEntry(
            entry.update_id,
            entry.message.chat.id,
            entry.message.chat.title,
            entry.message.message_id,
            current_contributor_handle,
            "",
            contributor_text,
            formatDate(entry.message.date) 
          );

          if (!chat_ids.includes(entry.message.chat.id) && tdg_issued > 0) {
            chat_ids.push(entry.message.chat.id);
            chat_packets[entry.message.chat.id] = chat_packets[entry.message.chat.id] || [];
            chat_packets[entry.message.chat.id].push(current_contributor_handle);
          } else if (tdg_issued > 0) {
            if (!chat_packets[entry.message.chat.id].includes(current_contributor_handle)) {
              chat_packets[entry.message.chat.id].push(current_contributor_handle);
            }
          }
        });
      }
    }
  });
  acknowledgeMessagesWithReciepientsTillNow(chat_packets);
}

function checkMessageRecordExists(update_id) {
  var sheet = telegramLogTab;
  var column = 1; // Column A: Telegram Message ID
  var valueToCheck = update_id;
  var range = sheet.getRange(1, column, sheet.getLastRow());
  var values = range.getValues();
  var exists = values.some(function(row) {
    return row[0] === valueToCheck;
  });

  if (exists) {
    Logger.log("Record already exists");
  }
  return exists;
}

function addTabulationEntry(
  telegram_update_id, 
  telegram_chatroom_id,
  telegram_chatroom_name,  
  telegram_message_id, 
  contributor_name,
  project_name,
  contribution_made,
  status_date
) {
  var open_ai_scoring = checkTdgIssued(contribution_made);
  var openai_result = open_ai_scoring.split(';');
  var classification = "Unknown";
  var tdg_issue = 0;
  
  if (openai_result.length == 2) {
    classification = openai_result[0];
    tdg_issue = openai_result[1];
  }

  // Hardcode Status (Column I) to "Pending"
  var the_status = "Pending";

  var data = [
    telegram_update_id, 
    telegram_chatroom_id,
    telegram_chatroom_name,
    telegram_message_id, 
    contributor_name, 
    "", // Project Name
    contribution_made,
    classification,
    tdg_issue,
    the_status, // Column I: Status
    "", // Column K
    status_date
  ]; 
  telegramLogTab.appendRow(data);
  return tdg_issue;
}

function formatDate(timestamp) {
  var formattedDate = Utilities.formatDate(new Date(timestamp * 1000), "GMT", "yyyyMMdd");
  Logger.log(formattedDate);
  return formattedDate;
}

// Stubbed: No OpenAI API call, returns fixed "Unknown; 0"
function checkTdgIssued(workDescription) {
  return "Unknown; 0";
}

// Stubbed: No OpenAI API call, returns empty array
function checkAdditionalContributors(workDescription) {
  return [];
}

// Stubbed: No OpenAI API call, returns fixed future date
function getClosestEquinoxOrSolstice() {
  var fixedDate = "2025-06-21"; // Example future solstice date
  Logger.log("Next Airdrop date (stubbed): " + fixedDate);
  return fixedDate;
}

// Stubbed: No OpenAI API call, returns fixed fun fact
function getEntertainingInsight() {
  return "The Amazon has a fish that swims up urethras."; // 45 chars
}

function getMostRecentUpdateId() {
  var columnValues = telegramLogTab.getRange('A:A').getValues();
  var lastUpdateId = null;
  for (var i = columnValues.length - 1; i >= 0; i--) {
    if (columnValues[i][0] !== '') {
      lastUpdateId = columnValues[i][0];
      break;
    }
  }
  Logger.log("Most Recent Update ID: " + lastUpdateId);
  return lastUpdateId;
}

function setNextAirDropDate() {  
  var equinox_o_solstice_date = getClosestEquinoxOrSolstice();
  telegramLogTab.getRange("G1").setValue(equinox_o_solstice_date);
}

function sendMessageToTelegram(chatId, contributorUserNames) {
  const token = telegramBotKey;
  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;

  var contributor_names_string = contributorUserNames.map(function(str) {
    return "@" + str;
  }).join(", ");

  const payload = {
    chat_id: chatId,
    text: "Thank you very much " + contributor_names_string + " for contributing to our mission to regenerate 10,000 hectares of Amazon rainforest. Keep up the effort our planet needs it! I have duly noted all submissions received so far in this channel. To review the logs please reference 🙂🙏\n\nhttps://www.truesight.me/telegram-chatlog"
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  Logger.log(response.getContentText());
}

function acknowledgeMessagesTillNow(chatIds) {
  chatIds.forEach(function(chatId) {
    sendMessageToTelegram(chatId);
  });  
}

function acknowledgeMessagesWithReciepientsTillNow(chatPackets) {
  var chat_ids = Object.keys(chatPackets);
  chat_ids.forEach(function(chatId) {
    sendMessageToTelegram(chatId, chatPackets[chatId]);
  });  
}

function sendTestAcknowledgement() {
  sendMessageToTelegram(2102593402, ["garyjob"]);
}

// Example Usage for Testing
function testCheckTdgIssued() {
  var result = checkTdgIssued("Gary Teh spent 5 minutes for walking the dog");
  Logger.log(result); // Logs "Unknown; 0"
}

function testCheckAdditionalContributors() {
  var result = checkAdditionalContributors("Jerry, James, Richard spent 5 minutes for walking the dog");
  Logger.log(result); // Logs []
}